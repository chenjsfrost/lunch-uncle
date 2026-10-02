// Google Places API (New): text search, details and photos.

const BASE = 'https://places.googleapis.com/v1';
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

export const hasPlacesKey = () => Boolean(API_KEY);

const BASIC_FIELDS = [
  'id', 'displayName', 'location', 'rating', 'userRatingCount', 'priceLevel',
  'currentOpeningHours.openNow', 'shortFormattedAddress', 'primaryTypeDisplayName', 'photos',
];
const DETAIL_FIELDS = [
  ...BASIC_FIELDS, 'editorialSummary', 'regularOpeningHours.weekdayDescriptions', 'reviews', 'servesVegetarianFood',
];

const PRICE = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

// Places seen recently, so follow-up questions ("the second one?") can refer
// back to them across requests. Kept small; oldest entries are dropped first.
const cache = new Map();
const CACHE_MAX = 500;
export const cachedPlace = (id) => cache.get(id);
function remember(place) {
  cache.delete(place.id);
  cache.set(place.id, place);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return place;
}

export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(h)));
}

function normalize(p, origin) {
  const lat = p.location?.latitude;
  const lng = p.location?.longitude;
  return remember({
    id: p.id,
    name: p.displayName?.text || 'Unnamed place',
    lat,
    lng,
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
    price: PRICE[p.priceLevel] || null,
    open: p.currentOpeningHours?.openNow ?? null,
    address: p.shortFormattedAddress || '',
    type: p.primaryTypeDisplayName?.text || '',
    distance: origin && lat != null ? distanceM(origin, { lat, lng }) : null,
    photoName: p.photos?.[0]?.name || null,
  });
}

async function google(path, { method = 'GET', fields, body, signal } = {}) {
  const res = await fetch(`${BASE}/${path}`, {
    method,
    headers: {
      'X-Goog-Api-Key': API_KEY,
      ...(fields && { 'X-Goog-FieldMask': fields }),
      ...(body && { 'Content-Type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${data.error?.message || 'request failed'}`);
  return data;
}

export async function searchPlaces({ query, origin, radius = 1500, openNow = false, signal }) {
  const data = await google('places:searchText', {
    method: 'POST',
    fields: BASIC_FIELDS.map((f) => `places.${f}`).join(','),
    body: {
      textQuery: query,
      locationBias: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius } },
      openNow,
      maxResultCount: 10,
      languageCode: 'en',
      regionCode: 'SG',
    },
    signal,
  });
  const places = (data.places || []).map((p) => normalize(p, origin));
  // locationBias only prefers nearby results; drop ones that are clearly too far,
  // but keep a few nearest if the area is sparse.
  const near = places.filter((p) => p.distance != null && p.distance <= radius * 2);
  return near.length >= 3 ? near : [...places].sort((a, b) => a.distance - b.distance).slice(0, 5);
}

export async function placeDetails(id, { origin, signal } = {}) {
  const p = await google(`places/${encodeURIComponent(id)}`, { fields: DETAIL_FIELDS.join(','), signal });
  return {
    place: normalize(p, origin),
    summary: p.editorialSummary?.text || '',
    hours: p.regularOpeningHours?.weekdayDescriptions || [],
    vegetarian: p.servesVegetarianFood ?? null,
    reviews: (p.reviews || []).slice(0, 4).map((r) => ({
      rating: r.rating,
      when: r.relativePublishTimeDescription,
      text: (r.text?.text || '').slice(0, 280),
    })),
  };
}

// Returns a short-lived googleusercontent URL. The API key is not in it,
// so it is safe to hand to the browser.
export async function photoUrl(photoName, { signal } = {}) {
  if (!photoName) return null;
  try {
    const data = await google(`${photoName}/media?maxWidthPx=480&skipHttpRedirect=true`, { signal });
    return data.photoUri || null;
  } catch {
    return null;
  }
}

// ---------- "where am I" (reverse geocoding from Places Nearby) ----------
// The Geocoding API isn't enabled on this key, so describe the location by the
// most recognisable landmark nearby plus its neighbourhood, e.g.
// "near Bugis Street, Rochor". Lower rank = more recognisable type; a landmark
// wins over a closer but less known one when rank * RANK_WEIGHT_M outweighs
// distance. Popular places (many Google reviews) get a bonus, so "Marina Bay
// Sands" beats a lobby counter inside it.
const LANDMARK_RANK = {
  shopping_mall: 0, subway_station: 0, train_station: 0, light_rail_station: 0,
  tourist_attraction: 1, university: 1, hospital: 1,
  park: 2, hotel: 2, stadium: 2, library: 2,
  community_center: 3, market: 3, food_court: 3, housing_complex: 3, apartment_complex: 3,
  school: 4,
  bus_station: 5, transit_station: 5, bus_stop: 5,
};
const RANK_WEIGHT_M = 150;
const POPULARITY_WEIGHT_M = 80; // per 10x reviews
const MIN_REVIEWS = 20; // below this, a non-mall/MRT place is too obscure to name
const WHERE_RADIUS_M = 400;

const whereCache = new Map();

function component(place, type) {
  return (place.addressComponents || []).find((c) => c.types?.includes(type))?.longText || null;
}

export async function whereAmI(origin, { signal } = {}) {
  // ~100 m grid, so people moving around a block share one lookup.
  const key = `${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`;
  if (whereCache.has(key)) return whereCache.get(key);

  const data = await google('places:searchNearby', {
    method: 'POST',
    fields: 'places.displayName,places.primaryType,places.types,places.location,places.addressComponents,places.userRatingCount',
    body: {
      includedTypes: Object.keys(LANDMARK_RANK),
      locationRestriction: { circle: { center: { latitude: origin.lat, longitude: origin.lng }, radius: WHERE_RADIUS_M } },
      rankPreference: 'DISTANCE',
      maxResultCount: 20,
      languageCode: 'en',
    },
    signal,
  });

  const places = data.places || [];
  const scored = places
    .map((p) => {
      const rank = Math.min(...(p.types || [p.primaryType]).map((t) => LANDMARK_RANK[t] ?? Infinity));
      const loc = { lat: p.location?.latitude, lng: p.location?.longitude };
      const popularity = Math.log10((p.userRatingCount || 0) + 1) * POPULARITY_WEIGHT_M;
      return { p, rank, score: rank * RANK_WEIGHT_M + distanceM(origin, loc) - popularity };
    })
    .filter((x) => Number.isFinite(x.rank) && (x.rank === 0 || (x.p.userRatingCount || 0) >= MIN_REVIEWS))
    .sort((a, b) => a.score - b.score);

  const best = scored[0]?.p;
  const hood = places.map((p) => component(p, 'neighborhood') || component(p, 'sublocality_level_1') || component(p, 'sublocality')).find(Boolean);
  const name = best?.displayName?.text;

  let label = null;
  if (name && hood && !name.includes(hood)) label = `near ${name}, ${hood}`;
  else if (name) label = `near ${name}`;
  else if (hood) label = `in ${hood}`;

  const result = { label, landmark: name || null, area: hood || null };
  whereCache.set(key, result);
  if (whereCache.size > 2000) whereCache.delete(whereCache.keys().next().value);
  return result;
}

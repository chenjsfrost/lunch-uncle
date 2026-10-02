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

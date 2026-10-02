// Walking directions for the in-chat map.
//
// Uses the free FOSSGIS OSRM server (OpenStreetMap data, foot profile, no key).
// Routes follow real walkways, so they go around buildings instead of through them.
// Fair-use public server: fine for a prototype. For production, route through
// the backend (OneMap or Google Routes) — see FEATURES.md.
//
// getRoute(from, place) → { path, distance, minutes, steps: [{ at, text }], approx }
//   path   [{ lat, lng }, …] from you to the place
//   at     index into path where that step begins
//   approx true when the router was unreachable and we fell back to a rough line

const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot';
const ROUTE_TIMEOUT_MS = 6000;

async function osrm(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ROUTE_TIMEOUT_MS);
  try {
    const res = await fetch(`${OSRM_FOOT}/${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = await res.json();
    if (data.code !== 'Ok') throw new Error(`OSRM ${data.code}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Move a point onto the nearest walkable path (so pins don't sit in the sea
// or in the middle of a building). Returns the original point on failure.
async function snapToWalkway(pt) {
  try {
    const data = await osrm(`nearest/v1/foot/${pt.lng},${pt.lat}`);
    const [lng, lat] = data.waypoints[0].location;
    return { lat, lng };
  } catch {
    return { lat: pt.lat, lng: pt.lng };
  }
}

// ---------- uncle-style instructions ----------
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = (bearing) => COMPASS[Math.round(bearing / 45) % 8];
const metresText = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} metres`);
const onto = (name) => (name ? ` onto ${name}` : '');

const TURN = {
  left: 'Turn left',
  right: 'Turn right',
  'slight left': 'Keep slightly left',
  'slight right': 'Keep slightly right',
  'sharp left': 'Turn sharp left',
  'sharp right': 'Turn sharp right',
  straight: 'Go straight',
  uturn: 'Turn back',
};

const LONG_WALK_QUIPS = [
  'Long a bit, walk slowly, burn calories first.',
  'Steady walk, good for digestion later.',
  'Shade got or not ah? Bring umbrella.',
];

function stepText(step, place, i) {
  const { type, modifier, bearing_after: bearing, exit } = step.maneuver;
  const dist = metresText(step.distance);
  // OSM sometimes names paths with a single letter ("D"); not useful to say aloud.
  const name = step.name && step.name.length > 2 ? step.name : '';
  let text;
  if (type === 'depart') {
    text = `Start walking ${compass(bearing)}${name ? ` on ${name}` : ''}, about ${dist}.`;
  } else if (type === 'arrive') {
    const side = modifier === 'left' || modifier === 'right' ? `on your ${modifier}` : 'right in front of you';
    return `${place.name} is ${side}. Reached already! Enjoy your makan!`;
  } else if (type === 'roundabout' || type === 'rotary') {
    text = `At the roundabout, take exit ${exit ?? 1}${onto(name)}, then ${dist}.`;
  } else if (type === 'end of road') {
    text = `At the end of the path, ${(TURN[modifier] || 'turn').toLowerCase()}${onto(name)}, walk ${dist}.`;
  } else if (type === 'new name' || (type === 'continue' && modifier === 'straight')) {
    text = `Continue straight${onto(name)}, ${dist}.`;
  } else {
    text = `${TURN[modifier] || 'Continue'}${onto(name)}, then walk ${dist}.`;
  }
  if (step.distance > 350) text += ` ${LONG_WALK_QUIPS[i % LONG_WALK_QUIPS.length]}`;
  return text;
}

const TINY_STEP_M = 15;

// Fold "continue straight / road changes name" steps and tiny jogs (e.g. a
// 10 m zig-zag at a crossing) into the previous step, so uncle only talks
// when you actually need to turn.
function mergeSteps(steps) {
  const out = [];
  for (const s of steps) {
    const { type, modifier } = s.maneuver;
    const passive = type === 'new name' || (type === 'continue' && modifier === 'straight')
      || (s.distance < TINY_STEP_M && type !== 'depart' && type !== 'arrive');
    const prev = out[out.length - 1];
    if (passive && prev && prev.maneuver.type !== 'arrive') {
      prev.distance += s.distance;
      prev.coords += s.geometry.coordinates.length - 1;
    } else {
      out.push({ ...s, coords: s.geometry.coordinates.length - 1 });
    }
  }
  return out;
}

async function getRoute(from, place) {
  try {
    const data = await osrm(
      `route/v1/foot/${from.lng},${from.lat};${place.lng},${place.lat}?steps=true&overview=full&geometries=geojson`,
    );
    const route = data.routes[0];
    // Start at you and end at the pin, even if the router snapped both onto a path.
    const path = [
      { lat: from.lat, lng: from.lng },
      ...route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      { lat: place.lat, lng: place.lng },
    ];
    let at = 1;
    const steps = mergeSteps(route.legs[0].steps).map((s, i) => {
      const step = { at, text: stepText(s, place, i) };
      at += s.coords;
      return step;
    });
    steps[0].at = 0;
    return {
      path,
      distance: Math.round(route.distance),
      minutes: Math.max(1, Math.round(route.duration / 60)),
      steps,
      approx: false,
    };
  } catch (err) {
    console.warn('Routing failed, using rough line:', err);
    return roughRoute(from, place);
  }
}

// Fallback when the router is unreachable: a straight line, clearly labelled.
function roughRoute(from, place) {
  const kx = 111320 * Math.cos((from.lat * Math.PI) / 180);
  const east = (place.lng - from.lng) * kx;
  const north = (place.lat - from.lat) * 111320;
  const distance = Math.round(Math.hypot(east, north));
  const bearing = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
  return {
    path: [{ lat: from.lat, lng: from.lng }, { lat: place.lat, lng: place.lng }],
    distance,
    minutes: Math.max(1, Math.round(distance / 80)),
    steps: [
      { at: 0, text: `Uncle's map signal weak leh. Roughly head ${compass(bearing)}, about ${metresText(distance)}. Follow the walkway, don't cut through buildings ah.` },
      { at: 1, text: `${place.name} should be around here. Reached already! Enjoy your makan!` },
    ],
    approx: true,
  };
}

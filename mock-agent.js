// Mock agent loop: demo mode with sample places, used when no backend is
// reachable (e.g. on GitHub Pages). The real agent runs in server/agent.js.
//
// mockRunAgent(history, ctx) is an async generator that yields the same events the
// real backend will stream later (see FEATURES.md → "Event protocol"):
//   { type: 'status',      text }               uncle's thinking line
//   { type: 'tool_call',   id, name, label }    agent started a tool
//   { type: 'tool_result', id, summary }        tool finished
//   { type: 'final',       text, places?, origin? }   uncle's answer
//
// Walking directions live in routing.js (real router, not mocked).
//
// All places below are fictional sample data.

const PLACES = [
  { name: 'Ah Seng Chicken Rice', tags: ['chicken rice', 'cheap', 'local', 'rice'], price: '$', rating: 4.6, distance: 350, open: true,
    note: 'Steamed chicken very smooth, chilli got kick. Queue a bit, but worth it.' },
  { name: 'Mak Cik Nasi Padang', tags: ['halal', 'malay', 'spicy', 'rice', 'cheap'], price: '$', rating: 4.5, distance: 600, open: true,
    note: 'Rendang is power. Go before 1pm or the good stuff all gone already.' },
  { name: 'Hock Kee Bak Chor Mee', tags: ['noodles', 'cheap', 'local'], price: '$', rating: 4.4, distance: 450, open: true,
    note: 'Ask for more vinegar. Trust uncle.' },
  { name: 'Green Bowl Salad Bar', tags: ['healthy', 'vegetarian', 'salad'], price: '$$', rating: 4.3, distance: 800, open: true,
    note: 'Healthy stuff. Your doctor will be proud of you.' },
  { name: "Ravi's Prata House", tags: ['halal', 'indian', 'supper', 'cheap', 'late'], price: '$', rating: 4.5, distance: 900, open: true,
    note: 'Open until very late. Prata crispy, teh tarik thick.' },
  { name: 'Lao Ban Fish Soup', tags: ['healthy', 'soup', 'local', 'fish'], price: '$', rating: 4.4, distance: 520, open: false,
    note: 'Clear soup, very nourishing. Closed now though. Come back tomorrow.' },
  { name: 'Sin Ming Zi Char', tags: ['supper', 'zi char', 'group', 'seafood', 'late'], price: '$$', rating: 4.2, distance: 1200, open: true,
    note: 'Bring your kakis. Order the salted egg sotong.' },
  { name: 'Kopi & Kaya Corner', tags: ['breakfast', 'coffee', 'cheap', 'local'], price: '$', rating: 4.1, distance: 200, open: true,
    note: 'Kaya toast, soft-boiled eggs, kopi-o. Simple but shiok.' },
];

const KEYWORDS = {
  'chicken rice': ['chicken rice'],
  cheap: ['cheap', 'budget', 'affordable', 'broke'],
  halal: ['halal', 'muslim'],
  supper: ['supper', 'late', 'midnight', 'night'],
  healthy: ['healthy', 'diet', 'salad', 'light'],
  vegetarian: ['vegetarian', 'vegan', 'veg'],
  noodles: ['noodle', 'mee', 'mian'],
  spicy: ['spicy', 'chilli', 'chili'],
  coffee: ['coffee', 'kopi', 'breakfast'],
  seafood: ['seafood', 'crab', 'fish'],
};

const STATUS = {
  reading: ['Uncle reading your message…', 'Wah, let uncle think ah…', 'Hmm, uncle scratching head…'],
  searching: ['Uncle checking the area…', 'Uncle asking his kakis…', 'Uncle walking around kopitiam…'],
  deciding: ['Uncle comparing the queues…', 'Uncle tasting in his mind…', 'Uncle choosing the best for you…'],
};

const OPENERS = [
  'Wah, you asking the right person! Uncle eat around here 30 years already.',
  'Okay okay, listen to uncle ah.',
  "Aiyo, hungry already is it? Don't worry, uncle got you.",
  'Steady lah, uncle got some good ones for you.',
];
const CLOSERS = [
  'Go early ah, lunch crowd very siao one!',
  'Eat slowly, enjoy. Then come back tell uncle how.',
  "Don't waste time thinking, just go lah!",
  'If not nice, you come find uncle. Confirm nice one.',
];
const SMALLTALK = {
  greet: [
    'Eh hello hello! Hungry already ah? Tell uncle what you feel like eating, or just say "anything" and uncle decide for you.',
    "Wah, you came to see uncle! What you want to makan today? Cheap, healthy, spicy? Just tell me.",
  ],
  thanks: ['No problem lah! Eat well, then come back and tell uncle how.', 'Welcome welcome! Uncle very happy to help. Enjoy ah!'],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseIntent(text) {
  const lower = text.toLowerCase();
  const tags = Object.keys(KEYWORDS).filter((tag) => KEYWORDS[tag].some((w) => lower.includes(w)));
  const generic = /\b(anything|hungry|lunch|dinner|eat|food|makan|recommend|cheap|good)\b/.test(lower);
  return { tags, generic, query: tags.length ? tags.join(' + ') : generic ? 'good food' : text.trim() };
}

function searchPlaces({ tags }) {
  const scored = PLACES.map((p) => ({ ...p, score: tags.filter((t) => p.tags.includes(t)).length }))
    .filter((p) => !tags.length || p.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.open) - Number(a.open) || b.rating - a.rating);
  return scored.length ? scored : [...PLACES].sort((a, b) => b.rating - a.rating);
}

function compose(intent, places, matched) {
  const intro = matched
    ? pick(OPENERS)
    : `Hmm, uncle don't know any "${intent.query}" place nearby leh. But these ones also very good:`;
  const lines = places.map((p, i) => `${i + 1}. ${p.name}: ${p.note}`);
  return [intro, ...lines, pick(CLOSERS)].join('\n');
}

async function* mockRunAgent(history, ctx) {
  const text = history[history.length - 1].content.trim();
  const lower = text.toLowerCase();

  yield { type: 'status', text: pick(STATUS.reading) };
  await sleep(700);

  // Small talk: the real agent will answer directly without calling tools.
  const intent = parseIntent(text);
  if (/\b(thank|thanks|tq|ty)\b/.test(lower)) {
    yield { type: 'final', text: pick(SMALLTALK.thanks) };
    return;
  }
  if (!intent.tags.length && /^(hi|hello|hey|yo|uncle|morning|afternoon)\b/.test(lower)) {
    yield { type: 'final', text: pick(SMALLTALK.greet) };
    return;
  }

  yield { type: 'tool_call', id: 'loc', name: 'get_user_location', label: 'Checking where you are' };
  const loc = await ctx.getLocation();
  yield { type: 'tool_result', id: 'loc', summary: `You're at ${loc.label}` };

  yield { type: 'status', text: pick(STATUS.searching) };
  yield { type: 'tool_call', id: 'search', name: 'search_places', label: `Searching "${intent.query}" within 1km` };
  await sleep(1200);
  const results = searchPlaces(intent);
  const matched = intent.tags.length ? results.some((p) => p.score > 0) : intent.generic;
  yield { type: 'tool_result', id: 'search', summary: `Found ${results.length} places` };

  yield { type: 'status', text: pick(STATUS.deciding) };
  yield { type: 'tool_call', id: 'details', name: 'get_place_details', label: 'Checking reviews & opening hours' };
  await sleep(1000);
  // Sample places get scattered around you, then snapped onto a walkway so the
  // pins never land inside a building or in the sea.
  const top = await Promise.all(
    results.slice(0, 3).map(async (p) => ({ ...p, ...(await snapToWalkway(placeLocation(loc, p))) })),
  );
  yield { type: 'tool_result', id: 'details', summary: `Shortlisted top ${top.length}` };

  yield { type: 'final', text: compose(intent, top, matched), places: top, origin: loc };
}

// ---------- mock geometry (real coords + routes will come from Google) ----------
const M_PER_DEG = 111320;

function offset(from, east, north) {
  return {
    lat: from.lat + north / M_PER_DEG,
    lng: from.lng + east / (M_PER_DEG * Math.cos((from.lat * Math.PI) / 180)),
  };
}

function hash(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

// Scatter the sample places around the user at their listed distance.
function placeLocation(from, place) {
  const bearing = ((hash(place.name) % 360) * Math.PI) / 180;
  return offset(from, place.distance * Math.sin(bearing), place.distance * Math.cos(bearing));
}

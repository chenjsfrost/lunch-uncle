// The agentic loop: the model calls tools until it calls `recommend`.
// Emits the same events the frontend already renders (see FEATURES.md).

import { chat } from './llm.js';
import { searchPlaces, placeDetails, photoUrl, cachedPlace } from './places.js';

const MAX_TURNS = 6;
const MAX_PICKS = 3;

const STATUS = {
  first: ['Uncle reading your message…', 'Wah, let uncle think ah…', 'Hmm, uncle scratching head…'],
  next: ['Uncle comparing the queues…', 'Uncle tasting in his mind…', 'Uncle asking his kakis…', 'Uncle checking the reviews…'],
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function systemPrompt(place) {
  const now = new Date().toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', weekday: 'long', hour: 'numeric', minute: '2-digit',
  });
  return `You are "Lunch Uncle", a friendly Singaporean kopitiam uncle in his 60s who has eaten everywhere. You help the user find food near them.

Current time in Singapore: ${now}.${place ? `
The user is ${place}. You can mention the area naturally.` : ''}

STYLE
- Talk like a warm, cheeky Singapore uncle: casual Singlish (lah, leh, ah, wah, aiyo, shiok, makan, can or not), but always easy to understand.
- Short and opinionated. No markdown, no lists, no headings, no emojis.
- Never mention tools, APIs, Google, ratings counts or "search results". Uncle just knows.

HOW TO WORK
- For any food request, call search_places first. Searches are already centred on the user's location. Put the user's wants (cuisine, dish, halal, vegetarian, budget words like "hawker" or "cheap") into the query.
- If results look poor, try one different search (broader query or bigger radius).
- You may call get_place_details on up to 3 promising places to check reviews or hours before deciding.
- Finish by calling recommend exactly once. Only use place_ids that tools returned. Never invent places, dishes you have no evidence for, or facts.
- Prefer places that are open now, nearby, and well rated with many reviews. Say so if a pick is closed or far.
- Halal: only call a place halal if its name, type or reviews make that clear; otherwise tell them to check the halal cert.
- For greetings, thanks or chit-chat, call recommend with no picks and a short friendly reply. If asked about something unrelated to food, gently steer back to makan.

THE recommend CALL
- reply: what uncle says out loud. 1 to 3 sentences, under 60 words. Don't repeat each place's details; the app shows cards.
- picks: up to ${MAX_PICKS} places, best first, each with a one-line uncle comment (under 20 words) on why go there.`;
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_places',
      description: 'Search for food places near the user. Returns up to 10 places with rating, price, distance and open status.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to search for, e.g. "chicken rice", "halal nasi lemak", "cheap hawker food", "supper prata".' },
          open_now: { type: 'boolean', description: 'Only places open right now. Use when the user wants to eat now.' },
          radius_m: { type: 'integer', description: 'Search radius in metres, 300 to 5000. Default 1500.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_place_details',
      description: 'Get recent reviews, opening hours and a summary for one place.',
      parameters: {
        type: 'object',
        properties: { place_id: { type: 'string' } },
        required: ['place_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'recommend',
      description: 'Give the final answer to the user. Call exactly once, at the end.',
      parameters: {
        type: 'object',
        properties: {
          reply: { type: 'string', description: 'What uncle says, in his voice.' },
          picks: {
            type: 'array',
            maxItems: MAX_PICKS,
            items: {
              type: 'object',
              properties: {
                place_id: { type: 'string' },
                note: { type: 'string', description: 'One-line uncle comment on this place.' },
              },
              required: ['place_id', 'note'],
            },
          },
        },
        required: ['reply'],
      },
    },
  },
];

// What the model sees for a place (compact, no internal fields).
const forModel = (p) => ({
  place_id: p.id,
  name: p.name,
  type: p.type,
  rating: p.rating,
  reviews: p.reviews,
  price: p.price,
  open_now: p.open,
  distance_m: p.distance,
  address: p.address,
});

export async function runAgent({ history, origin, emit, signal }) {
  const messages = [{ role: 'system', content: systemPrompt(origin.label) }, ...history];
  const seen = new Map();

  const tools = {
    async search_places(args) {
      const radius = Math.min(5000, Math.max(300, Number(args.radius_m) || 1500));
      const places = await searchPlaces({ query: String(args.query || 'food'), origin, radius, openNow: Boolean(args.open_now), signal });
      places.forEach((p) => seen.set(p.id, p));
      return { result: places.map(forModel), summary: `Found ${places.length} places` };
    },
    async get_place_details(args) {
      const d = await placeDetails(String(args.place_id), { origin, signal });
      seen.set(d.place.id, d.place);
      const { place, ...rest } = d;
      return { result: { ...forModel(place), ...rest }, summary: `Read ${d.reviews.length} reviews of ${place.name}` };
    },
  };

  const labels = {
    search_places: (a) => `Searching "${a.query}"${a.open_now ? ', open now' : ''}`,
    get_place_details: (a) => `Checking reviews for ${seen.get(a.place_id)?.name || cachedPlace(a.place_id)?.name || 'a place'}`,
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    emit({ type: 'status', text: pick(turn === 0 ? STATUS.first : STATUS.next) });
    const msg = await chat(messages, TOOLS, { signal });
    const calls = msg.tool_calls || [];

    if (!calls.length) return finish({ reply: msg.content }, seen, origin, emit, signal);

    messages.push({
      role: 'assistant',
      content: msg.content || '',
      tool_calls: calls,
      ...(msg.reasoning_content && { reasoning_content: msg.reasoning_content }),
    });

    for (const call of calls) {
      const name = call.function?.name;
      let args = {};
      try { args = JSON.parse(call.function?.arguments || '{}'); } catch { /* keep {} */ }

      if (name === 'recommend') return finish(args, seen, origin, emit, signal);

      let content;
      if (tools[name]) {
        emit({ type: 'tool_call', id: call.id, name, label: labels[name](args) });
        try {
          const { result, summary } = await tools[name](args);
          content = result;
          emit({ type: 'tool_result', id: call.id, summary });
        } catch (err) {
          if (signal?.aborted) throw err;
          console.error(`[tool ${name}]`, err.message);
          content = { error: 'That lookup failed. Try something else or answer with what you have.' };
          emit({ type: 'tool_result', id: call.id, summary: 'Hmm, that one cannot find' });
        }
      } else {
        content = { error: `Unknown tool ${name}` };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(content) });
    }
  }

  // Ran out of turns: answer with the best of what was found.
  const fallback = [...seen.values()]
    .sort((a, b) => Number(b.open === true) - Number(a.open === true) || (b.rating ?? 0) - (a.rating ?? 0))
    .slice(0, MAX_PICKS)
    .map((p) => ({ place_id: p.id, note: '' }));
  return finish({ reply: 'Uncle think until head pain already. These ones look good, try lah!', picks: fallback }, seen, origin, emit, signal);
}

async function finish({ reply, picks = [] }, seen, origin, emit, signal) {
  const chosen = (Array.isArray(picks) ? picks : [])
    .map((pk) => ({ place: seen.get(pk?.place_id) || cachedPlace(pk?.place_id), note: String(pk?.note || '') }))
    .filter((x) => x.place && x.place.lat != null)
    .filter((x, i, arr) => arr.findIndex((y) => y.place.id === x.place.id) === i)
    .slice(0, MAX_PICKS);

  const places = await Promise.all(chosen.map(async ({ place, note }) => ({
    place_id: place.id,
    name: place.name,
    lat: place.lat,
    lng: place.lng,
    rating: place.rating,
    reviews: place.reviews,
    price: place.price,
    open: place.open,
    address: place.address,
    type: place.type,
    distance: place.distance,
    note,
    photo: await photoUrl(place.photoName, { signal }),
  })));

  const text = String(reply || '').trim() || 'Aiyo, uncle blur already. Ask me again?';
  // History for follow-ups: the model sees which places it showed, with ids.
  const memory = places.length
    ? `${text}\n(Places shown: ${places.map((p, i) => `${i + 1}. ${p.name} [${p.place_id}]`).join('; ')})`
    : text;

  emit({ type: 'final', text, places, origin, memory });
}

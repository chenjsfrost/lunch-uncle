# Lunch Uncle: Features & Wireframe Spec

A chatbot that recommends food near you, answering like a friendly kopitiam uncle.

## Persona

- **Who:** A friendly Singaporean kopitiam uncle in a white singlet with a towel on his shoulder. He has eaten around the area for 30 years.
- **Tone:** Warm, cheeky and confident, with light Singlish ("lah", "leh", "wah", "aiyo", "shiok", "makan"). He gives short, opinionated picks, never a dry list.
- **Voice:** Text-to-speech with a lower pitch and a slightly slower pace. It uses an `en-SG` voice if the device has one.
- **Rules:** He always recommends real places returned by the tools and never invents them. If nothing matches, he says so honestly and suggests the closest alternatives.

## Features

### Done
| Feature | Status |
|---|---|
| Chat UI styled as a kopitiam: kopi-brown header, floor-tile background, uncle avatar | ✅ |
| Animated SVG uncle: blinks when idle, tilts his head and looks around while thinking, moves his mouth while talking | ✅ |
| Thinking bubble with a steaming kopi cup, bouncing dots and a rotating uncle status line | ✅ |
| Agent step trail: each tool call appears as ⏳ and changes to ✅ when done | ✅ |
| Quick-reply chips (Cheap & good, Chicken rice, Halal, Supper, Healthy) | ✅ |
| Place cards: number, name, open/closed, rating, price, distance, uncle's comment | ✅ |
| Mini map in uncle's reply with you plus numbered pins (tap a pin to get directions) | ✅ |
| **In-app directions** ("Bring me there"): full map, walking route, ETA, uncle reading each step aloud, "Reached!" message back in chat. You never leave the app. | ✅ |
| **Real walking routes** that follow walkways and streets, never cutting through buildings. Turn-by-turn steps are in uncle's words, tiny crossing jogs are merged, and sample places are snapped onto walkways. | ✅ |
| Demo "Start walking" that moves your dot along the route and updates the current step and distance left | ✅ |
| Uncle voice (Web Speech API) with an on/off toggle | ✅ |
| Browser geolocation, falling back to central Singapore | ✅ |
| Small talk (greetings, thanks) without tool calls | ✅ |

| **Real agent loop** on the server (`server/agent.js`): an OpenCode model (`deepseek-v4.1-flash` by default) calls tools until it calls `recommend` | ✅ |
| **Google Places (New)**: text search near you, details with reviews and hours, a photo on each card | ✅ |
| Follow-ups ("what about the second one?"): earlier picks are kept in the history with their place ids | ✅ |
| Demo mode fallback with sample places when no backend is reachable (GitHub Pages) | ✅ |

### Next
- Deploy the backend so the GitHub Pages site can use it (set `config.js` → backend URL)
- Move routing to the backend using the OneMap Routing API (`routeType=walk`). It's free, made for Singapore, and covers sheltered linkways and overhead bridges, but it needs a token from a registered OneMap account, so it can't be called from the static page.
- Live tracking via `geolocation.watchPosition` replacing the demo walk
- **Required before public launch:** switch the map to the Google Maps JavaScript API. Google's terms don't allow showing Places data on a non-Google map, and real Places data is now shown on Leaflet/OpenStreetMap. This needs a browser key restricted to the site's domain.
- Remember preferences within a session (e.g. "no beef", "budget $5"). This partly works already through the history.
- Photo carousel on place cards
- Better uncle voice: a cloud TTS voice instead of the browser's built-in one

### Later ideas
- "Uncle, surprise me" roulette animation
- Group mode: several friends' preferences produce one pick
- Favourites / "uncle remember this place"

## Agentic loop design

```
user msg ─▶ LLM (uncle system prompt + tools)
              │
              ├─ tool_call get_user_location  ─▶ browser supplies coords
              ├─ tool_call search_places      ─▶ Google Places Nearby/Text Search
              ├─ tool_call get_place_details  ─▶ Google Places Details (hours, reviews)
              │        ▲            │
              │        └── results fed back to LLM, loop until it answers
              ▼
         final answer (uncle voice) + structured places[]
```

**Tools**

| Tool | Input | Backed by |
|---|---|---|
| `search_places` | `query`, `open_now`, `radius_m` | Google Places API (New): Text Search, biased to the user's location |
| `get_place_details` | `place_id` | Google Places API (New): Place Details (reviews, hours, summary) |
| `recommend` | `reply`, `picks: [{ place_id, note }]` | Ends the loop. The server checks the ids, then adds card data and photos. |

The browser's location is sent with each request, so it isn't an LLM tool.

Directions aren't an LLM tool. When you tap "Bring me there", the frontend calls `getRoute(from, place)` in `routing.js`. It returns `{ path, distance, minutes, steps: [{ at, text }], approx }`.

**Routing now:** the free FOSSGIS OSRM server (`routing.openstreetmap.de/routed-foot`), which uses OpenStreetMap data with the walking profile. It needs no key and allows browser requests from any site. It's a fair-use public server, fine for a prototype but not for production traffic. If it's unreachable, uncle falls back to a rough straight-line direction and says it's approximate.

**Routing later:** `GET /api/route` on the backend → OneMap Routing API (walk), with Google Routes API as an option. Only `getRoute()` changes, as long as it returns the same shape.

**Guardrails**
- At most 6 model turns per message, with a 45-second timeout per model call. If the turn limit is hit, uncle replies with the best places found so far.
- The model can only recommend place ids that tools actually returned.
- The history is capped at 12 messages of 2,000 characters each.
- Each IP is limited to 12 requests per minute.
- The server only sends a fixed list of frontend files, so `.env` and the server code are never served.

## Event protocol (frontend ⇄ backend)

The backend streams these as Server-Sent Events. `mock-agent.js` yields the same shapes, so `app.js` doesn't care which one is running.

`POST /api/chat` with `{ history: [{ role, content }], location: { lat, lng } }` streams back:

```js
{ type: 'status',      text: 'Uncle checking the area…' }
{ type: 'tool_call',   id, name: 'search_places', label: 'Searching "chicken rice" within 1km' }
{ type: 'tool_result', id, summary: 'Found 8 places' }
{ type: 'final',       text: 'Wah, you asking the right person!…',
  places: [{ place_id, name, lat, lng, rating, reviews, price, open, address, type, distance, note, photo }],
  origin: { lat, lng },
  memory: 'reply + (Places shown: 1. Name [place_id]; …)' }   // what the client stores in history
{ type: 'error', message }
```

## Files

```
index.html      layout, directions panel, uncle SVG template (Leaflet from cdnjs)
styles.css      kopitiam theme + all animations
config.js       backend URL ('' = same origin)
app.js          UI, voice, location, event handling (only depends on runAgent)
api-agent.js    runAgent(): streams from /api/chat, falls back to mock-agent.js
routing.js      real walking directions (OSRM foot) + uncle-style step text
mock-agent.js   fake agent loop with sample places; replace with backend client
server/
  index.js      HTTP server: static files, /api/health, /api/chat (SSE), CORS, rate limit
  agent.js      the agent loop, uncle system prompt, tool definitions
  llm.js        OpenCode Zen chat completions
  places.js     Google Places search / details / photos
.env.example    keys and options (never put keys in frontend code)
```

## Deploying the backend
GitHub Pages can only host static files, so the backend needs a host that runs Node, such as Render, Railway or Fly.io. Then:
1. Set the env vars from `.env.example` on the host.
2. Put the backend URL in `config.js` and push. The Pages site then switches out of demo mode.

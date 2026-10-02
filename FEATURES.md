# Lunch Uncle: Features & Wireframe Spec

A chatbot that recommends food near you, answering like a friendly kopitiam uncle.

## Persona

- **Who:** A friendly Singaporean kopitiam uncle in a white singlet with a towel on his shoulder. He has eaten around the area for 30 years.
- **Tone:** Warm, cheeky and confident, with light Singlish ("lah", "leh", "wah", "aiyo", "shiok", "makan"). He gives short, opinionated picks, never a dry list.
- **Voice:** Text-to-speech with a lower pitch and a slightly slower pace. It uses an `en-SG` voice if the device has one.
- **Rules:** He always recommends real places returned by the tools and never invents them. If nothing matches, he says so honestly and suggests the closest alternatives.

## Features

### MVP (in the wireframe now, using mock data)
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

### Next (needs API keys and a backend)
- Real agentic loop on the server using the OpenCode model API
- Google Places for real search, details, opening hours and photos
- Move routing to the backend using the OneMap Routing API (`routeType=walk`). It's free, made for Singapore, and covers sheltered linkways and overhead bridges, but it needs a token from a registered OneMap account, so it can't be called from the static page.
- Live tracking via `geolocation.watchPosition` replacing the demo walk
- Switch the map to the Google Maps JavaScript API: Google's terms don't allow showing Places data on a non-Google map, so Leaflet/OpenStreetMap is for the wireframe only
- Remember preferences within a session (e.g. "no beef", "budget $5")
- Follow-ups: "anything nearer?", "what about the second one?"
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
| `get_user_location` | none | Browser geolocation, sent with the request |
| `search_places` | `query`, `radius_m`, `open_now`, `price_level` | Google Places API (New): Text Search / Nearby Search |
| `get_place_details` | `place_id` | Google Places API (New): Place Details |

Directions aren't an LLM tool. When you tap "Bring me there", the frontend calls `getRoute(from, place)` in `routing.js`. It returns `{ path, distance, minutes, steps: [{ at, text }], approx }`.

**Routing now:** the free FOSSGIS OSRM server (`routing.openstreetmap.de/routed-foot`), which uses OpenStreetMap data with the walking profile. It needs no key and allows browser requests from any site. It's a fair-use public server, fine for a prototype but not for production traffic. If it's unreachable, uncle falls back to a rough straight-line direction and says it's approximate.

**Routing later:** `GET /api/route` on the backend → OneMap Routing API (walk), with Google Routes API as an option. Only `getRoute()` changes, as long as it returns the same shape.

Guardrails: at most about 5 tool iterations per message, plus a timeout. If the limit is hit, uncle replies with whatever he has found so far.

## Event protocol (frontend ⇄ backend)

The backend streams these as Server-Sent Events. `mock-agent.js` already yields the same shapes, so `app.js` won't need to change.

```js
{ type: 'status',      text: 'Uncle checking the area…' }
{ type: 'tool_call',   id, name: 'search_places', label: 'Searching "chicken rice" within 1km' }
{ type: 'tool_result', id, summary: 'Found 8 places' }
{ type: 'final',       text: 'Wah, you asking the right person!…',
  places: [{ name, rating, price, distance, open, note, place_id, lat, lng }],
  origin: { lat, lng } }
```

## Files

```
index.html      layout, directions panel, uncle SVG template (Leaflet from cdnjs)
styles.css      kopitiam theme + all animations
app.js          UI, voice, location, event handling (only depends on runAgent)
routing.js      real walking directions (OSRM foot) + uncle-style step text
mock-agent.js   fake agent loop with sample places; replace with backend client
.env.example    keys the backend will need (never put keys in frontend code)
```

## When the keys arrive
1. Add a small backend (e.g. Node/Express) with `POST /api/chat` that runs the loop and streams events.
2. Put `OPENCODE_API_KEY` and `GOOGLE_PLACES_API_KEY` in `.env` on the server.
3. Replace `mock-agent.js` with a `runAgent()` that calls `/api/chat` and yields the parsed SSE events.

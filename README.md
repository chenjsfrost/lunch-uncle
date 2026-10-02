# lunch-uncle

A food-recommendation chatbot that answers like a kopitiam uncle. 🍜

It runs an agent loop: an OpenCode model searches Google Places, reads reviews, then recommends real places nearby. Walking directions appear on a map inside the chat.

## Run it (real mode)

Needs Node 22 or later. Put your keys in `.env` (see `.env.example`), then:

```sh
npm start        # http://localhost:8787
```

No `npm install` is needed because there are no dependencies.

## Demo mode

The GitHub Pages site (https://chenjsfrost.github.io/lunch-uncle/) is static. It calls the backend on Render (https://lunch-uncle.onrender.com, set in `config.js`). If the backend cannot be reached, it falls back to a mock agent with sample places and says "Demo mode" in the header.

See [FEATURES.md](FEATURES.md) for the features, the agent loop and the event protocol.

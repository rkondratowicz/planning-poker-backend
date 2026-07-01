# Planning Poker frontend

Static, zero-build single-page frontend for the Planning Poker backend. Three flat files: `index.html`, `style.css`, `app.js`. Vue 3 ESM browser build via CDN import map (no bundler). Visual system: "Paper & Ink" (`docs/paper-and-ink-style-guide.md`).

## Run locally

Serve this directory over HTTP (a `file://` open won't resolve the WebSocket origin cleanly and forbids ES module CORS for the import map consistently across browsers):

```bash
pnpm dlx serve .     # or: python3 -m http.server
```

Open the printed local URL. With `?room=<id>` present it goes to the Join screen; otherwise the landing screen lets you generate a room.

The backend URL is resolved at runtime: `localhost` → `ws://localhost:3000/ws`, otherwise → `wss://planning-poker-backend.onrender.com/ws`.

## Deployment

Deployment (GitHub Pages / static host) is deferred until this frontend is relocated to its own `planning-poker-frontend` repo (see `docs/TASKS.md`). No `.nojekyll`, no build step, no `node_modules`.
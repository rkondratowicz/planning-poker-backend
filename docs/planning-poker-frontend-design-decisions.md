# Planning Poker — Frontend Design Decisions

This document records every decision made during the frontend design interview (Q1–Q41), grouped by area. It is the spec the implementation must conform to. Each entry references the interview question that produced it.

The frontend is a static page (no build step, no backend changes) for the [Planning Poker backend](./planning-poker-api-contract.md). It targets workshop-time use: short-lived estimation sessions with a facilitator and a handful of participants.

## TL;DR

Single-page static frontend served from a **separate GitHub repo** (`planning-poker-frontend`) via GitHub Pages on `main` root. Three flat files (`index.html`, `style.css`, `app.js`), zero build, one CDN dependency: **Vue 3 ESM browser build** loaded via `<script type="importmap">` (pinned version, `.prod.js`). State is one reactive object; the WebSocket lifecycle drives a 5-phase UI. Room ID rides in the `?room=` query param and is the shareable join link.

## 1. Hosting & deployment

- **Q1 — Hosting model: separate static host.** The page is *not* served by the backend. Backend stays backend-only; the frontend is a standalone static deploy. (Backend on Render, frontend on GitHub Pages — two independent deploys.)
- **Q2/Q3 — Repo split, plan-only in this session.** The frontend lives in its own repo, `planning-poker-frontend`, with GitHub Pages enabled on the `main` branch root. No files are generated in this backend repo; this document is the plan the new repo implements against.
- **Q4 — Repo name: `planning-poker-frontend`.** Symmetric with the backend repo, self-documenting. Pages URL: `https://rkondratowicz.github.io/planning-poker-frontend/`.
- **Q5 — Backend URL resolution: auto-detect from `location.hostname`.** `localhost` → `ws://localhost:3000/ws`; otherwise → the production Render URL (`wss://planning-poker-backend.onrender.com/ws`). One `if` at the top of `app.js`; the prod URL is still a named constant, easy to find and change.
- **Q7 — Room in URL: `?room=<roomId>` query param.** Survives hard refresh, zero GitHub Pages routing config (no path rewrites, no 404.html trick). Example: `https://.../planning-poker-frontend/?room=xk29-4plm`.
- **Q21 — Visual identity: deferred to a style-guide document provided later.** No color/type/density decisions are fixed here; implementation should consume the style guide when it arrives.

## 2. File structure & framework

- **Q11 — Vue 3 ESM via CDN import map.** No bundler, no compile step, no `node_modules`. `<script type="importmap">` pins `"vue": "https://unpkg.com/vue@3/dist/vue.esm-browser.prod.js"` (pin a specific version string at implementation time). One external runtime dependency (unpkg).
- **Q12 — Composition API.** `setup()` with `ref`/`reactive`/`computed`. The whole app is one reactive `state` plus a few computeds ("isHost", "myVote", "allVoted") — the Composition API's center case.
- **Q13 — Inline template in `index.html`.** Mount on a `#app` element whose existing markup uses Vue's `{{ }}` and `v-*` directives directly. No `template: '...'` string in JS; the browser parses the HTML before Vue boots.
- **Q37 — `v-cloak` + "Loading…" outside `#app`.** `[v-cloak] { display: none }` in `style.css` hides the raw template until Vue mounts. A small static "Loading…" line outside `#app` (no Vue dependency) shows *something* immediately so the user isn't staring at a bare blank.
- **Q11 (reaffirmed) — three flat files:** `index.html` (markup + import map + mount point), `style.css`, `app.js` (Vue `createApp` + WS logic).

## 3. Entry flow & room management

- **Q8 — Single landing screen, conditional button.** If `?room=` is present: show "Joining room `xk29-4plm`" + name input + "Join" button. If absent: show name input + "Start" button that generates a new room ID. One screen, one input, one button.
- **Q9 — Generated room ID format: two 4-char segments, one dash** (e.g. `xk29-4plm`). Matches the contract's illustrative example; 8 chars of entropy (~36^8) is far beyond any guessability concern for a non-secret join code.
- **Q10 — Random source: `crypto.getRandomValues` → base-36 index** into `abcdefghijklmnopqrstuvwxyz0123456789`. Naive `% 36` on a 0–255 byte has a ~1% bias toward values 0–3; this is **accepted** because room IDs are not secrets.
- **Q29 — Validate `?room=` against the backend regex on page load:** `^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$`. A malformed room link (hand-edited, stale bookmark) shows a "This room link is invalid" landing state instead of attempting an upgrade that would fail opaquely.
- **Q40 — "Start" flow: generate → `history.pushState("?room=<id>")` → connect in one click.** No full page reload; the URL becomes shareable the instant "Start" is clicked, *before* the WebSocket opens. The room ID is locally generated and guaranteed valid, so there is no "generate failed" failure mode.
- **Q41 — "Join" flow ≡ "Start" flow.** Both read `new URLSearchParams(location.search).get("room")` and call the same `connect(name)` function. The button label is a reactive `computed` off the presence of `?room=` ("Start" vs "Joining … Join"), not a control-flow fork.

## 4. Client-side validation

- **Q27/Q28 — Name: client-side trim + length check (1–32 chars after trim), Join button disabled until valid.** This is a hard requirement, not optional polish: the WebSocket API does **not** expose the HTTP upgrade response body, so a server-side 400 (e.g. name too long) would arrive as an opaque `onclose` code 1006 — the user would land on the generic "Disconnected — reload to reconnect" screen with no hint that their name was the problem. Client validation prevents the unrecoverable loop entirely.
- **Q25 — Vote-send guard: check `socket.readyState === OPEN` before `send()`.** If not open, show a transient "Not connected yet" toast and do *not* update `myVote`. Prevents a local-highlight-vs-server-`hasVoted` mismatch during the narrow tick between `welcome` and the `connected` phase being set, or during a teardown race.

## 5. WebSocket lifecycle & connection states

- **Q16 — 5-phase reactive `phase` ref:** `'landing' | 'connecting' | 'connected' | 'disconnected'` plus an orthogonal `errorMsg` ref for transient error toasts. The template is a `v-if`/`v-else-if` chain over `phase`.
- **Q33 — `connecting → connected` transition gated on `welcome` message arrival**, not on socket `open`. `welcome` is the server's "you're in" signal and carries `myUserId`; gating on it guarantees `myUserId` is populated before the first `state` render, so host badge and "me" detection are correct from frame one.
- **Q34 — Discard `state` if `myUserId` is unset** (defensive: `state` arriving before `welcome` violates the contract's ordering invariant, but we build defensively). `console.warn` and keep the previous view. If `welcome` never arrives, Q14's disconnect flow catches it.
- **Q14 — No automatic reconnect.** On `onclose`, transition to the `disconnected` phase and show "Disconnected — reload to reconnect." Reconnects are fresh users server-side (new `id`, new `seq`, no vote) per the contract, so a manual reload is the only path.
- **Q23 — `disconnected` screen shows a one-line reason derived from the close code** + a reload button: `1001 "server_shutdown"` → "Server is restarting. Reload to rejoin." / `1011` (heartbeat timeout) → "Connection timed out. Reload to rejoin." / `1006` (abnormal, typical network drop) → "Connection lost. Reload to rejoin." / other → "Disconnected. Reload to rejoin." The `1001` case cues the user to wait (Render recycle) before reloading.
- **Q30 — Ignore `onerror`.** It carries no detail the browser exposes; `onclose` always fires afterward with the close code, which `phase`-transition logic uses. Treating `onerror` as a separate transition creates a flicker state with no UX benefit.
- **Q31 — Defensive message handling:** JSON parse failure / unknown `type` / bad shape / `welcome` arriving after `state` → swallow with `console.warn`. The one exception is the **votes-privacy invariant (D)**: if a `state` arrives with `votes` populated while `revealed === false`, enforce client-side — set `votes = null` before storing the state, regardless of what the server sent. This is the client-side mirror of backend invariant #3.
- **Q38 — No `beforeunload` handler.** The server's `onClose` runs unconditionally on any close and performs full cleanup (user removal, host promotion, room discard-if-empty); the close code the server receives doesn't influence its behavior. An explicit `socket.close(1000)` is pure ceremony with no observable effect.

## 6. In-room UI structure

- **Q15 — Room view includes: A. participant roster, B. my vote row (deck buttons), C. host controls (reveal/reset), D. reveal panel, E. room link with copy affordance.** Drops F (estimator ticker as a separate strip) — stats live inside the reveal panel instead.
- **Q15-A / Q19 — Roster persists across phases.** Pre-reveal: shows each user's name, host badge, and voted check (no vote values). Post-reveal: the table is *augmented in place* with each user's vote value inline. The roster is the who's-here surface, in arrival order.
- **Q15-D / Q18-Q20 — Reveal panel appears post-reveal only**, as a *separate* surface from the roster (roster keeps its tabular inline view; panel adds the aggregate + sorted card grid).
  - **Q17 — Vote-row interaction:** track `myVote` locally (highlight my selection, survives `state` re-broadcasts since the server only echoes `hasVoted`, not values). Post-reveal, **replace the vote row entirely** with the reveal panel (the deck buttons disappear; the panel is the new surface). On `reset`, clear `myVote` and the panel, restore the vote row.
  - **Q19 — Reveal panel contents: B. average (mean) + C. mode + F. sorted card grid** (one card per participant with name + vote, sorted by vote value). Distribution/min/max/non-numeric-count are derivable at a glance and skipped.
  - **Q20 — Sort order in the card grid: numeric ascending, then `?`, then `☕` at the end.** Average and mode are computed over numeric votes only; `?` and `☕` are excluded. If everyone voted non-numeric, avg and mode show "—" (not `NaN`).
- **Q15-C / Q24 — Host controls: strict `v-if="hostId === myUserId"`.** Non-hosts never see reveal/reset buttons. Host promotion promotes them reactively (buttons appear for the new host without a reload, since `hostId` is reactive from `state`). The rare race (deposed host's in-flight click arrives after demotion) surfaces as a server `error` and is caught by the toast (Q36).

## 7. Voting deck

- **Q6 — Deck = Fibonacci + `?` + `☕`:** `0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, ?, ☕`. One fixed row of buttons, no switcher, no free-form input.
- **Q26 — Buttons labeled with the raw glyph; `vote.value` sent as the literal string** (`"5"`, `"?"`, `"☕"`). No `aria-label` attributes — accessibility is accepted as "good enough" for the workshop scope (screen-reader behavior on `☕` varies; the visible glyph is the canonical label).

## 8. Utility UX

- **Q22 — Copy invite link button: copies the full room join URL** (`https://rkondratowicz.github.io/planning-poker-frontend/?room=xk29-4plm`) via `navigator.clipboard.writeText`, with a **2-second "Link copied" toast** for feedback. The toast is essential because `navigator.clipboard` can fail or be blocked silently.
- **Q36 — Toast implementation: single `toast` ref, auto-dismiss after 3s.** A new toast overwrites the previous (`showToast(msg)` sets the ref and schedules a clear via `setTimeout`). No queue — the two triggers (server `error`, copy confirmation) rarely overlap, and overwrite behavior is acceptable at this scale. One absolutely-positioned element with `v-if`.
- **Q32 — No name disambiguation.** Duplicate display names render as-is. The contract permits duplicates; the workshop scope doesn't warrant an `id`-suffix scheme.

## 9. Persistence across reloads

- **Q35 — Persist nothing.** Reload = fresh landing with a blank name input (room still comes from `?room=` in the URL, which survives reload by definition). The server treats reconnects as fresh users anyway (new `id`, `seq`, no vote), so persisting the name would only save typing, not session state — and the agreed simplicity weight says it's not worth even 2 lines of `localStorage`.

## 10. Connecting-phase UX

- **Q39 — "Connecting…" is an overlay on the landing form, not a full screen.** Disable the name input and Join button, relabel Join to "Connecting…". No screen flicker; the form stays put so the user sees their name and room are still there, just in progress. One Vue class binding for subtle "pending" styling on the button.

## 11. File checklist for implementation

```
planning-poker-frontend/
  index.html      # <head> import map (pinned Vue prod URL), <body> #app inline template + "Loading…" text
  style.css       # [v-cloak] { display: none }, layout, theme placeholder (style guide TBD)
  app.js          # <script type="module">: createApp, reactive state, WS lifecycle, 5-phase model
  README.md       # how to enable GitHub Pages on main root + point at the backend
```

Enable GitHub Pages in the new repo's Settings → Pages → Source: `main` / root. No Jekyll config, no build step, no `.nojekyll` (the import map and ES modules work with Jekyll's default processing as long as file extensions are preserved).
# Frontend Build Tasks — Planning Poker

Target: a static, zero-build single-page frontend for the Planning Poker backend. Lives in `frontend/` within this repo for now; will be relocated to its own `planning-poker-frontend` repo later (no deployment tasks here).

Stack is locked by `docs/planning-poker-frontend-design-decisions.md`: three flat files (`index.html`, `style.css`, `app.js`), Vue 3 ESM browser build via CDN import map (pinned `.prod.js`), Composition API, inline `#app` template. Visual system is the "Paper & Ink" guide in `docs/paper-and-ink-style-guide.md`, with a working POC in `docs/mock.html`. Wire protocol is `docs/planning-poker-api-contract.md`.

Convention: mark items `- [ ]` / `- [x]` as you go. Each task is sized to be independently verifiable.

## Phase 0 — Scaffold

- [ ] 0.1 Create `frontend/` directory with three empty files: `index.html`, `style.css`, `app.js`, plus a `README.md` stub noting that deployment/GitHub Pages setup is deferred until the repo split.
- [ ] 0.2 In `index.html`, add the document shell: `<!DOCTYPE html>`, `<meta charset>`, viewport, `<title>Deal — Planning Poker</title>`, the Google Fonts `<link>` for Fraunces / Source Serif 4 / IBM Plex Mono (copy the exact `family=` URL from `docs/mock.html`), a `<link rel="stylesheet" href="style.css">`, and a `<script type="importmap">` pinning Vue 3 ESM prod (`"vue": "https://unpkg.com/vue@3.<pin-specific-minor>/dist/vue.esm-browser.prod.js"` — pick a concrete 3.x version, do not leave `@3` floating). End `app.js` as `<script type="module" src="app.js"></script>`.
- [ ] 0.3 Add `#app` mount point with `[v-cloak]` attribute, and a static "Loading…" line **outside** `#app` per design Q37. Add `[v-cloak]{display:none}` to `style.css`. Verify: opening `index.html` shows "Loading…" then goes blank once Vue mounts an empty template, with no console errors.

## Phase 1 — Paper & Ink design tokens & base

- [ ] 1.1 Port the `:root` color tokens (`--paper`, `--paper-card`, `--ink`, `--ink-soft`, `--ink-faint`, `--rule`, `--stamp`, `--stamp-soft`) verbatim from `docs/mock.html` into `style.css`. Add the body background texture (the repeating 1px gradient at ~1.2% opacity over `--paper`), base `color: var(--ink)`, `font-family: 'Source Serif 4', serif`, antialiasing. Add `.display` (Fraunces) and `.mono` (IBM Plex Mono) helper classes.
- [ ] 1.2 Implement the `.app` max-width container and the `header` (brand mark left + room code right, separated by a hairline rule, no card chrome). The brand mark is `deal.` with the period in `--stamp` — **note**: `--stamp` red is otherwise reserved for reveal state only; the brand period is the documented single exception. The mock's ticket id / title / "ROUND 3" block has **no backing in the data model** (the backend has no ticket concept) — drop it entirely; do not port it.
- [ ] 1.3 Implement the `.card` signature object: 76×106px, `--paper-card` bg, 1px `--ink` border, 3px radius, the double shadow (`0 1px 0 rgba(0,0,0,0.04)` + `0 6px 14px rgba(42,36,32,0.10)`), the `::before`/`::after` dashed `--rule` inset 6px from top/bottom, centered Fraunces 30px/600 value. Implement the small `.card-back` 16×22px face-down icon (diagonal striped `--rule` over `--paper-card`). Verify by rendering static copies.
- [ ] 1.4 Implement the two-column `.layout` grid (1fr + 260px roster, 40px gap, stacks to 1fr under 820px), the hairline-bordered `.table-area` with its subtle radial background, and the roster sidebar with `border-left:1px solid var(--rule)`. Implement `.roster h3` (mono uppercase 11px, `--ink-faint`).

> **Stub the brand period exception in the code with a code comment** is NOT allowed (no comments rule). Instead, the brand mark simply does it — no annotation needed. If a reviewer asks, point at the style guide's "card point-values … primary CTA border" exclusivity and Q15-D reveal state.

## Phase 2 — App state & Vue boot

- [ ] 2.1 In `app.js`, import Vue (`import { createApp, ref, reactive, computed } from 'vue'`). Define the single `reactive` state object: `{ roomId, myName, myUserId, hostId, revealed, users, votes, phase, errorMsg, toast, myVote }`. Initialize `phase = 'landing'`. Add a `toast` ref + `showToast(msg)` (sets ref, schedules clear via `setTimeout(..., 3000)`, no queue, overwrite per Q36). Mount `createApp({...}).mount('#app')` with an empty inline template that just renders a placeholder; verify mount with no console errors and `v-cloak` releases.
- [ ] 2.2 Add the 5-phase reactive `phase` ref per Q16 (`'landing' | 'connecting' | 'connected' | 'disconnected'`) plus the orthogonal `errorMsg` ref. Template is a `v-if`/`v-else-if` chain; for now each phase renders a single placeholder line (e.g. `<div>{{ phase }}</div>`) so you can flip phases from the console to confirm the chain works.
- [ ] 2.3 Implement the backend URL resolver (Q5): `localhost` → `ws://localhost:3000/ws`, otherwise → `wss://planning-poker-backend.onrender.com/ws`. Export it as a named constant (`PROD_WS_URL` / `DEV_WS_URL`) with one `if` selecting between them.
- [ ] 2.4 Implement `parseRoomParam()`: read `new URLSearchParams(location.search).get('room')`, validate against the backend regex `^[a-z0-9]{4,32}(-[a-z0-9]{4,32})*$` (Q29). Return `{ present: boolean, valid: boolean, roomId: string|null }`. Call it once at mount to seed `state.roomId`. A malformed room sets a short "invalid room link" landing state per Q29.
- [ ] 2.5 Implement `generateRoomId()` (Q9/Q10): two 4-char base-36 segments joined by a dash, using `crypto.getRandomValues(new Uint8Array(8))` indexed `% 36` into `abcdefghijklmnopqrstuvwxyz0123456789`. Confirm output matches `xk29-4plm`-shaped strings.

## Phase 3 — Landing & connect flow

- [ ] 3.1 Implement the landing screen (Q8): one screen, one name `<input>`, one button. If `parseRoomParam().present`: button label reads `Join` (or `Joining <room>… Join`) and a heading "Joining room `<roomId>`". If absent: button label reads `Start` (generates a room ID). The label is a single `computed` (`joinLabel`) off the presence of `?room=`, **not** a control-flow fork (Q41).
- [ ] 3.2 Name validation (Q27/Q28): trim on input, length 1–32 after trim. Disable the action button (`:disabled`) while invalid; do not attempt connect with an invalid name — this is a hard requirement because the WS API hides the HTTP 400 body behind an opaque `onclose 1006` (Q27).
- [ ] 3.3 "Start" handler (Q40): `generateRoomId()` → `history.pushState(null, '', '?room=<id>')` → update `state.roomId` → `connect(name)`. No full page reload; URL is shareable the instant Start is clicked, before the socket opens.
- [ ] 3.4 "Join" handler (Q41): call `connect(state.myName)` — same code path as Start.
- [ ] 3.5 Implement `connect(name)`: build the URL `${resolvedWsUrl}?room=${encodeURIComponent(roomId)}&name=${encodeURIComponent(name.trim())}`, `phase = 'connecting'`, open `new WebSocket(url)`, wire `onopen`/`onmessage`/`onclose`/`onerror`. **Do not gate `connected` on `onopen`** — gate on `welcome` arrival (Q33). Leave handlers stubbed for the next phase.

## Phase 4 — WebSocket lifecycle

- [ ] 4.1 `onmessage`: JSON parse, on failure `console.warn` + return (Q31). Dispatch on `type`:
  - `welcome` → set `state.myUserId`, transition `phase = 'connected'` (Q33). This is the only `connecting → connected` trigger.
  - `state` → defensively discard if `state.myUserId` is unset (`console.warn`, keep previous view, Q34). Otherwise enforce the votes-privacy invariant client-side (Q31/D): if `state.revealed === false` and `votes` is non-null, set `votes = null` before storing. Replace the reactive state wholesale (contract: "replace, not merge").
  - `error` → `showToast(msg)` (Q36). Do not transition phase; socket stays open.
  - unknown type / bad shape → `console.warn` + return (Q31).
- [ ] 4.2 `welcome` arriving **after** a `state` (violates contract ordering): swallow with `console.warn` (Q31).
- [ ] 4.3 `onerror`: do nothing beyond what `onclose` will do (Q30 — `onerror` carries no usable detail; `onclose` always fires after with the real code).
- [ ] 4.4 `onclose`: set `phase = 'disconnected'` and derive a one-line reason off the close code (Q23): `1001` → "Server is restarting. Reload to rejoin." / `1011` → "Connection timed out. Reload to rejoin." / `1006` → "Connection lost. Reload to rejoin." / other → "Disconnected. Reload to rejoin." Store reason in `errorMsg`. No auto-reconnect (Q14).
- [ ] 4.5 Render the `disconnected` screen: one serif line with `errorMsg` + a plain outlined "Reload" button that calls `location.reload()`. No reactive recovery, no reconnect button (Q14/Q38).
- [ ] 4.6 Connecting-phase UX (Q39): when `phase === 'connecting'`, the landing form stays mounted but the name input and action button are `:disabled` and the button relabels to "Connecting…". Use a single Vue class binding (e.g. `:class="{ pending: phase === 'connecting' }"`) for subtle pending styling on the button — no screen flicker, no full-screen replacement.

## Phase 5 — Room view structure

- [ ] 5.1 When `phase === 'connected'`, render the two-column layout from Phase 1. The header shows the brand mark with the `--stamp` period on the left and the room code in mono (`session · <roomId>`) on the right. No ticket/title/round block — the mock's `PROJ-482 / ROUND 3` content has no data-model backing and was dropped in Phase 1.2.
- [ ] 5.2 Implement the roster sidebar (Q15-A/Q19): a `.roster-row` per `state.users` (in array order = arrival order). Left side: name, plus a `you` badge if `user.id === state.myUserId` (mono, `--stamp` border/text per the mock). Right side, **voting phase**: face-down `.card-back` if `user.hasVoted`, else italic serif "thinking…" in `--ink-faint`. **Revealed phase**: the actual vote value in mono, `--stamp` color, where `votes[user.id]` is non-null; users who somehow have no revealed vote show "—" `--ink-faint`.
- [ ] 5.3 Implement the segment/phase indicator. The mock's `.phase-toggle` (Voting / Revealed) is **display-only** in the real app: it reflects `state.revealed`, it is not a clickable control for clients (only the host flips it via `reveal`/`reset`). Show it as a disabled segmented control whose active tab is `Revealed` iff `state.revealed`. Non-hosts see it as a read-only status indicator (no `onclick`); hosts still don't toggle it by clicking — they use the explicit reveal/reset buttons (Phase 7). Verify the active tab flips reactively when a `state` with `revealed:true` arrives.

## Phase 6 — Voting phase (private)

- [ ] 6.1 Voting deck (Q6/Q26): a single fixed row of `.hand .card` buttons labeled with raw glyphs `0 1 2 3 5 8 13 21 34 55 89 ? ☕`. `<button class="card">` (it's interactive, so a real button, not a div). `vote.value` is sent as the literal string (`"5"`, `"?"`, `"☕"`). No `aria-label` (Q26).
- [ ] 6.2 Per-card rotation (style guide): hand cards get a varied −3°..+3° rotation, never uniform. Port the mock's `:nth-child(odd/even)` rotation as a starting point, but note the mock has 11 cards and your deck has 13 — recompute the alternating pattern so rotation is varied across all 13.
- [ ] 6.3 Selection highlight (Q17): maintain `state.myVote` locally (a ref, not derived from `state.votes` — the server only echoes `hasVoted` pre-reveal, never the value). The selected card gets `.selected` (`translateY(-16px)`, rotation → 0°, border `--stamp`, value `--stamp`). Clicking a card: if `socket.readyState === OPEN` send `{type:'vote', value}` and set `state.myVote`; if not open, `showToast("Not connected yet")` and do **not** update `myVote` (Q25).
- [ ] 6.4 `.selected` must survive `state` re-broadcasts: do not let an incoming `state` reset `state.myVote` (the server only tells you `hasVoted`). Keep `myVote` purely client-local until `reset` clears it (Phase 8).
- [ ] 6.5 Voting prompt + waiting count (style guide "Voting (private)"): a serif prompt "Everyone's choosing in private…" and a mono count `"<voted> of <total> have voted"`. Derive `voted` from `state.users.filter(u => u.hasVoted).length` and `total` from `state.users.length`. No red anywhere on this screen (style guide guardrail).
- [ ] 6.6 Hover micro-interaction (style guide "Motion"): `.hand .card:hover { transform: translateY(-6px) rotate(0deg); transition: transform 0.15s ease; }`. Selected cards do not re-lift on hover.

## Phase 7 — Reveal & host controls

- [ ] 7.1 Host controls (Q15-C/Q24): reveal + reset buttons, rendered with strict `v-if="state.hostId === state.myUserId"`. Non-hosts never see them. Because `hostId` is reactive from `state`, a promoted user sees the buttons appear without a reload. Tie them to `send({type:'reveal'})` / `send({type:'reset'})` over the OPEN socket (reuse the Q25 open-check guard; if not open, toast).
- [ ] 7.2 On reveal (Q17): when `state.revealed === true`, the voting hand **disappears** and the reveal panel takes over the table area. The vote row is fully replaced (the deck buttons go away); the panel is the new surface. Do this with a `v-if`/`v-else` pair over `state.revealed` inside the table area.
- [ ] 7.3 Reveal panel — card grid (Q19/Q20): one `.reveal-slot` per user, each with a `.card` (value = `votes[user.id]` ?? `"—"`) + a serif name beneath. Sort order: numeric ascending, then `?`, then `☕` at the end (Q20). Per-card varied rotation (extend the mock's `:nth-child` rotation map to N cards; if more than the mock's 6 fixed cases, derive rotation as `(index % 2 === 0 ? -1 : 1) * (2 + (index % 3))` or similar so it stays within ±3° and varied).
- [ ] 7.4 The "REVEALED" stamp (style guide "Revealed (public)"): a `.stamp` element top-right of the table area — mono uppercase, `--stamp` color, 2px `--stamp` border, `rotate(8deg)`, `opacity:0.85`. This is the one big visual moment; per the style guide it should land like a physical stamp (overshoot/thud), but a static appearance is acceptable for the first pass — file a follow-up if animation is deferred.
- [ ] 7.5 Outlier highlighting (style guide): a vote meaningfully off from the group gets `.outlier` (border + value recolored `--stamp`). Define "outlier" as: among numeric votes, any value more than one Fibonacci step from the **mode** (e.g. mode is 5, an 8 next to it is in-band, a 13/21 is an outlier). If all votes agree, mark no outliers. Non-numeric (`?`/`☕`) cards never get the outlier treatment. Keep the threshold simple and document the rule in the TASKS entry when you finalize it.
- [ ] 7.6 Stats row (style guide "Revealed (public)" / design Q19): three stats — **average (mean)**, **mode**, and the **card grid** is already shown above, so the three sub-stat numbers are average / median / spread as per the style guide (note: design Q19 says "average + mode"; the style guide's reveal panel lists "average / median / spread". **Reconcile this**: pick the style guide's three (average / median / spread) since it is the visual spec, and confirm with the user if median-vs-mode matters. Compute over **numeric votes only**; `?`/`☕` excluded. If everyone voted non-numeric, all three show "—" (not `NaN`, Q20). Average rounds to one decimal; spread renders as `"<min>–<max>"`.
- [ ] 7.7 Italic serif note (style guide): a one-line plain-language consensus/disagreement cue below the stats. Rule of thumb: if `(max - min) <= one Fibonacci step among numeric votes` → "Consensus — everyone's near `<mode>`." Else → "No consensus — `<name>` is highest at `<value>`. Worth a quick word." Quote the highest-voter's name where possible; fall back to a generic "spread is wide" note if the top vote is non-numeric.
- [ ] 7.8 Roster in revealed state (Phase 5.2 already implemented the data binding) — verify visually that revealed roster renders vote values in `--stamp` mono, and that the `you` badge stays.

## Phase 8 — Reset & round transition

- [ ] 8.1 Reset handler (host only): on `reset`, the server broadcasts `state` with `revealed:false`, `votes:null`, all `hasVoted:false`. Client must clear `state.myVote` (Q17 — "clear `myVote` and the panel, restore the vote row"). Verify the hand reappears and the reveal panel is gone.
- [ ] 8.2 Defensive: if a `state` arrives with `revealed:false` but `votes` non-null, the Phase 4.1 privacy guard already nulled it — verify there's no leftover `votes`-based UI showing stale values after reset.
- [ ] 8.3 The style guide's reveal-phase actions were "Discuss" (outlined) + "Re-deal round" (solid ink primary). "Discuss" is dropped — it has no backing in the data model. "Re-deal round" is the host reset button from Phase 7.1; style it as the solid-ink primary. The outlined "Discuss" slot is simply gone; do not render an empty/stub button.

## Phase 9 — Utility UX

- [ ] 9.1 Copy invite link (Q22): a button that copies `${location.origin}${location.pathname}?room=${encodeURIComponent(state.roomId)}` via `navigator.clipboard.writeText`. On success → `showToast("Link copied")` (the toast is essential per Q22 because clipboard can fail silently). On failure → `showToast("Couldn't copy — copy the URL from the address bar")`. Use a 2-second feedback variant of the toast here vs the 3-second default for errors — either reuse `showToast` with a duration param, or accept the 3s default. Decide and keep it consistent.
- [ ] 9.2 Place the copy-invite control in the header area (next to the room code) so it's visible in both voting and revealed phases. Mono uppercase, plain outline (no `--stamp`).
- [ ] 9.3 No `beforeunload` handler (Q38) — verify you did not add one. The server's `onClose` cleanup is unconditional; an explicit `socket.close(1000)` is ceremony. Do not add it.
- [ ] 9.4 No name disambiguation (Q32): duplicate display names render as-is. Verify the roster handles two users with the same name withoutcollapsing them (key by `id`, never by `name`).
- [ ] 9.5 No persistence across reloads (Q35): confirm nothing is written to `localStorage`/`sessionStorage`. Reload → fresh landing, blank name input, room still from `?room=`.

## Phase 10 — Visual polish (Paper & Ink conformance)

- [ ] 10.1 Audit every screen against `docs/paper-and-ink-style-guide.md` "Guardrails": no fourth typeface, no sans-serif, `--stamp` only on reveal/brand-period/outlier/primary-CTA-border, card rotation ≤3° and varied, chrome defaults to ink-on-paper hairline borders before shadows.
- [ ] 10.2 Verify the voting screen has **zero** `--stamp` red anywhere (style guide "Voting (private)"). The only red on the voting screen is the `deal.` brand period in the header — confirm that's the accepted exception.
- [ ] 10.3 Confirm the texture background renders (the repeating 1px gradient) and doesn't look flat.
- [ ] 10.4 Responsive pass: at ≤820px the roster stacks below the table area. Verify no horizontal scroll, the hand wraps, the reveal card grid wraps.
- [ ] 10.5 Loading polish: confirm the "Loading…" outside `#app` shows until Vue mounts, then disappears (it stays in the DOM but is covered/hidden by `#app`; acceptable, or remove it via a tiny inline script once `#app` populates — decide and be consistent).

## Phase 11 — Manual verification against the backend

- [ ] 11.1 Start the backend (`pnpm dev` or the run command) and open `frontend/index.html` via a static server (e.g. `python3 -m http.server` from `frontend/`, or `pnpm dlx serve`). Confirm `localhost` resolves to `ws://localhost:3000/ws`.
- [ ] 11.2 Open two browser tabs, Start a room in tab 1, copy the `?room=` link into tab 2, Join with a different name. Verify: `welcome` → `state` ordering, roster updates on both tabs, host badge on tab 1 only, "you" badge per-tab.
- [ ] 11.3 Vote in both tabs. Verify: `hasVoted` face-down icon appears, **no vote values leak** before reveal (inspect `state.votes` in Vue devtools — must be `null`), the waiting count updates.
- [ ] 11.4 Reveal from tab 1 (host). Verify: reveal panel appears on both tabs, stamp shows, outliers flagged, stats computed, roster shows values in `--stamp`.
- [ ] 11.5 Reset from tab 1. Verify: hand returns on both tabs, `myVote` cleared, roster back to face-down/thinking, no stale values.
- [ ] 11.6 Close tab 1 (host). Verify: tab 2 sees host promotion (reveal/reset buttons appear for it without reload), roster updates, room stays alive. Close tab 2 — room is discarded server-side (check backend logs).
- [ ] 11.7 Malformed room: hand-edit the URL to `?room=!!!` — verify the "invalid room link" landing state (Q29), no socket attempt.
- [ ] 11.8 Server shutdown: stop the backend. Verify tab shows `disconnected` with "Server is restarting. Reload to rejoin." (code 1001 path — may need a `process.kill` graceful shutdown to trigger; abnormal `1006` via killing the process yields "Connection lost."). Reload reconnects as a fresh user.
- [ ] 11.9 Confirm the votes-privacy client-side guard (Q31/D): if somehow a `state` with `revealed:false, votes:{...}` arrives, the client nulls it before render. Inject via Vue devtools or a temp `ws` mock — verify no values render.

## Phase 12 — File checklist & docs

- [ ] 12.1 Final `frontend/` contents: `index.html`, `style.css`, `app.js`, `README.md`. No `node_modules`, no build artifacts, no `.nojekyll` (Q11). `README.md` notes the eventual GitHub Pages setup is deferred until repo split.
- [ ] 12.2 Pin the Vue version in the import map to a concrete 3.x minor (e.g. `vue@3.5.13`), not `@3` floating, not `latest`.
- [ ] 12.3 Update `docs/TASKS.md` checkbox state and note any follow-ups (e.g. deferred reveal/stamp animation, median-vs-mode decision) inline as `- [ ] 12.x` follow-up items.
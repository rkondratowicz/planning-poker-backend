# Planning Poker Backend — Design Decisions

This document captures every decision made during the design interview session. It is the authoritative companion to `planning-poker-api-contract.md` — the contract describes the wire protocol the frontend codes against; this document describes the implementation choices the backend is built against. Coding will be done in a separate session.

Decisions are grouped by area, with the original interview question number (Q1–Q31) for traceability.

## 1. Architecture & runtime

### D1.1 — Scaling model: single-instance, in-memory (Q1)
No clustering, no shared store, no Redis. One Node process, one `Map<roomId, Room>` at module scope. Matches the contract's "rooms discarded when empty" semantics exactly. If traffic ever outgrows a single process, the migration path is to add Redis pubsub + a coordination store — not pursued for v1.

### D1.2 — Language: TypeScript, latest stable, strict mode (Q3, Q13)
Strict tsconfig is non-negotiable for the discriminated-union message shape. See §5 for the full tsconfig.

### D1.3 — Web framework: Hono (Q2)
Hono on Node.js via `@hono/node-server` + the `ws` package. Hono's `upgradeWebSocket()` returns a closure with `onOpen`/`onMessage`/`onClose`/`onError`; per-connection state is captured in that closure, cross-connection state lives in a module-scope `Map`. Hono was chosen over Fastify because the question was explicitly raised by the user; final confirmation happened after considering Bun (Q13) and Render (Q14). Note: Hono is later committed to as the framework even when Bun was briefly considered, and remains when we revert to Node after the Render decision.

### D1.4 — Production runtime: Node + `tsc` build step → `node dist/` (Q13)
Reverted from Bun (Q14) after the Render decision coupled back to Node for the boring/conservative path. Scripts:
```
"dev": "tsx watch src/index.ts",
"build": "tsc",
"start": "node dist/index.js",
"typecheck": "tsc --noEmit",
"lint": "biome check src test",
"format": "biome format --write src test",
"test": "vitest run",
"test:watch": "vitest"
```

### D1.5 — Deployment target: Render free tier, direct GitHub repo link (Q14)
No Dockerfile, no GH Actions YAML for deploy. Render runs `pnpm install && pnpm build && pnpm start` on every push to `main`. Free web service supports WebSockets; spins down after 15 min idle, wakes in ~30s on next request. Workshop-time use only — not 24/7 prod. Vendor lock-in avoided (vs. Cloudflare Workers + Durable Objects).

## 2. Tooling

### D2.1 — Package manager: pnpm (Q12)
Lockfile committed. Fast, disk-efficient, strict about phantom deps.

### D2.2 — Node version: Node 20 LTS minimum (Q12)
`"engines": { "node": ">=20" }`. Stable, long shelf life, all needed stdlib (`crypto.randomUUID`, native `fetch`, stable ESM).

### D2.3 — Test runner: Vitest (Q5)
Plays cleanly with ESM + TS + Node, has fake timers for the heartbeat-timeout tests. Initially scoped to unit tests only per user direction (Q28):
- Unit tests for `buildStateSnapshot`, `promoteNextHost`, validation helpers, voting state-machine rules.
- Integration tests (real WS round-trips) explicitly deferred until after the workshop if needed.

### D2.4 — Lint/format: Biome (Q13)
Replaces ESLint + Prettier with one tool. `biome.json` with recommended rules: 2-space indent, double quotes, semicolons, biome's own sort-imports. CI: `pnpm biome ci`.

### D2.5 — Runtime validation: Zod (Q21)
One Zod schema per `ClientToServer` variant, with TS types derived via `z.infer`. Single source of truth for both the parse-time guard and the static type. Adds `zod` (~10KB gzipped, zero deps) as a runtime dep.

### D2.6 — Logging: Pino (Q11)
Structured JSON. Root logger + child logger per room with `{ roomId }` context. Levels:
- `info` — room created, user joined, user left, host promoted, room discarded
- `warn` — validation failures, rule violations, malformed messages (with Zod detail attached)
- `error` — unexpected send failures, unhandled exceptions in handlers
- `debug` — per-message traces, off by default

Level controlled by `LOG_LEVEL` env var (default `info`). No metrics/tracing. No healthcheck beyond the `/health` route.

## 3. Project layout

### D3.1 — ESM + flat `src/` (Q4)
`package.json` has `"type": "module"`. `tsconfig` has `module: "NodeNext"`, `moduleResolution: "NodeNext"`. Flat:
```
src/
  index.ts        # serve(), route registration, wire-up, shutdown handler
  room.ts         # Room type + in-memory Map + mutate helpers + buildStateSnapshot
  conn.ts         # per-connection state, validation, message routing for one client
  messages.ts     # Zod schemas + z.infer'd types for ServerToClient / ClientToServer
  config.ts       # env-bound config object, validated at boot
  errors.ts       # error message string constants (single spot)
test/
  *.test.ts
```

## 4. TypeScript configuration

### D4.1 — Strict tsconfig (Q13)
- `"strict": true`
- `noUncheckedIndexedAccess` — catches `users[i]` undefined pitfalls in host promotion
- `exactOptionalPropertyTypes` — forces explicit `| undefined` on optional fields, important for `votes: null | Record<...>` shape
- `noImplicitOverride`
- `noFallthroughCasesInSwitch` — discriminated-union switch on `msg.type` must be exhaustive
- `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- `target: "ES2022"`, `lib: ["ES2022"]`
- `verbatimModuleSyntax: true` — forces `import type` for type-only imports

## 5. Configuration & environment

### D5.1 — Config table (Q20, Q30)
Single `src/config.ts` reads and validates env at boot. All integers parsed with bounds validation; bad value → throw → process exits non-zero → Render marks deploy failed. Defaults chosen so the service runs with zero configuration (only `PORT` is injected by Render).

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WS listen port (Render injects this) |
| `LOG_LEVEL` | `info` | Pino level |
| `HEARTBEAT_INTERVAL_MS` | `30000` | ping interval |
| `HEARTBEAT_TIMEOUT_MS` | `10000` | pong deadline before terminate |
| `MAX_PAYLOAD_BYTES` | `4096` | `ws` maxPayload |
| `MAX_ROOM_ID_LENGTH` | `128` | upper bound for room id total length |
| `MAX_NAME_LENGTH` | `32` | upper bound for display name |
| `MAX_VOTE_LENGTH` | `64` | upper bound for vote value |
| `SHUTDOWN_GRACE_MS` | `20000` | cap on graceful close before forced exit |
| `MAX_ROOM_USERS` | `50` | cap on users per room; reject join with HTTP 403 on upgrade |
| `MESSAGE_RATE_WINDOW_MS` | `1000` | rate-limit time window |
| `MESSAGE_RATE_BURST` | `20` | max messages per window before `Rate limit exceeded` |

`.env.example` documents all vars uncommitted; for local dev use Node 20's `--env-file`. No CORS.

## 6. Protocol decisions

### D6.1 — Drop `leave` message (Q22, Q23)
The contract's original `leave (optional)` message is removed. Closing the socket is the only way to leave. Socket close = cleanup = next-oldest host promotion. Removing `leave` eliminates a redundant primitive; clients who close a browser tab already exercise the socket-close path, and any client code that relied on `leave` for correctness would have been wrong anyway.

### D6.2 — Add `/health` GET route (Q14)
Returns `200 OK` with body `ok`. Stateless. Used for keep-warm pings during workshops (Render free tier spins down after 15 min idle). No CORS.

### D6.3 — `welcome` → `state` invariant (Q16)
On every join: server sends `welcome{userId}` to the joiner only, then broadcasts `state` to every current connection in the room (including the joiner). For a brand-new room this collapses to: `welcome` to the joiner, then `state` to that same joiner (the only connection). `welcome` is always first per-connection; `state` always fires after and goes to everyone. This eliminates a class of bugs where the joiner never sees its own first `state`, or other clients never see the new roster.

### D6.4 — Broadcast includes originator; `error` does not broadcast (Q9)
Every state change → one `state` message to *all* clients in the room, including the originator. Frontend never optimistically updates local state; it waits for the server echo. An `error` triggers *no* broadcast — only the offender gets the `error`, state didn't change.

### D6.5 — Host change uses `state`, not a new message type (Q9)
Same `state` shape, only `hostId` differs. No `hostChanged` event type — keeps the message union tight.

### D6.6 — No reconnect-as-host (Q7, Q25)
Reconnects are fresh users with a new `id`, a new `seq` at the back of the line, and no vote. A reconnecting original host does **not** regain host. The current smallest `seq` is host; promotion is purely based on who's currently connected, not on history.

## 7. Validation

### D7.1 — `room` query param: `^([a-z0-9]{4,32}-)*[a-z0-9]{4,32}$`, total length ≤ 128 (Q6)
Lowercase alphanumeric, segments 4–32 chars, separated by single dashes. Reject on mismatch with HTTP 400 on the upgrade (socket never opens). Matches the sluggy `xk29-4plm` example, rejects slashes/symbols.

### D7.2 — `name` query param: trim, 1–32 chars after trim (Q6)
Reject with HTTP 400 on upgrade if invalid. No truncation (surprises the user). Names not unique within a room (Q18) — disambiguate by `id` in the UI.

### D7.3 — `userId` format: `user-<uuid>` (Q6)
`user-${crypto.randomUUID()}` — full UUID for zero collision worry; not a secret.

### D7.4 — `vote.value`: `z.string().min(1).max(64)`, no character restrictions (Q8, Q23)
Free-form string; frontend decides what's valid. No trimming by the server (verbatim echo). Non-string `value` (e.g. `5` instead of `"5"`) rejected with `Invalid vote message`.

### D7.5 — JSON parsing policy (Q19)
Use `JSON.parse` as-is, no custom reviver. Trailing junk → `Malformed message` error (keep socket). Duplicate keys → standard JSON last-wins behavior. Type-check parsed shape via Zod; mismatches → `Invalid <type> message`.

### D7.6 — Names are non-unique within a room (Q18)
Multiple users can share a display name; they're distinguished by server-assigned `id`. Names are immutable per session — set only at the WS upgrade via the `name` query param, no mid-session rename (contract has no `setName` message).

## 8. Voting state machine

### D8.1 — Voting after reveal: rejected (Q8)
`vote` while `revealed === true` → `Voting is locked until reset`. The reveal is a point-in-time snapshot; voting is frozen until `reset`.

### D8.2 — No `unvote` action (Q8)
No `unvote` message; `value` must be a non-empty string. To "clear" a vote, wait for the host to `reset`. Re-voting to a *different* value is always allowed pre-reveal.

### D8.3 — Revealing with zero votes: allowed (Q8)
`reveal` populates `votes: {}` and sets `revealed: true`. No error. UI shows "no one voted".

### D8.4 — Idempotent host actions: rejected, not no-op (Q27)
- `reveal` when `revealed === true` → `error: "Votes are already revealed"`.
- `reset` when `revealed === false` and no votes → `error: "Votes are already reset"`.

Every host action either mutates state (→ broadcast) or is rejected (→ `error`). No silent no-op path. Makes the `state` broadcast a reliable signal of *actual* state changes.

### D8.5 — Disconnect mid-round removes vote (Q8)
If a voter leaves before reveal, they leave `users[]` and the `votes` map entirely. If a host disconnects, host promotion runs *before* the broadcast, so roster change + host change ride the same `state` message.

## 9. Connection lifecycle & host promotion

### D9.1 — Monotonic per-room `seq` for "oldest" definition (Q7)
Each connection is assigned the next integer `seq` (1, 2, 3, …) at join time, within the room. On host vacancy, pick the remaining user with the smallest `seq`. No ties possible. Immune to clock skew. Debuggable.

### D9.2 — Promotion algorithm (Q25)
On `onClose` cleanup, if the disconnecting user's `userId === room.hostId`:
1. Remove the disconnecting user from `room.users`.
2. If `room.users.size === 0`: delete the room immediately (no broadcast — nobody to broadcast to).
3. Else: iterate `room.users.values()`, pick entry with smallest `seq`, set `room.hostId = entry.id`, broadcast `state`.

Promotion only runs when the host disconnects; non-host disconnects don't trigger promotion.

### D9.3 — Cleanup is idempotent (Q10)
`onClose` always runs the cleanup path — even if the socket was closed by our own validation-failure `ws.close()`. Removes the user from the room iff present, no-op if already removed. Design invariant: the room map and the `conn → (roomId, userId)` map never store a connection that's been cleaned up. A socket could close after we've already cleaned it up (race between a broadcast send-failure and a network close); the idempotent remove-if-present handles this.

### D9.4 — Room discard on last disconnect (Q7, Q10)
When the last connection closes (gracefully or on error), delete the room from the map immediately. No grace period. Re-connect with the same id after empty = fresh room where newcomer becomes host (matches contract).

### D9.5 — Validation-failure close (Q7)
Bad `room`/`name` on the HTTP upgrade → reject the upgrade itself with HTTP 400 (socket never opens). Inbound message validation failures after upgrade → send `error`, keep the socket open.

### D9.6 — Close codes (Q10)
We don't parse or branch on inbound close codes. All closes → same cleanup path. Outbound close codes:
- `1001 "server_shutdown"` — server-driven graceful shutdown (D11.2)
- `1011` — heartbeat pong timeout (D11.1)
- `1000` — normal client close, no reason needed

## 10. Broadcast & wire-protocol edges

### D10.1 — Broadcast mechanics (Q9)
- Every state change → one `state` message to all clients in the room, including the originator.
- `error` triggers no broadcast.
- Host change uses the same `state` shape, only `hostId` differs.
- Per-message size cap at transport: `ws` server `maxPayload: 4096`. Larger frames are auto-closed by `ws` with code 1009; no app-level `error`.

### D10.2 — Malformed client messages (Q9)
- JSON parse fail → `error: "Malformed message"`, keep socket.
- Missing/unknown `type` → `error: "Unknown message type"`, keep socket.
- Known `type` but bad shape (Zod fails) → `error: "Invalid <type> message"`, keep socket. Zod issue detail logged at `warn` level server-side.
- Well-formed known-type message violating a rule (non-host `reveal`, `vote` after reveal) → `error` with the rule-specific string (see contract's error table), keep socket.

### D10.3 — Concurrency (Q9)
Single Node event loop serializes JS execution; no locks needed around the `Map`. Each message handler runs to completion before the next. **Handlers are synchronous end-to-end** — no `await` mid-handler that could let another message mutate the room from under us. If async is ever needed, revisit.

## 11. Reliability

### D11.1 — Server-side ping/pong heartbeat (Q15)
`ws`'s built-in ping/pong via `WebSocketServer({ clientTracking: true })` + a single `setInterval`-driven heartbeat loop. Ping every `HEARTBEAT_INTERVAL_MS` (default 30s). Any socket that hasn't ponged within `HEARTBEAT_TIMEOUT_MS` (default 10s) is terminated with close code 1011. Terminated sockets run the normal `onClose` cleanup path (roster update, host promotion if needed). No app-level ping/pong message — no client cooperation required, no contract change.

### D11.2 — Graceful shutdown on SIGTERM (Q17)
Render sends `SIGTERM` with ~30s before `SIGKILL` on spin-down and on every deploy. On `SIGTERM`:
1. Stop accepting new WS upgrades.
2. Iterate all rooms, send each socket a close frame with code `1001` and reason `"server_shutdown"`.
3. Wait up to `SHUTDOWN_GRACE_MS` (default 20s) for sockets to close cleanly.
4. Force-exit.

`onClose` handlers fire during close and run normal cleanup (rooms become empty → discarded). No app-level broadcast needed — the close code carries the meaning; clients reconnect to a fresh process where they become host of fresh rooms.

### D11.3 — Broadcast send failures (Q10)
Best-effort, swallow per-socket errors. One failing socket never aborts the loop or corrupts room state. Wrap each `ws.send` in try/catch, ignore failures, rely on `onClose` for authoritative cleanup. At most one dropped message for that user; the next state change will re-sync them.

### D11.4 — Unhandled exception boundaries (Q29)
Two `try/catch` wrappers in `index.ts`:
- Around the `onMessage` callback body: catch → log `error` with `{ roomId, userId }`, send generic `{"type":"error","message":"Internal error"}` to the offender, keep socket, keep room. Safe because handlers are structured as validate-then-mutate-then-broadcast — a throw in validate is recoverable; a throw in mutate/broadcast is a bug we can't reason about, but the try/catch at least prevents process death.
- Around the `onClose` callback body: catch → log `error`, close the offender socket hard. If cleanup throws, room integrity is suspect; the next `onClose` (if any) tries again. Worst case: a corrupted room hangs until all users leave and it's discarded. Better than cascading the bad cleanup to other rooms.

## 12. Abuse protection

### D12.1 — Minimal defensive limits (Q30)
- **Max room size: `MAX_ROOM_USERS` (default 50)** — reject new joins beyond this with HTTP 403 on the upgrade (socket doesn't open).
- **Max message rate per socket: `MESSAGE_RATE_BURST` (default 20) per `MESSAGE_RATE_WINDOW_MS` (default 1000)** — trivial token-bucket per connection in `conn.ts`. On each `onMessage`, check `now - lastReset > window`; if so, reset count to 0; increment; if count > burst, send `error: "Rate limit exceeded"` and ignore the message. No socket close — forgiving for misbehaving clients.
- **Max payload: `MAX_PAYLOAD_BYTES` (default 4096)** (D10.1) — `ws` auto-closes with 1009 on violation.
- **No per-IP limits** — workshops share NAT egress IPs; per-IP limits would block legit attendees.
- **No limit on rooms per process** — empty rooms discarded eagerly; memory grows only with active rooms (bounded by active humans).

All limits configurable via env (D5.1).

## 13. Testing strategy

### D13.1 — Unit tests only, for v1 (Q28)
- Target: pure functions in `room.ts` and validation helpers (`buildStateSnapshot`, `promoteNextHost`, `validateRoomId`, `validateName`, `parseClientMessage`), voting state-machine rules (`vote` rejected when revealed, `reset` clears votes, idempotent `reveal`/`reset` rejected).
- Use Vitest's `vi.useFakeTimers()` for any time-dependent unit (e.g. the rate-limit window).
- Skip integration tests (real WS round-trips) per user direction. Acknowledge the trade-off: the WS glue code (connection lifecycle, broadcast mechanics, `onClose` cleanup, shutdown handler) won't be covered by unit tests; that's the part most likely to harbor integration bugs. Add focused integration tests later if any misbehaves during the workshop.

## 14. Open items deferred to coding session

- The exact Pino log message template strings (we agreed on log *events* and *levels*, not on verbatim strings).
- The exact `tsconfig.json` and `biome.json` syntax (we agreed on the option set).
- The `package.json` contents (we agreed on the scripts list and the deps/set — `hono`, `@hono/node-server`, `ws`, `pino`, `zod`; devDeps — `tsx`, `vitest`, `@types/ws`, `typescript`, `@biomejs/biome`).
- File-by-file skeleton of `src/` — the layout in D3.1 is the agreement; the implementation fills it in.

## 15. Deck selection (post-v1 addition)

- `deck` is an optional, frontend-controlled room identifier supplied as a query parameter by the room-creating connection. The backend has no default.
- Blank values are treated as absent; non-blank values are trimmed and limited by `MAX_DECK_LENGTH` (default 32). The backend intentionally does not validate against a deck enum.
- Joiners inherit the value fixed at room creation. A joining connection cannot alter it.
- `state.deck` is included only when the room has a deck. Existing state payloads remain unchanged when it does not.
- There is no `setDeck` message and no way to change a room's deck after creation.
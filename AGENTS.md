# AGENTS.md

This file is the onboarding doc for coding agents (opencode, Claude, Copilot Chat, etc.) working on this repo. It tells you what the project is, where everything lives, and how to verify your work. **Update this file whenever the project changes** (new files, new scripts, new conventions, new failure modes) **or whenever you learn a lesson during implementation** that the next agent should know. If you don't update it, the next agent will repeat your mistakes.

## TL;DR for agents

WebSocket backend for Planning Poker. Single Node.js process, all state in memory. TypeScript (strict), Hono framework, Zod for runtime validation, Pino for logs, Vitest for tests, Biome for lint/format. Deploys to Render free tier on push to `main`.

**Before writing any code, read both:**
1. [`planning-poker-api-contract.md`](./planning-poker-api-contract.md) — the wire protocol (what the server sends and accepts). This is the contract the frontend codes against; do not break it without explicit user approval.
2. [`planning-poker-backend-design-decisions.md`](./planning-poker-backend-design-decisions.md) — every design choice made during the interview session (Q1–Q31), grouped by area. Refer back to this when a decision's reasoning isn't obvious.

## Project structure

```
src/
  index.ts        # serve(), route registration, wire-up, SIGTERM handler
  room.ts         # Room type + in-memory Map + mutate helpers + buildStateSnapshot
  conn.ts         # per-connection state, validation, message routing for one client
  messages.ts     # Zod schemas + z.infer'd types for ServerToClient / ClientToServer
  config.ts       # env-bound config object, validated at boot
  errors.ts       # error message string constants (single spot)
test/
  *.test.ts       # unit tests (no integration tests for v1)
planning-poker-api-contract.md
planning-poker-backend-design-decisions.md
README.md
AGENTS.md         # this file — keep it current
```

## Commands you must run before finishing any task

```bash
pnpm typecheck   # tsc --noEmit, strict mode
pnpm lint        # biome check src test
pnpm test        # vitest run
```

All three must pass. If `pnpm lint` complains about formatting, run `pnpm format` and re-stage. Do not commit if any of these fail.

If you discover a new meaningful command (e.g. a specific vitest invocation, a biome autofix flag), add it to this file.

## Tech stack (locked decisions — do not change without user approval)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Boring, stable, Render-compatible |
| Framework | Hono on `@hono/node-server` + `ws` | Lightweight, runtime-agnostic, WS via `upgradeWebSocket` |
| Language | TypeScript (strict), `module: "NodeNext"` | See `planning-poker-backend-design-decisions.md` §4 for the full tsconfig options |
| Validation | Zod | Single source of truth for runtime parsers and static types via `z.infer` |
| Logging | Pino | Structured JSON, child logger per room |
| Tests | Vitest | ESM-native, fake timers for time-dependent units |
| Lint/format | Biome | Replaces ESLint + Prettier; `pnpm lint` and `pnpm format` |
| Package manager | pnpm | Committed lockfile |
| Deploy | Render free tier, direct GitHub link | No CI YAML, no Dockerfile |

## Invariants you must not break

These are the load-bearing invariants. Violating them is a bug, even if tests pass.

1. **`welcome` → `state` ordering on join.** Every new connection receives `welcome{userId}` before any `state` message. Then `state` is broadcast to *all* clients in the room, including the joiner. See `planning-poker-backend-design-decisions.md` D6.3.

2. **`state` is always derived, never stored.** The room holds the source of truth (a `Map<userId, User>` with `{id, name, seq, vote}` fields, plus `hostId` and `revealed`). Every `state` broadcast is built fresh by `buildStateSnapshot(room)`. Do not cache or patch a `state` object on the room — see D8.1 in the decisions doc.

3. **`votes` is `null` while `revealed === false`.** Vote values never leak pre-reveal. `buildStateSnapshot` is the single place that enforces this.

4. **Host promotion picks the smallest remaining `seq`.** `seq` is monotonic per-room, assigned at join. No ties possible. Promotion runs only on host disconnect, never on non-host disconnect. See D9.2.

5. **Cleanup is idempotent.** `onClose` removes the user iff present. A socket may close after we've already cleaned it up; the remove-if-present handles that. See D9.3.

6. **Handlers are synchronous end-to-end.** No `await` mid-handler that could let another message mutate the room. The Node event loop serializes JS execution, so no locks are needed — but only if you don't yield. See D10.3.

7. **No `leave` message.** Closing the socket is the only way to leave. Do not add a `leave` handler. See D6.1.

8. **Every inbound message Zod-parse fails → `Invalid <type> message`.** Do not pass through Zod's internal issue text to clients; log the detail server-side at `warn` and return the stable normalized string. See D7.5 and the contract's error table.

9. **Every `error` keeps the socket open** except heartbeat timeout (1011) and server shutdown (1001). Do not close the socket on a validation failure or rule violation.

10. **Room discarded immediately when empty.** No grace period. See D9.4.

## Validation rules (regexes and bounds)

- `room` (on WS upgrade): `^([a-z0-9]{4,32}-)*[a-z0-9]{4,32}$`, total length ≤ `MAX_ROOM_ID_LENGTH` (default 128). Mismatch → HTTP 400 on the upgrade, socket never opens.
- `name` (on WS upgrade): trim, 1–32 chars after trim. Mismatch → HTTP 400 on the upgrade.
- `vote.value`: `z.string().min(1).max(64)`, no character restrictions, no trimming. Non-string `value` → Zod fails → `Invalid vote message`.
- Inbound WS frame: `MAX_PAYLOAD_BYTES` (default 4096). `ws` auto-closes with 1009 on violation; no app-level `error`.
- Rate limit: `MESSAGE_RATE_BURST` (default 20) per `MESSAGE_RATE_WINDOW_MS` (default 1000) per socket. Over → `Rate limit exceeded` error, message ignored, socket kept.
- Room size: `MAX_ROOM_USERS` (default 50) concurrent users. Over → HTTP 403 on the upgrade.

## Error message strings (the full vocabulary)

All `error` messages must come from `src/errors.ts` (single source). The strings are:

```
"Malformed message"
"Unknown message type"
"Invalid <type> message"     # <type> is the lowercased message type, e.g. "Invalid vote message"
"Voting is locked until reset"
"Only the host can reveal votes"
"Only the host can reset votes"
"Votes are already revealed"
"Votes are already reset"
"Rate limit exceeded"
"Internal error"
```

Validation-failure close codes:
- `1001 "server_shutdown"` (graceful shutdown via SIGTERM)
- `1011` (heartbeat pong timeout)

See the contract's error table for which trigger maps to which string.

## Testing

Unit tests only for v1. Target the pure functions in `room.ts` and `validation.ts`:

- `buildStateSnapshot(room)` — `votes` redaction, users list, `hasVoted` flags
- `promoteNextHost(room)` — smallest `seq`, delete-if-empty, no-op when not host disconnect
- `validateRoomId`, `validateName`, `parseClientMessage` (Zod-backed)
- Voting state-machine rules — `vote` rejected when revealed, `reset` clears, idempotent `reveal`/`reset` rejected

Use `vi.useFakeTimers()` for any time-dependent unit (e.g. the rate-limit window). Skip integration tests (real WS round-trips); they're acknowledged as a gap and may be added later. See `planning-poker-backend-design-decisions.md` §13.

When adding a new behavior, add a unit test for it. Do not add an integration test without user approval — the deliberate scope is unit-only.

## Logging conventions

- Root logger in `src/index.ts`; child logger per room with `{ roomId }` context, created when the room is created.
- Levels:
  - `info` — room created, user joined, user left, host promoted, room discarded
  - `warn` — validation failures, rule violations, malformed messages (attach the Zod issue detail for shape failures)
  - `error` — unexpected send failures, unhandled exceptions in `onMessage`/`onClose`
  - `debug` — per-message traces, off by default (`LOG_LEVEL=debug` to enable)
- Never log vote values before `revealed === true`. The `votes` map is the only carrier of vote values; logs reference users by `id`, not by how they voted.

## Code style

- 2-space indent, double quotes, semicolons (Biome enforced — `pnpm format`).
- `import type` for type-only imports (`verbatimModuleSyntax: true` in tsconfig).
- No comments unless explicitly requested by the user.
- No emoji in code or commit messages.
- Handlers structured as **validate → mutate → broadcast**. A throw in validate is recoverable (keep socket, send `Internal error`); a throw in mutate/broadcast is a bug but should not crash the process (see the `try/catch` wrappers in §"Error boundaries").

## Error boundaries

Two `try/catch` wrappers in `src/index.ts`:

- Around `onMessage` body: catch → log `error` with `{ roomId, userId }`, send `{"type":"error","message":"Internal error"}` to the offender, keep socket, keep room.
- Around `onClose` body: catch → log `error`, close the offender socket hard. If cleanup throws, room integrity is suspect; the next `onClose` (if any) tries again. Worst case: a corrupted room hangs until empty and is discarded.

See `planning-poker-backend-design-decisions.md` D11.4.

## Concurrency model

Single Node event loop. Each message handler runs to completion before the next. **Handlers are synchronous end-to-end** — if you need `await` mid-handler, stop and reconsider; you'd be yielding control and another message could mutate the room from under you. The `Map<roomId, Room>` needs no locks because of this. See D10.3.

## Configuration loading

`src/config.ts` reads env vars at boot, parses integers, validates bounds, and throws on bad values (process exits non-zero, Render marks deploy failed). Defaults are picked so the service runs with zero configuration. The full table is in `planning-poker-backend-design-decisions.md` §5 and in the README. Do not read `process.env` directly elsewhere — import the validated config object from `src/config.ts`.

## Deployment

Render free tier, connected GitHub repo, auto-deploy on push to `main`. Render runs `pnpm install && pnpm build && pnpm start`. No Dockerfile. No GitHub Actions YAML. If you're asked to change deployment, ask the user first — the choice was deliberate (vendor lock-in avoidance, see `planning-poker-backend-design-decisions.md` §1 D1.5).

Render spins down after 15 min idle; `SIGTERM` triggers graceful shutdown (close all sockets with 1001/"server_shutdown", wait up to `SHUTDOWN_GRACE_MS`, exit). See D11.2.

## When to update this file

**Update AGENTS.md whenever:**

- A new file or directory is added to `src/` or `test/` — add it to the project structure list and explain its role.
- A new script is added to `package.json` — add it to the commands list with what it does.
- A new invariant is introduced or an existing one is removed/relaxed — update the "Invariants you must not break" section.
- A new error message string is added — add it to the error vocabulary list.
- A new env var is added — add it to the config tables here and in the README.
- You discover a footgun, a surprise, or a lesson during implementation (e.g. "the `ws` library doesn't emit `onClose` if you call `ws.terminate()` synchronously in `onMessage` — use `process.nextTick`") — add a "Lessons learned" entry below.
- The testing strategy changes (e.g. integration tests are added) — update the Testing section.
- The deployment target or build process changes — update the Deployment section.

**Lessons learned (append below this line as they're discovered):**

<!-- Example format:
- **YYYY-MM-DD — Short title**: One-paragraph description of the lesson, including the symptom, root cause, and fix. Include file:line references where relevant.
-->

(None yet — add the first one when you hit something this file should have warned you about.)
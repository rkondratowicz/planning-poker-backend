# AGENTS.md

This file is the onboarding doc for coding agents (opencode, Claude, Copilot Chat, etc.) working on this repo. It tells you what the project is, where everything lives, and how to verify your work. **Update this file whenever the project changes** (new files, new scripts, new conventions, new failure modes) **or whenever you learn a lesson during implementation** that the next agent should know. If you don't update it, the next agent will repeat your mistakes.

## TL;DR for agents

WebSocket backend for Planning Poker. Single Node.js process, all state in memory. TypeScript (strict), Hono framework, Zod for runtime validation, Pino for logs, Vitest for tests, Biome for lint/format. Deploys to Render free tier on push to `main`.

**Before writing any code, read both:**
1. [`planning-poker-api-contract.md`](./docs/planning-poker-api-contract.md) — the wire protocol (what the server sends and accepts). This is the contract the frontend codes against; do not break it without explicit user approval.
2. [`planning-poker-backend-design-decisions.md`](./docs/planning-poker-backend-design-decisions.md) — every design choice made during the interview session (Q1–Q31), grouped by area. Refer back to this when a decision's reasoning isn't obvious.

## Project structure

```
src/
  index.ts        # serve(), route registration, wire-up, SIGTERM handler
  room.ts         # Room type + in-memory Map + mutate helpers + buildStateSnapshot
  conn.ts         # per-connection state, validation, message routing for one client
  validation.ts   # pure validateRoomId / validateName helpers used by the /ws upgrade
  messages.ts     # Zod schemas + z.infer'd types for ServerToClient / ClientToServer
  config.ts       # env-bound config object, validated at boot
  errors.ts       # error message string constants (single spot)
test/
  *.test.ts       # unit tests (no integration tests for v1)
vitest.config.ts  # pins include: test/** and excludes dist/ (prevents build double-run)
docs/
  planning-poker-api-contract.md  # wire protocol (server↔client messages, error table)
  planning-poker-backend-design-decisions.md  # design interview Q&A (Q1–Q31)
  TASKS.md  # build progress checklist
README.md
AGENTS.md         # this file — keep it current
```

## Commands you must run before finishing any task

```bash
pnpm typecheck   # tsc --noEmit, strict mode
pnpm lint        # biome check src test
pnpm test        # vitest run
pnpm build       # tsc → dist/ (verify the build compiles; run before committing wire-up Changes)
```

All three must pass. If `pnpm lint` complains about formatting, run `pnpm format` and re-stage. Do not commit if any of these fail.

`vitest.config.ts` pins `include: ["test/**/*.test.ts"]` and excludes `dist/` — without it, `pnpm build` emits `dist/test/*.js` and `pnpm test` double-runs them (212 tests instead of 106). `dist/` is gitignored; do not commit it.

Before writing a commit message, load the `commit-conventions` skill — it encodes this repo's imperative subject / optional `Area:` prefix / ~72-char body style so you don't need to inspect git history to match it.

If you discover a new meaningful command (e.g. a specific vitest invocation, a biome autofix flag), add it to this file.

## Tech stack (locked decisions — do not change without user approval)

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js 20 LTS | Boring, stable, Render-compatible |
| Framework | Hono on `@hono/node-server` + `ws` | Lightweight, runtime-agnostic, WS via `upgradeWebSocket` |
| Language | TypeScript (strict), `module: "NodeNext"` | See `docs/planning-poker-backend-design-decisions.md` §4 for the full tsconfig options |
| Validation | Zod | Single source of truth for runtime parsers and static types via `z.infer` |
| Logging | Pino | Structured JSON, child logger per room |
| Tests | Vitest | ESM-native, fake timers for time-dependent units |
| Lint/format | Biome | Replaces ESLint + Prettier; `pnpm lint` and `pnpm format` |
| Package manager | pnpm | Committed lockfile |
| Deploy | Render free tier, direct GitHub link | No CI YAML, no Dockerfile |

## Invariants you must not break

These are the load-bearing invariants. Violating them is a bug, even if tests pass.

1. **`welcome` → `state` ordering on join.** Every new connection receives `welcome{userId}` before any `state` message. Then `state` is broadcast to *all* clients in the room, including the joiner. See `docs/planning-poker-backend-design-decisions.md` D6.3.

2. **`state` is always derived, never stored.** The room holds the source of truth (a `Map<userId, User>` with `{id, name, seq, vote}` fields, plus `hostId` and `revealed`). Every `state` broadcast is built fresh by `buildStateSnapshot(room)`. Do not cache or patch a `state` object on the room — see D8.1 in the decisions doc.

3. **`votes` is `null` while `revealed === false`.** Vote values never leak pre-reveal. `buildStateSnapshot` is the single place that enforces this.

4. **Host promotion picks the smallest remaining `seq`.** `seq` is monotonic per-room, assigned at join. No ties possible. Promotion runs only on host disconnect, never on non-host disconnect. See D9.2.

5. **Cleanup is idempotent.** `onClose` removes the user iff present. A socket may close after we've already cleaned it up; the remove-if-present handles that. See D9.3.

6. **Handlers are synchronous end-to-end.** No `await` mid-handler that could let another message mutate the room. The Node event loop serializes JS execution, so no locks are needed — but only if you don't yield. See D10.3.

7. **No `leave` message.** Closing the socket is the only way to leave. Do not add a `leave` handler. See D6.1.

8. **Every inbound message Zod-parse fails → `Invalid <type> message`.** Do not pass through Zod's internal issue text to clients; log the detail server-side at `warn` and return the stable normalized string. See D7.5 and the contract's error table.

9. **Every `error` keeps the socket open** except heartbeat timeout (1011) and server shutdown (1001). Do not close the socket on a validation failure or rule violation.

10. **Room discarded immediately when empty.** No grace period. See D9.4.

## Validation rules & error vocabulary

See the `validation-errors-reference` skill (loaded on demand) for the canonical regex list, full error-string set, trigger→string mappings, and the `1001`/`1011` close-codes table. The strings also live in `src/errors.ts` as the code-level source of truth.

## Testing

Unit tests only for v1. Target the pure functions in `room.ts` and `validation.ts`:

- `buildStateSnapshot(room)` — `votes` redaction, users list, `hasVoted` flags
- `promoteNextHost(room)` — smallest `seq`, delete-if-empty, no-op when not host disconnect
- `validateRoomId`, `validateName`, `parseClientMessage` (Zod-backed)
- Voting state-machine rules — `vote` rejected when revealed, `reset` clears, idempotent `reveal`/`reset` rejected

Use `vi.useFakeTimers()` for any time-dependent unit (e.g. the rate-limit window). Skip integration tests (real WS round-trips); they're acknowledged as a gap and may be added later. See `docs/planning-poker-backend-design-decisions.md` §13.

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

## Error boundaries & deployment lifecycle

See the `deployment-lifecycle` skill (loaded on demand) for the `onMessage`/`onClose` try/catch wrappers, `SIGTERM` graceful shutdown, `SHUTDOWN_GRACE_MS`, `1001 "server_shutdown"` / `1011` close codes, and Render free-tier deploy details.

## Concurrency model

Single Node event loop. Each message handler runs to completion before the next. **Handlers are synchronous end-to-end** — if you need `await` mid-handler, stop and reconsider; you'd be yielding control and another message could mutate the room from under you. The `Map<roomId, Room>` needs no locks because of this. See D10.3.

## Configuration loading

`src/config.ts` reads env vars at boot, parses integers, validates bounds, and throws on bad values (process exits non-zero, Render marks deploy failed). Defaults are picked so the service runs with zero configuration. The full table is in `docs/planning-poker-backend-design-decisions.md` §5 and in the README. Do not read `process.env` directly elsewhere — import the validated config object from `src/config.ts`.

## When to update this file

**Update AGENTS.md whenever:**

- A new file or directory is added to `src/`, `test/`, or `docs/` — add it to the project structure list and explain its role.
- A new script is added to `package.json` — add it to the commands list with what it does.
- A new invariant is introduced or an existing one is removed/relaxed — update the "Invariants you must not break" section.
- A new error message string is added — add it to the error vocabulary list in the `validation-errors-reference` skill.
- A new env var is added — add it to the config tables here and in the README.
- You discover a footgun, a surprise, or a lesson during implementation (e.g. "the `ws` library doesn't emit `onClose` if you call `ws.terminate()` synchronously in `onMessage` — use `process.nextTick`") — append a "Lessons learned" entry to the `toolchain-and-dependencies` skill, not here.
- The testing strategy changes (e.g. integration tests are added) — update the Testing section.
- The deployment target, graceful-shutdown behavior, or close codes change — update the `deployment-lifecycle` skill.

**Lessons learned:** see the `toolchain-and-dependencies` skill (loaded on demand) for pnpm v11 `allowBuilds` / TS 6 `@types/node` / Vitest 4 `vite` peer pin / Biome 2 `migrate` / `pnpm build`-then-`test` double-run footguns and the "never trust LLM memory for lib versions" dependency workflow. Append new entries to that skill, not here.

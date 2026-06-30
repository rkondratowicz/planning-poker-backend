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
  messages.ts     # Zod schemas + z.infer'd types for ServerToClient / ClientToServer
  config.ts       # env-bound config object, validated at boot
  errors.ts       # error message string constants (single spot)
test/
  *.test.ts       # unit tests (no integration tests for v1)
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
```

All three must pass. If `pnpm lint` complains about formatting, run `pnpm format` and re-stage. Do not commit if any of these fail.

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

## Error boundaries

Two `try/catch` wrappers in `src/index.ts`:

- Around `onMessage` body: catch → log `error` with `{ roomId, userId }`, send `{"type":"error","message":"Internal error"}` to the offender, keep socket, keep room.
- Around `onClose` body: catch → log `error`, close the offender socket hard. If cleanup throws, room integrity is suspect; the next `onClose` (if any) tries again. Worst case: a corrupted room hangs until empty and is discarded.

See `docs/planning-poker-backend-design-decisions.md` D11.4.

## Concurrency model

Single Node event loop. Each message handler runs to completion before the next. **Handlers are synchronous end-to-end** — if you need `await` mid-handler, stop and reconsider; you'd be yielding control and another message could mutate the room from under you. The `Map<roomId, Room>` needs no locks because of this. See D10.3.

## Configuration loading

`src/config.ts` reads env vars at boot, parses integers, validates bounds, and throws on bad values (process exits non-zero, Render marks deploy failed). Defaults are picked so the service runs with zero configuration. The full table is in `docs/planning-poker-backend-design-decisions.md` §5 and in the README. Do not read `process.env` directly elsewhere — import the validated config object from `src/config.ts`.

## Deployment

Render free tier, connected GitHub repo, auto-deploy on push to `main`. Render runs `pnpm install && pnpm build && pnpm start`. No Dockerfile. No GitHub Actions YAML. If you're asked to change deployment, ask the user first — the choice was deliberate (vendor lock-in avoidance, see `docs/planning-poker-backend-design-decisions.md` §1 D1.5).

Render spins down after 15 min idle; `SIGTERM` triggers graceful shutdown (close all sockets with 1001/"server_shutdown", wait up to `SHUTDOWN_GRACE_MS`, exit). See D11.2.

## When to update this file

**Update AGENTS.md whenever:**

- A new file or directory is added to `src/`, `test/`, or `docs/` — add it to the project structure list and explain its role.
- A new script is added to `package.json` — add it to the commands list with what it does.
- A new invariant is introduced or an existing one is removed/relaxed — update the "Invariants you must not break" section.
- A new error message string is added — add it to the error vocabulary list.
- A new env var is added — add it to the config tables here and in the README.
- You discover a footgun, a surprise, or a lesson during implementation (e.g. "the `ws` library doesn't emit `onClose` if you call `ws.terminate()` synchronously in `onMessage` — use `process.nextTick`") — add a "Lessons learned" entry below.
- The testing strategy changes (e.g. integration tests are added) — update the Testing section.
- The deployment target or build process changes — update the Deployment section.

**Lessons learned (append below this line as they're discovered):**

- **2026-06-30 — Add/change dependencies via `pnpm`, never from LLM training data.** Do NOT pick a library version (or assume an API exists) from memory. Library majors ship breaking changes constantly (zod 3→4, biome 1→2, typescript 5→6, vitest 2→4, pino 9→10, @hono/node-server 1→2 all happened in this repo). Workflow for adding or bumping a dependency: (1) check the real latest with `pnpm view <pkg> version` (and `pnpm view <pkg> versions --json` if you need to pin a major); (2) install it with `pnpm add <pkg>` (or `pnpm add -D` for devDeps) so the lockfile, `package.json`, and pnpm supply-chain policies are updated correctly — hand-editing `package.json` then `pnpm install` is fine for bumps, but `pnpm add` is the only correct way to introduce a *new* dep; (3) read the package's own current docs (Context7 or the changelog) for breaking changes before touching code — your training data is stale; (4) run `pnpm typecheck && pnpm lint && pnpm test` and fix fallout before moving on. Pnpm v11 may auto-append a `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml` when you add a freshly-released package (e.g. vite@8.1.2) — that's expected, leave it.

- **2026-06-30 — TypeScript 6 needs an explicit node types entry.** TS 6.0 stopped auto-including `@types/node`. `tsc` fails with `Cannot find namespace 'NodeJS'` / `Cannot find name 'process'`. Fix: add `"types": ["node"]` to `tsconfig.json` `compilerOptions`. (`@types/node` stays on the 22 major on purpose to match node 22 LTS / Render's node 20 runtime; do not bump it to 26 just because it's published.)

- **2026-06-30 — Vitest 4 needs `vite` ≥6 as a direct devDependency.** Vitest 4's peer range is `vite ^6||^7||^8`. Without an explicit `vite` pin, pnpm resolves the transitive vite 5 and `pnpm test` blows up at startup with `ERR_PACKAGE_PATH_NOT_EXPORTED: ./module-runner`. Add `vite` (currently `^8.1.2`) to `devDependencies` via `pnpm add -D vite`.

- **2026-06-30 — Biome 2 config migration.** Bumping `@biomejs/biome` 1→2 is not a drop-in: the `biome.json` schema and several keys changed. Run `pnpm exec biome migrate --write` after the bump (it rewrites the `$schema` URL and transforms `files.ignore` → `files.includes` with `!`-negated patterns, top-level `organizeImports.enabled` → `assist.actions.source.organizeImports: "on"`, and `linter.rules.recommended: true` → `linter.rules.preset: "recommended"`). Then re-run `pnpm lint`. Don't hand-write a v2 config from memory — use the migrate command.

- **2026-06-30 — `pnpm build` then `pnpm test` double-runs tests.** `tsconfig.json` sets `rootDir: "."` and `include: ["src","test"]`, so `tsc` emits `dist/test/*.test.js`. Vitest's default glob (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) then picks up those compiled copies alongside `test/*.test.ts`, so the count doubles (35 → 70) and `.gitignore`'d `dist/` silently affects test runs. When you run `pnpm build`, always `rm -rf dist` before `pnpm test`, or (preferred long-term) add a `vitest.config.ts` with `test: { exclude: ["dist/**", "node_modules/**"] }`. Until that config exists, treat the post-build test count as a false signal.

- **2026-06-30 — pnpm v11 needs `allowBuilds` for native postinstalls**: With pnpm v11, native-binary deps with `postinstall` scripts (`@biomejs/biome`, `esbuild`) are NOT run by default and `pnpm install` exits non-zero with `[ERR_PNPM_IGNORED_BUILDS]`, which also breaks any `pnpm <script>` (each script re-runs `pnpm install` via `verifyDepsBeforeRun`). `pnpm approve-builds` is interactive and unusable in a non-TTY agent shell. Fix: add `pnpm-workspace.yaml` next to `package.json` with an `allowBuilds:` map (e.g. `{"@biomejs/biome": true, "esbuild": true}`), then `rm -rf node_modules pnpm-lock.yaml && pnpm install` to re-resolve and actually run the builds. The `pnpm.onlyBuiltDependencies` field in `package.json` is no longer read by pnpm v11 (warned + ignored) — use `pnpm-workspace.yaml`. Without this, `pnpm build`/`pnpm start` on Render would also fail the deploy on a fresh machine.

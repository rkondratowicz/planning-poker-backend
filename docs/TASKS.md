# Tasks

Current: 1 done, starting 2 next.

- [x] 1. Scaffolding & leaf modules (`package.json`, `tsconfig.json`, `biome.json`, install deps, `src/config.ts`, `src/errors.ts`, config unit test). After this `pnpm typecheck && pnpm lint && pnpm test` passes.
- [ ] 2. Protocol layer (`src/messages.ts` — Zod schemas for `ClientToServer`, plain types for `ServerToClient`, `parseClientMessage` + tests for valid/invalid shapes and `Invalid <type> message` normalization).
- [ ] 3. Domain layer (`src/room.ts` — `Room` type, in-memory `Map`, `buildStateSnapshot` with votes redaction, `promoteNextHost` picking smallest `seq`, vote/reveal/reset mutators enforcing the state-machine rules. Most unit tests land here).
- [ ] 4. Connection layer (`src/conn.ts` — per-connection state, rate-limit token bucket, validate→mutate→broadcast handler structure, idempotent `onClose` cleanup).
- [ ] 5. Wire-up (`src/index.ts` — Hono app, `/health`, `/ws` upgrade with `room`/`name` validation, heartbeat loop, SIGTERM shutdown, the two `try/catch` error boundaries. No new unit tests — acknowledged integration gap).
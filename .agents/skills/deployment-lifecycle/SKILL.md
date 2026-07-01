---
name: deployment-lifecycle
description: Use when touching src/index.ts graceful-shutdown / SIGTERM handling, heartbeat/pong logic, WebSocket close codes, or any Render deployment / build / run question. Covers Render free tier, SHUTDOWN_GRACE_MS, 1001 "server_shutdown", 1011 heartbeat timeout, and the error-boundary try/catch wrappers in src/index.ts. Use ONLY for lifecycle, deploy, and error-boundary work.
---

# Deployment & Lifecycle

## Error boundaries

Two `try/catch` wrappers in `src/index.ts`:

- Around `onMessage` body: catch → log `error` with `{ roomId, userId }`, send `{"type":"error","message":"Internal error"}` to the offender, keep socket, keep room.
- Around `onClose` body: catch → log `error`, close the offender socket hard. If cleanup throws, room integrity is suspect; the next `onClose` (if any) tries again. Worst case: a corrupted room hangs until empty and is discarded.

See `docs/planning-poker-backend-design-decisions.md` D11.4.

## Validation-failure close codes

- `1001 "server_shutdown"` (graceful shutdown via SIGTERM)
- `1011` (heartbeat pong timeout)

See the contract's error table for which trigger maps to which string.

## Deployment

Render free tier, connected GitHub repo, auto-deploy on push to `main`. Render runs `pnpm install && pnpm build && pnpm start`. No Dockerfile. No GitHub Actions YAML. If you're asked to change deployment, ask the user first — the choice was deliberate (vendor lock-in avoidance, see `docs/planning-poker-backend-design-decisions.md` §1 D1.5).

Render spins down after 15 min idle; `SIGTERM` triggers graceful shutdown (close all sockets with 1001/"server_shutdown", wait up to `SHUTDOWN_GRACE_MS`, exit). See D11.2.

## Repo-root file access at runtime (footgun)

`src/index.ts` reads `package.json` and `docs/planning-poker-api-contract.md` once at boot to serve `/` and `/contract`. The compiled entrypoint is `dist/src/index.js`, so `new URL("../...", import.meta.url)` resolves to `dist/`, NOT the repo root — it crashes on Render with `ENOENT: ... dist/package.json` (and works only under `pnpm dev` where tsx runs `src/index.ts` directly).

**Always resolve repo-root files against `process.cwd()`, not `import.meta.url`** — Render runs `pnpm start` (= `node dist/src/index.js`) with cwd = repo root (`/opt/render/project/src`), and `pnpm dev`/`pnpm start` locally also run from the repo root. `path.resolve(process.cwd(), "package.json")` is the only form that works in dev, build-run, and Render.

Do NOT add a bundler step or a copy-to-dist postbuild to "fix" this — cwd resolution is the cheap, dependency-free answer. If a future start command is ever invoked from a non-root cwd, this assumption breaks; flag it in AGENTS.md if that ever happens.
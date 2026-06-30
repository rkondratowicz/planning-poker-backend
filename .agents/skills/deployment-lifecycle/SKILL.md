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
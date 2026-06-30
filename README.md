# planning-poker-backend

WebSocket backend for Planning Poker — a collaborative estimation tool for agile teams. Participants join a shared room, cast votes on planning items, and reveal them together.

## What this is

A single Node.js process serving one WebSocket endpoint (`/ws`) plus one health-check route (`/health`). No database, no persistence, no clustering — all room state lives in memory and is discarded when the last participant leaves. Designed for workshop-time use (short-lived estimation sessions with a facilitator and a handful of participants).

## Prerequisites

- **Node.js 20 LTS** or newer
- **pnpm** (install via `npm install -g pnpm` if you don't have it)

## Getting started

```bash
# install dependencies
pnpm install

# start the dev server with hot reload on http://localhost:3000
pnpm dev
```

The server prints a single log line on startup telling you which port it's listening on.

## Available scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Run the server with hot reload (via `tsx watch`) |
| `pnpm build` | Compile TypeScript to `dist/` (typecheck-only — the prod process runs compiled JS) |
| `pnpm start` | Run the compiled server from `dist/` (used in production) |
| `pnpm typecheck` | Typecheck the project without emitting any files |
| `pnpm lint` | Run Biome lint + format check over `src/` and `test/` |
| `pnpm format` | Auto-format `src/` and `test/` with Biome |
| `pnpm test` | Run the unit tests once |
| `pnpm test:watch` | Run the unit tests in watch mode |

## Connecting a client

Connect any WebSocket client to:

```
ws://localhost:3000/ws?room=<roomId>&name=<displayName>
```

- `room` — a slug like `xk29-4plm` (lowercase alphanumeric, 4–32 chars per segment, dashes between segments). The first person to connect to a given room becomes its host.
- `name` — your display name (1–32 chars).

## Quick smoke test

You can test the server is alive with curl:

```bash
curl http://localhost:3000/health
# → ok
```

For a real WS round-trip, use `wscat`:

```bash
# in one terminal
pnpm dev
# in another
npx wscat -c "ws://localhost:3000/ws?room=test-room&name=Alice"
# you should receive a {"type":"welcome",...} then a {"type":"state",...}
```

Open a second `wscat` connection with a different `name` to see the roster broadcast.

## Configuration

All settings have sensible defaults — the server runs correctly with zero configuration. To override, set environment variables (e.g. via your shell or a local `.env` file loaded with `node --env-file`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP/WS listen port |
| `LOG_LEVEL` | `info` | Pino log level (`debug`/`info`/`warn`/`error`) |
| `HEARTBEAT_INTERVAL_MS` | `30000` | How often to ping clients |
| `HEARTBEAT_TIMEOUT_MS` | `10000` | Grace period before a non-ponging client is dropped |
| `MAX_ROOM_USERS` | `50` | Max concurrent users in a room |
| `MAX_PAYLOAD_BYTES` | `4096` | Max inbound WS frame size |
| `MESSAGE_RATE_BURST` | `20` | Max inbound messages per window before rate-limit |
| `MESSAGE_RATE_WINDOW_MS` | `1000` | Rate-limit window length |
| `SHUTDOWN_GRACE_MS` | `20000` | Max wait for graceful shutdown before forced exit |

## Protocol

The full message contract — what the server sends, what it accepts, and all error cases — is documented in [`planning-poker-api-contract.md`](./planning-poker-api-contract.md). Read that if you're building a client or want to understand the wire format precisely.

## Deployment

This service is deployed to [Render](https://render.com)'s free tier via the connected GitHub repo: every push to `main` auto-deploys. No GitHub Actions config, no Dockerfile — Render runs `pnpm install && pnpm build && pnpm start` on each deploy.

Note: Render's free web services spin down after 15 minutes of no inbound traffic and wake on the next request (~30s cold start). For workshop use that's fine — just keep a browser tab pointed at `https://<host>/health` refreshing every 10 minutes, or ping it from your CI if you want to keep it warm all day.

## Contributing

Before committing, please run:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

All three should pass. Format with `pnpm format` if Biome complains.

## License

MIT
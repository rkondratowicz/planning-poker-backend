---
name: validation-errors-reference
description: Use when editing src/messages.ts, src/errors.ts, src/config.ts bounds, or any validation / error-handling code. Contains the canonical regex list, the full error-string vocabulary, trigger-to-string mappings, and the close-codes table. Reference only — src/errors.ts is the code-level source of truth.
---

# Validation Rules & Error Vocabulary

## Validation rules (regexes and bounds)

- `room` (on WS upgrade): `^([a-z0-9]{4,32}-)*[a-z0-9]{4,32}$`, total length ≤ `MAX_ROOM_ID_LENGTH` (default 128). Mismatch → HTTP 400 on the upgrade, socket never opens.
- `name` (on WS upgrade): trim, 1–32 chars after trim. Mismatch → HTTP 400 on the upgrade.
- `deck` (optional on WS upgrade): trim; blank is treated as absent, otherwise maximum `MAX_DECK_LENGTH` chars (default 32). Too long → HTTP 400 on the upgrade. The backend does not validate deck identifiers against an enum.
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
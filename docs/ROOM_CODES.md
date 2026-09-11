# Room codes and saved games

New rooms have two identifiers:

- **Join code:** four characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. There are 1,048,576 possible codes. `0`, `O`, `1`, and `I` are excluded.
- **Permanent room ID:** a UUID used by saved sessions, durable invite links, seats, game history, and command receipts. Reconnects use this ID rather than a recyclable join code.

Existing eight-character room IDs and links continue working. On the next successful admission or resume, an old room receives a four-character alias without changing its permanent ID, players, or saved game.

`RoomState` and `RoomPreview` expose the permanent `roomId` and, when available, `roomCode`. `GET /api/rooms/:reference` accepts a short code, an old eight-character ID, or a UUID. Join messages accept the same references and return the resolved permanent ID. The shared `room-reference.ts` helper trims input, uppercases codes, and lowercases UUIDs before validation.

## Expiry and recovery

A code has a **30-day inactivity lease**. Successful admission/resume and committed player actions refresh it. Anonymous previews, failed requests, heartbeat pings, and automatic timer moves do not. Expired codes stop resolving and may be assigned to a different room; no saved room, game, seat, history entry, or receipt is deleted.

Returning through a permanent link or saved session resumes the original room. If its previous code was recycled, the room gets another available code. A saved seat submitted with a recycled code fails the room-ownership check; it cannot silently join the other room. Share durable invite links when they need to remain valid beyond the code's lease.

Allocation runs inside SQLite transactions. It uses cryptographic uniform draws, at most 32 random attempts, then a bounded ordered search for an unused slot. The former 1,000-total-room limit is removed. If all code slots are occupied, new-room creation returns `ROOM_CODES_FULL`; existing saved games can still resume by permanent ID without receiving a code. This code-space ceiling is not a claim about server capacity. Saved-game storage currently has no automatic deletion policy.

## Lookup and admission limits

The server allows 60 room previews and 30 create/join/short-code admission attempts per minute per client address. These fixed-window maps retain at most 4,096 addresses each. Throttled HTTP previews return 429 with `Retry-After`; WebSocket admissions report `ROOM_RATE_LIMIT`. Established gameplay continues independently.

**Resuming a saved seat using its permanent UUID or old eight-character ID is exempt from the code-guessing bucket.** Authentication, seat ownership, ordinary per-socket message limits, and connection limits still apply. A group sharing an unreliable connection therefore cannot strand their existing seats by exhausting the short-code join allowance.

Forwarded client addresses are ignored by default. Set `TRUSTED_PROXY_CIDRS` only to the controlled network containing the immediate reverse proxy. The game port must remain private. For the current direct Caddy topology, the server accepts the rightmost validated `X-Forwarded-For` address only when the socket peer belongs to that configured network. Malformed values fall back to the socket address; untrusted clients cannot choose their rate-limit identity by supplying a header.

Caddy normally ignores incoming forwarded values from untrusted clients and records the peer it observed. If another proxy or CDN is added, review the complete trust chain before changing this configuration. [Caddy reverse-proxy header behavior](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)

Without a trusted-proxy setting, requests behind Caddy share its address bucket. The setting is a deployment boundary, not an instruction to trust every private network or every forwarded header.

# Security

The current server is an early playable game for controlled local testing. It is not ready for an unrestricted public game service.

In local playtest mode, seat tokens are bearer credentials. With Supabase configured, a verified Google-linked account is also required and must own that seat. The client generates them before the first handshake; the server stores only their SHA-256 hashes. Do not publish tokens, session exports, production database files, or private hands in bug reports. Use `wss://` when traffic leaves a trusted local machine. A room code is an invitation, not a password, and a display name is not an identity.

The prototype bounds message sizes, input shapes, connection count, room count, per-socket message rate, and outgoing buffers. Those controls do not replace ingress abuse protection, account abuse prevention, invite controls, token lifecycle management, storage quotas, or deployment hardening. A local playtest client with the correct seat token can take over that seat. Authenticated play requires the owning verified account, which can recover its seat on a new device. The old socket is revoked immediately. Google sessions are verified with the Auth server at handshake, and socket expiry forces token refresh. Profile updates are scoped to that verified identity; browser-supplied user IDs are ignored.

Production fails startup if auth is missing unless isolated local playtesting is explicitly enabled. Only the Supabase project URL and publishable/anon key enter public runtime config; never put a Supabase secret, service-role key or Google client secret there. The Google provider secret belongs in Supabase. See [authentication setup](docs/AUTH.md).

Private event history contains full game states, including hidden hands and deck outcomes. Only filtered public entries are exposed by the history endpoint to joined seats. Treat the database and its backups as private. State hashes detect a mismatching current snapshot; they do not authenticate a database against a malicious operator or protect against losing the disk.

If you find a vulnerability, use GitHub's private vulnerability reporting when enabled for this repository. Do not post exploitable details or secrets in a public issue. If that channel is unavailable, contact the repository owner privately through a contact method they have published; no private security mailbox is currently operated by this project.

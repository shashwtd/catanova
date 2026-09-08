# Security

The current server is an early playable game for controlled local testing. It is not ready for an unrestricted public game service.

Seat tokens are bearer credentials. The client generates them before the first handshake; the server stores only their SHA-256 hashes. Do not publish tokens, session exports, production database files, or private hands in bug reports. Use `wss://` when traffic leaves a trusted local machine. A room code is an invitation, not a password, and a display name is not an identity.

The prototype bounds message sizes, input shapes, connection count, room count, per-socket message rate, and outgoing buffers. Those controls do not replace ingress abuse protection, account authentication, invite controls, token lifecycle management, storage quotas, or deployment hardening. A client with the correct seat token can take over that seat; the old socket is revoked immediately.

If you find a vulnerability, use GitHub's private vulnerability reporting when enabled for this repository. Do not post exploitable details or secrets in a public issue. If that channel is unavailable, contact the repository owner privately through a contact method they have published; no private security mailbox is currently operated by this project.

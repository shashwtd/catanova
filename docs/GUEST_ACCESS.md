# Proposed guest access — awaiting approval

**Recommendation: temporary accounts with recoverable games.** A guest chooses a display name and the same free cosmetics as a signed-in player. The name is a display label, not a permanent global reservation. Identify the guest through a Supabase anonymous account and a protected session, never through their chosen name.

| Event                                        | Proposed behavior                                                                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Refresh, short network loss, or laptop sleep | Reconnect to the same seat and keep the same name and cosmetics.                                                                                                                                              |
| Explicit Leave in the lobby                  | Release the seat immediately. Do not reserve the name for that room.                                                                                                                                          |
| Leave during a game                          | Keep that game's seat and history; show the player as disconnected. Offer Resume on the same device.                                                                                                          |
| Close the tab                                | Preserve recovery for up to 24 hours. Do not treat unreliable browser-close events as forfeits.                                                                                                               |
| Recovery window expires                      | Expire the guest session and temporary profile. Preserve the match record; do not delete roads or rewrite historical moves.                                                                                   |
| Upgrade with Google                          | Offer to retain the portrait and name, and link the account where supported. If that Google account already exists, require a deliberate merge/recovery flow; never silently transfer another account's seat. |

Show a single clear notice on entry: **Guest progress can be recovered on this device for 24 hours. Sign in to keep your profile.** Provide an explicit **Forget guest** action outside an active match for someone using a shared device.

Before enabling this, implement server-enforced expiry, a cleanup job for anonymous Auth users and temporary profiles, abuse limits/CAPTCHA appropriate to public traffic, and tests for upgrades and interrupted sessions. Decide separately what a match does after an absent guest's recovery window; automatic forfeits or bots are not current rules.

No guest button or anonymous-account creation is implemented in the current build. Google login is the account path. The existing isolated local playtest remains available for development.

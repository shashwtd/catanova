# Guest access

Guest accounts are implemented using Supabase anonymous authentication. Enable the provider and set up the [account schema](AUTH.md) on the deployment. Guests choose the same globally unique 3–20 character username and game portrait as permanent players; their reservation is temporary.

| Event                                              | Behavior                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Refresh, short network loss or laptop sleep        | Recover the same seat using the existing Supabase session and invite.                                        |
| Leave a lobby                                      | Release that room's seat. Keep the account profile until expiry.                                             |
| Leave or close a tab during play                   | Preserve the match, pieces and move history. The player appears disconnected.                                |
| Seven days without confirmed account activity      | Expire the guest profile and release its username. The expired identity cannot create a replacement profile. |
| Link Google before expiry                          | Keep the exact account ID, username, portrait and room ownership. The profile becomes permanent.             |
| Google identity already belongs to another account | Explain the conflict and retain the guest session. Never merge accounts or transfer another account's seats. |
| Open Friends                                       | Offer Link Google. Guests cannot send, receive or accept friend requests.                                    |

The deadline is exactly seven days after the last server-recorded activity. Successful profile saves and explicit activity calls update it. The client sends activity only after a visible pointer/key interaction, at most once a minute; background tabs, passive pings, history reads and periodic friend refreshes do not prolong a guest. The game server also records accepted guest mutations in the background at most once a minute. Builds, dice rolls and turn completion never wait for that account-service round trip.

The game server enforces both the verified JWT expiry and its last confirmed guest deadline. Only a successful Supabase response extends that deadline. A failed activity write is retried after later interaction; it cannot invent more time or reset an expired account. This deliberately bounded sync means the recorded activity can lag recent interaction by up to one minute during normal operation, or longer during an account-service outage. Already verified games continue within their known validity window; expired or unregistered accounts fail closed on reconnect. Refreshes and reconnects read the existing deadline, rather than resetting it merely because a tab reopened.

Expired profile cleanup runs lazily in scoped account RPCs. A healthy caller's successful transaction removes expired profile rows, releases their names, and saves a private tombstone. If an expired caller's RPC rejects and rolls its transaction back, the old row remains expired and every subsequent read still rejects it; a later successful cleanup commits the tombstone. A Google link completed before the deadline is recognized from the provider identity timestamp even if the next account refresh is delayed. Linking after expiry cannot revive the old profile.

Cleanup does **not** delete Supabase `auth.users` records because the app has no auth-admin credential. It does not delete any SQLite match, seat, move, piece, event or command receipt. Expired guests lose access to their old seats; those match records remain intact. No timeout bot or forfeit is added by guest expiry. If an optional turn clock is enabled, its existing safe turn-completion rules still apply.

Clearing browser storage or signing out can make an anonymous identity unrecoverable because it has no external login credential. Link Google before doing so to retain account access. Expired guests can explicitly start a new guest account or sign in with Google and choose an available username.

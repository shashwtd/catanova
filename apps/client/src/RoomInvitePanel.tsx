import { useEffect, useRef, useState } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import type { RoomInvite } from '../../../packages/protocol/src/room-invites.js';
import type { useAuth } from './auth.js';
import type { RoomInvitesController } from './useRoomInvites.js';
import { Avatar } from './Profile.js';
import { Check, Clock3, Plus, RefreshCw, Users, X } from './GameIcons.js';
import { GoogleMark } from './ProviderMarks.js';
import { Invite } from './Lobby.js';
import { visibleRoomCode } from './navigation.js';

type Auth = ReturnType<typeof useAuth>;
export function RoomInviteInbox({
  invitations,
  busy,
  onOpen,
  onDismiss,
  blockedReason,
}: {
  invitations: readonly RoomInvite[];
  busy: boolean;
  onOpen: (roomId: string) => void;
  onDismiss: (id: string) => void;
  blockedReason?: string;
}) {
  if (!invitations.length) return null;
  return (
    <section className="room-invite-inbox" aria-label="Room invitations">
      <h3>
        Room invitations <span>{invitations.length}</span>
      </h3>
      <ul>
        {invitations.map((invite) => (
          <li key={invite.id}>
            <Avatar profile={invite.from.profile} />
            <div>
              <strong title={invite.from.username}>{invite.from.username}</strong>
              <span>
                Invited you to play
                {invite.roomCode ? (
                  <>
                    {' '}
                    · <b>{invite.roomCode}</b>
                  </>
                ) : (
                  ''
                )}
              </span>
            </div>
            <button
              type="button"
              className="roster-action roster-accept"
              disabled={busy || !!blockedReason}
              title={blockedReason}
              onClick={() => onOpen(invite.roomId)}
            >
              View room
            </button>
            <button
              type="button"
              className="roster-action roster-icon"
              aria-label={`Dismiss room invitation from ${invite.from.username}`}
              title="Dismiss invitation"
              disabled={busy}
              onClick={() => onDismiss(invite.id)}
            >
              <X size={20} />
            </button>
          </li>
        ))}
      </ul>
      {blockedReason && <p className="room-invite-blocked">{blockedReason}</p>}
    </section>
  );
}

/** Stays visible until dismissed or expired; never takes focus away from play. */
export function RoomInviteNotice({
  invitations,
  busy,
  blockedReason,
  error,
  onOpen,
  onDismiss,
  onShowAll,
}: Parameters<typeof RoomInviteInbox>[0] & { error?: string; onShowAll: () => void }) {
  const invite = invitations[0];
  return (
    <aside className="invitation-notice" aria-label="Game invitation" hidden={!invite}>
      <div role="status" aria-live="polite" aria-atomic="true" className="invitation-message">
        {invite && (
          <>
            <Avatar profile={invite.from.profile} />
            <span>
              <strong>{invite.from.username}</strong>
              <span>Invited you to play · {invite.roomCode ?? 'Game room'}</span>
            </span>
          </>
        )}
      </div>
      {invite && (
        <>
          <button
            className="invitation-dismiss"
            aria-label={`Dismiss invitation from ${invite.from.username}`}
            disabled={busy}
            onClick={() => onDismiss(invite.id)}
          >
            <X size={18} />
          </button>
          <div className="invitation-actions">
            {blockedReason ? (
              <span>{blockedReason}</span>
            ) : (
              <button className="hub-return" disabled={busy} onClick={() => onOpen(invite.roomId)}>
                View room
              </button>
            )}
            {invitations.length > 1 && (
              <button className="hub-text-action" onClick={onShowAll}>
                All invitations ({invitations.length})
              </button>
            )}
          </div>
          {error && (
            <p className="roster-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </aside>
  );
}

export function RoomInvitePanel({
  auth,
  room,
  invites,
}: {
  auth: Auth;
  room: RoomState;
  invites?: RoomInvitesController;
}) {
  const guest = !auth.account || auth.account.isGuest;
  const [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [linking, setLinking] = useState(false),
    [loading, setLoading] = useState(!guest);
  const authRef = useRef(auth);
  authRef.current = auth;
  useEffect(() => {
    let active = true;
    if (!guest) {
      setLoading(true);
      void authRef.current
        .refreshFriends()
        .catch((error: unknown) => {
          if (active) setError(error instanceof Error ? error.message : 'Could not load friends.');
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
    };
  }, [auth.account?.id, guest]);
  const friends = [...auth.friends.friends]
    .filter((friend) => friend.username.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(
      (a, b) => Number(b.online === true) - Number(a.online === true) || a.username.localeCompare(b.username),
    );
  const unavailable = !!room.game || room.players.length >= 4;
  return (
    <section className="friends-roster room-invite-panel" aria-label="Invite friends to this room">
      {guest ? (
        <div className="roster-guest">
          <Users size={64} />
          <h3>Invite your friends</h3>
          <p>Link Google to invite friends and keep your username. You can also share the room below.</p>
          <button
            type="button"
            className="google-button"
            disabled={auth.loading || linking}
            onClick={() => {
              setLinking(true);
              void auth.signIn().finally(() => setLinking(false));
            }}
          >
            <GoogleMark />
            {linking ? 'Opening Google…' : 'Link Google'}
          </button>
          {auth.error && (
            <p className="roster-error" role="alert">
              {auth.error}
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="roster-fixed">
            <label className="room-invite-filter">
              Find a friend
              <input
                type="search"
                value={query}
                placeholder="Username"
                maxLength={20}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            {(error || invites?.error) && (
              <p className="roster-error" role="alert">
                {error || invites?.error}
              </p>
            )}
            {unavailable && (
              <p className="roster-error" role="status">
                {room.game ? 'This game has started.' : 'This room is full.'}
              </p>
            )}
          </div>
          <div className="roster-scroll">
            <section className="roster-section" aria-label="Friends to invite">
              <ul>
                {friends.map((friend) => {
                  const present = room.players.some((player) => player.name === friend.username);
                  const sent = invites?.sent.some(
                    (invite) => invite.roomId === room.roomId && invite.to === friend.id,
                  );
                  return (
                    <li className="roster-row" key={friend.id}>
                      <Avatar profile={friend.profile} />
                      <span className="roster-identity">
                        <strong title={friend.username}>{friend.username}</strong>
                        {typeof friend.online === 'boolean' && (
                          <small className="roster-presence" data-online={friend.online}>
                            <span aria-hidden="true" />
                            {friend.online ? 'Online' : 'Offline'}
                          </small>
                        )}
                      </span>
                      {present ? (
                        <span className="roster-status">
                          <Check size={18} />
                          In room
                        </span>
                      ) : sent ? (
                        <span className="roster-status">
                          <Check size={18} />
                          Invited
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="roster-action roster-add"
                          disabled={unavailable || !invites || !!invites.busy}
                          aria-label={`Invite ${friend.username} to this room`}
                          onClick={() => void invites?.send(room.roomId, friend.id)}
                        >
                          {invites?.busy === `send:${friend.id}` ? (
                            'Sending…'
                          ) : (
                            <>
                              <Plus size={19} />
                              Invite
                            </>
                          )}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              {!friends.length && (
                <div className="roster-empty">
                  <Users size={50} />
                  <strong>
                    {loading
                      ? 'Loading friends…'
                      : query.trim()
                        ? 'No matching friends'
                        : 'No friends added yet'}
                  </strong>
                  <p>
                    {loading
                      ? 'Just a moment.'
                      : query.trim()
                        ? 'Try another username.'
                        : 'Share the room below, or add friends from your player home.'}
                  </p>
                </div>
              )}
            </section>
          </div>
          <button
            type="button"
            className="roster-refresh room-invite-refresh"
            disabled={!!invites?.busy}
            onClick={() => {
              setError('');
              void auth
                .refreshFriends()
                .catch((error: unknown) =>
                  setError(error instanceof Error ? error.message : 'Could not load friends.'),
                );
              void invites?.refresh();
            }}
          >
            <RefreshCw size={19} />
            Refresh
          </button>
        </>
      )}
      <footer className="invite-room-details">
        <h3>Room details</h3>
        <div className="invite-room-summary">
          <span>
            <Users size={18} />
            {room.players.length} {room.players.length === 1 ? 'player' : 'players'}
          </span>
          <span>
            <Clock3 size={18} />
            {room.settings?.turnTimerSeconds ? `${room.settings.turnTimerSeconds}s turns` : 'No turn timer'}
          </span>
        </div>
        <Invite code={visibleRoomCode(room) ?? undefined} roomId={room.roomId} />
      </footer>
    </section>
  );
}

import { useEffect, useId, useRef, useState } from 'react';
import type { FriendsState, PublicAccount } from '../../../packages/protocol/src/profile.js';
import type { useAuth } from './auth.js';
import { Check, Plus, RefreshCw, Users, X } from './GameIcons.js';
import { Avatar } from './Profile.js';
import { GoogleMark } from './ProviderMarks.js';

type Auth = ReturnType<typeof useAuth>;
type Friend = PublicAccount & { online?: boolean };
const failure = (error: unknown) => (error instanceof Error ? error.message : 'Please try again.');

/** Invalidating a search also invalidates its eventual error, not just its result. */
export class FriendSearchSequence {
  private version = 0;
  start() {
    return ++this.version;
  }
  invalidate() {
    ++this.version;
  }
  isCurrent(version: number) {
    return version === this.version;
  }
}

export function FriendRemoveIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 28V24c0-5 4-8 9-8s9 3 9 8v4Z" fill="#a9bfa6" stroke="#35453d" strokeWidth="1.5" />
      <circle cx="14" cy="9" r="6" fill="#eadab1" stroke="#35453d" strokeWidth="1.5" />
      <path d="M20 23h10" stroke="#da9d82" strokeWidth="4" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" strokeLinecap="round" />
    </svg>
  );
}
function FriendIdentity({ account, showPresence = false }: { account: Friend; showPresence?: boolean }) {
  return (
    <>
      <Avatar profile={account.profile} />
      <span className="roster-identity">
        <strong title={account.username}>{account.username}</strong>
        {account.isGuest ? (
          <small>Guest · needs Google</small>
        ) : showPresence && typeof account.online === 'boolean' ? (
          <small className="roster-presence" data-online={account.online}>
            <span aria-hidden="true" />
            {account.online ? 'Online' : 'Offline'}
          </small>
        ) : null}
      </span>
    </>
  );
}
export function FriendSearchResults({
  results,
  friendships,
  busy,
  onRequest,
}: {
  results: readonly PublicAccount[];
  friendships: FriendsState;
  busy: boolean;
  onRequest: (account: PublicAccount) => void;
}) {
  return (
    <section className="roster-section" aria-label="Search results">
      <h3>
        Search results <span>{results.length}</span>
      </h3>
      {!results.length ? (
        <div className="roster-empty" role="status">
          <strong>No players found</strong>
          <p>Check the username and try again.</p>
        </div>
      ) : (
        <ul>
          {results.map((account) => {
            const isFriend = friendships.friends.some((friend) => friend.id === account.id),
              sent = friendships.outgoing.some((friend) => friend.id === account.id),
              received = friendships.incoming.some((friend) => friend.id === account.id);
            return (
              <li className="roster-row" key={account.id}>
                <FriendIdentity account={account} />
                {isFriend || sent || received ? (
                  <span className="roster-status">
                    {isFriend ? (
                      <>
                        <Check size={17} />
                        Added
                      </>
                    ) : sent ? (
                      'Request sent'
                    ) : (
                      'Request received'
                    )}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="roster-action roster-add"
                    disabled={busy || account.isGuest}
                    aria-label={`Add ${account.username} as a friend`}
                    title={
                      account.isGuest
                        ? 'This player needs to link Google before adding friends.'
                        : `Add ${account.username}`
                    }
                    onClick={() => {
                      if (!busy && !account.isGuest) onRequest(account);
                    }}
                  >
                    <Plus size={20} />
                    <span>Add</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function FriendRemovalConfirmation({
  account,
  busy,
  onCancel,
  onConfirm,
}: {
  account: PublicAccount;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const label = useId();
  return (
    <div className="roster-confirm" role="group" aria-labelledby={label}>
      <p id={label}>
        Remove <strong>{account.username}</strong> from your friends?
      </p>
      <div>
        <button type="button" className="roster-action" autoFocus disabled={busy} onClick={onCancel}>
          Keep friend
        </button>
        <button type="button" className="roster-action roster-danger" disabled={busy} onClick={onConfirm}>
          {busy ? 'Removing…' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

/** A new account gets a new request lifetime, even if this drawer stays open. */
export function FriendsPanel({ auth }: { auth: Auth }) {
  return (
    <FriendsContents key={`${auth.account?.id ?? 'signed-out'}:${!!auth.account?.isGuest}`} auth={auth} />
  );
}
function FriendsContents({ auth }: { auth: Auth }) {
  const guest = !auth.account || auth.account.isGuest;
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<PublicAccount[]>([]),
    [searched, setSearched] = useState(false),
    [searching, setSearching] = useState(false),
    [loading, setLoading] = useState(!guest),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [removing, setRemoving] = useState<PublicAccount | null>(null);
  const sequence = useRef(new FriendSearchSequence()),
    mounted = useRef(false),
    busyRef = useRef(false),
    authRef = useRef(auth),
    inputRef = useRef<HTMLInputElement>(null),
    removeTrigger = useRef<HTMLButtonElement | null>(null);
  authRef.current = auth;
  const inputId = useId();
  useEffect(() => {
    let active = true;
    mounted.current = true;
    if (!guest) {
      void authRef.current
        .refreshFriends()
        .catch((error: unknown) => {
          if (active) setError(failure(error));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }
    return () => {
      active = false;
      mounted.current = false;
      sequence.current.invalidate();
    };
  }, [guest]);
  useEffect(() => {
    if (removing && !auth.friends.friends.some((friend) => friend.id === removing.id)) setRemoving(null);
  }, [auth.friends.friends, removing]);

  async function perform(key: string, action: () => Promise<unknown>, success: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      if (!mounted.current) return false;
      setNotice(success);
      return true;
    } catch (error) {
      if (mounted.current) setError(failure(error));
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy('');
    }
  }
  function changeQuery(next: string) {
    sequence.current.invalidate();
    setQuery(next);
    setResults([]);
    setSearched(false);
    setSearching(false);
    setError('');
    setNotice('');
    setRemoving(null);
  }
  async function search() {
    const name = query.trim();
    if (name.length < 2 || searching) return;
    const version = sequence.current.start();
    setSearching(true);
    setSearched(false);
    setResults([]);
    setError('');
    setNotice('');
    try {
      const matches = await auth.searchFriends(name);
      if (mounted.current && sequence.current.isCurrent(version)) {
        setResults(matches.filter((account) => account.id !== auth.account?.id));
        setSearched(true);
      }
    } catch (error) {
      if (mounted.current && sequence.current.isCurrent(version)) setError(failure(error));
    } finally {
      if (mounted.current && sequence.current.isCurrent(version)) setSearching(false);
    }
  }
  const message = (
    <div className="roster-messages">
      {error && (
        <p className="roster-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="roster-notice" role="status">
          <Check size={17} />
          {notice}
        </p>
      )}
    </div>
  );
  if (guest) {
    return (
      <section className="friends-roster roster-guest" aria-label="Connect your account">
        <span className="roster-guest-art" aria-hidden="true">
          <Users size={70} />
        </span>
        <h3>Keep your people close</h3>
        <p>Link Google to add friends and keep your username.</p>
        <button
          type="button"
          className="google-button"
          disabled={!!busy || auth.loading}
          onClick={() => void perform('link', () => auth.signIn(), '')}
        >
          <GoogleMark />
          {busy === 'link' ? 'Opening Google…' : 'Link Google'}
        </button>
        {message}
      </section>
    );
  }
  const { friends, incoming, outgoing } = auth.friends;
  const list = (title: string, accounts: Friend[], kind: 'friends' | 'incoming' | 'outgoing') =>
    !accounts.length ? null : (
      <section className="roster-section" aria-label={title}>
        <h3>
          {title}
          <span>{accounts.length}</span>
        </h3>
        <ul>
          {accounts.map((account) => (
            <li className={`roster-row ${kind === 'friends' ? 'roster-member' : ''}`} key={account.id}>
              <FriendIdentity account={account} showPresence={kind === 'friends'} />
              <div className="roster-actions">
                {kind === 'incoming' ? (
                  <>
                    <button
                      type="button"
                      className="roster-action roster-accept"
                      disabled={!!busy}
                      aria-label={`Accept ${account.username}'s friend request`}
                      title="Accept request"
                      onClick={() =>
                        void perform(
                          `accept:${account.id}`,
                          () => auth.respondFriend(account.id, true),
                          `${account.username} added to friends.`,
                        )
                      }
                    >
                      <Check size={22} />
                    </button>
                    <button
                      type="button"
                      className="roster-action roster-icon"
                      disabled={!!busy}
                      aria-label={`Decline ${account.username}'s friend request`}
                      title="Decline request"
                      onClick={() =>
                        void perform(
                          `decline:${account.id}`,
                          () => auth.respondFriend(account.id, false),
                          'Friend request declined.',
                        )
                      }
                    >
                      <X size={21} />
                    </button>
                  </>
                ) : kind === 'outgoing' ? (
                  <button
                    type="button"
                    className="roster-action roster-icon"
                    disabled={!!busy}
                    aria-label={`Cancel friend request to ${account.username}`}
                    title="Cancel request"
                    onClick={() =>
                      void perform(
                        `cancel:${account.id}`,
                        () => auth.cancelFriend(account.id),
                        'Friend request cancelled.',
                      )
                    }
                  >
                    <X size={21} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="roster-action roster-icon roster-remove"
                    disabled={!!busy}
                    aria-label={`Remove ${account.username} from friends`}
                    aria-expanded={removing?.id === account.id}
                    title="Remove friend"
                    onClick={(event) => {
                      removeTrigger.current = event.currentTarget;
                      setRemoving(account);
                    }}
                  >
                    <FriendRemoveIcon />
                  </button>
                )}
              </div>
              {removing?.id === account.id && (
                <FriendRemovalConfirmation
                  account={account}
                  busy={!!busy}
                  onCancel={() => {
                    setRemoving(null);
                    removeTrigger.current?.focus();
                  }}
                  onConfirm={() => {
                    void perform(
                      `remove:${account.id}`,
                      () => auth.removeFriend(account.id),
                      `${account.username} removed from friends.`,
                    ).then((ok) => {
                      if (ok && mounted.current) {
                        setRemoving(null);
                        inputRef.current?.focus();
                      }
                    });
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  const searchingMode = !!query.trim();
  return (
    <section className="friends-roster" aria-label="Player connections">
      <div className="roster-fixed">
        <form
          className="roster-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            void search();
          }}
        >
          <label htmlFor={inputId}>Find a player</label>
          <div className="roster-search-control">
            <SearchIcon />
            <input
              id={inputId}
              ref={inputRef}
              type="search"
              value={query}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="Username"
              onChange={(event) => changeQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                className="roster-clear"
                aria-label="Clear username search"
                onClick={() => {
                  changeQuery('');
                  inputRef.current?.focus();
                }}
              >
                <X size={18} />
              </button>
            )}
          </div>
          <button
            className="roster-action roster-search-submit"
            disabled={query.trim().length < 2 || searching}
          >
            {searching ? 'Searching…' : 'Search'}
          </button>
        </form>
        {message}
      </div>
      <div className="roster-scroll" aria-busy={loading || searching}>
        {searchingMode ? (
          searched ? (
            <FriendSearchResults
              results={results}
              friendships={auth.friends}
              busy={!!busy}
              onRequest={(account) =>
                void perform(
                  `request:${account.id}`,
                  () => auth.requestFriend(account.id),
                  `Friend request sent to ${account.username}.`,
                )
              }
            />
          ) : (
            <div className="roster-search-hint" role="status">
              {searching
                ? 'Looking for players…'
                : query.trim().length < 2
                  ? 'Enter at least 2 characters.'
                  : 'Search for this username.'}
            </div>
          )
        ) : (
          <>
            {list('Received requests', incoming, 'incoming')}
            {list('Sent requests', outgoing, 'outgoing')}
            {list(
              'Players',
              [...friends].sort(
                (a: Friend, b: Friend) =>
                  Number(b.online === true) - Number(a.online === true) ||
                  a.username.localeCompare(b.username),
              ),
              'friends',
            )}
            {!friends.length && !incoming.length && !outgoing.length && (
              <div className="roster-empty" role="status">
                <Users size={54} />
                <strong>
                  {loading
                    ? 'Loading your players…'
                    : error
                      ? 'Your list is unavailable'
                      : 'Bring your friends along'}
                </strong>
                <p>
                  {loading
                    ? 'Just a moment.'
                    : error
                      ? 'Try refreshing below.'
                      : 'Find their username to send a request.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
      <footer className="roster-footer">
        <span>
          {friends.length} {friends.length === 1 ? 'player' : 'players'}
        </span>
        <button
          type="button"
          className="roster-refresh"
          disabled={!!busy || loading}
          aria-label="Refresh friends"
          onClick={() => void perform('refresh', () => auth.refreshFriends(), 'Friends updated.')}
        >
          <RefreshCw size={19} />
          <span>{busy === 'refresh' ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </footer>
    </section>
  );
}

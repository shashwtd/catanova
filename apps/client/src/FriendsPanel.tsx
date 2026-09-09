import { useEffect, useRef, useState } from 'react';
import type { FriendsState, PublicAccount } from '../../../packages/protocol/src/profile.js';
import type { useAuth } from './auth.js';
import { Check, Plus, Users, X } from './GameIcons.js';
import { Avatar } from './Profile.js';

type Auth = ReturnType<typeof useAuth>;
const failure = (error: unknown) => (error instanceof Error ? error.message : 'Please try again.');

function FriendIdentity({ account }: { account: PublicAccount }) {
  return (
    <>
      <Avatar profile={account.profile} />
      <span className="friend-identity">
        <strong title={account.username}>{account.username}</strong>
        {account.isGuest && <small>Guest · needs Google</small>}
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
    <section className="friends-section friend-results" aria-label="Search results">
      <h3>Search results</h3>
      {!results.length ? (
        <p className="account-note" role="status">
          No usernames found.
        </p>
      ) : (
        <ul>
          {results.map((account) => {
            const isFriend = friendships.friends.some((friend) => friend.id === account.id),
              sent = friendships.outgoing.some((friend) => friend.id === account.id),
              received = friendships.incoming.some((friend) => friend.id === account.id);
            return (
              <li className="friend-row" key={account.id}>
                <FriendIdentity account={account} />
                {isFriend || sent || received ? (
                  <span className="friend-status">
                    {isFriend ? 'Friends' : sent ? 'Request sent' : 'Request received'}
                  </span>
                ) : (
                  <button
                    className="dark-button"
                    disabled={busy || account.isGuest}
                    aria-label={`Add ${account.username} as a friend`}
                    onClick={() => {
                      if (!busy && !account.isGuest) onRequest(account);
                    }}
                  >
                    <Plus size={15} />
                    Add
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

export function FriendsPanel({ auth }: { auth: Auth }) {
  const [query, setQuery] = useState(''),
    [results, setResults] = useState<PublicAccount[]>([]),
    [searched, setSearched] = useState(false),
    [searching, setSearching] = useState(false),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const searchVersion = useRef(0),
    authRef = useRef(auth);
  authRef.current = auth;
  const guest = !auth.account || auth.account.isGuest;
  useEffect(() => {
    let mounted = true;
    setQuery('');
    setResults([]);
    setSearched(false);
    setSearching(false);
    setError('');
    setNotice('');
    if (!guest) {
      void authRef.current.refreshFriends().catch((error: unknown) => {
        if (mounted) setError(failure(error));
      });
    }
    return () => {
      mounted = false;
      ++searchVersion.current;
    };
  }, [auth.account?.id, guest]);
  async function perform(key: string, action: () => Promise<unknown>, success: string) {
    if (busy) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy('');
    }
  }
  const message = (
    <>
      {error && (
        <p className="entry-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="account-success" role="status">
          {notice}
        </p>
      )}
    </>
  );
  if (guest) {
    return (
      <section className="friends-panel" aria-label="Friends">
        <div className="account-section-heading">
          <Users />
          <h2>Friends</h2>
        </div>
        <p className="account-intro">Link Google to add friends and keep your username.</p>
        <button
          className="gold-button"
          disabled={!!busy || auth.loading}
          onClick={() => void perform('link', () => auth.signIn(), '')}
        >
          {busy === 'link' ? 'Opening Google…' : 'Link Google'}
        </button>
        {message}
      </section>
    );
  }
  const { friends, incoming, outgoing } = auth.friends;
  const list = (title: string, accounts: PublicAccount[], kind: 'friends' | 'incoming' | 'outgoing') =>
    !accounts.length ? null : (
      <section className="friends-section" aria-label={title}>
        <h3>
          {title} <span>{accounts.length}</span>
        </h3>
        <ul>
          {accounts.map((account) => (
            <li className="friend-row" key={account.id}>
              <FriendIdentity account={account} />
              <div className="friend-actions">
                {kind === 'incoming' ? (
                  <>
                    <button
                      className="gold-button"
                      disabled={!!busy}
                      aria-label={`Accept ${account.username}'s friend request`}
                      onClick={() =>
                        void perform(
                          `accept:${account.id}`,
                          () => auth.respondFriend(account.id, true),
                          `${account.username} added to friends.`,
                        )
                      }
                    >
                      <Check size={15} />
                      Accept
                    </button>
                    <button
                      className="text-button"
                      disabled={!!busy}
                      aria-label={`Decline ${account.username}'s friend request`}
                      onClick={() =>
                        void perform(
                          `decline:${account.id}`,
                          () => auth.respondFriend(account.id, false),
                          'Friend request declined.',
                        )
                      }
                    >
                      <X size={15} />
                      Decline
                    </button>
                  </>
                ) : kind === 'outgoing' ? (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    aria-label={`Cancel friend request to ${account.username}`}
                    onClick={() =>
                      void perform(
                        `cancel:${account.id}`,
                        () => auth.cancelFriend(account.id),
                        'Friend request cancelled.',
                      )
                    }
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    className="text-button"
                    disabled={!!busy}
                    aria-label={`Remove ${account.username} from friends`}
                    onClick={() =>
                      void perform(
                        `remove:${account.id}`,
                        () => auth.removeFriend(account.id),
                        `${account.username} removed from friends.`,
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <section className="friends-panel" aria-label="Friends" aria-busy={!!busy}>
      <div className="account-section-heading">
        <Users />
        <h2>Friends</h2>
      </div>
      <form
        className="friend-search"
        onSubmit={async (e) => {
          e.preventDefault();
          const name = query.trim();
          if (!name || searching) return;
          const version = ++searchVersion.current;
          setSearching(true);
          setSearched(false);
          setError('');
          try {
            const matches = await auth.searchFriends(name);
            if (version === searchVersion.current) {
              setResults(matches.filter((account) => account.id !== auth.account?.id));
              setSearched(true);
            }
          } catch (error) {
            if (version === searchVersion.current) setError(failure(error));
          } finally {
            if (version === searchVersion.current) setSearching(false);
          }
        }}
      >
        <label className="field">
          Find a username
          <input
            value={query}
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Username"
            onChange={(e) => {
              ++searchVersion.current;
              setQuery(e.target.value);
              setResults([]);
              setSearched(false);
              setSearching(false);
            }}
          />
        </label>
        <button className="dark-button" disabled={!query.trim() || searching}>
          {searching ? 'Searching…' : 'Search'}
        </button>
      </form>
      {message}
      {searched && (
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
      )}
      {list('Received requests', incoming, 'incoming')}
      {list('Sent requests', outgoing, 'outgoing')}
      {list('Your friends', friends, 'friends')}
      {!friends.length && <p className="account-note">Find a username above to add your first friend.</p>}
      <button
        className="text-button friend-refresh"
        disabled={!!busy}
        onClick={() => void perform('refresh', () => auth.refreshFriends(), 'Friends updated.')}
      >
        {busy === 'refresh' ? 'Refreshing…' : 'Refresh friends'}
      </button>
    </section>
  );
}

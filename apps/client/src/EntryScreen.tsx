import type { FormEvent } from 'react';
import type { RoomPreview, Session } from '../../../packages/protocol/src/index.js';
import { ArrowLeft, ArrowRight, LoaderCircle, LogOut, Plus, Settings2, Users } from './GameIcons.js';
import { Avatar } from './Profile.js';
import { AccountSetup } from './AccountSetup.js';
import { InviteRoster } from './Lobby.js';
import type { useAuth } from './auth.js';
import { roomPath } from './navigation.js';

type Auth = ReturnType<typeof useAuth>;
export function EntryScreen({
  auth,
  entry,
  setEntry,
  name,
  setName,
  code,
  setCode,
  invite,
  previewRoom,
  previewLoading,
  previewError,
  resumableInvite,
  last,
  busy,
  onEnter,
  onResume,
  onBack,
  onProfile,
  onFriends,
  onSettings,
  onSignOut,
}: {
  auth: Auth;
  entry: 'home' | 'create' | 'join' | 'invite';
  setEntry: (entry: 'create' | 'join') => void;
  name: string;
  setName: (name: string) => void;
  code: string;
  setCode: (code: string) => void;
  invite: string | null;
  previewRoom: RoomPreview | null;
  previewLoading: boolean;
  previewError: string;
  resumableInvite: boolean;
  last?: Session;
  busy: boolean;
  onEnter: (event: FormEvent, kind: 'create' | 'join') => void;
  onResume: () => void;
  onBack: () => void;
  onProfile: () => void;
  onFriends: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const local = auth.config?.mode === 'local';
  const returnPath = invite ? roomPath(invite) : '/';
  const blockedInvite =
    entry === 'invite' &&
    !resumableInvite &&
    (previewRoom?.started || (previewRoom?.players.length ?? 0) >= 4);
  return (
    <div className="title-screen">
      <header className="title-toolbar">
        {auth.canPlay && (
          <button className="lobby-self" onClick={onProfile}>
            <Avatar profile={auth.profile} />
            <strong>{auth.profile.name || 'Your profile'}</strong>
            {auth.account?.isGuest && <span>Guest</span>}
          </button>
        )}
        <div className="title-tools">
          {auth.canPlay && !local && (
            <button className="icon-button" aria-label="Friends" title="Friends" onClick={onFriends}>
              <Users />
            </button>
          )}
          <button className="icon-button" aria-label="Settings" title="Settings" onClick={onSettings}>
            <Settings2 />
          </button>
          {auth.user && (
            <button className="icon-button" aria-label="Sign out" title="Sign out" onClick={onSignOut}>
              <LogOut />
            </button>
          )}
        </div>
      </header>
      <div className="title-wordmark" aria-label="Catanova">
        <h1>Catanova</h1>
        <span aria-hidden="true" />
      </div>
      <section
        className={`title-panel ${auth.needsOnboarding ? 'onboarding-panel' : ''}`}
        aria-label={
          auth.needsOnboarding
            ? 'Choose your profile'
            : entry === 'create'
              ? 'Create room'
              : entry === 'home'
                ? 'Game menu'
                : 'Join room'
        }
      >
        {auth.loading ? (
          <div className="menu-loading" role="status">
            <LoaderCircle className="spin" />
            <span>Opening the gates…</span>
          </div>
        ) : auth.needsOnboarding ? (
          <AccountSetup auth={auth} />
        ) : !auth.canPlay ? (
          <>
            <h2>{invite ? 'Your crew awaits' : 'Adventure awaits'}</h2>
            {invite && <span className="entry-invite-caption">Room {invite}</span>}
            {auth.user && !auth.guestExpired ? (
              <button className="dark-button" onClick={() => void auth.retryProfile()}>
                Retry account
              </button>
            ) : (
              <>
                {auth.guestExpired && (
                  <p className="account-note">Your guest profile expired. Start fresh or sign in.</p>
                )}
                <button
                  className="google-button"
                  disabled={!auth.config?.auth}
                  onClick={() => void auth.signIn(returnPath)}
                >
                  <span className="google-letter">G</span>Continue with Google
                </button>
                <button
                  className="dark-button guest-button"
                  disabled={!auth.config?.auth}
                  onClick={() => void auth.signInGuest(returnPath)}
                >
                  Play as guest
                  <ArrowRight size={20} />
                </button>
                <p className="guest-policy">Guests expire after 7 days of inactivity.</p>
              </>
            )}
          </>
        ) : entry === 'home' ? (
          <>
            <h2>Gather your crew</h2>
            <div className="entry-actions">
              <button className="gold-button" disabled={busy} onClick={() => setEntry('create')}>
                <Plus />
                Create room
              </button>
              <button className="dark-button" disabled={busy} onClick={() => setEntry('join')}>
                <Users />
                Join room
              </button>
            </div>
            {last?.joined && (
              <button className="resume-button" disabled={busy} onClick={onResume}>
                Resume game
                <ArrowRight size={17} />
              </button>
            )}
            {local && <span className="local-mode">Local playtest</span>}
          </>
        ) : (
          <>
            <div className="entry-heading">
              <button className="icon-button" aria-label="Back" onClick={onBack}>
                <ArrowLeft />
              </button>
              <h2>{entry === 'create' ? 'Create room' : 'Join room'}</h2>
            </div>
            {entry === 'invite' && (
              <>
                <div className="invite-room-code">{invite}</div>
                {previewRoom && <InviteRoster room={previewRoom} />}
              </>
            )}
            {previewError && entry === 'invite' ? (
              <p className="entry-error">{previewError}</p>
            ) : (
              <form onSubmit={(event) => onEnter(event, entry === 'create' ? 'create' : 'join')}>
                {entry === 'join' && (
                  <label className="field">
                    Room code
                    <input
                      autoComplete="off"
                      autoCapitalize="characters"
                      maxLength={8}
                      value={code}
                      onChange={(event) => setCode(event.target.value.toUpperCase())}
                      placeholder="XXXXXXXX"
                      required
                      autoFocus
                    />
                  </label>
                )}
                {local && (
                  <label className="field">
                    Name
                    <input
                      autoComplete="nickname"
                      maxLength={32}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Name"
                      required
                    />
                  </label>
                )}
                {blockedInvite ? (
                  <p className="entry-error">
                    {previewRoom?.started ? 'This game has started.' : 'This room is full.'}
                  </p>
                ) : resumableInvite ? (
                  <button type="button" className="gold-button" disabled={busy} onClick={onResume}>
                    Resume room
                    <ArrowRight />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="gold-button"
                    disabled={busy || (entry === 'invite' && (previewLoading || !previewRoom))}
                  >
                    {busy || (entry === 'invite' && previewLoading) ? (
                      <LoaderCircle className="spin" />
                    ) : entry === 'create' ? (
                      <Plus />
                    ) : (
                      <ArrowRight />
                    )}
                    {entry === 'create' ? 'Create room' : 'Join room'}
                  </button>
                )}
              </form>
            )}
          </>
        )}
      </section>
    </div>
  );
}

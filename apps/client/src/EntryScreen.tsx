import { useState } from 'react';
import type { FormEvent } from 'react';
import { BrandLogo } from './BrandLogo.js';
import { GitHubMark, GoogleMark } from './ProviderMarks.js';
import { GameLoader } from './GameLoader.js';
import { rememberEntryIntent } from './entry-intent.js';
import { Turnstile } from './Turnstile.js';
import type { RoomPreview, Session } from '../../../packages/protocol/src/index.js';
import { ArrowLeft, ArrowRight, LogOut, Plus, Settings2, Users } from './GameIcons.js';
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
  onCreate,
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
  onCreate?: () => void;
  onResume: () => void;
  onBack: () => void;
  onProfile: () => void;
  onFriends: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [signInOpen, setSignInOpen] = useState(false);
  const [guestCheck, setGuestCheck] = useState(false);
  const local = auth.config?.mode === 'local';
  const homeMenu = entry === 'home' && (!signInOpen || auth.canPlay) && !auth.needsOnboarding;
  const goBack = () => {
    if (guestCheck) {
      setGuestCheck(false);
      auth.clearError();
      return;
    }
    rememberEntryIntent(sessionStorage, 'home');
    setGuestCheck(false);
    setSignInOpen(false);
    onBack();
  };
  const googleSignIn = () => {
    rememberEntryIntent(sessionStorage, entry);
    void auth.signIn(returnPath);
  };
  const returnPath = invite ? roomPath(invite) : '/';
  const blockedInvite =
    entry === 'invite' &&
    !resumableInvite &&
    (previewRoom?.started || (previewRoom?.players.length ?? 0) >= 4);
  return (
    <div className={`title-screen landing-screen ${homeMenu ? 'landing-home' : 'landing-flow'}`}>
      <header className="title-toolbar">
        {auth.canPlay && (
          <button className="lobby-self" onClick={onProfile}>
            <Avatar profile={auth.profile} />
            <strong>{auth.profile.name || 'Your profile'}</strong>
            {auth.account?.isGuest && <span>Guest</span>}
          </button>
        )}
        <div className="title-tools">
          {!auth.user && !local && homeMenu && (
            <button className="landing-sign-in" disabled={auth.loading} onClick={() => setSignInOpen(true)}>
              Sign in
            </button>
          )}
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
      <div className="landing-welcome">
        <div className="landing-brand">
          <h1>
            <BrandLogo />
          </h1>
          {homeMenu && <p>A Catan-style game for 2–4 friends.</p>}
        </div>
        <section
          className={`title-panel landing-panel ${homeMenu ? 'home-menu' : ''} ${auth.needsOnboarding ? 'onboarding-panel' : ''}`}
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
          {homeMenu ? (
            <>
              <h2 className="visually-hidden">Play with friends</h2>
              <div className="entry-actions">
                <button
                  className="gold-button"
                  disabled={busy || auth.loading}
                  onClick={() => (auth.canPlay && !local && onCreate ? onCreate() : setEntry('create'))}
                >
                  <Plus />
                  Create room
                </button>
                <button
                  className="dark-button"
                  disabled={busy || auth.loading}
                  onClick={() => setEntry('join')}
                >
                  <Users />
                  Join room
                </button>
              </div>
              {auth.canPlay && last?.joined && (
                <button className="resume-button" disabled={busy} onClick={onResume}>
                  Resume game
                  <ArrowRight size={17} />
                </button>
              )}
              {(auth.loading || busy) && (
                <GameLoader
                  className="landing-loading"
                  label={auth.loading ? 'Connecting…' : 'Opening room…'}
                />
              )}
              {local && <span className="local-mode">Local playtest</span>}
            </>
          ) : auth.loading ? (
            <div className="menu-loading">
              <GameLoader />
            </div>
          ) : auth.needsOnboarding ? (
            <AccountSetup auth={auth} />
          ) : !auth.canPlay ? (
            <>
              <div className="entry-heading">
                <button className="icon-button" aria-label="Back" onClick={goBack}>
                  <ArrowLeft />
                </button>
                <h2>
                  {entry === 'create' ? 'Create room' : entry === 'join' || invite ? 'Join room' : 'Sign in'}
                </h2>
              </div>
              {invite && (
                <>
                  <span className="entry-invite-caption">Room {invite}</span>
                  {previewRoom && <InviteRoster room={previewRoom} />}
                </>
              )}
              {guestCheck && (!auth.user || auth.guestExpired) && auth.config?.captcha?.siteKey ? (
                <div className="guest-check">
                  <p>Verify to play as a guest.</p>
                  {auth.error ? (
                    <button className="dark-button" onClick={auth.clearError}>
                      Retry check
                    </button>
                  ) : (
                    <Turnstile
                      siteKey={auth.config.captcha.siteKey}
                      action="guest_signup"
                      onVerify={(token) => void auth.signInGuest(returnPath, token)}
                    />
                  )}
                </div>
              ) : auth.user && !auth.guestExpired ? (
                <button className="dark-button" onClick={() => void auth.retryProfile()}>
                  Retry account
                </button>
              ) : (
                <>
                  {auth.guestExpired && <p className="account-note">Your guest profile expired.</p>}
                  <button className="google-button" disabled={!auth.config?.auth} onClick={googleSignIn}>
                    <GoogleMark />
                    Continue with Google
                  </button>
                  <button
                    className="dark-button guest-button"
                    disabled={!auth.config?.auth}
                    onClick={() => {
                      auth.clearError();
                      if (auth.config?.captcha?.siteKey) setGuestCheck(true);
                      else void auth.signInGuest(returnPath);
                    }}
                  >
                    Play as guest
                    <ArrowRight size={20} />
                  </button>
                  <p className="guest-policy">Guests expire after 7 days of inactivity.</p>
                </>
              )}
            </>
          ) : (
            <>
              <div className="entry-heading">
                <button className="icon-button" aria-label="Back" onClick={goBack}>
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
                        <GameLoader
                          compact
                          label={
                            previewLoading
                              ? 'Loading room…'
                              : entry === 'create'
                                ? 'Creating room…'
                                : 'Joining room…'
                          }
                        />
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
      <footer className="landing-footer">
        <a href="/guide/">How to play</a>
        <a href="https://github.com/shashwtd/catanova" target="_blank" rel="noopener noreferrer">
          <GitHubMark />
          Open on GitHub
        </a>
      </footer>
    </div>
  );
}

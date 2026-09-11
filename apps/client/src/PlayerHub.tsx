import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Profile } from '../../../packages/protocol/src/profile.js';
import type { useAuth } from './auth.js';
import { Avatar, ProfileEditor } from './Profile.js';
import { BrandLogo } from './BrandLogo.js';
import { GameLoader } from './GameLoader.js';
import { GoogleMark } from './ProviderMarks.js';
import {
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  History,
  LogOut,
  Pencil,
  Plus,
  Settings2,
  Users,
  X,
} from './GameIcons.js';
import { MatchHistory, PlayerStats } from './MatchHistory.js';
import type { PlayerGameState } from './MatchHistory.js';
import { normalizeRoomReference } from '../../../packages/protocol/src/room-reference.js';
import { validRoomCode } from './navigation.js';
type Auth = ReturnType<typeof useAuth>;

export function PlayerProfile({
  auth,
  profile,
  games,
  busy,
  resumeDisabled = false,
  onSave,
  onResume,
}: {
  auth: Auth;
  profile: Profile;
  games: PlayerGameState;
  busy: boolean;
  resumeDisabled?: boolean;
  onSave: (profile: Profile) => Promise<void>;
  onResume: (roomId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="player-profile-editor">
        <button className="hub-text-action" onClick={() => setEditing(false)}>
          <ArrowLeft size={18} /> Profile
        </button>
        <ProfileEditor
          initial={profile}
          busy={busy}
          checkUsername={auth.config?.mode === 'authenticated' ? auth.checkUsername : undefined}
          onSave={onSave}
        />
      </div>
    );
  return (
    <div className="player-overview">
      <div className="player-overview-identity">
        <Avatar profile={profile} />
        <div>
          <h2>{profile.name}</h2>
          {auth.account?.isGuest && <span className="hub-guest-label">Guest</span>}
          <button className="hub-text-action" onClick={() => setEditing(true)}>
            <Pencil size={17} /> Edit profile
          </button>
        </div>
      </div>
      <PlayerStats stats={games.data?.stats} />
      {auth.account?.isGuest && (
        <div className="hub-account-link">
          <p>Keep your username and add friends.</p>
          <button className="google-button" disabled={auth.loading} onClick={() => void auth.signIn()}>
            <GoogleMark /> Link Google
          </button>
        </div>
      )}
      {auth.account ? (
        <MatchHistory state={games} compact busy={busy || resumeDisabled} onResume={onResume} />
      ) : (
        <p className="record-caption">Match history is available with an account.</p>
      )}
    </div>
  );
}

export function PlayerHub({
  auth,
  games,
  busy,
  initialJoin = false,
  invitationCount = 0,
  notifications,
  onCreate,
  onJoin,
  onResume,
  onProfile,
  onFriends,
  onSettings,
  onSignOut,
}: {
  auth: Auth;
  games: PlayerGameState;
  busy: boolean;
  initialJoin?: boolean;
  invitationCount?: number;
  notifications?: ReactNode;
  onCreate: () => void;
  onJoin: (code: string) => Promise<void>;
  onResume: (roomId: string) => void;
  onProfile: () => void;
  onFriends: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [tab, setTab] = useState<'lobby' | 'history'>('lobby');
  const [joining, setJoining] = useState(initialJoin),
    [code, setCode] = useState(''),
    [joinError, setJoinError] = useState('');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (joining) field.current?.focus();
  }, [joining]);
  const requests = auth.friends.incoming.length + invitationCount;
  const resumable = games.data?.games.find((game) => game.resumable);
  return (
    <section className="player-hub" aria-label="Player lobby">
      <header className="hub-header">
        <div className="hub-brand">
          <BrandLogo mark />
        </div>
        <nav className="hub-navigation" aria-label="Player menu">
          <button aria-current={tab === 'lobby' ? 'page' : undefined} onClick={() => setTab('lobby')}>
            Lobby
          </button>
          <button aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>
            Game history
          </button>
        </nav>
        <div className="hub-header-tools">
          {tab === 'history' && (
            <button className="hub-tool" aria-label="Your profile" onClick={onProfile}>
              <Pencil />
            </button>
          )}
          <button
            className="hub-social-button"
            aria-label={requests ? `Friends, ${requests} invitations and requests` : 'Friends'}
            onClick={onFriends}
          >
            <Users size={24} />
            <span>Friends</span>
            {requests > 0 && <b aria-hidden="true">{requests}</b>}
          </button>
          <button className="hub-tool" aria-label="Settings" onClick={onSettings}>
            <Settings2 />
          </button>
        </div>
      </header>
      {notifications}
      {tab === 'lobby' ? (
        <div className="hub-lobby-content">
          <section className="hub-character" aria-label="Your player">
            <div className="hub-character-rays" aria-hidden="true" />
            <button
              className="hub-character-portrait"
              onClick={onProfile}
              aria-label={`View ${auth.profile.name}'s profile`}
            >
              <Avatar profile={auth.profile} />
            </button>
            <div className="hub-character-name">
              <span>{auth.profile.name}</span>
              {auth.account?.isGuest && <small className="hub-guest-label">Guest</small>}
            </div>
            <PlayerStats stats={games.data?.stats} />
          </section>
          <div className="hub-sidebar">
            <section className="hub-room-actions" aria-label="Play">
              <h1>Gather your crew</h1>
              <div className="hub-play-controls">
                {joining ? (
                  <form
                    className="hub-join-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (busy) return;
                      const normalized = normalizeRoomReference(code);
                      if (!validRoomCode(normalized)) {
                        setJoinError('Enter a valid room code.');
                        return;
                      }
                      setJoinError('');
                      void onJoin(normalized);
                    }}
                  >
                    <label htmlFor="hub-room-code">Room code</label>
                    <input
                      ref={field}
                      id="hub-room-code"
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.toUpperCase());
                        setJoinError('');
                      }}
                      placeholder="AB2C"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      maxLength={8}
                      aria-invalid={!!joinError}
                      aria-describedby={joinError ? 'hub-join-error' : undefined}
                    />
                    <button className="hub-join-submit" disabled={busy} type="submit" aria-label="Join room">
                      {busy ? <GameLoader compact /> : <ArrowRight size={22} />}
                    </button>
                    <button
                      className="hub-tool"
                      type="button"
                      aria-label="Cancel joining"
                      disabled={busy}
                      onClick={() => {
                        setJoining(false);
                        setJoinError('');
                      }}
                    >
                      <X size={19} />
                    </button>
                    {joinError && (
                      <span id="hub-join-error" role="alert">
                        {joinError}
                      </span>
                    )}
                  </form>
                ) : (
                  <button
                    className="hub-room-button hub-join-button"
                    disabled={busy}
                    onClick={() => setJoining(true)}
                  >
                    Join room <ArrowRight size={20} />
                  </button>
                )}
                {resumable && !joining && (
                  <button
                    className="hub-resume-button"
                    disabled={busy}
                    onClick={() => onResume(resumable.roomId)}
                  >
                    Resume game <History size={21} />
                  </button>
                )}
                <button className="hub-room-button hub-create-button" disabled={busy} onClick={onCreate}>
                  {busy ? <GameLoader compact label="Opening room…" /> : <Plus size={24} />} Create room
                </button>
              </div>
            </section>
            <MatchHistory
              state={games}
              compact
              busy={busy}
              onResume={onResume}
              onAll={() => setTab('history')}
            />
            {auth.account?.isGuest && (
              <button className="hub-link-account" disabled={auth.loading} onClick={() => void auth.signIn()}>
                <GoogleMark />
                <span>
                  <strong>Keep your place</strong>
                  <small>Link Google to add friends.</small>
                </span>
                <ArrowRight size={19} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="hub-history-page">
          <div className="hub-history-record">
            <h1>Your record</h1>
            <PlayerStats stats={games.data?.stats} />
          </div>
          <MatchHistory state={games} busy={busy} onResume={onResume} />
        </div>
      )}
      <footer className="hub-footer">
        <div className="hub-footer-meta">
          <BrandLogo mark />
          <a href="/guide/" target="_blank" rel="noopener noreferrer">
            <CircleHelp size={19} /> How to play
          </a>
          <button className="hub-tool" onClick={onSignOut} aria-label="Sign out">
            <LogOut size={21} />
          </button>
        </div>
      </footer>
    </section>
  );
}

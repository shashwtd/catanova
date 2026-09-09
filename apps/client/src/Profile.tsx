import { useEffect, useId, useRef, useState } from 'react';
import { Check } from './GameIcons.js';
import {
  AVATAR_COUNT,
  defaultProfile,
  isGoogleAvatarUrl,
  validUsername,
} from '../../../packages/protocol/src/profile.js';
import type { Profile, UsernameAvailability } from '../../../packages/protocol/src/profile.js';
const AVATAR_NAMES = [
  'Fox cartographer',
  'Pebble golem',
  'Woodland sprite',
  'Owl alchemist',
  'Pirate captain',
  'Badger mason',
  'Ram shepherd',
  'Goblin merchant',
  'Witch herbalist',
  'Tide trader',
  'Jolly builder',
  'Mushroom wanderer',
];
const AVATAR_ROWS = [0, 350, 698, 1086];
export type { UsernameAvailability } from '../../../packages/protocol/src/profile.js';
export type CheckUsername = (name: string) => Promise<UsernameAvailability>;

function httpsPhoto(value: string | null | undefined) {
  try {
    if (!isGoogleAvatarUrl(value)) return null;
    const url = new URL(value ?? '');
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
export function Avatar({
  profile = defaultProfile(),
  className = '',
}: {
  profile?: Profile;
  className?: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const photo = profile.avatarSource === 'google' ? httpsPhoto(profile.avatarUrl) : null;
  const avatar =
    Number.isInteger(profile.avatar) && profile.avatar >= 0 && profile.avatar < AVATAR_COUNT
      ? profile.avatar
      : 0;
  const row = Math.floor(avatar / 4),
    top = AVATAR_ROWS[row]!,
    height = AVATAR_ROWS[row + 1]! - top;
  return (
    <span className={`avatar-medallion ${className}`}>
      {photo && failedPhoto !== photo ? (
        <img
          className="avatar-photo"
          src={photo}
          alt={`${profile.name}'s avatar`}
          referrerPolicy="no-referrer"
          onError={() => setFailedPhoto(photo)}
        />
      ) : (
        <svg
          viewBox={`${(avatar % 4) * 362} ${top} 362 ${height}`}
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-label={`${profile.name}'s avatar`}
        >
          <image href="/art/avatars-fantasy.png" width="1448" height="1086" />
        </svg>
      )}
    </span>
  );
}
export function ProfileEditor({
  initial,
  onSave,
  busy,
  checkUsername,
  googleAvatarUrl,
  submitLabel = 'Save profile',
}: {
  initial: Profile;
  onSave: (profile: Profile) => Promise<void>;
  busy: boolean;
  checkUsername?: CheckUsername;
  googleAvatarUrl?: string | null;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState(initial),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [availability, setAvailability] = useState<{
      name: string;
      status: 'checking' | 'available' | 'unavailable' | 'error';
      reason?: string;
    } | null>(null);
  const checkVersion = useRef(0),
    checkRef = useRef(checkUsername),
    availabilityId = useId();
  checkRef.current = checkUsername;
  const username = draft.name.trim(),
    usernameValid = validUsername(username),
    photo = httpsPhoto(googleAvatarUrl),
    disabled = busy || saving,
    checked = availability?.name === username && availability.status === 'available';
  useEffect(() => {
    const version = ++checkVersion.current;
    if (!checkRef.current || !usernameValid) {
      setAvailability(null);
      return;
    }
    setAvailability({ name: username, status: 'checking' });
    const timeout = setTimeout(async () => {
      try {
        const result = await checkRef.current!(username);
        if (checkVersion.current === version) {
          setAvailability({
            name: username,
            status: result.available ? 'available' : 'unavailable',
            reason: result.reason,
          });
        }
      } catch (e) {
        if (checkVersion.current === version) {
          setAvailability({
            name: username,
            status: 'error',
            reason: e instanceof Error ? e.message : 'Could not check this username.',
          });
        }
      }
    }, 350);
    return () => {
      clearTimeout(timeout);
      ++checkVersion.current;
    };
  }, [username, usernameValid, !!checkUsername, retry]);
  const status = !usernameValid
    ? 'Use 3–20 letters, numbers or underscores.'
    : availability?.name !== username || availability.status === 'checking'
      ? 'Checking username…'
      : availability.status === 'available'
        ? 'Username available.'
        : availability.reason ||
          (availability.status === 'error'
            ? 'Could not check this username.'
            : 'That username is already taken.');
  return (
    <form
      className="profile-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        if (disabled || !username || (checkUsername && (!usernameValid || !checked))) return;
        setSaving(true);
        setError('');
        try {
          await onSave({
            ...draft,
            name: username,
            ...(checkUsername ? { username } : {}),
            ...(draft.avatarSource === 'google' && photo ? { avatarUrl: photo } : {}),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not save');
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="profile-preview">
        <Avatar profile={draft} />
        <label className="field">
          {checkUsername ? 'Username' : 'Display name'}
          <input
            value={draft.name}
            maxLength={checkUsername ? 20 : 32}
            minLength={checkUsername ? 3 : undefined}
            pattern={checkUsername ? '[A-Za-z0-9_]{3,20}' : undefined}
            autoComplete={checkUsername ? 'username' : 'nickname'}
            autoCapitalize="none"
            spellCheck={false}
            required
            disabled={disabled}
            aria-describedby={checkUsername ? availabilityId : undefined}
            onChange={(e) => {
              setError('');
              setDraft({ ...draft, name: e.target.value });
            }}
          />
        </label>
      </div>
      {checkUsername && (
        <div
          className="username-feedback"
          data-status={usernameValid ? (availability?.status ?? 'checking') : 'hint'}
        >
          <p id={availabilityId} role="status" aria-live="polite">
            {status}
          </p>
          {availability?.name === username && availability.status === 'error' && (
            <button
              className="text-button"
              type="button"
              disabled={disabled}
              onClick={() => setRetry((n) => n + 1)}
            >
              Check again
            </button>
          )}
        </div>
      )}
      {photo && (
        <button
          className="google-photo-choice"
          type="button"
          disabled={disabled}
          aria-pressed={draft.avatarSource === 'google'}
          onClick={() => setDraft({ ...draft, avatarSource: 'google', avatarUrl: photo })}
        >
          <Avatar profile={{ ...draft, avatarSource: 'google', avatarUrl: photo }} />
          <span>Use my Google photo</span>
          {draft.avatarSource === 'google' && <Check size={17} />}
        </button>
      )}
      <div className="avatar-choices" aria-label="Choose avatar">
        {Array.from({ length: AVATAR_COUNT }, (_, i) => {
          const selected = i === draft.avatar && draft.avatarSource !== 'google';
          return (
            <button
              type="button"
              key={i}
              disabled={disabled}
              className={selected ? 'selected' : ''}
              aria-label={AVATAR_NAMES[i]}
              aria-pressed={selected}
              onClick={() =>
                setDraft({ ...draft, avatar: i, avatarSource: 'generated', avatarUrl: undefined })
              }
            >
              <Avatar
                profile={{
                  ...draft,
                  avatar: i,
                  avatarSource: 'generated',
                  avatarUrl: undefined,
                  frame: 'plain',
                }}
              />
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="entry-error">
          {error}
        </p>
      )}
      <button
        className="gold-button"
        disabled={disabled || !username || (!!checkUsername && (!usernameValid || !checked))}
      >
        {saving ? 'Saving…' : submitLabel}
        <Check size={17} />
      </button>
    </form>
  );
}

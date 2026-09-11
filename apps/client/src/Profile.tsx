import { useEffect, useId, useRef, useState } from 'react';
import { Check } from './GameIcons.js';
import { AVATAR_COUNT, defaultProfile, validUsername } from '../../../packages/protocol/src/profile.js';
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

type UsernameCheck = {
  name: string;
  status: 'checking' | 'available' | 'unavailable' | 'error';
  reason?: string;
};
/** An already selected game avatar needs no extra click after the username is verified. */
export function canSaveProfile(
  profile: Profile,
  requiresUsernameCheck: boolean,
  availability: UsernameCheck | null,
) {
  const username = profile.name.trim();
  return (
    !!username &&
    (!requiresUsernameCheck ||
      (validUsername(username) && availability?.name === username && availability.status === 'available'))
  );
}

/** Only the game cosmetics are editable or sent back, even from a legacy profile payload. */
export function gameProfileDraft(profile: Profile): Profile {
  return {
    name: profile.name,
    ...(profile.username === undefined ? {} : { username: profile.username }),
    avatar:
      Number.isInteger(profile.avatar) && profile.avatar >= 0 && profile.avatar < AVATAR_COUNT
        ? profile.avatar
        : 0,
    accent: profile.accent,
    frame: profile.frame,
  };
}
export function Avatar({
  profile = defaultProfile(),
  className = '',
}: {
  profile?: Profile;
  className?: string;
}) {
  const avatar =
    Number.isInteger(profile.avatar) && profile.avatar >= 0 && profile.avatar < AVATAR_COUNT
      ? profile.avatar
      : 0;
  const row = Math.floor(avatar / 4),
    top = AVATAR_ROWS[row]!,
    height = AVATAR_ROWS[row + 1]! - top;
  return (
    <span className={`avatar-medallion ${className}`}>
      <svg
        viewBox={`${(avatar % 4) * 362} ${top} 362 ${height}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`${profile.name}'s avatar`}
      >
        <image href="/art/optimized/avatars-fantasy.6bf04e83341a.webp" width="1448" height="1086" />
      </svg>
    </span>
  );
}
export function ProfileEditor({
  initial,
  onSave,
  busy,
  checkUsername,
  submitLabel = 'Save profile',
}: {
  initial: Profile;
  onSave: (profile: Profile) => Promise<void>;
  busy: boolean;
  checkUsername?: CheckUsername;
  submitLabel?: string;
}) {
  const [draft, setDraft] = useState(() => gameProfileDraft(initial)),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [availability, setAvailability] = useState<UsernameCheck | null>(null);
  const checkVersion = useRef(0),
    checkRef = useRef(checkUsername),
    availabilityId = useId();
  checkRef.current = checkUsername;
  const username = draft.name.trim(),
    usernameValid = validUsername(username),
    disabled = busy || saving,
    ready = canSaveProfile(draft, !!checkUsername, availability);
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
        if (disabled || !ready) return;
        setSaving(true);
        setError('');
        try {
          await onSave({
            ...gameProfileDraft(draft),
            name: username,
            ...(checkUsername ? { username } : {}),
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
      <div className="avatar-choices" aria-label="Choose avatar">
        {Array.from({ length: AVATAR_COUNT }, (_, i) => {
          const selected = i === draft.avatar;
          return (
            <button
              type="button"
              key={i}
              disabled={disabled}
              className={selected ? 'selected' : ''}
              aria-label={AVATAR_NAMES[i]}
              aria-pressed={selected}
              onClick={() => setDraft({ ...draft, avatar: i })}
            >
              <Avatar
                profile={{
                  ...draft,
                  avatar: i,
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
      <button className="gold-button" disabled={disabled || !ready}>
        {saving ? 'Saving…' : submitLabel}
        <Check size={17} />
      </button>
    </form>
  );
}

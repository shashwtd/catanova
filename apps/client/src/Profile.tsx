import { useState } from 'react';
import { Check } from './GameIcons.js';
import { AVATAR_COUNT, defaultProfile } from '../../../packages/protocol/src/profile.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
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
export function Avatar({
  profile = defaultProfile(),
  className = '',
}: {
  profile?: Profile;
  className?: string;
}) {
  const row = Math.floor(profile.avatar / 4),
    top = AVATAR_ROWS[row]!,
    height = AVATAR_ROWS[row + 1]! - top;
  return (
    <span className={`avatar-medallion ${className}`}>
      <svg
        viewBox={`${(profile.avatar % 4) * 362} ${top} 362 ${height}`}
        preserveAspectRatio="xMidYMid slice"
        role="img"
        aria-label={`${profile.name}'s avatar`}
      >
        <image href="/art/avatars-fantasy.png" width="1448" height="1086" />
      </svg>
    </span>
  );
}
export function ProfileEditor({
  initial,
  onSave,
  busy,
}: {
  initial: Profile;
  onSave: (profile: Profile) => Promise<void>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(initial),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  return (
    <form
      className="profile-editor"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
          await onSave(draft);
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
          Display name
          <input
            value={draft.name}
            maxLength={32}
            required
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </label>
      </div>
      <div className="avatar-choices" aria-label="Choose avatar">
        {Array.from({ length: AVATAR_COUNT }, (_, i) => (
          <button
            type="button"
            key={i}
            className={i === draft.avatar ? 'selected' : ''}
            aria-label={AVATAR_NAMES[i]}
            aria-pressed={i === draft.avatar}
            onClick={() => setDraft({ ...draft, avatar: i })}
          >
            <Avatar profile={{ ...draft, avatar: i, frame: 'plain' }} />
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="entry-error">
          {error}
        </p>
      )}
      <button className="gold-button" disabled={busy || saving || !draft.name.trim()}>
        {saving ? 'Saving…' : 'Save profile'}
        <Check size={17} />
      </button>
    </form>
  );
}

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { ACCENTS, AVATAR_COUNT, defaultProfile } from '../../../packages/protocol/src/profile.js';
import type { Profile } from '../../../packages/protocol/src/profile.js';
export function Avatar({
  profile = defaultProfile(),
  className = '',
}: {
  profile?: Profile;
  className?: string;
}) {
  return (
    <span
      className={`avatar-medallion frame-${profile.frame} ${className}`}
      style={{ '--accent': ACCENTS[profile.accent] } as CSSProperties}
    >
      <svg
        viewBox={`${(profile.avatar % 4) * 362} ${Math.floor(profile.avatar / 4) * 362} 362 362`}
        role="img"
        aria-label={`${profile.name}'s avatar`}
      >
        <image href="/art/avatars.png" width="1448" height="1086" />
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
            aria-label={`Avatar ${i + 1}`}
            aria-pressed={i === draft.avatar}
            onClick={() => setDraft({ ...draft, avatar: i })}
          >
            <Avatar profile={{ ...draft, avatar: i, frame: 'plain' }} />
          </button>
        ))}
      </div>
      <div className="cosmetic-row">
        <span>Accent</span>
        <div className="accent-choices">
          {Object.entries(ACCENTS).map(([key, color]) => (
            <button
              type="button"
              key={key}
              style={{ background: color }}
              aria-label={`${key} accent`}
              aria-pressed={key === draft.accent}
              onClick={() => setDraft({ ...draft, accent: key as Profile['accent'] })}
            >
              {key === draft.accent && <Check size={15} />}
            </button>
          ))}
        </div>
      </div>
      <div className="cosmetic-row">
        <span>Frame</span>
        <div className="frame-choices">
          {(['rope', 'brass', 'plain'] as const).map((frame) => (
            <button
              type="button"
              key={frame}
              aria-pressed={frame === draft.frame}
              onClick={() => setDraft({ ...draft, frame })}
            >
              {frame}
            </button>
          ))}
        </div>
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

import { useEffect, useState } from 'react';
import { Check, Clock3, Volume2, VolumeX } from 'lucide-react';
import type { Preferences } from './preferences.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import {
  DEFAULT_ROOM_SETTINGS,
  DEFAULT_TURN_TIMER_SECONDS,
  TURN_TIMER_STEPS,
} from '../../../packages/protocol/src/settings.js';
import type { RoomSettings, TurnTimerSeconds } from '../../../packages/protocol/src/settings.js';
export function GameSettings({
  preferences,
  update,
  room,
  me,
  busy,
  save,
  previewSound,
  osReduced,
}: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  room: RoomState | null;
  me?: string;
  busy: boolean;
  save: (settings: RoomSettings) => Promise<void>;
  previewSound: () => void;
  osReduced: boolean;
}) {
  const [draft, setDraft] = useState(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const host = room?.players[0]?.id === me,
    editable = !!room && !room.game && host;
  const seconds = draft.turnTimerSeconds ?? DEFAULT_TURN_TIMER_SECONDS;
  useEffect(
    () => setDraft(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [room?.roomId, room?.settings?.turnTimerSeconds],
  );
  const toggles: [keyof Preferences, string, string][] = [
    ['motion', 'Visual effects', 'Dice throws, resource trails, and card feedback'],
    ['depth', '3D pieces', 'Solid houses, cities, and roads'],
    ['boardTilt', 'Board movement', 'A small tilt while you drag'],
    ['activity', 'Move announcements', 'Brief updates when another player acts'],
  ];
  return (
    <div className="settings-content">
      <section className="settings-section">
        <h3>Your experience</h3>
        <label className="settings-toggle">
          <span>{preferences.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}Sound effects</span>
          <input
            type="checkbox"
            checked={preferences.sound}
            onChange={(e) => update({ sound: e.target.checked })}
          />
        </label>
        <div className="volume-row">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            aria-label="Effects volume"
            value={Math.round(preferences.volume * 100)}
            disabled={!preferences.sound}
            onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
          />
          <button className="text-button" disabled={!preferences.sound} onClick={previewSound}>
            Test
          </button>
        </div>
        {toggles.map(([key, title, description]) => (
          <label className="settings-toggle" key={key}>
            <span>
              <b>{title}</b>
              <small>{description}</small>
            </span>
            <input
              type="checkbox"
              checked={!!preferences[key]}
              onChange={(e) => update({ [key]: e.target.checked })}
            />
          </label>
        ))}
        {osReduced && <p className="settings-note">Your system’s reduced-motion preference is active.</p>}
      </section>
      {room && (
        <section className="settings-section">
          <h3>
            <Clock3 size={17} />
            Room rules
          </h3>
          <label className="settings-toggle">
            <span>
              <b>Turn timer</b>
              <small>Automatically finish the turn when time runs out</small>
            </span>
            <input
              type="checkbox"
              disabled={!editable || busy || saving}
              checked={draft.turnTimerSeconds !== null}
              onChange={(e) =>
                setDraft({ turnTimerSeconds: e.target.checked ? DEFAULT_TURN_TIMER_SECONDS : null })
              }
            />
          </label>
          <div className={`timer-settings ${draft.turnTimerSeconds === null ? 'timer-off' : ''}`}>
            <div className="timer-value">
              <strong>{draft.turnTimerSeconds === null ? 'Off' : seconds + 's'}</strong>
              <span>per turn</span>
            </div>
            <input
              type="range"
              min="0"
              max="4"
              step="1"
              aria-label="Turn duration"
              aria-valuetext={seconds + ' seconds'}
              disabled={!editable || busy || saving || draft.turnTimerSeconds === null}
              value={TURN_TIMER_STEPS.indexOf(seconds)}
              onChange={(e) =>
                setDraft({ turnTimerSeconds: TURN_TIMER_STEPS[Number(e.target.value)] as TurnTimerSeconds })
              }
            />
            <div className="timer-stops">
              {TURN_TIMER_STEPS.map((n) => (
                <span key={n}>{n}s</span>
              ))}
            </div>
          </div>
          <p className="settings-note">
            Setup is untimed. Required discards get their own countdown. Expiry never buys, trades, or plays a
            development card for you.
          </p>
          {!editable ? (
            <p className="settings-note">
              {room.game ? 'Room rules are locked during play.' : 'The host chooses these rules.'}
            </p>
          ) : (
            <>
              <button
                className="gold-button"
                disabled={busy || saving || draft.turnTimerSeconds === room.settings?.turnTimerSeconds}
                onClick={async () => {
                  setSaving(true);
                  setError('');
                  try {
                    await save(draft);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Could not save settings');
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                <Check size={16} />
                {saving ? 'Saving…' : 'Save room rules'}
              </button>
              <p className="settings-note">Changing room rules asks the other players to ready up again.</p>
            </>
          )}
          {error && (
            <p className="entry-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

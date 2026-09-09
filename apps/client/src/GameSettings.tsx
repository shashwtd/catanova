import { useEffect, useState } from 'react';
import { Check, Clock3, Volume2, VolumeX } from './GameIcons.js';
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
}: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  room: RoomState | null;
  me?: string;
  busy: boolean;
  save: (settings: RoomSettings) => Promise<void>;
  previewSound: () => void;
  osReduced?: boolean;
}) {
  const [draft, setDraft] = useState(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const editable = !!room && !room.game && room.players[0]?.id === me,
    seconds = draft.turnTimerSeconds ?? DEFAULT_TURN_TIMER_SECONDS;
  useEffect(
    () => setDraft(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [room?.roomId, room?.settings?.turnTimerSeconds],
  );
  return (
    <div className="settings-content compact-settings">
      <div className="volume-heading">
        {preferences.sound && preferences.volume > 0 ? <Volume2 /> : <VolumeX />}
        <label htmlFor="game-volume">Volume</label>
        <output>{preferences.sound ? Math.round(preferences.volume * 100) : 0}%</output>
      </div>
      <input
        id="game-volume"
        type="range"
        min="0"
        max="100"
        step="5"
        aria-label="Effects volume"
        value={preferences.sound ? Math.round(preferences.volume * 100) : 0}
        onChange={(e) => {
          const volume = Number(e.target.value) / 100;
          update({ volume, sound: volume > 0 });
        }}
        onPointerUp={previewSound}
        onKeyUp={(e) => {
          if (e.key.startsWith('Arrow')) previewSound();
        }}
      />
      {room && (
        <div className="compact-timer-settings">
          <label className="settings-toggle">
            <span>
              <Clock3 />
              Turn timer
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
          {draft.turnTimerSeconds !== null && (
            <>
              <div className="timer-value">
                <strong>{seconds}s</strong>
              </div>
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                aria-label="Turn duration"
                aria-valuetext={`${seconds} seconds`}
                disabled={!editable || busy || saving}
                value={TURN_TIMER_STEPS.indexOf(seconds)}
                onChange={(e) =>
                  setDraft({ turnTimerSeconds: TURN_TIMER_STEPS[Number(e.target.value)] as TurnTimerSeconds })
                }
              />
              <div className="timer-stops">
                {TURN_TIMER_STEPS.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </div>
            </>
          )}
          <p className="settings-note">
            {room.game
              ? 'Set before the game.'
              : editable
                ? 'Time up? Your turn ends.'
                : 'Chosen by the host.'}
          </p>
          {editable && (
            <button
              className="gold-button"
              disabled={
                busy ||
                saving ||
                draft.turnTimerSeconds === (room.settings ?? DEFAULT_ROOM_SETTINGS).turnTimerSeconds
              }
              onClick={async () => {
                setSaving(true);
                setError('');
                try {
                  await save(draft);
                } catch (e) {
                  setError(e instanceof Error ? e.message : 'Could not save');
                } finally {
                  setSaving(false);
                }
              }}
            >
              <Check size={18} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          {error && (
            <p className="entry-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

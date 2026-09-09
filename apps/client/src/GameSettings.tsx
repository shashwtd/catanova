import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Clock3, Volume2, VolumeX } from './GameIcons.js';
import { DEFAULT_PREFERENCES } from './preferences.js';
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
    seconds = draft.turnTimerSeconds ?? DEFAULT_TURN_TIMER_SECONDS,
    muted = !preferences.sound || preferences.volume === 0,
    volumePercent = muted ? 0 : Math.round(preferences.volume * 100),
    timerEnabled = draft.turnTimerSeconds !== null,
    timerLocked = !editable || busy || saving,
    changed = draft.turnTimerSeconds !== (room?.settings ?? DEFAULT_ROOM_SETTINGS).turnTimerSeconds;
  const lastVolume = useRef(preferences.volume || DEFAULT_PREFERENCES.volume);
  useEffect(() => {
    if (preferences.volume > 0) lastVolume.current = preferences.volume;
  }, [preferences.volume]);
  useEffect(
    () => setDraft(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [room?.roomId, room?.settings?.turnTimerSeconds],
  );
  return (
    <div className="settings-content settings-menu">
      <section className="settings-audio" aria-labelledby="volume-label">
        <div className="settings-row-heading">
          <label id="volume-label" htmlFor="game-volume">
            Sound effects
          </label>
          <output htmlFor="game-volume">{muted ? 'Muted' : `${volumePercent}%`}</output>
        </div>
        <div className="settings-volume-control">
          <button
            type="button"
            className="settings-mute"
            aria-label="Mute sound"
            aria-pressed={muted}
            onClick={() =>
              update(
                muted ? { sound: true, volume: preferences.volume || lastVolume.current } : { sound: false },
              )
            }
          >
            {muted ? <VolumeX /> : <Volume2 />}
          </button>
          <input
            className="settings-range"
            id="game-volume"
            type="range"
            min="0"
            max="100"
            step="5"
            aria-label="Effects volume"
            aria-valuetext={muted ? 'Muted' : `${volumePercent} percent`}
            style={{ '--range-fill': `${volumePercent}%` } as CSSProperties}
            value={volumePercent}
            onChange={(e) => {
              const volume = Number(e.target.value) / 100;
              update({ volume, sound: volume > 0 });
            }}
            onPointerUp={previewSound}
            onKeyUp={(e) => {
              if (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
                previewSound();
            }}
          />
        </div>
      </section>
      {room && (
        <section className="settings-room" aria-labelledby="timer-label">
          <div className="settings-row-heading">
            <label id="timer-label" htmlFor="turn-timer-enabled">
              <Clock3 />
              Turn timer
            </label>
            <label className="settings-switch">
              <span aria-hidden="true">{timerEnabled ? 'On' : 'Off'}</span>
              <input
                id="turn-timer-enabled"
                type="checkbox"
                role="switch"
                aria-labelledby="timer-label"
                disabled={timerLocked}
                checked={timerEnabled}
                onChange={(e) =>
                  setDraft({ turnTimerSeconds: e.target.checked ? DEFAULT_TURN_TIMER_SECONDS : null })
                }
              />
            </label>
          </div>
          {timerEnabled && (
            <div className="settings-duration">
              <output htmlFor="turn-duration">
                <strong>{seconds}</strong> seconds
              </output>
              <input
                id="turn-duration"
                className="settings-range"
                type="range"
                min="0"
                max="4"
                step="1"
                aria-label="Turn duration"
                aria-valuetext={`${seconds} seconds`}
                disabled={timerLocked}
                style={{ '--range-fill': `${TURN_TIMER_STEPS.indexOf(seconds) * 25}%` } as CSSProperties}
                value={TURN_TIMER_STEPS.indexOf(seconds)}
                onChange={(e) =>
                  setDraft({ turnTimerSeconds: TURN_TIMER_STEPS[Number(e.target.value)] as TurnTimerSeconds })
                }
              />
              <div className="settings-timer-stops" aria-hidden="true">
                {TURN_TIMER_STEPS.map((n) => (
                  <span key={n} data-selected={n === seconds}>
                    {n}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="settings-caption">
            {room.game
              ? 'Set before the game.'
              : editable
                ? timerEnabled
                  ? 'Your turn ends when time runs out.'
                  : 'Play at your own pace.'
                : 'Chosen by the host.'}
          </p>
          {editable && changed && (
            <button
              type="button"
              className="settings-save"
              disabled={busy || saving}
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
              {saving ? 'Saving…' : 'Apply timer'}
            </button>
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

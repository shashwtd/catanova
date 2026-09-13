import {
  DEFAULT_VICTORY_POINTS,
  MIN_VICTORY_POINTS,
  MAX_VICTORY_POINTS,
} from '../../../packages/rules/src/victory.js';
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Check, Clock3, Dices, Trophy, Volume2, Music } from './GameIcons.js';
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
    changed =
      draft.turnTimerSeconds !== (room?.settings ?? DEFAULT_ROOM_SETTINGS).turnTimerSeconds ||
      (draft.diceMode ?? 'classic') !== (room?.settings?.diceMode ?? 'classic') ||
      (draft.victoryPoints ?? DEFAULT_VICTORY_POINTS) !==
        (room?.settings?.victoryPoints ?? DEFAULT_VICTORY_POINTS);
  const musicMuted = !preferences.music || preferences.musicVolume === 0;
  const musicPercent = musicMuted ? 0 : Math.round(preferences.musicVolume * 100);
  useEffect(
    () => setDraft(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [room?.roomId, room?.settings?.turnTimerSeconds, room?.settings?.diceMode, room?.settings?.victoryPoints],
  );
  return (
    <div className="settings-content settings-menu">
      <div className="settings-audio-group" role="group" aria-label="Audio">
        <section className="settings-audio" aria-labelledby="volume-label">
          <div className="settings-row-heading">
            <label id="volume-label" htmlFor="game-volume">
              Sound effects
            </label>
            <output htmlFor="game-volume">{muted ? 'Muted' : `${volumePercent}%`}</output>
          </div>
          <div className="settings-volume-control">
            <span className="settings-audio-icon">
              <Volume2 />
            </span>
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
        <section className="settings-audio settings-music" aria-labelledby="music-label">
          <div className="settings-row-heading">
            <label id="music-label" htmlFor="music-volume">
              Music
            </label>
            <output htmlFor="music-volume">{musicMuted ? 'Off' : `${musicPercent}%`}</output>
          </div>
          <div className="settings-volume-control">
            <span className="settings-audio-icon">
              <Music />
            </span>
            <input
              className="settings-range"
              id="music-volume"
              type="range"
              min="0"
              max="100"
              step="5"
              aria-label="Music volume"
              aria-valuetext={musicMuted ? 'Off' : `${musicPercent} percent`}
              style={{ '--range-fill': `${musicPercent}%` } as CSSProperties}
              value={musicPercent}
              onChange={(e) => {
                const musicVolume = Number(e.target.value) / 100;
                update({ musicVolume, music: musicVolume > 0 });
              }}
            />
          </div>
        </section>
      </div>
      <fieldset className="settings-theme">
        <legend>Board style</legend>
        {(['storybook', 'classic'] as const).map((theme) => (
          <label key={theme} data-selected={preferences.boardTheme === theme}>
            <input
              type="radio"
              name="board-theme"
              checked={preferences.boardTheme === theme}
              onChange={() => update({ boardTheme: theme })}
            />
            <span className={`theme-swatch theme-${theme}`} aria-hidden="true" />
            <span>{theme === 'storybook' ? 'Storybook' : 'Classic'}</span>
          </label>
        ))}
      </fieldset>
      {room && !room.game && (
        <section className="settings-room" aria-labelledby="timer-label">
          <div className="settings-timer-block">
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
                    setDraft({
                      ...draft,
                      turnTimerSeconds: e.target.checked ? DEFAULT_TURN_TIMER_SECONDS : null,
                    })
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
                    setDraft({
                      ...draft,
                      turnTimerSeconds: TURN_TIMER_STEPS[Number(e.target.value)] as TurnTimerSeconds,
                    })
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
              {editable
                ? timerEnabled
                  ? 'Your turn ends when time runs out.'
                  : 'Play at your own pace.'
                : 'Chosen by the host.'}
            </p>
          </div>
          <section className="settings-goal" aria-labelledby="victory-target-label">
            <div className="settings-row-heading">
              <label id="victory-target-label" htmlFor="victory-target">
                <Trophy /> Points to win
              </label>
              <output htmlFor="victory-target">{draft.victoryPoints ?? DEFAULT_VICTORY_POINTS}</output>
            </div>
            <input
              id="victory-target"
              type="range"
              className="settings-range"
              min={MIN_VICTORY_POINTS}
              max={MAX_VICTORY_POINTS}
              step={1}
              value={draft.victoryPoints ?? DEFAULT_VICTORY_POINTS}
              disabled={timerLocked}
              aria-valuetext={`${draft.victoryPoints ?? DEFAULT_VICTORY_POINTS} victory points`}
              style={
                {
                  '--range-fill': `${(((draft.victoryPoints ?? DEFAULT_VICTORY_POINTS) - MIN_VICTORY_POINTS) / (MAX_VICTORY_POINTS - MIN_VICTORY_POINTS)) * 100}%`,
                } as CSSProperties
              }
              onChange={(event) => setDraft({ ...draft, victoryPoints: Number(event.target.value) })}
            />
            <div className="settings-timer-stops">
              <span>{MIN_VICTORY_POINTS}</span>
              <span>10 · Standard</span>
              <span>{MAX_VICTORY_POINTS}</span>
            </div>
          </section>
          <fieldset className="settings-dice" disabled={timerLocked}>
            <legend>
              <Dices /> Dice
            </legend>
            {(['classic', 'balanced'] as const).map((mode) => (
              <label
                key={mode}
                className="settings-dice-option"
                data-selected={(draft.diceMode ?? 'classic') === mode}
              >
                <input
                  type="radio"
                  name="dice-mode"
                  value={mode}
                  checked={(draft.diceMode ?? 'classic') === mode}
                  onChange={() => setDraft({ ...draft, diceMode: mode })}
                />
                <span>
                  <strong>{mode === 'classic' ? 'Natural' : 'Balanced'}</strong>
                  <small>
                    {mode === 'classic'
                      ? 'Two normal dice. 7 is most common.'
                      : 'A dice deck smooths extremes and reduces repeats.'}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
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
              {saving ? 'Saving…' : 'Apply settings'}
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

/** Frozen match rules live here; the in-game settings menu contains personal audio and appearance choices. */
export function GameInfo({ room }: { room: RoomState }) {
  const settings = room.settings ?? DEFAULT_ROOM_SETTINGS;
  const balanced = (room.game?.diceMode ?? settings.diceMode) === 'balanced';
  const flat = (room.game?.diceMode ?? settings.diceMode ?? 'classic') === 'flat';
  return (
    <div className="game-info-content">
      <dl className="game-info-rules">
        <div>
          <dt>
            <Trophy /> Goal
          </dt>
          <dd>
            {room.game?.victoryPoints ?? settings.victoryPoints ?? DEFAULT_VICTORY_POINTS} points on your turn
          </dd>
        </div>
        <div>
          <dt>
            <Clock3 /> Turn timer
          </dt>
          <dd>{settings.turnTimerSeconds === null ? 'Off' : `${settings.turnTimerSeconds} seconds`}</dd>
        </div>
        <div>
          <dt>
            <Dices /> Dice
          </dt>
          <dd>
            {flat ? 'Legacy flat totals' : balanced ? 'Balanced' : 'Natural'}
            <small>
              {flat
                ? 'Every total from 2 to 12 has a 1 in 11 chance. This house rule changes production and robber odds.'
                : balanced
                  ? 'Draws from 36 dice pairs, refreshes with 12 left, and reduces the previous total’s weight by 30%. No player-based adjustments.'
                  : 'Two independent six-sided dice. 7 is most likely; 2 and 12 are rarest.'}
            </small>
          </dd>
        </div>
      </dl>
    </div>
  );
}

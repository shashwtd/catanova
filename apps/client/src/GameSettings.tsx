/**
 * Two different things wearing two different icons.
 *
 * `PlayerSettings` is yours: how loud the game is, how the board looks, and
 * what other people can see about you. It follows you from room to room, and
 * it opens from a cog, which is the everyday symbol for a thing you keep.
 *
 * `RoomConfiguration` belongs to the table: the turn timer, the points needed
 * to win, the dice. Only the host can move them, so it opens from sliders
 * instead — the symbol for setting something up. The two used to share one
 * panel, which made the host's choices look like personal preferences and made
 * a guest's preferences look like they were changing the game for everyone.
 */
import {
  DEFAULT_VICTORY_POINTS,
  MIN_VICTORY_POINTS,
  MAX_VICTORY_POINTS,
} from '../../../packages/rules/src/victory.js';
import { useEffect, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Check, Clock3, Dices, Trophy, Volume2, Music, Eye } from './GameIcons.js';
import type { Preferences } from './preferences.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import {
  DEFAULT_ROOM_SETTINGS,
  DEFAULT_TURN_TIMER_SECONDS,
  TURN_TIMER_STEPS,
} from '../../../packages/protocol/src/settings.js';
import type { RoomSettings, TurnTimerSeconds } from '../../../packages/protocol/src/settings.js';
import type { AccountPrivacy } from '../../../packages/protocol/src/player-hub.js';

/** A labelled row with its current value read out on the right. */
function RowHeading({ label, value }: { label: ReactNode; value?: ReactNode }) {
  return (
    <div className="settings-row-heading">
      {label}
      {value}
    </div>
  );
}

function Volume({
  id,
  label,
  control,
  icon,
  percent,
  offLabel,
  onChange,
  onPreview,
}: {
  id: string;
  label: string;
  /** What a screen reader calls the slider itself, which is a different thing
   *  from the row's heading: "Music" names the row, "Music volume" the knob. */
  control: string;
  icon: ReactNode;
  percent: number;
  offLabel: string;
  onChange: (percent: number) => void;
  onPreview?: () => void;
}) {
  return (
    <section className="settings-audio" aria-labelledby={`${id}-label`}>
      <RowHeading
        label={
          <label id={`${id}-label`} htmlFor={id}>
            {label}
          </label>
        }
        value={<output htmlFor={id}>{percent === 0 ? offLabel : `${percent}%`}</output>}
      />
      <div className="settings-volume-control">
        <span className="settings-audio-icon">{icon}</span>
        <input
          className="settings-range"
          id={id}
          type="range"
          min="0"
          max="100"
          step="5"
          aria-label={control}
          aria-valuetext={percent === 0 ? offLabel : `${percent} percent`}
          style={{ '--range-fill': `${percent}%` } as CSSProperties}
          value={percent}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={onPreview}
          onKeyUp={(e) => {
            if (
              onPreview &&
              (e.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(e.key))
            )
              onPreview();
          }}
        />
      </div>
    </section>
  );
}

const TABS = [
  { id: 'table', label: 'Sound & board' },
  { id: 'privacy', label: 'Privacy' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function PlayerSettings({
  preferences,
  update,
  previewSound,
  privacy,
  savePrivacy,
  initialTab = 'table',
}: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  previewSound: () => void;
  /** Absent for a guest or a local server: there is then nothing to share. */
  privacy?: AccountPrivacy | null;
  savePrivacy?: (next: AccountPrivacy) => Promise<void>;
  initialTab?: TabId;
  osReduced?: boolean;
}) {
  const [tab, setTab] = useState<TabId>(initialTab);
  const [privacyError, setPrivacyError] = useState('');
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const base = useId().replaceAll(':', '');
  const muted = !preferences.sound || preferences.volume === 0,
    volumePercent = muted ? 0 : Math.round(preferences.volume * 100),
    musicMuted = !preferences.music || preferences.musicVolume === 0,
    musicPercent = musicMuted ? 0 : Math.round(preferences.musicVolume * 100);
  return (
    <div className="settings-content settings-menu">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${base}-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`${base}-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className="settings-tab"
            onClick={() => setTab(id)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = TABS[(TABS.findIndex((t) => t.id === tab) + step + TABS.length) % TABS.length]!;
              setTab(next.id);
              document.getElementById(`${base}-tab-${next.id}`)?.focus();
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'table' && (
        <div
          className="settings-panel"
          role="tabpanel"
          id={`${base}-panel-table`}
          aria-labelledby={`${base}-tab-table`}
        >
          <div className="settings-audio-group" role="group" aria-label="Audio">
            <Volume
              id="game-volume"
              label="Sound effects"
              control="Effects volume"
              icon={<Volume2 />}
              percent={volumePercent}
              offLabel="Muted"
              onChange={(percent) => update({ volume: percent / 100, sound: percent > 0 })}
              onPreview={previewSound}
            />
            <Volume
              id="music-volume"
              label="Music"
              control="Music volume"
              icon={<Music />}
              percent={musicPercent}
              offLabel="Off"
              onChange={(percent) => update({ musicVolume: percent / 100, music: percent > 0 })}
            />
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
        </div>
      )}
      {tab === 'privacy' && (
        <div
          className="settings-panel"
          role="tabpanel"
          id={`${base}-panel-privacy`}
          aria-labelledby={`${base}-tab-privacy`}
        >
          <section className="settings-privacy" aria-labelledby="last-seen-label">
            <RowHeading
              label={
                <label id="last-seen-label" htmlFor="share-last-seen">
                  <Eye />
                  Show when you were last online
                </label>
              }
              value={
                <label className="settings-switch">
                  <span aria-hidden="true">{privacy?.shareLastSeen ? 'On' : 'Off'}</span>
                  <input
                    id="share-last-seen"
                    type="checkbox"
                    role="switch"
                    aria-labelledby="last-seen-label"
                    disabled={!privacy || !savePrivacy || savingPrivacy}
                    checked={!!privacy?.shareLastSeen}
                    onChange={async (event) => {
                      if (!savePrivacy) return;
                      const shareLastSeen = event.target.checked;
                      setSavingPrivacy(true);
                      setPrivacyError('');
                      try {
                        await savePrivacy({ shareLastSeen });
                      } catch (e) {
                        setPrivacyError(e instanceof Error ? e.message : 'Could not save');
                      } finally {
                        setSavingPrivacy(false);
                      }
                    }}
                  />
                </label>
              }
            />
            <p className="settings-caption">
              {privacy
                ? privacy.shareLastSeen
                  ? 'Your friends see how long ago you were online. They never see which room you are in unless you are in a game they can watch.'
                  : 'Your friends see only whether you are online right now.'
                : 'Sign in to choose what your friends can see.'}
            </p>
            {privacyError && (
              <p className="entry-error" role="alert">
                {privacyError}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/**
 * The table's own rules. The host moves them; everyone else reads them, which
 * is why this panel opens for everyone but only fills in its controls for one
 * person.
 */
export function RoomConfiguration({
  room,
  me,
  busy,
  save,
}: {
  room: RoomState | null;
  me?: string;
  busy: boolean;
  save: (settings: RoomSettings) => Promise<void>;
}) {
  const [draft, setDraft] = useState(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const started = !!room?.game,
    editable = !!room && !started && room.players[0]?.id === me,
    seconds = draft.turnTimerSeconds ?? DEFAULT_TURN_TIMER_SECONDS,
    timerEnabled = draft.turnTimerSeconds !== null,
    locked = !editable || busy || saving,
    changed =
      draft.turnTimerSeconds !== (room?.settings ?? DEFAULT_ROOM_SETTINGS).turnTimerSeconds ||
      (draft.diceMode ?? 'classic') !== (room?.settings?.diceMode ?? 'classic') ||
      (draft.victoryPoints ?? DEFAULT_VICTORY_POINTS) !==
        (room?.settings?.victoryPoints ?? DEFAULT_VICTORY_POINTS);
  useEffect(
    () => setDraft(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [room?.roomId, room?.settings?.turnTimerSeconds, room?.settings?.diceMode, room?.settings?.victoryPoints],
  );
  return (
    <div className="settings-content settings-menu settings-configure">
      <p className="settings-owner-note">
        {started
          ? 'These were set before the game started and stay put until it ends.'
          : editable
            ? 'You are the host, so these are yours to set.'
            : 'The host sets these for the table.'}
      </p>
      <section className="settings-room" aria-labelledby="timer-label">
        <div className="settings-timer-block">
          <RowHeading
            label={
              <label id="timer-label" htmlFor="turn-timer-enabled">
                <Clock3 />
                Turn timer
              </label>
            }
            value={
              <label className="settings-switch">
                <span aria-hidden="true">{timerEnabled ? 'On' : 'Off'}</span>
                <input
                  id="turn-timer-enabled"
                  type="checkbox"
                  role="switch"
                  aria-labelledby="timer-label"
                  disabled={locked}
                  checked={timerEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      turnTimerSeconds: e.target.checked ? DEFAULT_TURN_TIMER_SECONDS : null,
                    })
                  }
                />
              </label>
            }
          />
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
                disabled={locked}
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
            {timerEnabled ? 'A turn ends when the time runs out.' : 'Everyone plays at their own pace.'}
          </p>
        </div>
        <section className="settings-goal" aria-labelledby="victory-target-label">
          <RowHeading
            label={
              <label id="victory-target-label" htmlFor="victory-target">
                <Trophy /> Points to win
              </label>
            }
            value={<output htmlFor="victory-target">{draft.victoryPoints ?? DEFAULT_VICTORY_POINTS}</output>}
          />
          <input
            id="victory-target"
            type="range"
            className="settings-range"
            min={MIN_VICTORY_POINTS}
            max={MAX_VICTORY_POINTS}
            step={1}
            value={draft.victoryPoints ?? DEFAULT_VICTORY_POINTS}
            disabled={locked}
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
        <fieldset className="settings-dice" disabled={locked}>
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
    </div>
  );
}

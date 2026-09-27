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
import { CLASSIC, TURN_STRUCTURES, findRuleset, switchBlock } from '../../../packages/rules/src/rulesets.js';
import type { Ruleset, TurnStructure } from '../../../packages/rules/src/rulesets.js';
import { Fragment, useEffect, useId, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Check, Clock3, Dices, GameMode, Trophy, Volume2, Music, Eye } from './GameIcons.js';
import type { Preferences } from './preferences.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { roomHostId } from '../../../packages/protocol/src/room-host.js';
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

/** The turn structure a mode's settings choose: its first, the default, unless the host picked another. */
const turnsOf = (settings: RoomSettings, ruleset: Ruleset) =>
  ruleset.turns ? (settings.turns ?? ruleset.turns[0]) : undefined;

/**
 * Big Table's turn style: two more option cards under its own, open while it is the mode picked, indented to its
 * text so they read as belonging to it (docs/GAME-MODES.md, "Matching the existing look").
 */
function TurnStyle({
  options,
  value,
  open,
  onChange,
}: {
  options: readonly TurnStructure[];
  value: TurnStructure | undefined;
  open: boolean;
  onChange: (turns: TurnStructure) => void;
}) {
  const id = useId();
  return (
    <div className="settings-turns t-acc" data-open={open}>
      <div className="t-acc-panel" inert={!open} aria-hidden={!open}>
        <div className="t-acc-panel-inner" role="radiogroup" aria-labelledby={id}>
          <p className="settings-caption" id={id}>
            Turn style
          </p>
          {options.map((structure) => (
            <label key={structure} className="settings-dice-option" data-selected={value === structure}>
              <input
                type="radio"
                name="turn-style"
                value={structure}
                checked={value === structure}
                onChange={() => onChange(structure)}
              />
              <span>
                <strong>{TURN_STRUCTURES[structure].name}</strong>
                <small>{TURN_STRUCTURES[structure].summary}</small>
              </span>
            </label>
          ))}
        </div>
      </div>
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
  const saved = room?.settings ?? DEFAULT_ROOM_SETTINGS;
  // The mode the room plays, and the one the host has picked but not applied yet.
  const roomMode = saved.mode ?? CLASSIC.id,
    mode = draft.mode ?? roomMode,
    rules = findRuleset(mode) ?? CLASSIC,
    savedTarget = saved.victoryPoints ?? (findRuleset(roomMode) ?? CLASSIC).victoryPoints.default,
    // A new mode starts from its own default target, which the host can move once the mode is applied.
    switching = mode !== roomMode,
    target = switching ? rules.victoryPoints.default : (draft.victoryPoints ?? rules.victoryPoints.default),
    // How turns run, where the mode lets the host choose: Big Table's Paired turns unless another is picked.
    turns = turnsOf(draft, rules),
    savedTurns = turnsOf(saved, findRuleset(roomMode) ?? CLASSIC);
  // The server lists what this host may pick only when that is more than Classic.
  const offered = room?.modes ?? [CLASSIC.id],
    modes = [...new Set([...offered, roomMode])].flatMap((id) => findRuleset(id) ?? []);
  const started = !!room?.game,
    editable = !!room && !started && roomHostId(room.players) === me,
    seconds = draft.turnTimerSeconds ?? DEFAULT_TURN_TIMER_SECONDS,
    timerEnabled = draft.turnTimerSeconds !== null,
    locked = !editable || busy || saving,
    changed =
      draft.turnTimerSeconds !== saved.turnTimerSeconds ||
      (draft.diceMode ?? 'classic') !== (saved.diceMode ?? 'classic') ||
      switching ||
      target !== savedTarget ||
      turns !== savedTurns;
  useEffect(
    () => setDraft(room?.settings ?? DEFAULT_ROOM_SETTINGS),
    [
      room?.roomId,
      room?.settings?.turnTimerSeconds,
      room?.settings?.diceMode,
      room?.settings?.victoryPoints,
      room?.settings?.mode,
      room?.settings?.turns,
    ],
  );
  /**
   * Why the host cannot switch to a mode now, if they cannot. The room's own mode is never blocked, and the
   * others at the table only read the section, so it gives them no reasons.
   */
  const blocked = (option: Ruleset) =>
    editable && option.id !== roomMode ? room && switchBlock(option, room.players)?.reason : undefined;
  // A room left in a mode its host may no longer pick keeps it, and says why Start will refuse it.
  const closed = editable && !offered.includes(roomMode);
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
        {/* Shown only when there is a choice to see: a host who may pick more than Classic, or a room already
            in another mode. With Classic alone, Room setup is exactly what it was. */}
        {(modes.length > 1 || roomMode !== CLASSIC.id) && (
          <fieldset className="settings-dice settings-mode" disabled={locked}>
            <legend>
              <GameMode /> Game mode
            </legend>
            {modes.map((option) => {
              const reason = blocked(option);
              return (
                <Fragment key={option.id}>
                  <label
                    className="settings-dice-option"
                    data-selected={mode === option.id}
                    {...(reason ? { 'data-disabled': true } : {})}
                  >
                    <input
                      type="radio"
                      name="game-mode"
                      value={option.id}
                      checked={mode === option.id}
                      disabled={!!reason}
                      onChange={() =>
                        setDraft({
                          ...draft,
                          mode: option.id,
                          // Back to the room's own mode, its own target and turns; any other mode starts from
                          // its defaults.
                          victoryPoints: option.id === roomMode ? saved.victoryPoints : undefined,
                          turns: option.id === roomMode ? saved.turns : undefined,
                        })
                      }
                    />
                    <span>
                      <strong>{option.name}</strong>
                      <small>
                        {reason ??
                          (closed && option.id === roomMode ? 'No longer open to this room' : option.summary)}
                      </small>
                    </span>
                  </label>
                  {option.turns && (
                    <TurnStyle
                      options={option.turns}
                      value={mode === option.id ? turns : undefined}
                      open={mode === option.id}
                      onChange={(next) => setDraft({ ...draft, turns: next })}
                    />
                  )}
                </Fragment>
              );
            })}
          </fieldset>
        )}
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
            value={<output htmlFor="victory-target">{target}</output>}
          />
          <input
            id="victory-target"
            type="range"
            className="settings-range"
            min={rules.victoryPoints.min}
            max={rules.victoryPoints.max}
            step={1}
            value={target}
            disabled={locked || switching}
            aria-valuetext={`${target} victory points`}
            style={
              {
                '--range-fill': `${((target - rules.victoryPoints.min) / (rules.victoryPoints.max - rules.victoryPoints.min)) * 100}%`,
              } as CSSProperties
            }
            onChange={(event) => setDraft({ ...draft, victoryPoints: Number(event.target.value) })}
          />
          <div className="settings-timer-stops">
            <span>{rules.victoryPoints.min}</span>
            {/* One text node, as the fixed label was: split in two, its letters would be spaced differently. */}
            <span>{`${rules.victoryPoints.default} · Standard`}</span>
            <span>{rules.victoryPoints.max}</span>
          </div>
          {switching && <p className="settings-caption">Apply the new mode first to change its target.</p>}
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
                // The turn structure goes only with a mode that has one, and always then, so that picking the
                // default again is a change the server sees.
                const { turns: _turns, ...settings } = draft;
                await save({ ...settings, ...(turns ? { turns } : {}) });
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

/** Compatibility entry for the tracked preview; production uses separate panels. */
export function GameSettings(props: {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
  previewSound: () => void;
  room: RoomState | null;
  me?: string;
  busy: boolean;
  save: (settings: RoomSettings) => Promise<void>;
}) {
  return (
    <>
      <PlayerSettings {...props} />
      {props.room && !props.room.game && <RoomConfiguration {...props} />}
    </>
  );
}

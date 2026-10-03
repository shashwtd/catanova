/**
 * Choosing the game mode: a large dialog over the room, opened from the mode's banner beside Start. The modes
 * stand side by side (one above another on a phone), each as its real board (ModeBoard.tsx) tilted like a tile on
 * the table, with its name, how many it seats, its icon where it has one, and a line on what sets it apart. The
 * host clicks one and the room plays it at once; the mode the room plays has its name in gold and its board lifted.
 * Everyone else sees the room's mode, and nothing to press.
 *
 * A mode the table does not fit yet (too many players, or a bot in a mode bots do not play) stays on show, faded,
 * with the reason where its line was.
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CLASSIC, findRuleset, switchBlock } from '../../../packages/rules/src/rulesets.js';
import type { Ruleset } from '../../../packages/rules/src/rulesets.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { roomHostId } from '../../../packages/protocol/src/room-host.js';
import { DEFAULT_ROOM_SETTINGS } from '../../../packages/protocol/src/settings.js';
import type { RoomSettings } from '../../../packages/protocol/src/settings.js';
import { ArrowRight, GameIcon, Users, X } from './GameIcons.js';
import { ModeBoard } from './ModeBoard.js';
import { modeCopy, roomModes, seatsText } from './game-modes.js';
import type { ModeCopy } from './game-modes.js';
import type { TerrainArt } from './Terrain.js';

export function ModeChooser({
  room,
  me,
  busy,
  save,
  art,
  onClose,
}: {
  room: RoomState;
  me?: string;
  busy: boolean;
  save: (settings: RoomSettings) => Promise<void>;
  art?: TerrainArt;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const saved = room.settings ?? DEFAULT_ROOM_SETTINGS;
  const roomMode = saved.mode ?? CLASSIC.id;
  const host = !room.game && roomHostId(room.players) === me;
  const offered = room.modes ?? [CLASSIC.id];
  const modes = host ? roomModes(room) : [findRuleset(roomMode) ?? CLASSIC];
  // The pick shows at once; the room follows when the server agrees, and an error puts it back.
  const [picked, setPicked] = useState(roomMode),
    [error, setError] = useState('');
  useEffect(() => setPicked(roomMode), [roomMode]);
  const pick = async (option: Ruleset) => {
    if (!host || busy || option.id === picked) return;
    setPicked(option.id);
    setError('');
    try {
      const { turns: _turns, victoryPoints: _target, ...rest } = saved;
      await save({ ...rest, mode: option.id, ...(option.turns ? { turns: option.turns[0]! } : {}) });
    } catch (e) {
      setPicked(roomMode);
      setError(e instanceof Error ? e.message : 'Could not change the mode');
    }
  };
  const chosen = findRuleset(picked) ?? CLASSIC;
  return (
    <dialog
      ref={ref}
      className="mode-dialog"
      aria-label="Choose a mode"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mode-dialog-surface">
        <button type="button" className="mode-dialog-close" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
        <header className="mode-dialog-head">
          <h2>{host ? 'Choose a mode' : 'Game mode'}</h2>
        </header>
        <div className="mode-lineup" style={{ '--modes': modes.length } as CSSProperties}>
          {modes.map((option) => {
            const copy = modeCopy(option);
            const selected = option.id === picked;
            const reason =
              host && option.id !== roomMode ? switchBlock(option, room.players)?.reason : undefined;
            const closed = host && option.id === roomMode && !offered.includes(roomMode);
            return (
              <button
                key={option.id}
                type="button"
                className="mode-pick"
                data-mode={option.id}
                aria-pressed={selected}
                disabled={!host || !!reason}
                onClick={() => void pick(option)}
              >
                <span className="mode-pick-stage">
                  <ModeBoard mode={option.id} art={art} />
                </span>
                <span className="mode-pick-name">{copy.name}</span>
                <span className="mode-pick-meta">
                  <span>
                    <Users size={20} />
                    {seatsText(option)}
                  </span>
                  <ModeIcons copy={copy} />
                </span>
                {/* Its line, or why the host cannot pick it, which small screens keep when they drop the line. */}
                <span className={`mode-pick-tagline${reason || closed ? ' is-note' : ''}`}>
                  {reason ?? (closed ? 'No longer open to this room' : copy.tagline)}
                </span>
              </button>
            );
          })}
        </div>
        <footer className="mode-dialog-foot">
          {error ? (
            <p className="mode-dialog-error" role="alert">
              {error}
            </p>
          ) : (
            <p>
              {host
                ? 'Everyone at the table sees the change at once.'
                : 'The host picks the mode for the table.'}
            </p>
          )}
          <button type="button" className="gold-button mode-dialog-done" onClick={onClose}>
            {host ? `Select ${modeCopy(chosen).name}` : 'Close'}
            {host && <ArrowRight size={18} />}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

/** A mode's own icons, each named for a tooltip and for a screen reader. */
export function ModeIcons({ copy }: { copy: ModeCopy }) {
  if (!copy.icons.length) return null;
  return (
    <span className="mode-icons">
      {copy.icons.map(({ icon, label }) => (
        <span key={icon} className="mode-icon" title={label} role="img" aria-label={label}>
          <GameIcon name={icon} size={24} />
        </span>
      ))}
    </span>
  );
}

import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { canPay, emptyHand, total } from '../../../packages/rules/src/game.js';
import type { GameAction, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { Avatar } from './Profile.js';
import { ResourceIcon } from './Board.js';
import { playerHexColor } from './player-colors.js';
import { Check, GameIcon, SEA_ICONS, WifiOff, X } from './GameIcons.js';
import { TurnTimer } from './TurnTimer.js';

/**
 * Year of Plenty's picker, for a gold field (docs/RULEBOOK-OPEN-SEA.md, section 9): only the types the bank still
 * holds can be chosen, and exactly as many cards as the player is owed, or all the bank has if that is fewer.
 */
export function GoldPicker({
  count,
  types,
  bank,
  disabled,
  onPick,
}: {
  count: number;
  types: readonly Resource[];
  bank: Hand;
  disabled: boolean;
  onPick: (resources: Hand) => void;
}) {
  const [take, setTake] = useState<Hand>(emptyHand);
  const chosen = total(take);
  return (
    <div className="development-choice">
      <div className="development-resources">
        {RESOURCES.map((r) => (
          <button
            key={r}
            aria-label={`Choose ${RESOURCE_NAMES[r]}, ${take[r]} selected, ${bank[r]} available`}
            aria-pressed={take[r] > 0}
            disabled={disabled || !types.includes(r) || take[r] >= bank[r] || chosen >= count}
            onClick={() => setTake((h) => ({ ...h, [r]: h[r] + 1 }))}
          >
            <ResourceIcon resource={r} />
            <span>{take[r] ? `${take[r]} selected` : RESOURCE_NAMES[r]}</span>
          </button>
        ))}
      </div>
      <div className="plenty-picked">
        {RESOURCES.filter((r) => take[r] > 0).map((r) => (
          <button
            key={r}
            onClick={() => setTake((h) => ({ ...h, [r]: h[r] - 1 }))}
            title="Remove one selected card"
          >
            <ResourceIcon resource={r} />
            {take[r]} · {RESOURCE_NAMES[r]} <X size={12} />
          </button>
        ))}
      </div>
      <button
        type="button"
        className="gold-button"
        disabled={disabled || chosen !== count || !canPay(bank, take)}
        onClick={() => onPick(take)}
      >
        <Check size={18} />
        {chosen === count
          ? `Take ${count} ${count === 1 ? 'resource' : 'resources'}`
          : `Choose ${count - chosen} more`}
      </button>
    </div>
  );
}

/**
 * Open Sea's gold picks, for everyone at the table while they are owed: a panel made like the robber flow's. The
 * players owed gold pick one at a time, in turn order from the player on turn (section 9.2); the discard list's
 * rows show that order, the player picking now first. The picker chooses against their own 20 seconds, the
 * others see who is picking. A second starting settlement's picks come the same way (section 5.5).
 */
export function GoldPick({
  room,
  me,
  disabled,
  connected,
  offset,
  onAction,
  onWarning,
}: {
  room: RoomState;
  me?: string;
  disabled: boolean;
  connected: boolean;
  offset?: number;
  onAction: (action: GameAction) => void;
  onWarning: () => void;
}) {
  const game = room.game;
  const order = game?.phase === 'goldPick' && !game.winner ? (game.goldOwed ?? []) : [];
  const picker = order[0];
  if (!game || !picker) return null;
  const mine = picker.player === me,
    name = game.players.find((p) => p.id === picker.player)?.name ?? 'A player';
  const count = game.legal.goldPick?.count ?? Math.min(picker.picks, total(game.bank));
  const cards = `${count} ${count === 1 ? 'resource' : 'resources'}`;
  return (
    <aside className={`robber-flow gold-pick ${mine ? 'needs-you' : 'waiting'}`} aria-label="Gold picks">
      <div className="robber-flow-heading">
        <GameIcon name={SEA_ICONS.gold} size={29} />
        <h2 aria-live="polite">
          {mine ? `Gold field: choose ${count}` : `${name} is picking from a gold field`}
        </h2>
        <TurnTimer
          room={room}
          me={me}
          goldPicker={picker.player}
          connected={connected}
          offset={offset}
          onWarning={onWarning}
        />
      </div>
      <p className="robber-explanation">
        {mine
          ? 'Take any resources the bank still has, of one kind or several.'
          : `They take ${cards} of their choice from the bank. Play resumes after the last pick.`}
      </p>
      <div className="discard-waiting-list" aria-label="Order of gold picks">
        {order.map((owed, i) => {
          const player = game.players.find((p) => p.id === owed.player),
            seat = room.players.find((s) => s.id === owed.player);
          return (
            <div
              key={owed.player}
              className="discard-player"
              data-current={i === 0}
              style={{ '--player-color': playerHexColor(room.players, owed.player) } as CSSProperties}
            >
              <Avatar profile={seat?.profile ?? defaultProfile(player?.name ?? '')} />
              <strong>{owed.player === me ? 'You' : player?.name}</strong>
              {seat && !seat.connected && <WifiOff size={17} aria-label="Disconnected" />}
              <small>{i === 0 ? 'Picking now' : i === 1 ? 'Next' : 'Then'}</small>
              <span aria-label={`${owed.picks} ${owed.picks === 1 ? 'pick' : 'picks'}`}>
                <GameIcon name={SEA_ICONS.gold} size={17} />
                {owed.picks}
              </span>
            </div>
          );
        })}
      </div>
      {mine && game.legal.goldPick && (
        <GoldPicker
          key={`${room.roomId}:${game.turn}:${picker.player}:${count}:${game.legal.goldPick.types.join()}`}
          count={count}
          types={game.legal.goldPick.types}
          bank={game.bank}
          disabled={disabled}
          onPick={(resources) => onAction({ kind: 'goldPick', resources })}
        />
      )}
    </aside>
  );
}

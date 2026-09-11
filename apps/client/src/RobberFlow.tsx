import { useState } from 'react';
import type { CSSProperties } from 'react';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { emptyHand, robberVictims, total } from '../../../packages/rules/src/game.js';
import type { GameAction, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { ResourceIcon, PLAYER_COLORS } from './Board.js';
import { Check, GameIcon, Plus, WifiOff } from './GameIcons.js';
import { TurnTimer } from './TurnTimer.js';

/** A changing hand or deadline cannot leave an invalid selection enabled. */
export function discardChoice(
  selected: Hand,
  hand: Hand,
  required: number,
  resource: Resource,
  direction: 1 | -1,
): Hand {
  const count = selected[resource] + direction;
  if (count < 0 || count > hand[resource] || (direction > 0 && total(selected) >= required)) return selected;
  return { ...selected, [resource]: count };
}
export function validDiscard(selected: Hand, hand: Hand, required: number) {
  return (
    required > 0 &&
    total(selected) === required &&
    RESOURCES.every((r) => Number.isInteger(selected[r]) && selected[r] >= 0 && selected[r] <= hand[r])
  );
}
function DiscardCards({
  hand,
  required,
  disabled,
  onDiscard,
}: {
  hand: Hand;
  required: number;
  disabled: boolean;
  onDiscard: (hand: Hand) => void;
}) {
  const [selected, setSelected] = useState(emptyHand);
  const chosen = total(selected);
  return (
    <div className="discard-choice">
      <div className="discard-selection-heading">
        <span>Return to the bank</span>
        <strong aria-live="polite">
          {chosen} / {required}
        </strong>
      </div>
      <div className="discard-cards" role="group" aria-label="Choose cards to discard">
        {RESOURCES.map((resource) => (
          <div
            className={`discard-card resource-${resource}`}
            data-selected={selected[resource] > 0}
            key={resource}
          >
            <button
              type="button"
              className="discard-add"
              disabled={disabled || chosen >= required || selected[resource] >= hand[resource]}
              aria-label={`Discard one ${RESOURCE_NAMES[resource]}; ${selected[resource]} selected, ${hand[resource]} held`}
              onClick={() => setSelected((current) => discardChoice(current, hand, required, resource, 1))}
            >
              <ResourceIcon resource={resource} />
              <b>{selected[resource] || <Plus size={16} />}</b>
            </button>
            <small>{hand[resource] - selected[resource]} kept</small>
            <button
              type="button"
              className="discard-remove"
              disabled={disabled || !selected[resource]}
              aria-label={`Keep one ${RESOURCE_NAMES[resource]}`}
              onClick={() => setSelected((current) => discardChoice(current, hand, required, resource, -1))}
            >
              <span aria-hidden="true">−</span>
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="gold-button discard-submit"
        disabled={disabled || !validDiscard(selected, hand, required)}
        onClick={() => onDiscard(selected)}
      >
        <Check size={18} />
        {chosen === required ? `Discard ${required} cards` : `Choose ${required - chosen} more`}
      </button>
    </div>
  );
}

/** Everyone sees the blocking phase; only the player with an obligation gets controls. */
export function RobberFlow({
  room,
  me,
  selectedHex,
  onSelectHex,
  onAction,
  disabled,
  connected,
  offset,
  onWarning,
}: {
  room: RoomState;
  me?: string;
  selectedHex: number | null;
  onSelectHex: (hex: number | null) => void;
  onAction: (action: GameAction) => void;
  disabled: boolean;
  connected: boolean;
  offset?: number;
  onWarning: () => void;
}) {
  const game = room.game;
  if (!game || !['discard', 'robber'].includes(game.phase) || game.winner) return null;
  const mine = game.players[game.active]?.id === me,
    active = game.players[game.active]!;
  const required = game.discards[me ?? ''] ?? 0;
  const player = game.players.find((p) => p.id === me);
  const waiting = game.players.filter((p) => (game.discards[p.id] ?? 0) > 0);
  const choosingVictim = mine && game.phase === 'robber' && selectedHex !== null;
  const victims = choosingVictim ? robberVictims(game, me!, selectedHex) : [];
  const stage = game.phase === 'discard' ? 0 : choosingVictim ? 2 : 1;
  const headline =
    game.phase === 'discard'
      ? required
        ? `Discard ${required} cards`
        : 'Waiting for discards'
      : mine
        ? choosingVictim
          ? 'Choose who to steal from'
          : 'Move the robber'
        : `${active.name} is moving the robber`;
  return (
    <aside className={`robber-flow ${required || mine ? 'needs-you' : 'waiting'}`} aria-label="Robber status">
      <div className="robber-flow-heading">
        <GameIcon name="robber" size={29} />
        <h2 aria-live="polite">{headline}</h2>
        {!!required && (
          <TurnTimer
            room={room}
            me={me}
            discard
            connected={connected}
            offset={offset}
            onWarning={onWarning}
          />
        )}
      </div>
      <ol className="robber-steps" aria-label="Robber steps">
        {['Discard', 'Move', 'Steal'].map((label, i) => (
          <li
            key={label}
            data-current={i === stage}
            data-complete={i < stage}
            aria-current={i === stage ? 'step' : undefined}
          >
            <span>{i < stage ? <Check size={12} /> : i + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {game.phase === 'discard' ? (
        <>
          <p className="robber-explanation">
            A seven was rolled. Players with more than 7 cards return half, rounded down.
          </p>
          <div className="discard-waiting-list" aria-label="Players still discarding">
            {waiting.map((p) => {
              const seat = room.players.find((s) => s.id === p.id);
              return (
                <div
                  key={p.id}
                  className="discard-player"
                  style={
                    {
                      '--player-color': PLAYER_COLORS[game.players.findIndex((v) => v.id === p.id)],
                    } as CSSProperties
                  }
                >
                  <Avatar profile={seat?.profile ?? defaultProfile(p.name)} />
                  <strong>{p.id === me ? 'You' : p.name}</strong>
                  {seat && !seat.connected && <WifiOff size={17} aria-label="Disconnected" />}
                  <span>
                    <GameIcon name="discard" size={17} />
                    {game.discards[p.id]}
                  </span>
                </div>
              );
            })}
          </div>
          {!!required && player?.hand && (
            <DiscardCards
              key={`${room.roomId}:${game.turn}:${me}:${required}`}
              hand={player.hand}
              required={required}
              disabled={disabled}
              onDiscard={(resources) => onAction({ kind: 'discard', resources })}
            />
          )}
          <p className="robber-next">
            Then {mine ? 'you' : active.name} move{mine ? '' : 's'} the robber. Play resumes after the steal.
          </p>
        </>
      ) : mine ? (
        choosingVictim ? (
          <>
            {victims.length ? (
              <>
                <p className="robber-explanation">Move here and take one random resource card.</p>
                <div className="robber-victims">
                  {victims.map((id) => {
                    const target = game.players.find((p) => p.id === id)!;
                    const seat = room.players.find((s) => s.id === id);
                    return (
                      <button
                        type="button"
                        className="robber-victim"
                        key={id}
                        disabled={disabled}
                        onClick={() => onAction({ kind: 'robber', hex: selectedHex!, victim: id })}
                      >
                        <Avatar profile={seat?.profile ?? defaultProfile(target.name)} />
                        <span>
                          <strong>{target.name}</strong>
                          <small>{target.resourceCount ? 'Steal 1 card' : 'No cards to steal'}</small>
                        </span>
                        <GameIcon name="robber" size={22} />
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <>
                <p className="robber-explanation">
                  No opponent touches this tile. Move here without stealing.
                </p>
                <button
                  type="button"
                  className="gold-button"
                  disabled={disabled}
                  onClick={() => onAction({ kind: 'robber', hex: selectedHex! })}
                >
                  <Check size={18} />
                  Move here
                </button>
              </>
            )}
            <button
              type="button"
              className="robber-back"
              disabled={disabled}
              onClick={() => onSelectHex(null)}
            >
              Choose another tile
            </button>
          </>
        ) : (
          <p className="robber-explanation">
            Choose a highlighted tile, then an opponent beside it to steal from.
          </p>
        )
      ) : (
        <p className="robber-explanation">
          {active.name} is choosing a tile and an opponent. Play resumes after the steal.
        </p>
      )}
    </aside>
  );
}

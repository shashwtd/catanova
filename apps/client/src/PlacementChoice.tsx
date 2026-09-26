import type { Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import { GameIcon, SEA_ICONS } from './GameIcons.js';

type Piece = 'road' | 'ship';
/** An Open Sea coastal edge takes a road or a ship, one or the other (docs/RULEBOOK-OPEN-SEA.md, section 2.4). */
export type PieceChoice = {
  pieces: Piece[];
  /** What each costs, when it is bought: none in setup or from Road Building. */
  costs?: Partial<Record<Piece, Hand>>;
  onChoose: (piece: Piece) => void;
};
const NAMES: Record<Piece, string> = { road: 'Road', ship: 'Ship' };
const costText = (cost: Hand) =>
  RESOURCES.filter((r) => cost[r])
    .map((r) => `${cost[r]} ${RESOURCE_NAMES[r]}`)
    .join(', ');

/** Road or ship, inside the placement's confirmation: the one chosen is the one confirmed, and previewed on the edge. */
export function PlacementChoice({ pieces, costs, selected, onChoose }: PieceChoice & { selected: string }) {
  return (
    <span className="placement-choice" role="group" aria-label="Road or ship">
      {pieces.map((piece) => {
        const cost = costs?.[piece];
        return (
          <button
            key={piece}
            type="button"
            className="placement-option"
            data-piece={piece}
            aria-pressed={selected === piece}
            aria-label={cost ? `${NAMES[piece]}, ${costText(cost)}` : NAMES[piece]}
            onClick={() => onChoose(piece)}
          >
            <GameIcon name={piece === 'road' ? 'road' : SEA_ICONS.ship} size={20} />
            <span>{NAMES[piece]}</span>
            {cost && (
              <span className="placement-option-cost" aria-hidden="true">
                {RESOURCES.flatMap((r) =>
                  Array.from({ length: cost[r] }, (_, i) => (
                    <span key={`${r}-${i}`} data-cost-resource={r}>
                      <ResourceIcon resource={r} />
                    </span>
                  )),
                )}
              </span>
            )}
          </button>
        );
      })}
    </span>
  );
}

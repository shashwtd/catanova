import type { GameView } from '../../../packages/rules/src/game.js';
import { GameIcon, SEA_ICONS } from './GameIcons.js';

/** What Open Sea moves after a seven or a Knight: the robber or the pirate (docs/RULEBOOK-OPEN-SEA.md, 10). */
export type RobberPiece = 'robber' | 'pirate';
const PIECES = {
  robber: { title: 'Robber', line: 'Block a land tile, and rob a building beside it', icon: 'robber' },
  pirate: { title: 'Pirate', line: 'Block a sea hex, and rob a ship beside it', icon: SEA_ICONS.pirate },
} as const;
const legal = (game: GameView, piece: RobberPiece) =>
  !!(piece === 'robber' ? game.legal.robberHexes : game.legal.pirateHexes)?.length;

/**
 * The first step: two buttons made like the robber flow's victims, each with a title and a line. Only a piece
 * with somewhere to go is offered; the hexes of the one chosen become the targets on the board.
 */
export function PieceChoice({
  game,
  disabled,
  onPiece,
}: {
  game: GameView;
  disabled: boolean;
  onPiece: (piece: RobberPiece) => void;
}) {
  return (
    <>
      <p className="robber-explanation">Choose which one to move. Only one of them moves.</p>
      <div className="robber-victims" role="group" aria-label="Robber or pirate">
        {(['robber', 'pirate'] as const)
          .filter((piece) => legal(game, piece))
          .map((piece) => (
            <button
              type="button"
              className="robber-victim"
              key={piece}
              disabled={disabled}
              onClick={() => onPiece(piece)}
            >
              <GameIcon name={PIECES[piece].icon} size={39} />
              <span>
                <strong>{PIECES[piece].title}</strong>
                <small>{PIECES[piece].line}</small>
              </span>
            </button>
          ))}
      </div>
    </>
  );
}

/** Once a piece is chosen and before its hex is, the way back to the other one. */
export function PieceSwitch({
  game,
  chosen,
  disabled,
  onPiece,
}: {
  game: GameView;
  chosen: RobberPiece;
  disabled: boolean;
  onPiece: (piece: RobberPiece) => void;
}) {
  const other = chosen === 'robber' ? 'pirate' : 'robber';
  if (!legal(game, other)) return null;
  return (
    <button type="button" className="robber-back" disabled={disabled} onClick={() => onPiece(other)}>
      {`Move the ${other} instead`}
    </button>
  );
}

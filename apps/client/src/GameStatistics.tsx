import type { CSSProperties } from 'react';
import type { GameStatistics as Statistics } from '../../../packages/protocol/src/index.js';
import type { GameView } from '../../../packages/rules/src/game.js';

export const DICE_FREQUENCIES = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] as const;
export function GameStatistics({ game, statistics }: { game: GameView; statistics: Statistics | null }) {
  const counts = statistics?.diceCounts ?? Array<number>(11).fill(0);
  const rolls = statistics?.rolls ?? 0;
  const ceiling = Math.max(1, ...counts, rolls / 6);
  return (
    <section className="match-statistics" aria-label="Dice statistics">
      <div className="statistics-heading">
        <h3>Dice rolls</h3>
        <span>
          {statistics ? `${rolls} rolls` : 'Loading…'} ·{' '}
          {game.diceMode === 'balanced' ? 'Balanced' : 'Natural'}
        </span>
      </div>
      <div className="dice-histogram" role="list" aria-label="Roll count by total">
        {counts.map((count, index) => (
          <div
            key={index}
            className="dice-histogram-column"
            role="listitem"
            aria-label={`${index + 2}: ${count} rolls; expected ${((rolls * DICE_FREQUENCIES[index]!) / 36).toFixed(1)}`}
          >
            <b>{count}</b>
            <div
              className="dice-histogram-track"
              style={
                {
                  '--actual': `${(100 * count) / ceiling}%`,
                  '--expected': `${(100 * rolls * DICE_FREQUENCIES[index]!) / 36 / ceiling}%`,
                } as CSSProperties
              }
            >
              <span className="dice-histogram-bar" />
              <i className="dice-histogram-expected" />
            </div>
            <span>{index + 2}</span>
          </div>
        ))}
      </div>
      <p className="statistics-legend">
        <i /> Expected average for two dice
      </p>
      <p className="statistics-note">
        {game.diceMode === 'balanced'
          ? 'A deck of 36 dice pairs, reshuffled after 24 rolls. Recent repeats are less likely; rare totals can still be missed.'
          : 'Two independent dice. 7 is most common; 2 and 12 each have a 1 in 36 chance.'}
      </p>
    </section>
  );
}

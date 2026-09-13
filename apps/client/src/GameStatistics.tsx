import type { CSSProperties } from 'react';
import type { GameStatistics as Statistics } from '../../../packages/protocol/src/index.js';
import type { GameView } from '../../../packages/rules/src/game.js';

export const DICE_FREQUENCIES = [1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1] as const;
export function GameStatistics({ game, statistics }: { game: GameView; statistics: Statistics | null }) {
  const counts = statistics?.diceCounts ?? Array<number>(11).fill(0);
  const rolls = statistics?.rolls ?? 0;
  const ceiling = Math.max(1, ...counts, rolls / 6) * 1.08;
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
            <b>{statistics ? count : '–'}</b>
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
        <i /> Expected average · not a target for each game
      </p>
      <p className="statistics-note">
        {game.diceMode === 'balanced'
          ? 'Balanced reduces streaks. 6, 7 and 8 are still the most common totals.'
          : 'Two independent dice. 7 is most common; 2 and 12 each have a 1 in 36 chance.'}
      </p>
      <details className="statistics-method">
        <summary>How these dice work</summary>
        <p>
          {game.diceMode === 'balanced'
            ? 'We draw from the 36 possible dice pairs without replacing each pair. After 24 rolls the deck refreshes. An immediate repeat has a lower selection weight. Because 12 pairs stay undrawn, a rare total such as 2 or 12 can still be missed.'
            : 'Each roll uses two independent random numbers from 1 to 6. There are six ways to roll 7, but only one way each to roll 2 or 12. Earlier rolls do not change the next roll.'}
        </p>
      </details>
    </section>
  );
}

/**
 * A game mode's picture: a game of the mode a few turns in (mode-samples.ts, stored in mode-samples.data.ts and
 * loaded on its own when first drawn), on the mode's own board, drawn by the same Board the table uses, so the
 * picture is the game itself.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { GameView } from '../../../packages/rules/src/game.js';
import { Board } from './Board.js';
import { BOARD_THEMES } from './board-theme.js';
import { seatColorMap } from './player-colors.js';
import { hasSea, worldBox } from './scene.js';
import type { TerrainArt } from './Terrain.js';

const noop = () => {};

export const ModeBoard = memo(function ModeBoard({
  mode,
  art = BOARD_THEMES.storybook,
  className = '',
}: {
  mode: string;
  art?: TerrainArt;
  className?: string;
}) {
  const [game, setGame] = useState<GameView | null>(null);
  useEffect(() => {
    let current = true;
    void import('./mode-samples.data.js').then(({ MODE_SAMPLES }) => {
      if (current) setGame(MODE_SAMPLES[mode] ?? null);
    });
    return () => {
      current = false;
    };
  }, [mode]);
  const world = useMemo(() => game && worldBox(game.board), [game]);
  const colors = useMemo(() => seatColorMap(game?.players), [game]);
  if (!game || !world) return null;
  // A picture of the mode: its hexes, harbours and pieces are not anyone's to read out, so assistive
  // technology skips it.
  return (
    <span
      className={`mode-board ${className}`}
      data-sea={hasSea(game.board) || undefined}
      aria-hidden="true"
      inert
      style={
        {
          '--board-aspect': world.width / world.height,
          '--mode-sea': `url("${art.environment}")`,
        } as CSSProperties
      }
    >
      <Board
        board={game.board}
        game={game}
        art={art}
        colors={colors}
        mode={null}
        disabled
        onAction={noop}
        onRobber={noop}
      />
    </span>
  );
});

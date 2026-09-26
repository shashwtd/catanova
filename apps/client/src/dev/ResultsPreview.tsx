/** Local-only results preview: real components, sample scores, no match to play. */
import { useState } from 'react';
import { GameOver } from '../GameOver.js';
import { Lobby } from '../Lobby.js';
import { LoungeBackdrop } from '../LoungeBackdrop.js';
import { defaultProfile } from '../../../../packages/protocol/src/profile.js';
import type { MatchResults } from '../../../../packages/protocol/src/results.js';
import type { RoomState } from '../../../../packages/protocol/src/index.js';
import type { PlayerColor } from '../../../../packages/protocol/src/colors.js';

const seat = (name: string, avatar: number, color?: PlayerColor): RoomState['players'][number] => ({
  id: `preview-${name.toLowerCase()}`,
  name,
  ...(color ? { color } : {}),
  profile: { ...defaultProfile(name), avatar },
  ready: false,
  connected: true,
});
const piecesOf = (roads: number, settlements: number, cities: number) => ({ roads, settlements, cities });
/** `?players=5` or `?players=6` shows a Big Table's results: a long name, a short one, and a resignation. */
const size = Number(new URLSearchParams(location.search).get('players'));
const players: RoomState['players'] = [seat('Captain', 3, 'coral'), seat('Fern', 5, 'sky')];
const standings: MatchResults['game']['players'] = [
  {
    id: players[0]!.id,
    name: 'Captain',
    points: 10,
    pieces: piecesOf(12, 2, 3),
    roadLength: 9,
    knights: 1,
  },
  {
    id: players[1]!.id,
    name: 'Fern',
    points: 8,
    pieces: piecesOf(7, 3, 1),
    roadLength: 5,
    knights: 3,
  },
];
if (size === 5 || size === 6) {
  players.push(seat('Thistledown_Wayfarer', 7), seat('Juniper', 6), seat('CopperFox', 4));
  standings.push(
    {
      id: players[2]!.id,
      name: 'Thistledown_Wayfarer',
      points: 7,
      pieces: piecesOf(11, 3, 2),
      roadLength: 8,
      knights: 2,
    },
    { id: players[3]!.id, name: 'Juniper', points: 6, pieces: piecesOf(9, 4, 1), roadLength: 4, knights: 0 },
    {
      id: players[4]!.id,
      name: 'CopperFox',
      points: 4,
      pieces: piecesOf(6, 4, 0),
      roadLength: 3,
      knights: 1,
    },
  );
  if (size === 6) {
    players.push(seat('Pip', 8));
    standings.push({
      id: players[5]!.id,
      name: 'Pip',
      points: 2,
      pieces: piecesOf(4, 2, 0),
      roadLength: 2,
      knights: 0,
      resigned: true,
    });
  }
}
const results: MatchResults = {
  id: 'sample-results',
  roomId: 'preview-room',
  round: 0,
  players,
  game: {
    winner: players[0]!.id,
    turn: 84,
    longestRoad: players[0]!.id,
    largestArmy: players[1]!.id,
    players: standings,
  },
};
const room: RoomState = {
  roomId: 'preview-room',
  roomCode: 'CREW',
  revision: 1,
  counter: 0,
  round: 1,
  players,
  settings: { turnTimerSeconds: 90, diceMode: 'balanced', victoryPoints: 10 },
  previousResults: results,
};
const noop = () => {};
export function ResultsPreview() {
  const [showResults, setShowResults] = useState(true);
  return (
    <main className="game-world lobby">
      <LoungeBackdrop />
      <Lobby
        room={room}
        me={players[0]!.id}
        busy={false}
        connected={true}
        onReady={noop}
        onStart={() => setShowResults(true)}
        onInvite={noop}
        onEdit={noop}
        onSettings={noop}
        onLeave={() => location.assign('/dev/lounge')}
        onPreviousResults={() => setShowResults(true)}
        seats={size === 5 || size === 6 ? 6 : undefined}
      />
      {showResults && (
        <GameOver
          results={results}
          busy={false}
          canReturn={true}
          onReturn={() => setShowResults(false)}
          onQuit={() => location.assign('/play')}
        />
      )}
    </main>
  );
}

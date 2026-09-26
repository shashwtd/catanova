/** Local-only results preview: real components, sample scores, no match to play. */
import { useState } from 'react';
import { GameOver } from '../GameOver.js';
import { Lobby } from '../Lobby.js';
import { LoungeBackdrop } from '../LoungeBackdrop.js';
import { defaultProfile } from '../../../../packages/protocol/src/profile.js';
import type { MatchResults } from '../../../../packages/protocol/src/results.js';
import type { RoomState } from '../../../../packages/protocol/src/index.js';

const players: RoomState['players'] = [
  {
    id: 'preview-captain',
    name: 'Captain',
    color: 'coral',
    profile: { ...defaultProfile('Captain'), avatar: 3 },
    ready: false,
    connected: true,
  },
  {
    id: 'preview-fern',
    name: 'Fern',
    color: 'sky',
    profile: { ...defaultProfile('Fern'), avatar: 5 },
    ready: false,
    connected: true,
  },
];
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
    players: [
      {
        id: players[0]!.id,
        name: 'Captain',
        points: 10,
        // Named by the server, as every result is now; results saved before terms leave them out.
        terms: [
          { id: 'settlements', points: 2, count: 2 },
          { id: 'cities', points: 6, count: 3 },
          { id: 'longestRoad', points: 2, count: 1 },
        ],
        pieces: { roads: 12, settlements: 2, cities: 3 },
        roadLength: 9,
        knights: 1,
      },
      {
        id: players[1]!.id,
        name: 'Fern',
        points: 8,
        terms: [
          { id: 'settlements', points: 3, count: 3 },
          { id: 'cities', points: 2, count: 1 },
          { id: 'largestArmy', points: 2, count: 1 },
          { id: 'cards', points: 1, count: 1 },
        ],
        pieces: { roads: 7, settlements: 3, cities: 1 },
        roadLength: 5,
        knights: 3,
      },
    ],
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

/**
 * How a game went: its result and standings, points turn by turn, dice
 * against what its dice mode expects, where resources came from and went,
 * the robber, trades, development cards, the awards changing hands, and who
 * or what made the moves. Computed from the journal in the analysis worker;
 * public information only.
 */
import type { ReactNode } from 'react';
import type { AnalyticsPlayer, Cached, GameAnalytics, GameEndReason } from '../../server/src/admin/types.js';
import { RESOURCE_NAMES, RESOURCES } from '../../../packages/rules/src/index.js';
import { findRuleset, routeAwardName } from '../../../packages/rules/src/rulesets.js';
import { useApi } from '../api.js';
import { accountLabel, count, diceLabel, duration, time } from '../format.js';
import { Badge, Columns, Empty, Failure, LineChart, Loading, Section, Stat, Table, When } from '../ui.js';
import { DiceTable, expectationName, fairness, rollCount, totalLabel } from './Stats.js';
import { PairGrid, totalDice } from '../dice.js';

type Slot = 1 | 2 | 3 | 4;
/** Each player keeps one chart colour everywhere on the page, by their place in turn order. */
const slotOf = (index: number) => ((index % 4) + 1) as Slot;

const END_TEXT: Record<GameEndReason, string> = {
  points: 'reached the target',
  resignation: 'everyone else resigned',
  closedByAdmin: 'closed by the admin',
  everyoneLeft: 'every player left',
  botsOnly: 'only bots were left at the table',
  disconnected: 'nobody came back to the table',
  abandoned: 'abandoned',
};

const CARD_NAMES: Record<string, string> = {
  knight: 'Knight',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
};

const TERRAIN_NAMES: Record<string, string> = {
  ...RESOURCE_NAMES,
  desert: 'Desert',
  gold: 'Gold field',
  sea: 'Sea',
};

/** A whole-number axis for turns: about five ticks. */
function turnTicks(last: number): number[] {
  if (last <= 0) return [0];
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((candidate) => last / candidate <= 6) ?? 200;
  return Array.from({ length: Math.floor(last / step) + 1 }, (_, i) => i * step);
}

function Key({ index }: { index: number }) {
  return <i className={`swatch swatch-line line-bg-${slotOf(index)}`} aria-hidden="true" />;
}

function PlayerName({ player, index }: { player: AnalyticsPlayer; index: number }) {
  return (
    <span className="nowrap">
      <Key index={index} />{' '}
      {player.userId ? <a href={`#/players/${player.userId}`}>{player.name}</a> : player.name}
      {player.bot && <span className="muted"> · bot{player.botLevel ? ` (${player.botLevel})` : ''}</span>}
    </span>
  );
}

function resultText(game: GameAnalytics): string {
  const byId = (id: string | null) => game.players.find((player) => player.id === id)?.name ?? 'Someone';
  if (!game.end) return game.status === 'setup' ? 'Still in setup' : `Still being played, turn ${game.turns}`;
  if (game.end.reason === 'points') {
    const winner = game.players.find((player) => player.winner);
    return `${byId(game.end.winnerId)} won with ${winner?.points ?? game.victoryPoints} points`;
  }
  if (game.end.reason === 'resignation') return `${byId(game.end.winnerId)} won: everyone else resigned`;
  return `No winner: ${END_TEXT[game.end.reason]}`;
}

function Summary({ game, cachedAt }: { game: GameAnalytics; cachedAt: number }) {
  // A finished game lasted until its last move; one still being played has run until now.
  const until = game.end ? game.endedAt : Date.now();
  const knights = game.robberMoves.filter((move) => move.cause === 'knight').length;
  const trades = game.trades.length;
  const bank = game.players.reduce((sum, player) => sum + player.trades.bank, 0);
  return (
    <>
      <p className="result-line">
        <strong>{resultText(game)}</strong>
        {game.end && game.end.reason !== 'points' && <span className="muted"> · {game.end.text}</span>}
      </p>
      <div className="stats">
        <Stat
          label={game.end ? 'Lasted' : 'Running for'}
          value={game.startedAt !== null && until !== null ? duration((until - game.startedAt) / 1000) : '—'}
          hint={
            game.end || game.lastMoveAt === null ? (
              game.startedAt !== null ? (
                `from ${time(game.startedAt)}`
              ) : undefined
            ) : (
              <>
                last move <When at={game.lastMoveAt} />
              </>
            )
          }
        />
        <Stat label="Turns" value={count(game.turns)} hint={`${count(game.moves)} moves`} />
        <Stat
          label="Dice"
          value={diceLabel(game.diceMode)}
          hint={`${count(game.dice.rolls)} rolls · ${count(game.dice.sevens)} sevens`}
        />
        <Stat label="Target" value={`${game.victoryPoints} points`} />
        <Stat
          label="Player trades"
          value={count(trades)}
          hint={`${count(bank)} with the bank or a harbour`}
        />
        <Stat
          label="Robber moves"
          value={count(game.robberMoves.length)}
          hint={`${count(knights)} by a knight`}
        />
      </div>
      <p className="footnote">
        Read from the game&rsquo;s journal, moves {game.fromRevision} to {game.toRevision}, in a background
        worker at {time(cachedAt)}. What the table could see only: points count victory point cards once a
        winner revealed them.
        {game.legacy &&
          ' This game was imported from before the journal existed, so its record starts part way through.'}
        {game.unreadable > 0 && ` ${game.unreadable} saved move(s) could not be read and were left out.`}
      </p>
    </>
  );
}

function Standings({ game }: { game: GameAnalytics }) {
  const order = new Map(game.players.map((player, index) => [player.id, index]));
  const ranked = [...game.players].sort((a, b) => a.rank - b.rank);
  return (
    <Table className="compact standings">
      <thead>
        <tr>
          <th className="num">#</th>
          <th>Player</th>
          <th className="num">Points</th>
          <th className="num hide-phone">Settlements</th>
          <th className="num hide-phone">Cities</th>
          <th className="num hide-phone">Roads</th>
          <th className="num hide-phone">Knights</th>
          <th>Awards</th>
          <th className="num" title="Median time from the start of each of their turns to the next">
            Median turn
          </th>
          <th className="num" title="Moves made by the person, by a bot, and by the turn timer">
            Moves
          </th>
          <th className="hide-phone">Account</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map((player) => (
          <tr key={player.id}>
            <td className="num">{player.rank}</td>
            <td>
              <PlayerName player={player} index={order.get(player.id)!} />
              {player.winner && <span className="seat-points"> ★ winner</span>}
              {player.resigned && (
                <div className="muted small">
                  {player.resigned.how} on turn {player.resigned.turn}
                </div>
              )}
            </td>
            <td className="num">{player.points}</td>
            <td className="num hide-phone">{player.pieces.settlements}</td>
            <td className="num hide-phone">{player.pieces.cities}</td>
            <td className="num hide-phone">{player.pieces.roads}</td>
            <td className="num hide-phone">{player.knights}</td>
            <td>
              {player.longestRoad && <Badge tone="accent">{routeAwardName(findRuleset(game.ruleset))}</Badge>}
              {player.largestArmy && <Badge tone="accent">Largest Army</Badge>}
            </td>
            <td className="num nowrap">
              {player.turnTime.medianSeconds === null ? '—' : duration(player.turnTime.medianSeconds)}
              {player.turnTime.meanSeconds !== null && (
                <div className="muted small">mean {duration(player.turnTime.meanSeconds)}</div>
              )}
            </td>
            <td className="num nowrap">
              {player.moves.own + player.moves.bot + player.moves.timer}
              {(player.moves.bot > 0 || player.moves.timer > 0) && (
                <div className="muted small">
                  {player.bot
                    ? 'all by the bot'
                    : [
                        player.moves.bot ? `${player.moves.bot} by a bot` : null,
                        player.moves.timer ? `${player.moves.timer} by the timer` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                </div>
              )}
            </td>
            <td className="muted hide-phone">
              {player.bot ? 'bot' : (accountLabel(player.accountType) ?? 'local')}
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function PointsChart({ game }: { game: GameAnalytics }) {
  const last = game.points.turns.at(-1) ?? 0;
  return (
    <LineChart
      label={`Points each player had at the end of each turn, from setup (turn 0) to turn ${last}`}
      x={game.points.turns}
      series={game.players.map((player, index) => ({
        name: player.name,
        slot: slotOf(index),
        values: game.points.byPlayer[index] ?? [],
      }))}
      domain={[0, Math.max(1, last)]}
      ticks={turnTicks(last)}
      tickLabel={String}
      pointLabel={(turn) => (turn === 0 ? 'Setup' : `Turn ${turn}`)}
      format={(value) => `${value} point${value === 1 ? '' : 's'}`}
      xTitle="Turn"
      axisTitle="turn"
      yTitle="points"
      yMin={game.victoryPoints}
      integer
      step
      height={220}
    />
  );
}

function ResourceTables({ game }: { game: GameAnalytics }) {
  // Open Sea's ships are a spend of their own; other modes have no column for them.
  const ships = game.players.some((player) => player.resources.spent.ships !== undefined);
  const rows = (cells: (player: AnalyticsPlayer) => number[]) =>
    game.players.map((player, index) => {
      const values = cells(player);
      return (
        <tr key={player.id}>
          <td>
            <PlayerName player={player} index={index} />
          </td>
          {values.map((value, n) => (
            <td key={n} className="num">
              {value}
            </td>
          ))}
          <td className="num strong">{values.reduce((a, b) => a + b, 0)}</td>
        </tr>
      );
    });
  return (
    <>
      <h3>Gained</h3>
      <Table className="compact">
        <thead>
          <tr>
            <th>Player</th>
            <th className="num">From rolls</th>
            <th className="num">Setup</th>
            <th className="num">Trades</th>
            <th className="num">Bank</th>
            <th className="num" title="Year of Plenty and Monopoly">
              Cards
            </th>
            <th className="num">Stolen</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows(({ resources: { gained: g } }) => [
            g.production,
            g.setup,
            g.trades,
            g.bank,
            g.fromCards,
            g.stolen,
          ])}
        </tbody>
      </Table>
      <h3>Spent and lost</h3>
      <Table className="compact">
        <thead>
          <tr>
            <th>Player</th>
            <th className="num">Roads</th>
            {ships && <th className="num">Ships</th>}
            <th className="num">Settlements</th>
            <th className="num">Cities</th>
            <th className="num">Dev cards</th>
            <th className="num">Trades</th>
            <th className="num">Bank</th>
            <th className="num">Discarded</th>
            <th className="num">Robbed</th>
            <th className="num">Monopoly</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows(({ resources: { spent: s, lost: l } }) => [
            s.roads,
            ...(ships ? [s.ships ?? 0] : []),
            s.settlements,
            s.cities,
            s.devCards,
            s.trades,
            s.bank,
            s.discarded,
            l.robbed,
            l.monopoly,
          ])}
        </tbody>
      </Table>
      <h3>Produced by the dice, by resource</h3>
      <Table className="compact">
        <thead>
          <tr>
            <th>Player</th>
            {RESOURCES.map((resource) => (
              <th key={resource} className="num">
                {RESOURCE_NAMES[resource]}
              </th>
            ))}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>{rows(({ resources }) => RESOURCES.map((resource) => resources.produced[resource]))}</tbody>
      </Table>
      <p className="footnote">
        Cards, counted. Which resource a steal took is not shown: only the two players involved saw it.
      </p>
    </>
  );
}

function Interactions({ game }: { game: GameAnalytics }) {
  const name = (id: string | null) => game.players.find((player) => player.id === id)?.name ?? '—';
  return (
    <>
      <Table className="compact">
        <thead>
          <tr>
            <th>Player</th>
            <th className="num" title="Sevens this player rolled">
              Sevens
            </th>
            <th className="num">Robber moves</th>
            <th className="num">Steals</th>
            <th className="num">Robbed</th>
            <th className="num">Trades</th>
            <th className="num">Offers</th>
            <th className="num">Bank</th>
            <th className="num">Cards bought</th>
            <th>Cards played</th>
          </tr>
        </thead>
        <tbody>
          {game.players.map((player, index) => (
            <tr key={player.id}>
              <td>
                <PlayerName player={player} index={index} />
              </td>
              <td className="num">{player.robber.sevens}</td>
              <td className="num">{player.robber.moves}</td>
              <td className="num">{player.robber.steals}</td>
              <td className="num">{player.robber.robbed}</td>
              <td className="num">{player.trades.withPlayers}</td>
              <td className="num">{player.trades.offers}</td>
              <td className="num">{player.trades.bank}</td>
              <td className="num">{player.devCards.bought}</td>
              <td>
                {Object.entries(player.devCards.played)
                  .map(([kind, n]) => `${n} ${CARD_NAMES[kind] ?? kind}`)
                  .join(', ') || <span className="muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {game.robberMoves.length > 0 && (
        <details className="chart-table">
          <summary>Every robber move ({game.robberMoves.length})</summary>
          <div className="chart-table-scroll">
            <table className="compact">
              <thead>
                <tr>
                  <th className="num">Turn</th>
                  <th>Moved by</th>
                  <th>To</th>
                  <th>Took a card from</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {game.robberMoves.map((move, index) => (
                  <tr key={index}>
                    <td className="num">{move.turn}</td>
                    <td>{name(move.playerId)}</td>
                    <td>
                      {move.piece === 'pirate'
                        ? 'The pirate, to the sea'
                        : (TERRAIN_NAMES[move.terrain] ?? move.terrain)}
                      {move.number !== null && ` ${move.number}`}
                    </td>
                    <td>
                      {move.victimId ? (
                        <>
                          {name(move.victimId)}
                          {!move.stole && <span className="muted"> (had no cards)</span>}
                        </>
                      ) : (
                        <span className="muted">nobody</span>
                      )}
                    </td>
                    <td>{move.cause === 'knight' ? 'a knight' : 'a seven'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {game.trades.length > 0 && (
        <details className="chart-table">
          <summary>Every trade between players ({game.trades.length})</summary>
          <ul className="plain">
            {game.trades.map((trade, index) => (
              <li key={index}>
                <span className="muted">Turn {trade.turn}</span> · {trade.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function Awards({ game }: { game: GameAnalytics }) {
  const name = (id: string | null) => game.players.find((player) => player.id === id)?.name ?? 'nobody';
  const route = routeAwardName(findRuleset(game.ruleset));
  if (!game.awards.length) return <Empty>Nobody held {route} or Largest Army.</Empty>;
  return (
    <ul className="plain">
      {game.awards.map((award, index) => (
        <li key={index}>
          <span className="muted">Turn {award.turn}</span> ·{' '}
          {award.award === 'longestRoad' ? route : 'Largest Army'}:{' '}
          {award.playerId ? (
            <>
              {name(award.playerId)} took it{award.fromId ? ` from ${name(award.fromId)}` : ''}
            </>
          ) : (
            <>{name(award.fromId)} lost it, and nobody holds it</>
          )}
        </li>
      ))}
    </ul>
  );
}

function Bots({ game }: { game: GameAnalytics }) {
  const lines: ReactNode[] = [];
  game.players.forEach((player, index) => {
    const moves = player.moves.own + player.moves.bot + player.moves.timer;
    if (player.bot)
      lines.push(
        <li key={player.id}>
          <PlayerName player={player} index={index} /> is a bot and made all {moves} of its moves.
        </li>,
      );
    else if (player.moves.bot || player.standIns || player.moves.timer)
      lines.push(
        <li key={player.id}>
          <PlayerName player={player} index={index} />:{' '}
          {[
            player.standIns
              ? `a bot took the seat ${player.standIns === 1 ? 'once' : `${player.standIns} times`} while they were away`
              : null,
            player.moves.bot ? `a bot made ${player.moves.bot} of their ${moves} moves` : null,
            player.turnTime.botTurns
              ? `(${player.turnTime.botTurns} turns left out of their turn times)`
              : null,
            player.moves.timer
              ? `the turn timer moved for them ${player.moves.timer === 1 ? 'once' : `${player.moves.timer} times`}`
              : null,
          ]
            .filter(Boolean)
            .join('; ')}
          .
        </li>,
      );
  });
  if (!lines.length)
    return <Empty>Everyone played every move themselves; the turn timer never had to.</Empty>;
  return <ul className="plain">{lines}</ul>;
}

/** How a game went: the room's current game, or one of its earlier rounds. */
export function GameAnalyticsView({
  roomId,
  round,
  live,
}: {
  roomId: string;
  round?: string;
  /** Refreshes while the game is being played. */
  live: boolean;
}) {
  const path = `/api/admin/games/${encodeURIComponent(roomId)}/analytics${round ? `?round=${round}` : ''}`;
  const { data, error, reload } = useApi<Cached<GameAnalytics>>(path, live ? 30_000 : undefined);
  if (!data)
    return (
      <Section title="How the game went" className="wide">
        {error ? <Failure error={error} retry={reload} /> : <Loading label="Reading the game’s journal…" />}
      </Section>
    );
  const game = data.value;
  return (
    <>
      <Section title="How the game went" className="wide">
        <Summary game={game} cachedAt={data.cachedAt} />
      </Section>
      <Section title="Standings" className="wide">
        <Standings game={game} />
        <p className="footnote">
          Pieces on the board at the end. A turn lasts from its first move to the next turn&rsquo;s; turn
          times leave out turns a bot played for someone who was away.
        </p>
      </Section>
      <Section title="Points by turn" className="wide">
        <PointsChart game={game} />
      </Section>
      <Section title={`Dice (${count(game.dice.rolls)} rolls)`} className="wide">
        {game.dice.rolls ? (
          <>
            <div className="duo dice-views">
              <div>
                <h3>Totals</h3>
                <Columns
                  label={`Rolls of each total in this game, against ${expectationName(game.dice).toLowerCase()}`}
                  categories={Array.from({ length: 11 }, (_, i) => String(i + 2))}
                  pointLabel={totalLabel}
                  format={rollCount}
                  series={[{ name: 'Rolled', slot: 1, values: game.dice.counts }]}
                  reference={{ name: expectationName(game.dice), values: game.dice.expected }}
                  below={totalDice((i) => i + 2)}
                  height={230}
                />
                <p className="muted small">{fairness(game.dice)}</p>
              </div>
              {game.dice.pairs && (
                <div>
                  <h3>Which pairs came up</h3>
                  <PairGrid
                    dice={game.dice}
                    label="How often each pair of dice came up in this game, first die by second"
                  />
                </div>
              )}
            </div>
            <DiceTable dice={game.dice} />
          </>
        ) : (
          <Empty>No dice rolled yet.</Empty>
        )}
      </Section>
      <div className="grid">
        <Section title={`${routeAwardName(findRuleset(game.ruleset))} and Largest Army`}>
          <Awards game={game} />
        </Section>
        <Section title="Bots, stand-ins and the turn timer">
          <Bots game={game} />
        </Section>
      </div>
      <Section title="Resources" className="wide">
        <ResourceTables game={game} />
      </Section>
      <Section title="Robber, trades and development cards" className="wide">
        <Interactions game={game} />
      </Section>
    </>
  );
}

/** An earlier round of a room, on its own page: how it went, and a way back to the room. */
export function GameRound({ roomId, round }: { roomId: string; round: string }) {
  const { data } = useApi<Cached<GameAnalytics>>(
    `/api/admin/games/${encodeURIComponent(roomId)}/analytics?round=${round}`,
  );
  const game = data?.value;
  return (
    <div className="stack">
      <p>
        <a href={`#/games/${roomId}`}>← The room now</a>
      </p>
      <div className="title-row">
        <h1 className="mono">{game?.roomCode ?? roomId.slice(0, 8)}</h1>
        <Badge>earlier round</Badge>
      </div>
      <p className="muted">
        A game this room played before it returned to its lobby
        {game?.startedAt ? (
          <>
            , started <When at={game.startedAt} />
          </>
        ) : null}
        .
      </p>
      <GameAnalyticsView roomId={roomId} round={round} live={false} />
    </div>
  );
}

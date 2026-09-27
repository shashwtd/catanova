import type { ReactNode } from 'react';
import type { HistoryEntry } from '../../../packages/protocol/src/index.js';
import { pips } from '../../../packages/rules/src/board.js';
import type { Board as Island, Hex, Port } from '../../../packages/rules/src/board.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import { RESOURCE_NAMES, RESOURCES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import {
  ArrowRight,
  Castle,
  Clock3,
  Dices,
  GameIcon,
  House,
  Layers,
  Route,
  ScrollText,
  SEA_ICONS,
  Shield,
} from './GameIcons.js';
import type { GameIconName, IconProps } from './GameIcons.js';

/**
 * Open Sea's words in the log (docs/RULEBOOK-OPEN-SEA.md, section 14), with the icon each takes: a ship stands for
 * itself like a road, and the others keep their word beside their icon, as the awards do.
 */
const SEA_WORDS: Record<string, { icon: GameIconName; word: boolean }> = {
  ship: { icon: SEA_ICONS.ship, word: false },
  pirate: { icon: SEA_ICONS.pirate, word: true },
  gold: { icon: SEA_ICONS.gold, word: true },
  'new island': { icon: SEA_ICONS.islandBonus, word: true },
};
const seaIcon = (name: GameIconName) => (props: IconProps) => <GameIcon name={name} {...props} />;
/** Open Sea's moves, each with its icon: a ship built, a ship moved, the pirate, and a pick from a gold field. */
const SEA_MOVES = new Map([
  ['ship', seaIcon(SEA_ICONS.ship)],
  ['moveShip', seaIcon('move-ship')],
  ['pirate', seaIcon(SEA_ICONS.pirate)],
  ['goldPick', seaIcon(SEA_ICONS.gold)],
]);

/** A corner or an edge of the board, as a line in the history names one. */
export type BoardPlace = { vertex: number } | { edge: number };

/**
 * What a place touches, as players read the board: the land tiles it takes from, the likeliest number first, and
 * the harbour at a corner. An edge out at sea, touching no land, names the land at its two ends instead (`near`).
 * Null for a place this board does not have.
 */
export function placeTiles(
  board: Island,
  place: BoardPlace,
): { tiles: Hex[]; harbour: Port | null; near: boolean } | null {
  const land = (ids: Iterable<number>) =>
    [...ids].map((id) => board.hexes[id]!).filter((hex) => hex && hex.terrain !== 'sea');
  const order = (tiles: Hex[]) =>
    tiles.sort((a, b) => pips(b.number) - pips(a.number) || b.number - a.number || a.id - b.id);
  if ('vertex' in place) {
    const vertex = board.vertices[place.vertex];
    if (!vertex) return null;
    const harbour =
      board.ports.find((port) => {
        const edge = board.edges[port.edge];
        return edge && (edge.a === place.vertex || edge.b === place.vertex);
      }) ?? null;
    return { tiles: order(land(vertex.hexes)), harbour, near: false };
  }
  const edge = board.edges[place.edge];
  if (!edge) return null;
  const own = land(edge.hexes);
  if (own.length) return { tiles: order(own), harbour: null, near: false };
  const ends = new Set([...(board.vertices[edge.a]?.hexes ?? []), ...(board.vertices[edge.b]?.hexes ?? [])]);
  return { tiles: order(land(ends)), harbour: null, near: true };
}

const tileName = (hex: Hex) =>
  hex.terrain === 'desert'
    ? 'Desert'
    : `${hex.terrain === 'gold' ? 'Gold field' : RESOURCE_NAMES[hex.terrain as Resource]} ${hex.number}`;

/** A place as a row of the tiles it touches, each with its number token; hovering or tapping it shows it on the board. */
function Place({
  board,
  place,
  onPlace,
}: {
  board: Island;
  place: BoardPlace;
  onPlace?: PlaceHandler | undefined;
}) {
  const found = placeTiles(board, place)!;
  const names = found.tiles.map(tileName);
  const harbour = found.harbour
    ? found.harbour.resource === 'any'
      ? '3:1 harbour'
      : `2:1 ${RESOURCE_NAMES[found.harbour.resource]} harbour`
    : null;
  const label = names.length
    ? `${found.near ? 'Near ' : ''}${names.join(', ')}${harbour ? `, at a ${harbour}` : ''}`
    : 'Open sea';
  const contents = (
    <>
      {found.near && <span className="journal-place-word">near</span>}
      {found.tiles.map((hex) => (
        <span key={hex.id} className="journal-tile" data-terrain={hex.terrain}>
          {hex.terrain === 'gold' ? (
            <GameIcon name={SEA_ICONS.gold} />
          ) : (RESOURCES as readonly string[]).includes(hex.terrain) ? (
            <ResourceIcon resource={hex.terrain as Resource} />
          ) : (
            <span className="journal-place-word">desert</span>
          )}
          {hex.number > 0 && (
            <i className={`journal-number ${[6, 8].includes(hex.number) ? 'journal-number-red' : ''}`}>
              {hex.number}
            </i>
          )}
        </span>
      ))}
      {found.harbour && (
        <span className="journal-harbour">
          {found.harbour.resource === 'any' ? '3:1' : '2:1'}
          {found.harbour.resource !== 'any' && <ResourceIcon resource={found.harbour.resource} />}
        </span>
      )}
      {!names.length && <span className="journal-place-word">open sea</span>}
    </>
  );
  if (!onPlace)
    return (
      <span className="journal-place" role="img" aria-label={label}>
        {contents}
      </span>
    );
  return (
    <button
      type="button"
      className="journal-place"
      aria-label={`${label}. Show on the board`}
      title="Show on the board"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') onPlace(place);
      }}
      onFocus={() => onPlace(place)}
      onClick={() => onPlace(place, true)}
    >
      {contents}
    </button>
  );
}

/**
 * Shows a place on the board, or stops showing it. `tapped` asks for a look at the board itself: on a phone the
 * history covers it, so the history steps aside for the moment the place is shown.
 */
export type PlaceHandler = (place: BoardPlace | null, tapped?: boolean) => void;

/** A corner or edge the rules engine named by its number, the way the log has always written it. */
const PLACE = / at corner (\d+)| on edge (\d+)| from edge (\d+) to edge (\d+)/g;

export function historyTurns(entries: readonly HistoryEntry[]) {
  const groups = new Map<number, HistoryEntry[]>();
  for (const entry of [...new Map(entries.map((e) => [e.revision, e])).values()].sort(
    (a, b) => b.revision - a.revision,
  )) {
    const group = groups.get(entry.turn) ?? [];
    group.push(entry);
    groups.set(entry.turn, group);
  }
  return [...groups].map(([turn, moves]) => ({ turn, moves }));
}
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/**
 * Only canonical actor and recipient positions name a player; payment tokens stay resources. Given the board, a
 * corner or edge the line names by number becomes the tiles it touches.
 */
export function historyTokens(
  line: string,
  names: readonly string[],
  places?: { board: Island; onPlace?: PlaceHandler | undefined },
): ReactNode[] {
  const people = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const actor = people.find(
    (name) =>
      line.startsWith(name) &&
      /^(?: (?:is willing|declined|placed|built|bought|rolled|offered|traded|proposed|withdrew|played|collected|received|moved|discarded|took|claimed|settled|wins|begins)\b|'s (?:turn|timer|build window)\b)/.test(
        line.slice(name.length),
      ),
  );
  const spans: { at: number; name: string }[] = actor ? [{ at: 0, name: actor }] : [];
  if (actor) {
    const body = line.slice(actor.length);
    for (const name of people) {
      let at = -1;
      if (body.startsWith(' traded ')) {
        const marker = ` to ${name} for `,
          index = body.indexOf(marker);
        if (index >= 0) at = actor.length + index + 4;
      } else if (body.startsWith(' proposed ')) {
        const marker = ` for ${name}'s `,
          index = body.indexOf(marker);
        if (index >= 0) at = actor.length + index + 5;
      } else if (body === ` moved the robber and stole a card from ${name}.`)
        at = actor.length + ' moved the robber and stole a card from '.length;
      else if (body === ` is willing to trade with ${name}.`)
        at = actor.length + ' is willing to trade with '.length;
      else if (body === ` moved the robber. ${name} had no resource cards.`)
        at = actor.length + ' moved the robber. '.length;
      else if (body.startsWith(`'s turn, with ${name} as Partner.`))
        at = actor.length + "'s turn, with ".length;
      else if (body === ` moved the pirate and stole a card from ${name}.`)
        at = actor.length + ' moved the pirate and stole a card from '.length;
      else if (body === ` moved the pirate. ${name} had no resource cards.`)
        at = actor.length + ' moved the pirate. '.length;
      if (at >= 0) {
        spans.push({ at, name });
        break;
      }
    }
  }
  const resourceNames = Object.values(RESOURCE_NAMES);
  const pattern = new RegExp(
    `\\b(\\d+) (${resourceNames.map(escaped).join('|')})\\b|\\b(Longest Road|Longest Route|Largest Army|settlement|city|road|development card|ship|pirate|gold|new island)\\b`,
    'g',
  );
  const parts: ReactNode[] = [];
  const words = (text: string, offset: number) => {
    let cursor = 0;
    for (const match of text.matchAll(pattern)) {
      const at = match.index!;
      if (at > cursor) parts.push(text.slice(cursor, at));
      if (match[1] && match[2]) {
        const resource = (Object.keys(RESOURCE_NAMES) as Resource[]).find(
          (r) => RESOURCE_NAMES[r] === match[2],
        )!;
        parts.push(
          <span
            key={offset + at}
            className="journal-resource"
            role="img"
            aria-label={`${match[1]} ${match[2]}`}
          >
            <ResourceIcon resource={resource} />
            <b>{match[1]}</b>
          </span>,
        );
      } else {
        const word = match[3]!,
          sea = SEA_WORDS[word],
          Icon =
            word === 'settlement'
              ? House
              : word === 'city'
                ? Castle
                : word === 'road' || word === 'Longest Road' || word === 'Longest Route'
                  ? Route
                  : word === 'Largest Army'
                    ? Shield
                    : ScrollText;
        parts.push(
          <span key={offset + at} className="journal-item" role="img" aria-label={word}>
            {sea ? <GameIcon name={sea.icon} /> : <Icon />}
            <span>
              {sea?.word || word === 'Longest Road' || word === 'Longest Route' || word === 'Largest Army'
                ? word
                : null}
            </span>
          </span>,
        );
      }
      cursor = at + match[0].length;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
  };
  const place = (key: number, found: BoardPlace) => (
    <Place key={key} board={places!.board} place={found} onPlace={places!.onPlace} />
  );
  const known = (found: BoardPlace) => !!places && !!placeTiles(places.board, found);
  const tokens = (text: string, offset: number) => {
    let cursor = 0;
    for (const match of text.matchAll(PLACE)) {
      const at = match.index!;
      const [vertex, edge, from, to] = match.slice(1).map((n) => (n === undefined ? undefined : Number(n) - 1));
      const found: BoardPlace[] =
        vertex !== undefined
          ? [{ vertex }]
          : edge !== undefined
            ? [{ edge }]
            : [{ edge: from! }, { edge: to! }];
      if (!found.every(known)) continue;
      words(text.slice(cursor, at), offset + cursor);
      const key = offset + at;
      cursor = at + match[0].length;
      // The full stop after a place stays on its line.
      const stop = /^[.,;]/.exec(text.slice(cursor))?.[0] ?? '';
      cursor += stop.length;
      const last = (
        <span key={`end-${key}`} className="journal-place-end">
          {place(key + 1, found.at(-1)!)}
          {stop}
        </span>
      );
      if (vertex !== undefined) parts.push(' on ', last);
      else if (edge !== undefined) parts.push(' by ', last);
      else parts.push(' from ', place(key, found[0]!), ' to ', last);
    }
    words(text.slice(cursor), offset + cursor);
  };
  let cursor = 0;
  for (const span of spans) {
    tokens(line.slice(cursor, span.at), cursor);
    parts.push(
      <strong key={span.at} className="journal-person">
        {span.name}
      </strong>,
    );
    cursor = span.at + span.name.length;
  }
  tokens(line.slice(cursor), cursor);
  return parts;
}
function Move({
  entry,
  names,
  places,
}: {
  entry: HistoryEntry;
  names: string[];
  places: { board: Island; onPlace?: PlaceHandler | undefined };
}) {
  const Icon =
    SEA_MOVES.get(entry.kind) ??
    (entry.kind === 'road'
      ? Route
      : entry.kind === 'settlement'
        ? House
        : entry.kind === 'city'
          ? Castle
          : entry.kind === 'roll'
            ? Dices
            : entry.kind === 'buyCard' || entry.kind === 'playCard'
              ? ScrollText
              : entry.kind === 'endTurn' || entry.kind === 'endPhase' || entry.kind === 'endWindow'
                ? ArrowRight
                : /trade|proposal/i.test(entry.kind)
                  ? null
                  : entry.kind === 'discard'
                    ? Layers
                    : null);
  return (
    <li className={`journal-move ${!Icon && !entry.automatic ? 'journal-note' : ''}`}>
      {(Icon || entry.automatic) && (
        <span className="journal-action">
          {Icon && <Icon />}
          {entry.automatic && (
            <span
              className="automatic-mark"
              role="img"
              aria-label={
                entry.kind === 'resign' ? 'Automatic resignation after disconnect' : 'Automatic timer move'
              }
            >
              <Clock3 />
            </span>
          )}
        </span>
      )}
      <div className="journal-lines">
        {entry.lines.map((line, i) => (
          <p key={i}>{historyTokens(line, names, places)}</p>
        ))}
      </div>
    </li>
  );
}
export function MoveHistory({
  entries,
  game,
  hasMore,
  onEarlier,
  onPlace,
}: {
  entries: HistoryEntry[];
  game: GameView;
  hasMore: boolean;
  onEarlier: () => void;
  /** Shows a place a move names on the board, or stops showing it. */
  onPlace?: PlaceHandler;
}) {
  const names = game.players.map((p) => p.name);
  const places = { board: game.board, onPlace };
  return (
    <div className="turn-journal">
      {!entries.length && !game.log.length && (
        <p className="journal-empty">Moves and resource gains will appear here.</p>
      )}
      {entries.length ? (
        historyTurns(entries).map((group) => (
          <section className="journal-turn" key={group.turn}>
            <h3>{group.turn ? `Turn ${group.turn}` : 'Island setup'}</h3>
            <ol>
              {group.moves.map((entry) => (
                <Move key={entry.revision} entry={entry} names={names} places={places} />
              ))}
            </ol>
          </section>
        ))
      ) : (
        <section className="journal-turn">
          <h3>Recent moves</h3>
          <ol>
            {game.log
              .slice()
              .reverse()
              .map((e) => (
                <li className="journal-move journal-note" key={e.id}>
                  <p>{historyTokens(e.text, names, places)}</p>
                </li>
              ))}
          </ol>
        </section>
      )}
      {hasMore && (
        <button className="dark-button history-more" onClick={onEarlier}>
          Earlier turns
        </button>
      )}
    </div>
  );
}

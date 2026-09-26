import type { ReactNode } from 'react';
import type { HistoryEntry } from '../../../packages/protocol/src/index.js';
import type { GameView } from '../../../packages/rules/src/game.js';
import { RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import { ArrowRight, Castle, Clock3, Dices, House, Layers, Route, ScrollText, Shield } from './GameIcons.js';

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
/** Only canonical actor and recipient positions name a player; payment tokens stay resources. */
export function historyTokens(line: string, names: readonly string[]): ReactNode[] {
  const people = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  const actor = people.find(
    (name) =>
      line.startsWith(name) &&
      /^(?: (?:is willing|declined|placed|built|bought|rolled|offered|traded|proposed|withdrew|played|collected|received|moved|discarded|took|claimed|wins|begins)\b|'s (?:turn|timer|build window)\b)/.test(
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
      if (at >= 0) {
        spans.push({ at, name });
        break;
      }
    }
  }
  const resourceNames = Object.values(RESOURCE_NAMES);
  const pattern = new RegExp(
    `\\b(\\d+) (${resourceNames.map(escaped).join('|')})\\b|\\b(Longest Road|Longest Route|Largest Army|settlement|city|road|development card)\\b`,
    'g',
  );
  const parts: ReactNode[] = [];
  const tokens = (text: string, offset: number) => {
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
            <Icon />
            <span>
              {word === 'Longest Road' || word === 'Longest Route' || word === 'Largest Army' ? word : null}
            </span>
          </span>,
        );
      }
      cursor = at + match[0].length;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
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
function Move({ entry, names }: { entry: HistoryEntry; names: string[] }) {
  const Icon =
    entry.kind === 'road'
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
                    : null;
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
          <p key={i}>{historyTokens(line, names)}</p>
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
}: {
  entries: HistoryEntry[];
  game: GameView;
  hasMore: boolean;
  onEarlier: () => void;
}) {
  const names = game.players.map((p) => p.name);
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
                <Move key={entry.revision} entry={entry} names={names} />
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
                  <p>{historyTokens(e.text, names)}</p>
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

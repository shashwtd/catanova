import { useEffect, useState } from 'react';
import { Check, Clock3, LockKeyhole, Play, ScrollText, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { CARD_NAMES, canPay, emptyHand, total } from '../../../packages/rules/src/game.js';
import type { Card, CardKind, GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import { CardTooltip } from './CardTooltip.js';
import { CARD_LORE, DEVELOPMENT_ART_INDEX, cardLockReason } from './cards.js';
const ART_COLUMNS = [0, 419, 835, 1254],
  ART_ROWS = [0, 628, 1254];
export function DevelopmentArt({ kind }: { kind: CardKind | 'back' }) {
  const n = kind === 'back' ? 5 : DEVELOPMENT_ART_INDEX[kind],
    col = n % 3,
    row = Math.floor(n / 3),
    x = ART_COLUMNS[col]!,
    y = ART_ROWS[row]!;
  return (
    <svg
      className="development-art"
      viewBox={`${x} ${y} ${ART_COLUMNS[col + 1]! - x} ${ART_ROWS[row + 1]! - y}`}
      aria-hidden="true"
    >
      <image href="/art/development-cards.png" width="1254" height="1254" />
    </svg>
  );
}
/** Identical cards share one stack; the first currently playable copy is selected. */
export function developmentStacks(cards: readonly Card[], game: GameView, me: string) {
  return Object.keys(DEVELOPMENT_ART_INDEX).flatMap((kind) => {
    const copies = cards.filter((c) => c.kind === kind);
    if (!copies.length) return [];
    const ready = copies.filter((c) => !cardLockReason(c, game, me));
    return [
      {
        card: ready[0] ?? copies[0]!,
        count: copies.length,
        ready: ready.length,
        fresh: copies.filter((c) => c.kind !== 'victoryPoint' && c.boughtTurn === game.turn).length,
      },
    ];
  });
}
export function DevelopmentCards({
  game,
  me,
  disabled,
  reducedMotion,
  onAction,
  onClose,
  onHover,
}: {
  game: GameView;
  me: string;
  disabled: boolean;
  reducedMotion: boolean;
  onAction: (action: GameAction) => void;
  onClose: () => void;
  onHover: () => void;
}) {
  const cards = game.players.find((p) => p.id === me)?.cards ?? [],
    [selected, setSelected] = useState<string | null>(null),
    [resource, setResource] = useState<Resource>('wood'),
    [take, setTake] = useState<Hand>(emptyHand);
  const stacks = developmentStacks(cards, game, me);
  const card = cards.find((c) => c.id === selected),
    reason = card ? cardLockReason(card, game, me) : null;
  useEffect(() => {
    if (!cards.some((c) => c.id === selected)) setSelected(null);
  }, [cards.map((c) => c.id).join('|'), selected]);
  function choose(id: string) {
    setSelected(id);
    setTake(emptyHand());
  }
  function play() {
    if (
      !card ||
      reason ||
      disabled ||
      (card.kind === 'yearOfPlenty' &&
        (!canPay(game.bank, take) || total(take) !== Math.min(2, total(game.bank)) || !total(take)))
    )
      return;
    onAction({
      kind: 'playCard',
      cardId: card.id,
      ...(card.kind === 'monopoly' ? { resource } : card.kind === 'yearOfPlenty' ? { resources: take } : {}),
    });
  }
  return (
    <section className="development-spread floating-panel" aria-label="Development cards">
      <div className="panel-heading">
        <h2>
          <ScrollText size={18} />
          Your development cards
        </h2>
        <button className="icon-button" aria-label="Close development cards" onClick={onClose}>
          <X />
        </button>
      </div>
      {cards.length ? (
        <>
          <div className="development-fan">
            {stacks.map((stack, i) => {
              const c = stack.card;
              const lock = cardLockReason(c, game, me),
                lore = CARD_LORE[c.kind];
              return (
                <div
                  className={`development-slot ${selected === c.id ? 'selected' : ''}`}
                  key={c.kind}
                  style={
                    {
                      '--dev-angle': `${Math.max(-5, Math.min(5, (i - (stacks.length - 1) / 2) * 2))}deg`,
                    } as CSSProperties
                  }
                >
                  <CardTooltip
                    disabledMotion={reducedMotion || !!lock}
                    onHover={onHover}
                    content={
                      <>
                        <DevelopmentArt kind={c.kind} />
                        <strong>{CARD_NAMES[c.kind]}</strong>
                        {stack.count > 1 && (
                          <span>
                            {stack.count} cards{stack.ready ? ` · ${stack.ready} playable` : ''}
                            {stack.fresh ? ` · ${stack.fresh} next turn` : ''}
                          </span>
                        )}
                        <em>{lore.story}</em>
                        <span>{lore.effect}</span>
                        {lock && <b className="card-lock-message">{lock}</b>}
                      </>
                    }
                  >
                    <button
                      className={`development-card t-tilt-card ${lock ? 'resting-card' : 'playable-card'} ${c.kind === 'victoryPoint' ? 'victory-card' : ''}`}
                      aria-pressed={selected === c.id}
                      aria-label={`${CARD_NAMES[c.kind]}${stack.count > 1 ? ` × ${stack.count}` : ''}. ${lock ?? 'Choose card to play'}`}
                      onClick={() => choose(c.id)}
                    >
                      <DevelopmentArt kind={c.kind} />
                      {stack.count > 1 && <span className="development-count">×{stack.count}</span>}
                      <span className="development-title">{CARD_NAMES[c.kind]}</span>
                      <span className="development-status">
                        {c.kind === 'victoryPoint' ? (
                          <>
                            <Check size={11} />
                            +1 point
                          </>
                        ) : lock ? (
                          <>
                            <Clock3 size={11} />
                            Held
                          </>
                        ) : (
                          <>
                            <Play size={11} />
                            Playable
                          </>
                        )}
                      </span>
                      <span className="t-tilt-glare" />
                    </button>
                  </CardTooltip>
                </div>
              );
            })}
          </div>
          {card ? (
            <div className="development-detail">
              <div className="development-explanation">
                <span className="field-caption">{CARD_LORE[card.kind].title}</span>
                <h3>{CARD_NAMES[card.kind]}</h3>
                <p>{CARD_LORE[card.kind].effect}</p>
                {reason && (
                  <div className="card-unavailable">
                    <LockKeyhole size={14} />
                    {reason}
                  </div>
                )}
              </div>
              {!reason && (
                <div className="development-choice">
                  {card.kind === 'monopoly' && (
                    <>
                      <span className="field-caption">Choose a resource</span>
                      <div className="development-resources">
                        {RESOURCES.map((r) => (
                          <button
                            key={r}
                            aria-label={RESOURCE_NAMES[r]}
                            aria-pressed={resource === r}
                            onClick={() => setResource(r)}
                          >
                            <ResourceIcon resource={r} />
                            <span>{RESOURCE_NAMES[r]}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {card.kind === 'yearOfPlenty' && (
                    <>
                      <span className="field-caption">
                        Choose {Math.min(2, total(game.bank))} from the bank
                      </span>
                      <div className="development-resources">
                        {RESOURCES.map((r) => (
                          <button
                            key={r}
                            aria-label={`Choose ${RESOURCE_NAMES[r]}, ${take[r]} selected, ${game.bank[r]} available`}
                            aria-pressed={take[r] > 0}
                            disabled={take[r] >= game.bank[r] || total(take) >= Math.min(2, total(game.bank))}
                            onClick={() => setTake((h) => ({ ...h, [r]: h[r] + 1 }))}
                          >
                            <ResourceIcon resource={r} />
                            <span>{take[r] ? `${take[r]} selected` : RESOURCE_NAMES[r]}</span>
                          </button>
                        ))}
                      </div>
                      <div className="plenty-picked">
                        {RESOURCES.filter((r) => take[r] > 0).map((r) => (
                          <button
                            key={r}
                            onClick={() => setTake((h) => ({ ...h, [r]: h[r] - 1 }))}
                            title="Remove one selected card"
                          >
                            <ResourceIcon resource={r} />
                            {take[r]} · {RESOURCE_NAMES[r]} <X size={12} />
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                  {card.kind === 'yearOfPlenty' && !canPay(game.bank, take) && (
                    <div className="card-unavailable">
                      <span role="status">The bank changed.</span>
                      <button className="text-button" onClick={() => setTake(emptyHand())}>
                        Choose again
                      </button>
                    </div>
                  )}
                  <button
                    className="gold-button"
                    disabled={
                      disabled ||
                      (card.kind === 'yearOfPlenty' &&
                        (!canPay(game.bank, take) ||
                          total(take) !== Math.min(2, total(game.bank)) ||
                          !total(take)))
                    }
                    onClick={play}
                  >
                    <Play size={15} />
                    Play {CARD_NAMES[card.kind]}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="spread-hint">Choose a card.</p>
          )}
        </>
      ) : (
        <div className="empty-development">
          <DevelopmentArt kind="back" />
          <p>No development cards yet.</p>
          <span>Buy a development card with Sheep, Hay, and Rock.</span>
        </div>
      )}
    </section>
  );
}

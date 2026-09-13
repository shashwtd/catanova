import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GameIcon, Check, Clock3, LockKeyhole, Play, X } from './GameIcons.js';
import type { CSSProperties } from 'react';
import { CARD_NAMES, canPay, emptyHand, total } from '../../../packages/rules/src/game.js';
import type { Card, CardKind, GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ResourceIcon } from './Board.js';
import { CardTooltip } from './CardTooltip.js';
import { CARD_LORE, DEVELOPMENT_ART_INDEX, cardLockReason } from './cards.js';
import { fitFloatingPanel } from './floating-panel.js';
const ART_COLUMNS = [0, 418, 836, 1254],
  ART_ROWS = [0, 627, 1254];
export function DevelopmentArt({ kind }: { kind: CardKind | 'back' }) {
  const clip = useId();
  const n = kind === 'back' ? 5 : DEVELOPMENT_ART_INDEX[kind],
    col = n % 3,
    row = Math.floor(n / 3),
    x = ART_COLUMNS[col]!,
    y = ART_ROWS[row]!;
  return (
    <svg
      className="development-art"
      viewBox="0 0 418 627"
      preserveAspectRatio="xMidYMid meet"
      overflow="hidden"
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <rect width="418" height="627" />
        </clipPath>
      </defs>
      <image
        href="/art/optimized/development-cards.e40eabee1fa7.webp"
        x={-x}
        y={-y}
        width="1254"
        height="1254"
        clipPath={`url(#${clip})`}
      />
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
  onBuy,
  onSelect,
  obscured = false,
  canBuy = false,
  onHover,
}: {
  game: GameView;
  me: string;
  disabled: boolean;
  reducedMotion: boolean;
  onAction: (action: GameAction) => void;
  onClose?: () => void;
  onBuy?: () => void;
  onSelect?: () => void;
  obscured?: boolean;
  canBuy?: boolean;
  onHover: () => void;
}) {
  const cards = game.players.find((p) => p.id === me)?.cards ?? [],
    [selected, setSelected] = useState<string | null>(null),
    [resource, setResource] = useState<Resource>('wood'),
    [take, setTake] = useState<Hand>(emptyHand);
  const stacks = developmentStacks(cards, game, me);
  const card = cards.find((c) => c.id === selected),
    reason = card ? cardLockReason(card, game, me) : null;
  const handRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [detailPosition, setDetailPosition] = useState<CSSProperties>({});
  const [positionedCard, setPositionedCard] = useState<string | null>(null);
  function closeDetails(restoreFocus = false) {
    setSelected(null);
    onClose?.();
    if (restoreFocus && anchorRef.current?.isConnected) anchorRef.current.focus({ preventScroll: true });
  }
  useLayoutEffect(() => {
    const detail = detailRef.current;
    if (!card || !detail) return;
    const position = () => {
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? innerWidth,
        height: viewport?.height ?? innerHeight,
      };
      detail.style.width = `${Math.min(360, bounds.width - 24)}px`;
      detail.style.maxHeight = `${bounds.height - 24}px`;
      setDetailPosition(fitFloatingPanel(anchor, { width: 360, height: detail.offsetHeight }, bounds));
      setPositionedCard(card.id);
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(detail);
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !detail.contains(event.target) &&
        !handRef.current?.contains(event.target)
      )
        setSelected(null);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      resize.disconnect();
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [card?.id]);
  useLayoutEffect(() => {
    if (card && positionedCard === card.id) detailRef.current?.focus({ preventScroll: true });
  }, [positionedCard, card?.id]);
  useEffect(() => {
    if (!cards.some((c) => c.id === selected)) setSelected(null);
  }, [cards.map((c) => c.id).join('|'), selected]);
  useEffect(() => {
    if (obscured) setSelected(null);
  }, [obscured]);
  function choose(c: Card) {
    if (disabled || cardLockReason(c, game, me)) return;
    onSelect?.();
    setPositionedCard(null);
    setSelected((current) => (current === c.id ? null : c.id));
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
    setSelected(null);
  }
  return (
    <section
      ref={handRef}
      className="development-hand-inline"
      aria-label="Development cards"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          closeDetails(true);
          e.stopPropagation();
        }
      }}
    >
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
                    suppressed={!!selected}
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
                      className={`development-card card-finish ${lock ? 'resting-card' : 'playable-card'} ${c.kind === 'victoryPoint' ? 'victory-card' : ''}`}
                      aria-pressed={selected === c.id}
                      aria-label={`${CARD_NAMES[c.kind]}${stack.count > 1 ? ` × ${stack.count}` : ''}. ${lock ?? 'Review card'}`}
                      aria-disabled={disabled || !!lock}
                      onClick={(event) => {
                        anchorRef.current = event.currentTarget;
                        choose(c);
                      }}
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
                            {c.boughtTurn === game.turn ? 'Next turn' : 'Held'}
                          </>
                        ) : (
                          <>
                            <Play size={11} />
                            Review
                          </>
                        )}
                      </span>
                      <span className="card-sheen" aria-hidden="true" />
                    </button>
                  </CardTooltip>
                </div>
              );
            })}
          </div>
          {card && handRef.current
            ? createPortal(
                <div className="development-hand-inline development-detail-layer">
                  <div
                    ref={detailRef}
                    className="development-detail floating-panel development-detail-portal"
                    style={{
                      ...detailPosition,
                      visibility: positionedCard === card.id ? 'visible' : 'hidden',
                    }}
                    tabIndex={-1}
                    role="dialog"
                    aria-label={CARD_NAMES[card.kind]}
                  >
                    <button
                      className="icon-button development-close"
                      aria-label="Close card details"
                      onClick={() => closeDetails(true)}
                    >
                      <X />
                    </button>
                    <div className="development-explanation">
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
                                  disabled={
                                    take[r] >= game.bank[r] || total(take) >= Math.min(2, total(game.bank))
                                  }
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
                </div>,
                handRef.current.closest('.game-world') ?? document.body,
              )
            : null}
        </>
      ) : null}
      {onBuy && <DevelopmentPurchase disabled={disabled || !canBuy} onBuy={onBuy} />}
    </section>
  );
}

export function DevelopmentPurchase({ disabled, onBuy }: { disabled: boolean; onBuy: () => void }) {
  return (
    <button
      data-development-purchase
      className="development-buy"
      disabled={disabled}
      aria-label="Buy development card · 1 Sheep, 1 Hay, 1 Rock"
      title="Buy development card · 1 Sheep, 1 Hay, 1 Rock"
      onClick={onBuy}
    >
      <span className="development-buy-mark" aria-hidden="true">
        <GameIcon name="buy-development" size={40} />
      </span>
      <span className="development-buy-label">Buy</span>
      <span className="development-buy-cost" aria-hidden="true">
        {(['sheep', 'wheat', 'ore'] as const).map((resource) => (
          <span key={resource} data-cost-resource={resource}>
            <ResourceIcon resource={resource} />
          </span>
        ))}
      </span>
    </button>
  );
}

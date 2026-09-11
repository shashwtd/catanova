import { useEffect, useState } from 'react';
import { canPay, emptyHand, total } from '../../../packages/rules/src/game.js';
import type { GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ArrowLeftRight, Check, Plus, X } from './GameIcons.js';
import { ResourceChoice, ResourcePicker, ResourceSummary } from './ResourcePicker.js';

type Props = { game: GameView; me: string; disabled: boolean; onAction: (action: GameAction) => void };

/** Both columns always describe the person looking at this interface. */
function TradeExchange({ give, get }: { give: Hand | null; get: Hand | null }) {
  return (
    <div className="trade-exchange">
      <section className="trade-side trade-side-give" aria-label="You give">
        <strong>You give</strong>
        {give && total(give) ? (
          <ResourceSummary hand={give} />
        ) : (
          <span className="trade-undecided">Choose cards</span>
        )}
      </section>
      <ArrowLeftRight aria-hidden="true" />
      <section className="trade-side trade-side-get" aria-label="You get">
        <strong>You get</strong>
        {get && total(get) ? (
          <ResourceSummary hand={get} />
        ) : (
          <span className="trade-undecided">{get === null ? 'Open to offers' : 'Choose cards'}</span>
        )}
      </section>
    </div>
  );
}

/** A changed price or proposal invalidates the previous review, even before effects run. */
function ConfirmTrade({
  action,
  give,
  get,
  disabled,
  onAction,
  label,
  ariaLabel,
}: {
  action: GameAction;
  give: Hand;
  get: Hand;
  disabled: boolean;
  onAction: Props['onAction'];
  label: string;
  ariaLabel?: string;
}) {
  const [reviewed, setReviewed] = useState<string | null>(null);
  const fingerprint = JSON.stringify({ action, give, get });
  if (reviewed === fingerprint) {
    return (
      <section className="trade-confirmation" aria-label="Review trade">
        <strong>Confirm your trade</strong>
        <TradeExchange give={give} get={get} />
        <div className="offer-actions">
          <button className="text-button" onClick={() => setReviewed(null)}>
            Back
          </button>
          <button
            className="gold-button"
            disabled={disabled}
            onClick={() => {
              onAction(action);
              setReviewed(null);
            }}
          >
            <Check />
            Confirm trade
          </button>
        </div>
      </section>
    );
  }
  return (
    <button
      className="gold-button trade-review-button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => setReviewed(fingerprint)}
    >
      <Check />
      {label}
    </button>
  );
}

export function BankTrade({ game, me, disabled, onAction }: Props) {
  const [bankGive, setBankGive] = useState<Resource>('wood');
  const [bankReceive, setBankReceive] = useState<Resource>('brick');
  const hand = game.players.find((p) => p.id === me)?.hand ?? emptyHand();
  const locked = disabled || game.players[game.active]?.id !== me || game.phase !== 'actions';
  const give = { ...emptyHand(), [bankGive]: game.legal.rates[bankGive] };
  const get = { ...emptyHand(), [bankReceive]: 1 };
  return (
    <div role="tabpanel" aria-label="Bank and ports" className="bank-trade">
      <ResourceChoice
        label="You give"
        value={bankGive}
        onChange={setBankGive}
        amount={(r) => game.legal.rates[r]}
        unavailable={RESOURCES.filter((r) => locked || hand[r] < game.legal.rates[r])}
      />
      <ResourceChoice
        label="You get"
        value={bankReceive}
        onChange={setBankReceive}
        amount={() => 1}
        unavailable={RESOURCES.filter((r) => locked || !game.bank[r] || r === bankGive)}
      />
      <TradeExchange give={give} get={get} />
      <ConfirmTrade
        action={{ kind: 'bankTrade', give: bankGive, receive: bankReceive }}
        give={give}
        get={get}
        disabled={locked || bankGive === bankReceive || !canPay(hand, give) || !game.bank[bankReceive]}
        onAction={onAction}
        label={`Trade ${game.legal.rates[bankGive]}:1`}
      />
    </div>
  );
}

export function TradePanel({ game, me, disabled, onAction }: Props) {
  const [tab, setTab] = useState<'players' | 'bank'>('players');
  const [give, setGive] = useState<Hand>(emptyHand);
  const [want, setWant] = useState<Hand>(emptyHand);
  const [open, setOpen] = useState(false);
  const hand = game.players.find((p) => p.id === me)?.hand ?? emptyHand();
  const locked = disabled || game.players[game.active]?.id !== me || game.phase !== 'actions';
  const trade = game.trade?.player === me ? game.trade : null;
  const requestLimit = Object.fromEntries(RESOURCES.map((r) => [r, give[r] ? 0 : 19])) as Hand;
  return (
    <div className="trade-content">
      <div className="menu-tabs" role="tablist" aria-label="Trade with">
        <button role="tab" aria-selected={tab === 'players'} onClick={() => setTab('players')}>
          Players
        </button>
        <button role="tab" aria-selected={tab === 'bank'} onClick={() => setTab('bank')}>
          Bank & ports
        </button>
      </div>
      {tab === 'bank' ? (
        <BankTrade game={game} me={me} disabled={disabled} onAction={onAction} />
      ) : (
        <div role="tabpanel" aria-label="Player trade">
          <ResourcePicker
            label="You give"
            value={give}
            max={hand}
            disabled={locked}
            onChange={(next) => {
              setGive(next);
              setWant(
                (current) => Object.fromEntries(RESOURCES.map((r) => [r, next[r] ? 0 : current[r]])) as Hand,
              );
            }}
          />
          <div className="trade-request-heading">
            <span>You get</span>
            <button
              type="button"
              className="open-request"
              aria-pressed={open}
              onClick={() => setOpen((value) => !value)}
              disabled={locked}
            >
              <b aria-hidden="true">?</b>Open to offers
            </button>
          </div>
          {open ? (
            <div className="open-request-preview">
              <b>?</b>
              <span>Choose a return when someone offers.</span>
            </div>
          ) : (
            <ResourcePicker
              label="You get"
              value={want}
              max={requestLimit}
              onChange={setWant}
              disabled={locked}
            />
          )}
          {!!total(give) && <TradeExchange give={give} get={open ? null : want} />}
          <button
            className="gold-button trade-submit"
            disabled={locked || !total(give) || !canPay(hand, give) || (!open && !total(want))}
            onClick={() => onAction(open ? { kind: 'openTrade', give } : { kind: 'offerTrade', give, want })}
          >
            <ArrowLeftRight />
            {trade ? 'Update offer' : 'Offer trade'}
          </button>
          {trade && (
            <section className="live-offer" aria-label="Your current offer">
              <div className="offer-heading">
                <strong>Your offer</strong>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => onAction({ kind: 'cancelTrade' })}
                >
                  <X size={15} />
                  Withdraw
                </button>
              </div>
              <TradeExchange give={trade.give} get={trade.open ? null : trade.want} />
              {!!trade.declinedBy?.length && (
                <div className="trade-declines" aria-label="Declined by">
                  {trade.declinedBy.map((id) => (
                    <span key={id}>
                      <X size={12} />
                      {game.players.find((player) => player.id === id)?.name} declined
                    </span>
                  ))}
                </div>
              )}
              {trade.open && (
                <div className="counteroffers">
                  {trade.proposals?.length ? (
                    trade.proposals.map((proposal) => {
                      const name = game.players.find((p) => p.id === proposal.player)?.name;
                      return (
                        <div className="counteroffer trade-counteroffer" key={proposal.player}>
                          <strong>{name}'s offer</strong>
                          <TradeExchange give={trade.give} get={proposal.give} />
                          <ConfirmTrade
                            action={{
                              kind: 'acceptProposal',
                              tradeId: trade.id,
                              player: proposal.player,
                              expectedGive: proposal.give,
                            }}
                            give={trade.give}
                            get={proposal.give}
                            label="Accept offer"
                            ariaLabel={`Accept ${name}'s offer`}
                            disabled={
                              locked ||
                              !canPay(hand, trade.give) ||
                              !!trade.declinedBy?.includes(proposal.player)
                            }
                            onAction={onAction}
                          />
                        </div>
                      );
                    })
                  ) : (
                    <p className="quiet-note">Waiting for offers…</p>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}

/** Replies are possible only to the active player's live offer, without opening the Trade action. */
export function IncomingTrade({ game, me, disabled, onAction }: Props) {
  const trade = game.trade;
  const hand = game.players.find((p) => p.id === me)?.hand ?? emptyHand();
  const [give, setGive] = useState<Hand>(emptyHand);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setGive(emptyHand());
    setExpanded(false);
  }, [trade?.id]);
  if (
    !trade ||
    trade.player === me ||
    trade.player !== game.players[game.active]?.id ||
    game.phase !== 'actions' ||
    trade.declinedBy?.includes(me)
  )
    return null;
  const name = game.players.find((p) => p.id === trade.player)?.name;
  const proposal = trade.proposals?.find((p) => p.player === me);
  const limits = Object.fromEntries(RESOURCES.map((r) => [r, trade.give[r] ? 0 : hand[r]])) as Hand;
  return (
    <aside className="incoming-trade trade-notice floating-panel" aria-label="Incoming trade">
      <div className="offer-heading">
        <strong>Trade with {name}</strong>
        <ArrowLeftRight />
      </div>
      <TradeExchange
        give={trade.open ? (expanded ? give : (proposal?.give ?? null)) : trade.want}
        get={trade.give}
      />
      {trade.open ? (
        <>
          {proposal && (
            <div className="your-proposal">
              <span>Waiting for {name}</span>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => onAction({ kind: 'withdrawProposal', tradeId: trade.id })}
              >
                Withdraw
              </button>
            </div>
          )}
          {expanded ? (
            <>
              <ResourcePicker
                label="You give"
                value={give}
                onChange={setGive}
                max={limits}
                disabled={disabled}
              />
              <div className="offer-actions">
                <button className="text-button" onClick={() => setExpanded(false)}>
                  Cancel
                </button>
                <button
                  className="gold-button"
                  disabled={
                    disabled ||
                    !total(give) ||
                    !canPay(hand, give) ||
                    RESOURCES.some((r) => give[r] && trade.give[r])
                  }
                  onClick={() => {
                    onAction({ kind: 'proposeTrade', tradeId: trade.id, give });
                    setExpanded(false);
                  }}
                >
                  <Check />
                  Send offer
                </button>
              </div>
            </>
          ) : (
            <button
              className="gold-button"
              disabled={disabled}
              onClick={() => {
                setGive(proposal?.give ?? emptyHand());
                setExpanded(true);
              }}
            >
              <Plus />
              {proposal ? 'Change offer' : 'Make an offer'}
            </button>
          )}
        </>
      ) : (
        <ConfirmTrade
          action={{ kind: 'acceptTrade', tradeId: trade.id }}
          give={trade.want}
          get={trade.give}
          disabled={disabled || !canPay(hand, trade.want)}
          onAction={onAction}
          label="Accept trade"
        />
      )}
      <button
        className="trade-decline-button"
        disabled={disabled}
        onClick={() => onAction({ kind: 'declineTrade', tradeId: trade.id })}
      >
        <X size={15} />
        Decline
      </button>
    </aside>
  );
}

import { useEffect, useState } from 'react';
import { canPay, emptyHand, total } from '../../../packages/rules/src/game.js';
import type { GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ArrowLeftRight, Check, Plus, X } from './GameIcons.js';
import { ResourceChoice, ResourcePicker, ResourceSummary } from './ResourcePicker.js';

type Props = { game: GameView; me: string; disabled: boolean; onAction: (action: GameAction) => void };
export function TradePanel({ game, me, disabled, onAction }: Props) {
  const [tab, setTab] = useState<'players' | 'bank'>('players'),
    [give, setGive] = useState<Hand>(emptyHand),
    [want, setWant] = useState<Hand>(emptyHand),
    [open, setOpen] = useState(false);
  const [bankGive, setBankGive] = useState<Resource>('wood'),
    [bankReceive, setBankReceive] = useState<Resource>('brick');
  const hand = game.players.find((p) => p.id === me)?.hand ?? emptyHand(),
    active = game.players[game.active]?.id === me && game.phase === 'actions',
    locked = disabled || !active;
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
        <div role="tabpanel" aria-label="Bank and ports">
          <ResourceChoice
            label="Give"
            value={bankGive}
            onChange={setBankGive}
            amount={(r) => game.legal.rates[r]}
            unavailable={RESOURCES.filter((r) => hand[r] < game.legal.rates[r])}
          />
          <ResourceChoice
            label="Receive"
            value={bankReceive}
            onChange={setBankReceive}
            amount={() => 1}
            unavailable={RESOURCES.filter((r) => !game.bank[r] || r === bankGive)}
          />
          <button
            className="gold-button trade-submit"
            disabled={
              locked ||
              bankGive === bankReceive ||
              hand[bankGive] < game.legal.rates[bankGive] ||
              !game.bank[bankReceive]
            }
            onClick={() => onAction({ kind: 'bankTrade', give: bankGive, receive: bankReceive })}
          >
            <ArrowLeftRight />
            Trade <span>{game.legal.rates[bankGive]}:1</span>
          </button>
        </div>
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
            <span>You receive</span>
            <button
              type="button"
              className="open-request"
              aria-pressed={open}
              onClick={() => setOpen((v) => !v)}
              disabled={locked}
            >
              <b aria-hidden="true">?</b>Open to offers
            </button>
          </div>
          {open ? (
            <div className="open-request-preview">
              <b>?</b>
              <span>Let the others offer.</span>
            </div>
          ) : (
            <ResourcePicker
              label="Choose your return"
              value={want}
              max={requestLimit}
              onChange={setWant}
              disabled={locked}
            />
          )}
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
                <strong>On the table</strong>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => onAction({ kind: 'cancelTrade' })}
                >
                  <X size={15} />
                  Withdraw
                </button>
              </div>
              <div className="exchange-row">
                <ResourceSummary hand={trade.give} />
                <ArrowLeftRight />
                {trade.open ? (
                  <span className="unknown-return">?</span>
                ) : (
                  <ResourceSummary hand={trade.want} />
                )}
              </div>
              {trade.open && (
                <div className="counteroffers">
                  {trade.proposals?.length ? (
                    trade.proposals.map((proposal) => (
                      <div className="counteroffer" key={proposal.player}>
                        <strong>{game.players.find((p) => p.id === proposal.player)?.name}</strong>
                        <ResourceSummary hand={proposal.give} />
                        <button
                          className="gold-button"
                          aria-label={`Accept ${game.players.find((p) => p.id === proposal.player)?.name}'s offer`}
                          disabled={locked || !canPay(hand, trade.give)}
                          onClick={() =>
                            onAction({ kind: 'acceptProposal', tradeId: trade.id, player: proposal.player })
                          }
                        >
                          <Check />
                          Trade
                        </button>
                      </div>
                    ))
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
  const trade = game.trade,
    hand = game.players.find((p) => p.id === me)?.hand ?? emptyHand();
  const [give, setGive] = useState<Hand>(emptyHand),
    [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setGive(emptyHand());
    setExpanded(false);
  }, [trade?.id]);
  if (
    !trade ||
    trade.player === me ||
    trade.player !== game.players[game.active]?.id ||
    game.phase !== 'actions'
  )
    return null;
  const proposal = trade.proposals?.find((p) => p.player === me);
  const limits = Object.fromEntries(RESOURCES.map((r) => [r, trade.give[r] ? 0 : hand[r]])) as Hand;
  return (
    <aside className="incoming-trade trade-notice floating-panel" aria-label="Incoming trade">
      <div className="offer-heading">
        <strong>{game.players.find((p) => p.id === trade.player)?.name} offers</strong>
        <ArrowLeftRight />
      </div>
      <div className="exchange-row">
        <ResourceSummary hand={trade.give} />
        <ArrowLeftRight />
        {trade.open ? <span className="unknown-return">?</span> : <ResourceSummary hand={trade.want} />}
      </div>
      {trade.open ? (
        <>
          {proposal && (
            <div className="your-proposal">
              <span>Your offer</span>
              <ResourceSummary hand={proposal.give} />
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
        <button
          className="gold-button"
          disabled={disabled || !canPay(hand, trade.want)}
          onClick={() => onAction({ kind: 'acceptTrade', tradeId: trade.id })}
        >
          <Check />
          Accept trade
        </button>
      )}
    </aside>
  );
}

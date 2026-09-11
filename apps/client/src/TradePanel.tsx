import { useEffect, useRef, useState } from 'react';
import {
  canPay,
  emptyHand,
  total,
  tradeOffersRemaining,
  TRADE_OFFER_LIMIT,
} from '../../../packages/rules/src/game.js';
import type { GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ArrowLeftRight, Check, Plus, X } from './GameIcons.js';
import { ResourceChoice, ResourcePicker, ResourceSummary } from './ResourcePicker.js';
import { TradeSubmission } from './trade-submission.js';
import type { TradeSender } from './trade-submission.js';

type Props = {
  game: GameView;
  me: string;
  disabled: boolean;
  onAction: TradeSender;
};

function useTradeAction(disabled: boolean, send: Props['onAction']) {
  const latch = useRef(new TradeSubmission()),
    [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const submit = async (action: GameAction): Promise<boolean> => {
    if (disabled || latch.current.pending) return false;
    setPending(true);
    setError('');
    try {
      return await latch.current.run(action, send);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not send the trade. Please retry.');
      return false;
    } finally {
      setPending(false);
    }
  };
  return { submit, pending, error };
}

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
          <button className="text-button" disabled={disabled} onClick={() => setReviewed(null)}>
            Back
          </button>
          <button
            className="gold-button"
            disabled={disabled}
            onClick={async () => {
              if ((await onAction(action)) !== false)
                setReviewed((current) => (current === fingerprint ? null : current));
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
  const command = useTradeAction(disabled, onAction);
  const [bankGive, setBankGive] = useState<Resource>('wood');
  const [bankReceive, setBankReceive] = useState<Resource>('brick');
  const player = game.players.find((p) => p.id === me);
  const hand = player?.hand ?? emptyHand();
  const locked =
    disabled ||
    command.pending ||
    !!player?.resigned ||
    game.players[game.active]?.id !== me ||
    game.phase !== 'actions';
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
        onAction={command.submit}
        label={`Trade ${game.legal.rates[bankGive]}:1`}
      />
      {command.error && (
        <p role="alert" className="entry-error">
          {command.error}
        </p>
      )}
    </div>
  );
}

export function TradePanel({ game, me, disabled, onAction }: Props) {
  const command = useTradeAction(disabled, onAction);
  const [tab, setTab] = useState<'players' | 'bank'>('players');
  const [give, setGive] = useState<Hand>(emptyHand);
  const [want, setWant] = useState<Hand>(emptyHand);
  const [open, setOpen] = useState(false);
  const player = game.players.find((p) => p.id === me);
  const hand = player?.hand ?? emptyHand();
  const locked =
    disabled ||
    command.pending ||
    !!player?.resigned ||
    game.players[game.active]?.id !== me ||
    game.phase !== 'actions';
  const trade = game.trade?.player === me ? game.trade : null;
  const remaining = tradeOffersRemaining(game);
  const unchanged =
    !!trade &&
    !!trade.open === open &&
    RESOURCES.every((r) => trade.give[r] === give[r] && (open || trade.want[r] === want[r]));
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
        <BankTrade game={game} me={me} disabled={disabled} onAction={command.submit} />
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
            disabled={
              locked ||
              !remaining ||
              unchanged ||
              !total(give) ||
              !canPay(hand, give) ||
              (!open && !total(want))
            }
            onClick={() =>
              void command.submit(open ? { kind: 'openTrade', give } : { kind: 'offerTrade', give, want })
            }
          >
            <ArrowLeftRight />
            {command.pending ? 'Sending…' : unchanged ? 'Offer sent' : trade ? 'Update offer' : 'Offer trade'}
          </button>
          <p className="trade-offer-allowance" aria-live="polite">
            {remaining
              ? `${remaining} of ${TRADE_OFFER_LIMIT} offers left this turn`
              : 'All 5 offers used. You can still finish this trade or use the bank.'}
          </p>
          {trade && (
            <section className="live-offer" aria-label="Your current offer">
              <div className="offer-heading">
                <strong>Your offer</strong>
                <button
                  className="text-button"
                  disabled={locked}
                  onClick={() => void command.submit({ kind: 'cancelTrade' })}
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
                            onAction={command.submit}
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
      {command.error && (
        <p role="alert" className="entry-error">
          {command.error}
        </p>
      )}
    </div>
  );
}

/** Replies are possible only to the active player's live offer, without opening the Trade action. */
export function IncomingTrade({ game, me, disabled, onAction }: Props) {
  const command = useTradeAction(disabled, onAction);
  const locked = disabled || command.pending;
  const trade = game.trade;
  const player = game.players.find((p) => p.id === me);
  const hand = player?.hand ?? emptyHand();
  const [give, setGive] = useState<Hand>(emptyHand);
  const [expanded, setExpanded] = useState(false);
  const activeOffer = useRef('');
  activeOffer.current = `${me}:${trade?.id}`;
  useEffect(() => {
    setGive(emptyHand());
    setExpanded(false);
  }, [me, trade?.id]);
  if (
    !trade ||
    !player ||
    player.resigned ||
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
                disabled={locked}
                onClick={() => void command.submit({ kind: 'withdrawProposal', tradeId: trade.id })}
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
                disabled={locked}
              />
              <div className="offer-actions">
                <button className="text-button" disabled={locked} onClick={() => setExpanded(false)}>
                  Cancel
                </button>
                <button
                  className="gold-button"
                  disabled={
                    locked ||
                    !total(give) ||
                    !canPay(hand, give) ||
                    RESOURCES.some((r) => give[r] && trade.give[r])
                  }
                  onClick={async () => {
                    const offer = `${me}:${trade.id}`;
                    if (await command.submit({ kind: 'proposeTrade', tradeId: trade.id, give })) {
                      // An acknowledgement for an old offer must not close a newer draft.
                      if (activeOffer.current === offer) setExpanded(false);
                    }
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
              disabled={locked}
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
          disabled={locked || !canPay(hand, trade.want)}
          onAction={command.submit}
          label="Accept trade"
        />
      )}
      <button
        className="trade-decline-button"
        disabled={locked}
        onClick={() => void command.submit({ kind: 'declineTrade', tradeId: trade.id })}
      >
        <X size={15} />
        Decline
      </button>
      {command.error && (
        <p role="alert" className="entry-error">
          {command.error}
        </p>
      )}
    </aside>
  );
}

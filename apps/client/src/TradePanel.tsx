import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { canPay, emptyHand, total } from '../../../packages/rules/src/game.js';
import type { GameAction, GameView, Hand } from '../../../packages/rules/src/game.js';
import { RESOURCES } from '../../../packages/rules/src/index.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { ArrowLeftRight, LightCheck as Check, Exchange, GameIcon, Users, X } from './GameIcons.js';
import type { RoomState } from '../../../packages/protocol/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { Avatar } from './Profile.js';
import { PLAYER_COLORS } from './Board.js';
import { ResourceChoice, ResourcePicker, ResourceSummary } from './ResourcePicker.js';
import { TradeSubmission } from './trade-submission.js';
import type { TradeSender } from './trade-submission.js';

type Props = {
  game: GameView;
  me: string;
  disabled: boolean;
  onAction: TradeSender;
  roomPlayers?: RoomState['players'];
};
function TradePortrait({
  player,
  roomPlayers,
}: {
  player: { id: string; name: string };
  roomPlayers?: RoomState['players'];
}) {
  return (
    <Avatar
      profile={roomPlayers?.find((seat) => seat.id === player.id)?.profile ?? defaultProfile(player.name)}
    />
  );
}
function TradeWaiting() {
  return (
    <svg className="trade-waiting-ring" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 8 8" />
    </svg>
  );
}
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

/** Keep the player's receiving and payment sides consistent throughout the trade. */
export function TradeExchange({
  give,
  get,
  giveControl,
  getControl,
}: {
  give: Hand | null;
  get: Hand | null;
  giveControl?: ReactNode;
  getControl?: ReactNode;
}) {
  return (
    <div className="trade-exchange">
      <section className="trade-side trade-side-get" aria-label="You get">
        <strong>You get</strong>
        {getControl ??
          (get && total(get) ? (
            <ResourceSummary hand={get} />
          ) : (
            <span
              className="trade-undecided"
              aria-label={get === null ? 'Open to offers' : 'Nothing selected'}
            >
              {get === null ? '?' : '—'}
            </span>
          ))}
      </section>
      <span className="trade-exchange-mark" aria-hidden="true">
        <Exchange size={24} />
      </span>
      <section className="trade-side trade-side-give" aria-label="You give">
        <strong>You give</strong>
        {giveControl ??
          (give && total(give) ? (
            <ResourceSummary hand={give} />
          ) : (
            <span className="trade-undecided" aria-label="Nothing selected">
              —
            </span>
          ))}
      </section>
    </div>
  );
}

export function BankTrade({ game, me, disabled, onAction }: Props) {
  const command = useTradeAction(disabled, onAction);
  const [bankGive, setBankGive] = useState<Resource>('wood');
  const [bankReceive, setBankReceive] = useState<Resource>('brick');
  const player = game.players.find((p) => p.id === me),
    hand = player?.hand ?? emptyHand();
  const locked =
    disabled ||
    command.pending ||
    !!player?.resigned ||
    game.players[game.active]?.id !== me ||
    game.phase !== 'actions';
  const give = { ...emptyHand(), [bankGive]: game.legal.rates[bankGive] },
    get = { ...emptyHand(), [bankReceive]: 1 };
  const [reviewed, setReviewed] = useState('');
  const fingerprint = JSON.stringify({ turn: game.turn, give, get });
  const reviewing = reviewed === fingerprint;
  return (
    <div role="tabpanel" aria-label="Bank and ports" className="bank-trade">
      <TradeExchange
        give={give}
        get={get}
        getControl={
          reviewing ? undefined : (
            <ResourceChoice
              label="You get"
              value={bankReceive}
              onChange={setBankReceive}
              amount={() => 1}
              unavailable={RESOURCES.filter((r) => locked || !game.bank[r] || r === bankGive)}
            />
          )
        }
        giveControl={
          reviewing ? undefined : (
            <ResourceChoice
              label="You give"
              value={bankGive}
              onChange={setBankGive}
              amount={(r) => game.legal.rates[r]}
              unavailable={RESOURCES.filter((r) => locked || hand[r] < game.legal.rates[r])}
            />
          )
        }
      />
      <div className="trade-footer-actions">
        {reviewing && (
          <button className="text-button" disabled={locked} onClick={() => setReviewed('')}>
            Back
          </button>
        )}
        <button
          className="gold-button"
          disabled={locked || bankGive === bankReceive || !canPay(hand, give) || !game.bank[bankReceive]}
          onClick={async () => {
            if (!reviewing) {
              setReviewed(fingerprint);
              return;
            }
            if (await command.submit({ kind: 'bankTrade', give: bankGive, receive: bankReceive }))
              setReviewed('');
          }}
        >
          <Check />
          {reviewing ? 'Confirm trade' : `Trade ${game.legal.rates[bankGive]}:1`}
        </button>
      </div>
      {command.error && (
        <p role="alert" className="entry-error">
          {command.error}
        </p>
      )}
    </div>
  );
}

/** A live offer replaces its editor. Selection never transfers cards until Confirm is pressed. */
export function TradePanel({
  game,
  me,
  disabled,
  onAction,
  onClose,
  roomPlayers,
}: Props & { onClose?: () => void }) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && close.current) {
        event.preventDefault();
        close.current();
      }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);
  const command = useTradeAction(disabled, onAction);
  const [tab, setTab] = useState<'players' | 'bank'>('players');
  const [give, setGive] = useState<Hand>(emptyHand),
    [want, setWant] = useState<Hand>(emptyHand);
  const [open, setOpen] = useState(false),
    [selection, setSelection] = useState('');
  const player = game.players.find((p) => p.id === me),
    hand = player?.hand ?? emptyHand();
  const locked =
    disabled ||
    command.pending ||
    !!player?.resigned ||
    game.players[game.active]?.id !== me ||
    game.phase !== 'actions';
  const trade = game.trade?.player === me ? game.trade : null;
  const key = (id: string, cards: Hand) => JSON.stringify([trade?.id, id, cards]);
  const chosen = trade?.proposals?.find(
    (p) => key(p.player, p.give) === selection && !trade.declinedBy?.includes(p.player),
  );
  const partner = chosen && game.players.find((p) => p.id === chosen.player && !p.resigned);
  const requestLimit = Object.fromEntries(RESOURCES.map((r) => [r, give[r] ? 0 : 19])) as Hand;
  return (
    <aside className="game-panel floating-panel trade-panel" role="dialog" aria-label="Trade">
      <header className="trade-header">
        <ArrowLeftRight size={40} />
        <div className="menu-tabs" role="tablist" aria-label="Trade with">
          <button role="tab" aria-selected={tab === 'players'} onClick={() => setTab('players')}>
            <Users size={18} />
            Players
          </button>
          <button role="tab" aria-selected={tab === 'bank'} onClick={() => setTab('bank')}>
            <GameIcon name="bank" size={18} />
            Bank & ports
          </button>
        </div>
        {onClose && (
          <button className="icon-button trade-close" aria-label="Close trade" onClick={onClose}>
            <X />
          </button>
        )}
      </header>
      <div className="trade-content">
        {tab === 'bank' ? (
          <BankTrade game={game} me={me} disabled={disabled || command.pending} onAction={onAction} />
        ) : (
          <div role="tabpanel" aria-label="Player trade">
            {trade ? (
              <section className="live-offer" aria-label="Your current offer">
                <TradeExchange give={trade.give} get={trade.open ? (chosen?.give ?? null) : trade.want} />
                <div className="trade-partners" role="group" aria-label="Choose a trading partner">
                  {game.players.map((other, index) => {
                    if (other.id === me || other.resigned) return null;
                    const response = trade.proposals?.find((p) => p.player === other.id),
                      declined = trade.declinedBy?.includes(other.id);
                    const selected = !!response && selection === key(other.id, response.give);
                    return (
                      <button
                        key={other.id}
                        className="trade-partner"
                        aria-label={`Trade with ${other.name}`}
                        aria-pressed={selected}
                        aria-description={
                          declined ? 'Declined' : response ? 'Ready to trade' : 'Waiting for response'
                        }
                        data-response={declined ? 'declined' : response ? 'ready' : 'waiting'}
                        style={
                          { '--partner-color': PLAYER_COLORS[index % PLAYER_COLORS.length] } as CSSProperties
                        }
                        disabled={locked || !response || !!declined || !canPay(hand, trade.give)}
                        onClick={() => response && setSelection(key(other.id, response.give))}
                      >
                        <span className="trade-partner-portrait">
                          <TradePortrait player={other} roomPlayers={roomPlayers} />
                          <span className="trade-partner-response">
                            {declined ? <X /> : response ? <Check /> : <TradeWaiting />}
                          </span>
                        </span>
                        <span className="trade-partner-name">{other.name}</span>
                        {trade.open && response && <ResourceSummary hand={response.give} />}
                      </button>
                    );
                  })}
                </div>
                <p className="trade-status" role="status">
                  {partner
                    ? `Trade with ${partner.name}`
                    : trade.proposals?.length
                      ? 'Choose a player'
                      : 'Waiting for players…'}
                </p>
                <div className="trade-footer-actions">
                  <button
                    className="text-button trade-cancel"
                    disabled={locked}
                    onClick={() => void command.submit({ kind: 'cancelTrade' })}
                  >
                    <X />
                    Cancel offer
                  </button>
                  <button
                    className="gold-button"
                    disabled={locked || !partner || !chosen || !canPay(hand, trade.give)}
                    onClick={() => {
                      if (chosen && partner)
                        void command.submit({
                          kind: 'acceptProposal',
                          tradeId: trade.id,
                          player: partner.id,
                          expectedGive: chosen.give,
                        });
                    }}
                  >
                    <Check />
                    Confirm trade
                  </button>
                </div>
              </section>
            ) : (
              <>
                <TradeExchange
                  give={give}
                  get={open ? null : want}
                  getControl={
                    <ResourcePicker
                      label="You get"
                      value={open ? emptyHand() : want}
                      max={requestLimit}
                      disabled={locked}
                      onChange={(next) => {
                        setOpen(false);
                        setWant(next);
                      }}
                      extra={
                        <button
                          type="button"
                          className="picker-card question-card"
                          aria-label="Open to offers"
                          aria-pressed={open}
                          disabled={locked}
                          onClick={() => setOpen((v) => !v)}
                        >
                          ?
                        </button>
                      }
                    />
                  }
                  giveControl={
                    <ResourcePicker
                      label="You give"
                      value={give}
                      max={hand}
                      disabled={locked}
                      onChange={(next) => {
                        setGive(next);
                        setWant(
                          (current) =>
                            Object.fromEntries(RESOURCES.map((r) => [r, next[r] ? 0 : current[r]])) as Hand,
                        );
                      }}
                    />
                  }
                />
                <button
                  className="gold-button trade-submit"
                  disabled={locked || !total(give) || !canPay(hand, give) || (!open && !total(want))}
                  onClick={() =>
                    void command.submit(
                      open ? { kind: 'openTrade', give } : { kind: 'offerTrade', give, want },
                    )
                  }
                >
                  {command.pending ? 'Sending…' : 'Offer trade'}
                </button>
              </>
            )}
          </div>
        )}
        {command.error && (
          <p role="alert" className="entry-error">
            {command.error}
          </p>
        )}
      </div>
    </aside>
  );
}

/** Accepted replies stay committed; only the maker can choose a partner or cancel the offer. */
export function IncomingTrade({ game, me, disabled, onAction, roomPlayers }: Props) {
  const command = useTradeAction(disabled, onAction),
    locked = disabled || command.pending;
  const trade = game.trade,
    player = game.players.find((p) => p.id === me),
    hand = player?.hand ?? emptyHand();
  const [draft, setDraft] = useState<{ id: string; hand: Hand } | null>(null);
  const draftId = `${me}:${trade?.id}`;
  const give = draft?.id === draftId ? draft.hand : emptyHand();
  const setGive = (hand: Hand) => setDraft({ id: draftId, hand });
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
  const maker = game.players.find((p) => p.id === trade.player)!,
    name = maker.name,
    proposal = trade.proposals?.find((p) => p.player === me);
  const limits = Object.fromEntries(RESOURCES.map((r) => [r, trade.give[r] ? 0 : hand[r]])) as Hand;
  return (
    <aside className="incoming-trade trade-notice floating-panel" aria-label="Incoming trade">
      <header className="trade-header">
        <span className="trade-maker-portrait">
          <TradePortrait player={maker} roomPlayers={roomPlayers} />
        </span>
        <strong>{name} offers</strong>
        <ArrowLeftRight size={36} />
      </header>
      <TradeExchange
        give={trade.open ? (proposal?.give ?? give) : trade.want}
        get={trade.give}
        giveControl={
          trade.open && !proposal ? (
            <ResourcePicker label="You give" value={give} onChange={setGive} max={limits} disabled={locked} />
          ) : undefined
        }
      />
      {proposal ? (
        <p className="trade-waiting" role="status">
          <TradeWaiting />
          Waiting for {name} to choose
        </p>
      ) : (
        <>
          <div className="trade-footer-actions trade-response-actions">
            <button
              className="text-button"
              disabled={locked}
              onClick={() => void command.submit({ kind: 'declineTrade', tradeId: trade.id })}
            >
              <X />
              No thanks
            </button>
            <button
              className="gold-button"
              disabled={
                locked ||
                !canPay(hand, trade.open ? give : trade.want) ||
                (trade.open && (!total(give) || RESOURCES.some((r) => give[r] && trade.give[r])))
              }
              onClick={() =>
                void command.submit(
                  trade.open
                    ? { kind: 'proposeTrade', tradeId: trade.id, give }
                    : { kind: 'acceptTrade', tradeId: trade.id },
                )
              }
            >
              <Check />
              {trade.open ? 'Send offer' : 'Yes, trade'}
            </button>
          </div>
          {!trade.open && !canPay(hand, trade.want) && <p className="quiet-note">Not enough resources</p>}
        </>
      )}
      {command.error && (
        <p role="alert" className="entry-error">
          {command.error}
        </p>
      )}
    </aside>
  );
}

import { isBuildAction, placementValid, type PlacementDraft } from '../placement.js';
import { PlacementConfirmation } from '../PlacementConfirmation.js';
import { TurnButtonAttention } from '../TurnButtonAttention.js';
import { useFeedback } from '../useFeedback.js';
import { GameEffects } from '../GameEffects.js';
import { RobberFlow } from '../RobberFlow.js';
import { TradePanel, IncomingTrade } from '../TradePanel.js';
import {
  PREVIEW_EVENTS,
  previewEvent,
  previewRobber,
  previewTrade,
  type PreviewEvent,
  type RobberPreview,
} from './preview-events.js';
import type { Game, GameAction } from '../../../../packages/rules/src/game.js';
import { UtilityPanel } from '../UtilityPanel.js';
import { GameTools, type GameToolPanel } from '../GameTools.js';
import { QuickRules } from '../QuickRules.js';
import { MoveHistory } from '../MoveHistory.js';
import { BOARD_THEMES } from '../board-theme.js';
/** Vite-only design preview. Uses real components with local sample data, never account APIs. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PlayerHub, PlayerProfile } from '../PlayerHub.js';
import type { useAuth } from '../auth.js';
import { Lobby } from '../Lobby.js';
import { FriendsDrawer } from '../FriendsDrawer.js';
import { RoomInviteNotice } from '../RoomInvitePanel.js';
import type { RoomInvitesController } from '../useRoomInvites.js';
import { GameSettings } from '../GameSettings.js';
import { usePreferences } from '../preferences.js';
import { Board, type BuildMode } from '../Board.js';
import { BoardViewport } from '../BoardViewport.js';
import { ResourceHand } from '../ResourceHand.js';
import { DevelopmentCards, DevelopmentPurchase } from '../DevelopmentCards.js';
import { PlayerRail } from '../PlayerRail.js';
import { Dices, ArrowLeftRight, NextTurn, X, Settings2, House, Route, Castle } from '../GameIcons.js';
import {
  createGame,
  gameView,
  applyAction,
  roadSites,
  settlementSites,
} from '../../../../packages/rules/src/game.js';
import { defaultProfile, emptyFriends } from '../../../../packages/protocol/src/profile.js';
import type { Profile } from '../../../../packages/protocol/src/profile.js';
import type { RoomState } from '../../../../packages/protocol/src/index.js';
import type { PlayerGameState } from '../MatchHistory.js';
import './preview.css';
const noop = () => {};
const names = ['FernCaptain', 'Mossling', 'CopperFox', 'Juniper'];
const seats = names.map((name, i) => ({
  id: `sample-${i}`,
  name,
  ready: i !== 0,
  connected: true,
  profile: { ...defaultProfile(name), avatar: i + 3 },
}));
const me = seats[0]!.id;
const room: RoomState = {
  roomId: 'preview-room',
  roomCode: 'CREW',
  revision: 0,
  counter: 0,
  settings: { turnTimerSeconds: 90, diceMode: 'classic' },
  players: seats,
};
function sampleGame() {
  let game = createGame(seats, 481, () => 0.37);
  for (let i = 0; i < 16; i++) {
    const player = game.players[game.active]!;
    const view = gameView(game, player.id);
    const action =
      game.phase === 'setupSettlement'
        ? { kind: 'settlement' as const, vertex: view.legal.settlements[0]! }
        : { kind: 'road' as const, edge: view.legal.roads[0]! };
    game = applyAction(game, player.id, action, () => 0.37);
  }
  game = applyAction(game, me, { kind: 'roll' }, () => 0.34);
  // Give this local fixture a legal extension, so all three build states are inspectable.
  extend: for (const edge of roadSites(game, me)) {
    const candidate = structuredClone(game);
    candidate.roads[edge] = me;
    for (const next of roadSites(candidate, me)) {
      const extended = structuredClone(candidate);
      extended.roads[next] = me;
      if (settlementSites(extended, me).length) {
        game = extended;
        break extend;
      }
    }
  }
  game.players[0]!.hand = { wood: 3, brick: 2, sheep: 2, wheat: 7, ore: 4 };
  game.players[0]!.cards = [{ id: 'sample-knight', kind: 'knight', boughtTurn: 0 }];
  game.turn = 8;
  return game;
}
const sample = sampleGame();
const friends = seats
  .slice(1)
  .map((seat) => ({ id: seat.id, username: seat.name, profile: seat.profile, isGuest: false, online: true }));
const record: PlayerGameState = {
  data: {
    stats: { wins: 8, played: 23 },
    nextCursor: null,
    games: ['won', 'lost', 'won'].map((outcome, i) => ({
      roomId: `sample-game-${i}`,
      roomCode: null,
      startedAt: Date.now() - (i + 1) * 86400000,
      finishedAt: Date.now() - (i + 1) * 86400000 + 3600000,
      outcome: outcome as 'won' | 'lost',
      points: i === 1 ? 7 : 10,
      turns: 53 + i * 7,
      resumable: false,
      players: seats.map((seat, j) => ({
        ...seat,
        points: j === 0 ? (i === 1 ? 7 : 10) : 8 - j,
        winner: j === (i === 1 ? 1 : 0),
      })),
    })),
  },
  error: '',
  loading: false,
  refresh: noop,
  loadMore: noop,
};
function PreviewDialog(props: { title: string; children: ReactNode; onClose: () => void; side?: boolean }) {
  return props.side ? (
    <UtilityPanel title={props.title} onClose={props.onClose}>
      {props.children}
    </UtilityPanel>
  ) : (
    <PreviewModal {...props} />
  );
}
function PreviewModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} className="game-dialog" aria-label={title} onCancel={onClose}>
      <div className="dialog-surface">
        <div className="panel-heading">
          <h2>{title}</h2>
          <button className="hub-tool" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function LoungePreview() {
  const [screen, setScreen] = useState<'hub' | 'lobby' | 'game'>('hub');
  const [panel, setPanel] = useState<'profile' | 'editProfile' | 'friends' | 'trade' | GameToolPanel | null>(
    null,
  );
  const [showAwards, setShowAwards] = useState(false);
  const [availableBuilds, setAvailableBuilds] = useState(true);
  const [selectedBuild, setSelectedBuild] = useState<BuildMode>(null);
  const [placement, setPlacement] = useState<PlacementDraft | null>(null);
  const [previewLeader, setPreviewLeader] = useState(-1);
  const [simulation, setSimulation] = useState<Game | null>(null);
  const [robberPreview, setRobberPreview] = useState<RobberPreview>('off');
  const [robberHex, setRobberHex] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState('');
  const revision = useRef(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const update = () => setIsFullscreen(!!document.fullscreenElement);
    update();
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);
  const [profile, setProfile] = useState<Profile>(seats[0]!.profile);
  const [removedPlayers, setRemovedPlayers] = useState<string[]>([]);
  const [settings, setSettings] = useState(room.settings);
  const { preferences, update, reducedMotion } = usePreferences();
  const feedback = useFeedback(preferences, reducedMotion);
  useEffect(() => {
    feedback.sound.setScene(screen === 'game' ? 'game' : 'menu');
    if (screen !== 'game') feedback.reset();
  }, [screen, feedback.sound, feedback.reset]);
  const [showInvite, setShowInvite] = useState(false);
  const auth = {
    profile,
    account: { id: me, username: profile.name, profile, registered: true, isGuest: false },
    friends: { ...emptyFriends(), friends },
    config: { mode: 'authenticated' },
    canPlay: true,
    loading: false,
    error: '',
    signIn: async () => {},
    checkUsername: async () => ({ available: true }),
    refreshFriends: async () => {},
    searchFriends: async () => [],
    requestFriend: async () => {},
    respondFriend: async () => {},
    removeFriend: async () => {},
    cancelFriend: async () => {},
  } as unknown as ReturnType<typeof useAuth>;
  const invites: RoomInvitesController = {
    incoming: showInvite
      ? [
          {
            id: 'sample-invite',
            roomId: 'other-preview-room',
            roomCode: 'FERN',
            from: friends[0]!,
            players: 2,
            createdAt: Date.now(),
            expiresAt: Date.now() + 300000,
          },
        ]
      : [],
    sent: [],
    loading: false,
    busy: '',
    error: '',
    refresh: async () => {},
    send: async () => true,
    dismiss: async () => {
      setShowInvite(false);
      return true;
    },
  };
  const notice = (
    <RoomInviteNotice
      invitations={invites.incoming}
      busy={false}
      onOpen={() => {
        setScreen('lobby');
        setShowInvite(false);
      }}
      onDismiss={() => setShowInvite(false)}
      onShowAll={() => setPanel('friends')}
    />
  );
  const previewState = useMemo(() => {
    const state = structuredClone(simulation ?? sample);
    state.players[0]!.name = profile.name;
    if (!simulation) {
      if (!availableBuilds) state.players[0]!.hand = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
      if (previewLeader >= 0) {
        const building = Object.values(state.buildings).find((b) => b.player === seats[previewLeader]!.id);
        if (building) building.kind = 'city';
      }
    }
    return state;
  }, [simulation, availableBuilds, previewLeader, profile.name]);
  const game = useMemo(() => gameView(previewState, me), [previewState]);
  const previewGame = {
    ...game,
    diceMode: settings?.diceMode ?? 'classic',
    victoryPoints: simulation?.victoryPoints ?? settings?.victoryPoints ?? 10,
  };
  const displayedGame =
    showAwards && !simulation
      ? {
          ...previewGame,
          longestRoad: seats[0]!.id,
          largestArmy: seats[1]!.id,
          players: game.players.map((p, i) => ({
            ...p,
            roadLength: i === 0 ? 7 : p.roadLength,
            knights: i === 1 ? 3 : p.knights,
            points: p.points + (i < 2 ? 2 : 0),
          })),
        }
      : previewGame;
  const currentRoom = {
    ...room,
    settings,
    players: [
      { ...seats[0]!, name: profile.name, profile },
      ...seats.slice(1).filter((p) => !removedPlayers.includes(p.id)),
    ],
  };
  function snapshot(state: Game, rev: number): RoomState {
    return { ...currentRoom, revision: rev, game: gameView(state, me) };
  }
  function showScenario(before: Game, after?: Game) {
    feedback.reset(true);
    setPreviewError('');
    setSelectedBuild(null);
    setPlacement(null);
    setRobberHex(null);
    setPanel(null);
    setScreen('game');
    const first = snapshot(before, ++revision.current);
    feedback.accept(null, first, me, true);
    setSimulation(after ?? before);
    if (after) feedback.accept(first, snapshot(after, ++revision.current), me);
  }
  const placementReady = placementValid(placement, game, room.roomId, me);
  useEffect(() => {
    if (panel || !placementReady) setPlacement(null);
  }, [panel, placementReady]);
  function previewPlacement(action: GameAction) {
    if (!isBuildAction(action) || selectedBuild === action.kind) {
      playAction(action);
      return;
    }
    setPanel(null);
    setPlacement({
      action,
      roomId: room.roomId,
      player: me,
      turn: game.turn,
      phase: game.phase,
      setupIndex: game.setupIndex,
    });
  }
  function namedSample() {
    const base = structuredClone(sample);
    base.players.find((player) => player.id === me)!.name = profile.name;
    return base;
  }
  function runEvent(event: PreviewEvent) {
    try {
      const { before, after } = previewEvent(namedSample(), me, event);
      setRobberPreview('off');
      showScenario(before, after);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Preview failed');
    }
  }
  function playAction(action: GameAction, player = me) {
    try {
      const before = snapshot(previewState, revision.current);
      const after = applyAction(previewState, player, action, () => 0.34);
      setSimulation(after);
      setRobberHex(null);
      setPreviewError('');
      feedback.accept(before, snapshot(after, ++revision.current), me);
      return true;
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Preview failed');
      return false;
    }
  }
  function resetPreview() {
    feedback.reset(true);
    setSimulation(null);
    setRobberPreview('off');
    setRobberHex(null);
    setPreviewError('');
    setSelectedBuild(null);
    setPlacement(null);
    setPanel(null);
  }
  return (
    <main
      onClickCapture={(e) => {
        const button = (e.target as HTMLElement).closest('button');
        if (button && !button.disabled) feedback.sound.play('ui');
      }}
      data-motion={reducedMotion ? 'reduced' : 'full'}
      className={`game-world ${screen === 'hub' ? 'player-home' : screen === 'lobby' ? 'lobby' : 'playing'} design-preview`}
    >
      {screen === 'hub' && (
        <PlayerHub
          auth={auth}
          games={record}
          busy={false}
          notifications={notice}
          invitationCount={invites.incoming.length}
          onCreate={() => setScreen('lobby')}
          onJoin={async () => setScreen('lobby')}
          onResume={() => setScreen('game')}
          onProfile={() => setPanel('profile')}
          onEditProfile={() => setPanel('editProfile')}
          onFriends={() => setPanel('friends')}
          onSettings={() => setPanel('settings')}
          onSignOut={() => {
            location.href = '/';
          }}
        />
      )}
      {screen === 'lobby' && (
        <Lobby
          room={currentRoom}
          me={me}
          busy={false}
          connected
          onReady={noop}
          onKick={async (id) => setRemovedPlayers((current) => [...current, id])}
          onStart={() => setScreen('game')}
          onInvite={() => setPanel('friends')}
          onFriends={() => setPanel('friends')}
          onLeave={() => setScreen('hub')}
          onEdit={() => setPanel('editProfile')}
          onSettings={() => setPanel('settings')}
        />
      )}
      {screen === 'game' && (
        <>
          <div className="board-anchor">
            <BoardViewport seed={game.board.seed} reducedMotion={reducedMotion}>
              <Board
                board={game.board}
                art={BOARD_THEMES[preferences.boardTheme]}
                game={game}
                me={me}
                disabled={feedback.presentationBusy}
                mode={selectedBuild}
                glowHexes={reducedMotion ? [] : feedback.event?.glowHexes}
                effectId={feedback.event?.id}
                selectedRobberHex={robberHex}
                pendingBuild={placementReady ? placement?.action : null}
                onAction={previewPlacement}
                onRobber={setRobberHex}
              />
            </BoardViewport>
          </div>
          {placementReady && placement && (
            <PlacementConfirmation
              action={placement.action}
              disabled={false}
              onCancel={() => setPlacement(null)}
              onConfirm={() => {
                if (!placementValid(placement, game, room.roomId, me)) return;
                playAction(placement.action);
                setPlacement(null);
              }}
            />
          )}
          <PlayerRail room={currentRoom} game={displayedGame} me={me} />
          <GameTools
            onClosePanel={() => setPanel(null)}
            panel={panel}
            onPanel={setPanel}
            fullscreen={isFullscreen}
            onFullscreen={() => {
              void (
                document.fullscreenElement
                  ? document.exitFullscreen()
                  : document.documentElement.requestFullscreen()
              ).catch(() => {});
            }}
            onLeave={() => setPanel('leave')}
          />
          <div className="construction-tools build-shelf">
            {(['road', 'settlement', 'city'] as const).map((kind, i) => {
              const Icon = [Route, House, Castle][i]!;
              const sites =
                kind === 'road'
                  ? game.legal.roads
                  : kind === 'city'
                    ? game.legal.cities
                    : game.legal.settlements;
              const ready = sites.length > 0;
              return (
                <button
                  key={kind}
                  className={`icon-button build-control build-${kind} ${ready ? 'is-available' : ''} ${selectedBuild === kind ? 'is-selected' : ''}`}
                  disabled={!ready}
                  aria-pressed={selectedBuild === kind}
                  aria-label={`Build ${kind}`}
                  onClick={() => {
                    setPlacement(null);
                    setSelectedBuild(selectedBuild === kind ? null : kind);
                    setPanel(null);
                  }}
                >
                  <Icon />
                  <span className="build-control-label">{['Road', 'House', 'City'][i]}</span>
                </button>
              );
            })}
          </div>
          <div className="hand-dock">
            <div className="card-table">
              <div className="hand-zone">
                <ResourceHand
                  hand={feedback.hand ?? game.players[0]!.hand!}
                  pulse={feedback.pulse}
                  reducedMotion={reducedMotion}
                />
                <DevelopmentCards
                  game={game}
                  me={me}
                  disabled={feedback.presentationBusy}
                  reducedMotion={reducedMotion}
                  obscured={panel !== null || placementReady}
                  onSelect={() => {
                    setPanel(null);
                    setPlacement(null);
                    setSelectedBuild(null);
                  }}
                  onAction={playAction}
                  onHover={() => feedback.sound.play('hover')}
                />
              </div>
            </div>
            <div className="table-actions">
              <div className="dice-dock" data-dice-dock />
              <div className="utility-actions">
                <div className="development-hand-inline purchase-control">
                  <DevelopmentPurchase
                    disabled={feedback.presentationBusy || !game.legal.canBuyCard}
                    onBuy={() => {
                      runEvent('buy');
                    }}
                  />
                </div>
                <button
                  className="trade-action"
                  aria-label="Trade"
                  disabled={game.active !== 0 || game.phase !== 'actions'}
                  onClick={() => setPanel(panel === 'trade' ? null : 'trade')}
                >
                  <ArrowLeftRight />
                </button>
              </div>
              <button
                className={`turn-action ${simulation && game.phase === 'actions' ? 'end-turn' : 'roll-turn'}`}
                aria-label={simulation && game.phase === 'actions' ? 'Next turn' : 'Roll dice'}
                disabled={
                  feedback.presentationBusy || game.active !== 0 || !['actions', 'roll'].includes(game.phase)
                }
                onClick={() =>
                  simulation && game.phase === 'actions' ? playAction({ kind: 'endTurn' }) : runEvent('dice')
                }
              >
                <TurnButtonAttention />
                {simulation && game.phase === 'actions' ? (
                  <>
                    <NextTurn size={36} />
                    <span>Next</span>
                  </>
                ) : (
                  <Dices />
                )}
              </button>
            </div>
          </div>
          <RobberFlow
            room={{ ...currentRoom, game: displayedGame }}
            me={me}
            selectedHex={robberHex}
            onSelectHex={setRobberHex}
            onAction={playAction}
            disabled={false}
            connected
            onWarning={() => feedback.sound.play('warning')}
          />
          <IncomingTrade game={game} me={me} disabled={false} onAction={playAction} />
          <GameEffects
            event={feedback.event}
            lastDice={game.dice}
            reducedMotion={reducedMotion}
            activity
            awards={feedback.awards}
            onAwardComplete={feedback.finishAward}
            onAwardStart={feedback.announceAward}
          />
        </>
      )}
      {panel === 'trade' && (
        <TradePanel
          game={game}
          me={me}
          disabled={false}
          onAction={playAction}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'friends' && (
        <FriendsDrawer
          auth={auth}
          room={screen === 'lobby' ? currentRoom : undefined}
          invites={invites}
          onOpenRoom={() => {
            setPanel(null);
            setScreen('lobby');
            setShowInvite(false);
          }}
          onClose={() => setPanel(null)}
        />
      )}
      {(panel === 'profile' || panel === 'editProfile') && (
        <PreviewDialog
          title={panel === 'editProfile' ? 'Edit profile' : 'Your profile'}
          onClose={() => setPanel(null)}
        >
          <PlayerProfile
            key={panel}
            initialEditing={panel === 'editProfile'}
            onEdit={() => setPanel('editProfile')}
            auth={auth}
            profile={profile}
            games={record}
            busy={false}
            onSave={async (p) => {
              setProfile(p);
              setPanel(null);
            }}
            onResume={noop}
          />
        </PreviewDialog>
      )}
      {panel === 'settings' && (
        <PreviewDialog side={screen === 'game'} title="Settings" onClose={() => setPanel(null)}>
          <GameSettings
            preferences={preferences}
            update={update}
            room={screen === 'lobby' ? currentRoom : null}
            me={me}
            busy={false}
            save={async (next) => setSettings(next)}
            previewSound={() => feedback.sound.play('settlement')}
          />
        </PreviewDialog>
      )}
      {panel === 'rules' && (
        <PreviewDialog side={screen === 'game'} title="How to play" onClose={() => setPanel(null)}>
          <QuickRules victoryPoints={settings?.victoryPoints} />
        </PreviewDialog>
      )}
      {panel === 'journal' && (
        <PreviewDialog side={screen === 'game'} title="Move history" onClose={() => setPanel(null)}>
          <MoveHistory
            game={game}
            hasMore={false}
            onEarlier={noop}
            entries={game.log.map((entry, index) => ({
              revision: index,
              actor: null,
              kind: 'action',
              turn: Math.floor(index / 2),
              at: new Date(0).toISOString(),
              lines: [entry.text],
            }))}
          />
        </PreviewDialog>
      )}
      {panel === 'leave' && (
        <PreviewDialog title="Leave this game?" onClose={() => setPanel(null)}>
          <p>This is a local preview.</p>
          <div className="room-sheet-actions">
            <button className="hub-room-button" onClick={() => setPanel(null)}>
              Stay
            </button>
            <button
              className="hub-room-button"
              onClick={() => {
                setPanel(null);
                setScreen('hub');
              }}
            >
              Leave
            </button>
          </div>
        </PreviewDialog>
      )}
      <details className="preview-switcher">
        <summary>Preview</summary>
        <nav aria-label="Local design preview">
          <span>Sample data</span>
          {previewError && <p role="alert">{previewError}</p>}
          {(['hub', 'lobby', 'game'] as const).map((value) => (
            <button
              key={value}
              aria-pressed={screen === value}
              onClick={() => {
                setScreen(value);
                setPanel(null);
              }}
            >
              {value}
            </button>
          ))}
          <button
            onClick={() => {
              setScreen('hub');
              setShowInvite(true);
            }}
          >
            Test invite
          </button>
          <label>
            <input
              type="checkbox"
              checked={availableBuilds}
              onChange={(e) => {
                resetPreview();
                setAvailableBuilds(e.target.checked);
                setSelectedBuild(null);
                setPlacement(null);
                setScreen('game');
                setPanel(null);
              }}
            />{' '}
            Available builds
          </label>
          <button
            onClick={() => {
              resetPreview();
              setPreviewLeader((i) => ((i + 2) % 5) - 1);
              setScreen('game');
              setPanel(null);
            }}
          >
            Change leader
          </button>
          <label>
            <input
              type="checkbox"
              checked={showAwards}
              onChange={(e) => {
                resetPreview();
                setShowAwards(e.target.checked);
                setScreen('game');
                setPanel(null);
              }}
            />{' '}
            Show sample awards
          </label>
          <label>
            Robber
            <select
              aria-label="Preview robber phase"
              value={robberPreview}
              onChange={(e) => {
                const mode = e.target.value as RobberPreview;
                setRobberPreview(mode);
                if (mode === 'off') resetPreview();
                else showScenario(previewRobber(namedSample(), me, mode));
              }}
            >
              <option value="off">Off</option>
              <option value="discard">Your discard</option>
              <option value="waiting">Waiting for someone</option>
              <option value="robber">Move & steal</option>
            </select>
          </label>
          {robberPreview === 'waiting' && game.phase === 'discard' && (
            <button
              onClick={() => {
                const [id, required] = Object.entries(previewState.discards)[0]!;
                const hand = previewState.players.find((p) => p.id === id)!.hand;
                let remaining = required;
                const resources = { wood: 0, brick: 0, sheep: 0, wheat: 0, ore: 0 };
                for (const r of Object.keys(resources) as (keyof typeof resources)[]) {
                  resources[r] = Math.min(remaining, hand[r]);
                  remaining -= resources[r];
                }
                playAction({ kind: 'discard', resources }, id);
              }}
            >
              Finish their discard
            </button>
          )}
          <details className="preview-event-menu">
            <summary>Events & sounds</summary>
            <div>
              {Object.entries(PREVIEW_EVENTS).map(([event, label]) => (
                <button key={event} onClick={() => runEvent(event as PreviewEvent)}>
                  {label}
                </button>
              ))}
            </div>
            <div>
              {(['turn', 'road', 'settlement', 'city', 'gain', 'spend', 'trade'] as const).map((cue) => (
                <button
                  key={cue}
                  onClick={async () => {
                    await feedback.sound.unlock();
                    feedback.sound.play(cue);
                  }}
                >
                  Sound: {cue}
                </button>
              ))}
            </div>
            {!preferences.sound || !preferences.volume ? <p>Sound is muted. Enable it in Settings.</p> : null}
          </details>
          <button
            onClick={() => {
              setRobberPreview('off');
              showScenario(previewTrade(namedSample(), me, false));
              setPanel('trade');
            }}
          >
            Two willing traders
          </button>
          <button
            onClick={() => {
              setRobberPreview('off');
              showScenario(previewTrade(namedSample(), me, true));
            }}
          >
            Incoming trade
          </button>
          <button onClick={resetPreview}>Reset game preview</button>
        </nav>
      </details>
    </main>
  );
}

import { GameTools, type GameToolPanel } from '../GameTools.js';
import { QuickRules } from '../QuickRules.js';
import { MoveHistory } from '../MoveHistory.js';
import { ConnectionPanel } from '../ConnectionPanel.js';
import { initialMetrics } from '../connection.js';
const conceptArt = {
  terrain: new URL('./assets/terrain-concept.webp', import.meta.url).href,
  environment: new URL('./assets/environment-concept.webp', import.meta.url).href,
  concept: true,
};
/** Vite-only design preview. Uses real components with local sample data, never account APIs. */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { PlayerHub, PlayerProfile } from '../PlayerHub.js';
import type { useAuth } from '../auth.js';
import { Lobby } from '../Lobby.js';
import { FriendsDrawer } from '../FriendsDrawer.js';
import { RoomInviteNotice } from '../RoomInvitePanel.js';
import type { RoomInvitesController } from '../useRoomInvites.js';
import { GameSettings, GameInfo } from '../GameSettings.js';
import { DEFAULT_PREFERENCES } from '../preferences.js';
import { Board } from '../Board.js';
import { BoardViewport } from '../BoardViewport.js';
import { ResourceHand } from '../ResourceHand.js';
import { DevelopmentCards, DevelopmentPurchase } from '../DevelopmentCards.js';
import { PlayerRail } from '../PlayerRail.js';
import { Dices, ArrowLeftRight, X, Settings2, House, Route, Castle } from '../GameIcons.js';
import { createGame, gameView, applyAction } from '../../../../packages/rules/src/game.js';
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
  game.players[0]!.hand = { wood: 3, brick: 2, sheep: 0, wheat: 7, ore: 4 };
  game.players[0]!.cards = [{ id: 'sample-knight', kind: 'knight', boughtTurn: 0 }];
  game.turn = 8;
  return gameView(game, me);
}
const game = sampleGame();
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
function PreviewDialog({
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
  const [panel, setPanel] = useState<'profile' | 'editProfile' | 'friends' | GameToolPanel | null>(null);
  const [concept, setConcept] = useState(false);
  const [showAwards, setShowAwards] = useState(false);
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
  const [preferences, setPreferences] = useState(DEFAULT_PREFERENCES);
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
  const previewGame = {
    ...game,
    diceMode: settings?.diceMode ?? 'classic',
    victoryPoints: settings?.victoryPoints ?? 10,
  };
  const displayedGame = showAwards
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
  return (
    <main
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
            <BoardViewport seed={game.board.seed}>
              <Board
                board={game.board}
                art={concept ? conceptArt : undefined}
                game={game}
                me={me}
                disabled
                mode={null}
                onAction={noop}
                onRobber={noop}
              />
            </BoardViewport>
          </div>
          <PlayerRail room={currentRoom} game={displayedGame} me={me} />
          <GameTools
            panel={panel}
            onPanel={setPanel}
            connected
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
            {[Route, House, Castle].map((Icon, i) => (
              <button key={i} className="build-control">
                <Icon />
                <span className="build-control-label">{['Road', 'House', 'City'][i]}</span>
              </button>
            ))}
          </div>
          <div className="card-table">
            <div className="hand-zone">
              <ResourceHand hand={game.players[0]!.hand!} pulse={{}} reducedMotion onHover={noop} />
              <DevelopmentCards game={game} me={me} disabled reducedMotion onAction={noop} onHover={noop} />
            </div>
            <div className="table-actions">
              <div className="utility-actions">
                <button className="trade-action" aria-label="Trade">
                  <ArrowLeftRight />
                </button>
                <div className="development-hand-inline purchase-control">
                  <DevelopmentPurchase disabled onBuy={noop} />
                </div>
              </div>
              <button className="turn-action roll-turn">
                <Dices />
                <span>Roll</span>
              </button>
            </div>
          </div>
        </>
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
        <PreviewDialog title="Your profile" onClose={() => setPanel(null)}>
          <PlayerProfile
            key={panel}
            initialEditing={panel === 'editProfile'}
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
        <PreviewDialog title="Settings" onClose={() => setPanel(null)}>
          <GameSettings
            preferences={preferences}
            update={(patch) => setPreferences({ ...preferences, ...patch })}
            room={screen === 'lobby' ? currentRoom : null}
            me={me}
            busy={false}
            save={async (next) => setSettings(next)}
            previewSound={noop}
          />
        </PreviewDialog>
      )}
      {panel === 'rules' && (
        <PreviewDialog title="How to play" onClose={() => setPanel(null)}>
          <QuickRules victoryPoints={settings?.victoryPoints} />
        </PreviewDialog>
      )}
      {panel === 'info' && (
        <PreviewDialog title="Game rules" onClose={() => setPanel(null)}>
          <GameInfo room={{ ...currentRoom, game: displayedGame }} />
        </PreviewDialog>
      )}
      {panel === 'journal' && (
        <PreviewDialog title="Move history" onClose={() => setPanel(null)}>
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
      {panel === 'network' && (
        <PreviewDialog title="Connection · sample data" onClose={() => setPanel(null)}>
          <ConnectionPanel
            metrics={{ ...initialMetrics(), samples: [35, 42, 31, 38, 34].map((rtt, i) => ({ at: i, rtt })) }}
            status="connected"
            revision={0}
            pending={false}
            onSync={noop}
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
              checked={concept}
              onChange={(e) => {
                setConcept(e.target.checked);
                setScreen('game');
                setPanel(null);
              }}
            />{' '}
            Concept terrain &amp; ocean
          </label>
          <label>
            <input
              type="checkbox"
              checked={showAwards}
              onChange={(e) => {
                setShowAwards(e.target.checked);
                setScreen('game');
                setPanel(null);
              }}
            />{' '}
            Show sample awards
          </label>
        </nav>
      </details>
    </main>
  );
}

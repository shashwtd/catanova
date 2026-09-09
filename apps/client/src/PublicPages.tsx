import { EntryScreen } from './EntryScreen.js';
import { BrandLogo } from './BrandLogo.js';
import { ResourceIcon } from './Board.js';
import { DevelopmentArt } from './DevelopmentCards.js';
import { GameIcon } from './GameIcons.js';
import type { GameIconName } from './GameIcons.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { useAuth } from './auth.js';

export const SITE_URL = 'https://catanova.io';
export const REPOSITORY_URL = 'https://github.com/shashwtd/catanova';
export const PUBLIC_PAGES = [
  {
    path: '/',
    title: 'Catanova — Catan Alternative for Friends',
    description:
      'Build, trade and settle an island with friends. Catanova is an open-source Catan-style browser game for 2–4 players, with private rooms and recoverable multiplayer.',
  },
  {
    path: '/guide/',
    title: 'How to Play Catanova — Rules, Resources & Multiplayer Guide',
    description:
      'Learn to play Catanova: create a room, invite friends, build settlements, trade resources and race to 10 points. A quick guide for your first game.',
  },
] as const;

export function PublicMetadata({ page }: { page: (typeof PUBLIC_PAGES)[number] }) {
  return (
    <>
      <title>{page.title}</title>
      <meta name="description" content={page.description} />
      <link rel="canonical" href={`${SITE_URL}${page.path}`} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Catanova" />
      <meta property="og:locale" content="en_US" />
      <meta property="og:title" content={page.title} />
      <meta property="og:description" content={page.description} />
      <meta property="og:url" content={`${SITE_URL}${page.path}`} />
      <meta property="og:image" content={`${SITE_URL}/branding/social-card.jpg`} />
      <meta property="og:image:type" content="image/jpeg" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta
        property="og:image:alt"
        content="Catanova's sunny island emblem and wordmark above a painted island coast"
      />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={page.title} />
      <meta name="twitter:description" content={page.description} />
      <meta name="twitter:image" content={`${SITE_URL}/branding/social-card.jpg`} />
      <meta name="twitter:image:alt" content="Catanova — build, trade and play with friends" />
      <link rel="icon" type="image/x-icon" href="/branding/favicon.ico" />
      <link rel="icon" type="image/png" sizes="48x48" href="/branding/favicon-48.png" />
      <link rel="icon" type="image/png" sizes="96x96" href="/branding/favicon-96.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/branding/apple-touch-icon.png" />
      <link rel="manifest" href="/site.webmanifest" />
    </>
  );
}

const noop = () => {};
/** Discover the welcome artwork before CSS, without preloading it on private game routes. */
export function PublicArtPreloads() {
  return (
    <>
      <link
        rel="preload"
        as="image"
        type="image/webp"
        href="/art/optimized/catanova-logo-v2.a161a887edbc.webp"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        type="image/webp"
        href="/art/optimized/title-landscape.05db8101ac33.webp"
        fetchPriority="low"
      />
    </>
  );
}
/** Render the same public entry UI before React loads, without reading account/session data. */
export function PublicLanding() {
  const auth = {
    config: null,
    user: null,
    account: null,
    profile: defaultProfile(''),
    loading: true,
    canPlay: false,
    needsOnboarding: false,
  } as ReturnType<typeof useAuth>;
  return (
    <main className="game-world entry-world" data-motion="reduced">
      <div className="title-scenery" aria-hidden="true" />
      <EntryScreen
        auth={auth}
        entry="home"
        setEntry={noop}
        name=""
        setName={noop}
        code=""
        setCode={noop}
        invite={null}
        previewRoom={null}
        previewLoading={false}
        previewError=""
        resumableInvite={false}
        busy={false}
        onEnter={noop}
        onResume={noop}
        onBack={noop}
        onProfile={noop}
        onFriends={noop}
        onSettings={noop}
        onSignOut={noop}
      />
      <noscript>
        <p className="no-script-note">
          Enable JavaScript to play. The <a href="/guide/">game guide</a> works without it.
        </p>
      </noscript>
    </main>
  );
}

const sections = [
  ['start', 'Your first game', 'invite'],
  ['resources', 'Resources & costs', 'settlement'],
  ['turn', 'Taking a turn', 'dice'],
  ['trading', 'Trading & ports', 'trade'],
  ['development', 'Development cards', 'development'],
  ['winning', 'Reaching ten', 'trophy'],
  ['accounts', 'Your profile & seat', 'profile'],
] as const;

const terrainNames: Record<Resource, string> = {
  wood: 'Forest',
  brick: 'Hills',
  sheep: 'Pasture',
  wheat: 'Fields',
  ore: 'Mountains',
};

function GuideResource({ resource, count }: { resource: Resource; count: number }) {
  return (
    <span className="guide-cost-token" data-resource={resource}>
      <span aria-hidden="true">
        <ResourceIcon resource={resource} />
      </span>
      <span>
        {count} {RESOURCE_NAMES[resource]}
      </span>
    </span>
  );
}

function GuideHeading({ number, icon, children }: { number: string; icon: GameIconName; children: string }) {
  return (
    <div className="guide-section-heading">
      <span className="guide-section-number" aria-hidden="true">
        {number}
      </span>
      <h2>{children}</h2>
      <GameIcon name={icon} size={34} />
    </div>
  );
}

/** An illustrated public reference, rendered as HTML with no client bundle or sign-in requirement. */
export function PublicGuide() {
  return (
    <>
      <a className="guide-skip" href="#guide-content">
        Skip to guide
      </a>
      <header className="guide-header">
        <a className="guide-brand" href="/" aria-label="Catanova home">
          <BrandLogo />
        </a>
        <a className="guide-play" href="/">
          Play with friends <GameIcon name="next" size={22} />
        </a>
      </header>
      <div className="guide-hero">
        <div className="guide-hero-copy">
          <p className="guide-eyebrow">The player guide</p>
          <h1>
            How to play
            <br />
            Catanova
          </h1>
          <p>Build roads, grow settlements into cities, and be first to ten points on your own turn.</p>
          <div className="guide-hero-links">
            <a className="guide-start-link" href="#start">
              Start here <GameIcon name="next" size={20} />
            </a>
            <a href="#resources">Just need the costs?</a>
          </div>
        </div>
        <div className="guide-hero-facts" aria-label="Game at a glance">
          <span>
            <GameIcon name="invite" size={23} />
            2–4 friends
          </span>
          <span>
            <GameIcon name="trophy" size={23} />
            10 points to win
          </span>
          <span>
            <GameIcon name="lock" size={23} />
            Private rooms
          </span>
        </div>
      </div>
      <div className="guide-layout">
        <nav className="guide-nav" aria-label="On this page">
          <strong>In this guide</strong>
          <div className="guide-nav-links">
            {sections.map(([id, label, icon]) => (
              <a key={id} href={`#${id}`}>
                <GameIcon name={icon} size={23} />
                {label}
              </a>
            ))}
          </div>
          <a className="guide-full-rules" href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`}>
            <GameIcon name="help" size={23} />
            Full rulebook
          </a>
        </nav>
        <main id="guide-content" className="guide-content">
          <section id="start" className="guide-section">
            <GuideHeading number="01" icon="invite">
              Your first game
            </GuideHeading>
            <p className="guide-section-intro">Create or join a room, then start together.</p>
            <ol className="guide-start-steps">
              <li>
                <span className="guide-step-index" aria-hidden="true">
                  1
                </span>
                <h3>Find your room</h3>
                <p>
                  <strong>Create room</strong> opens your lobby. Choose <strong>Join room</strong> for a
                  friend’s code, or open their invite link.
                </p>
              </li>
              <li>
                <span className="guide-step-index" aria-hidden="true">
                  2
                </span>
                <h3>Choose your profile</h3>
                <p>
                  Continue with Google or as a guest. Pick a username and portrait, then share the room link
                  with your friends.
                </p>
              </li>
              <li>
                <span className="guide-step-index" aria-hidden="true">
                  3
                </span>
                <h3>Ready, then start</h3>
                <p>
                  The other players select <strong>Ready</strong>. The host selects <strong>Start</strong>{' '}
                  once everyone is connected and ready.
                </p>
              </li>
            </ol>
            <div className="guide-setup">
              <div>
                <h3>Your first two settlements</h3>
                <p>
                  Place a settlement and a road touching it. Everyone takes a first placement, then the order
                  reverses for the second.
                </p>
                <p>
                  Your <strong>second settlement</strong> gives you one resource from each neighboring
                  productive tile. Setup pieces are free.
                </p>
              </div>
              <div
                className="guide-draft"
                aria-label="Four-player setup order: one, two, three, four, four, three, two, one"
              >
                <span className="guide-small-label">Four-player setup</span>
                <div aria-hidden="true">
                  {[1, 2, 3, 4, 4, 3, 2, 1].map((seat, index) => (
                    <span key={index} data-seat={seat}>
                      {seat}
                    </span>
                  ))}
                </div>
                <small>Clockwise, then reverse.</small>
              </div>
            </div>
            <details className="guide-note">
              <summary>Two-player rooms & balanced islands</summary>
              <p>
                Two-player rooms are Catanova’s custom option using the same island and ten-point goal,
                without neutral players. The default balanced map also uses custom fairness constraints.
                Three- and four-player games are the base-game compatibility target. There is no solo mode or
                public matchmaking.
              </p>
            </details>
          </section>
          <section id="resources" className="guide-section">
            <GuideHeading number="02" icon="settlement">
              Resources & building costs
            </GuideHeading>
            <p className="guide-section-intro">
              Five resources pay for everything you build. Learn the pictures and you’ll know your hand at a
              glance.
            </p>
            <div className="guide-resources" aria-label="The five resources">
              {RESOURCES.map((resource) => (
                <div key={resource} data-resource={resource}>
                  <span aria-hidden="true">
                    <ResourceIcon resource={resource} />
                  </span>
                  <strong>{RESOURCE_NAMES[resource]}</strong>
                  <small>{terrainNames[resource]}</small>
                </div>
              ))}
            </div>
            <p className="guide-caption">
              A tile produces when its number is rolled. The desert produces nothing.
            </p>
            <div className="guide-builds" aria-label="Building costs">
              {(
                [
                  [
                    'road',
                    'Road',
                    'road',
                    'Extend your route by one edge. Connect to your own road or building; you cannot build through an opponent’s building.',
                  ],
                  [
                    'settlement',
                    'Settlement',
                    'settlement',
                    'Worth 1 point. Collects 1 resource from each neighboring tile that produces. After setup, it must touch one of your roads.',
                  ],
                  [
                    'city',
                    'City upgrade',
                    'city',
                    'Worth 2 points total. Replace your own settlement and collect 2 resources instead of 1. The settlement piece returns to your supply.',
                  ],
                  [
                    'developmentCard',
                    'Development card',
                    'development',
                    'Draw a hidden card from the deck. You can buy more than one if you can pay and cards remain.',
                  ],
                ] as const
              ).map(([kind, name, icon, benefit]) => (
                <article className="guide-build" key={kind}>
                  <div className="guide-build-heading">
                    <GameIcon name={icon} size={42} />
                    <h3>{name}</h3>
                  </div>
                  <span className="guide-small-label">Cost · pay the bank</span>
                  <div className="guide-costs">
                    {RESOURCES.filter((resource) => COSTS[kind][resource]).map((resource) => (
                      <GuideResource key={resource} resource={resource} count={COSTS[kind][resource]} />
                    ))}
                  </div>
                  <p>{benefit}</p>
                </article>
              ))}
            </div>
            <aside className="guide-tip">
              <GameIcon name="settlement" size={34} />
              <div>
                <strong>Leave room to grow.</strong>
                <p>
                  Keep at least one empty corner between any two settlements or cities, including your own.
                  Preview a legal build site, then confirm the placement.
                </p>
              </div>
            </aside>
          </section>
          <section id="turn" className="guide-section">
            <GuideHeading number="03" icon="dice">
              A turn, in three steps
            </GuideHeading>
            <ol className="guide-turn-steps">
              <li>
                <GameIcon name="dice" size={38} />
                <h3>Roll & collect</h3>
                <p>
                  Matching tiles pay every neighboring player, whoever rolled. Settlements collect one; cities
                  collect two.
                </p>
              </li>
              <li>
                <GameIcon name="trade" size={38} />
                <h3>Trade & build</h3>
                <p>
                  Make trades and purchases in any order. Keep going while you have legal moves and resources
                  to spend.
                </p>
              </li>
              <li>
                <GameIcon name="next" size={38} />
                <h3>End your turn</h3>
                <p>
                  Pass to the next player. Their portrait shows the next required action, such as rolling or
                  moving the robber.
                </p>
              </li>
            </ol>
            <p>
              A playable development card can be used before rolling, or during your action phase. Finish its
              effect before taking another action.
            </p>
            <div className="guide-robber">
              <GameIcon name="robber" size={54} />
              <div>
                <h3>Rolled a 7?</h3>
                <p>
                  No resources are produced. Everyone with <strong>more than seven resource cards</strong>{' '}
                  discards half, rounded down. Development cards do not count.
                </p>
                <p>
                  After all discards, move the robber to a different land tile and steal one random resource
                  from one eligible neighboring opponent. That tile stops producing until the robber moves
                  again.
                </p>
              </div>
            </div>
            <details className="guide-note">
              <summary>What if the bank runs short?</summary>
              <p>
                If several players need a resource and the bank cannot pay everyone, nobody receives that
                resource from the roll. If only one player is entitled to it, they receive what remains, up to
                their entitlement. Other resources still produce normally.
              </p>
            </details>
            <details className="guide-note">
              <summary>Optional turn timer</summary>
              <p>
                The host can leave it off or choose 40, 65, 90, 115 or 140 seconds before the game. Expiry
                completes required actions using the server’s rule-valid defaults and ends the turn. It does
                not buy pieces or accept trades for you. Setup placements are untimed; required discards have
                their own countdowns.
              </p>
            </details>
          </section>
          <section id="trading" className="guide-section">
            <GuideHeading number="04" icon="trade">
              Trading & ports
            </GuideHeading>
            <p className="guide-section-intro">Need one last resource? Ask a friend, or use the bank.</p>
            <div className="guide-player-trade">
              <GameIcon name="trade" size={42} />
              <div>
                <h3>Trade with a player</h3>
                <p>
                  On your turn, select <strong>Trade</strong>. Click the cards you give and the cards you
                  want. Choose <strong>? Open to offers</strong> to let friends propose a return. Both sides
                  must give something, and every trade includes the active player.
                </p>
              </div>
            </div>
            <div className="guide-port-rates">
              <article>
                <GameIcon name="cards" size={35} />
                <h3>The bank</h3>
                <strong className="guide-ratio">
                  4<span>:1</span>
                </strong>
                <p>Always available on your turn.</p>
                <div className="guide-trade-example">
                  <GuideResource resource="brick" count={4} />
                  <span className="guide-exchange" role="img" aria-label="for">
                    <GameIcon name="next" size={18} />
                  </span>
                  <GuideResource resource="wheat" count={1} />
                </div>
              </article>
              <article>
                <GameIcon name="boat" size={35} />
                <h3>A general port</h3>
                <strong className="guide-ratio">
                  3<span>:1</span>
                </strong>
                <p>Three cards of any one resource.</p>
                <div className="guide-trade-example">
                  <GuideResource resource="sheep" count={3} />
                  <span className="guide-exchange" role="img" aria-label="for">
                    <GameIcon name="next" size={18} />
                  </span>
                  <GuideResource resource="ore" count={1} />
                </div>
              </article>
              <article>
                <GameIcon name="boat" size={35} />
                <h3>A resource port</h3>
                <strong className="guide-ratio">
                  2<span>:1</span>
                </strong>
                <p>Two of the port’s named resource.</p>
                <div className="guide-trade-example">
                  <GuideResource resource="wood" count={2} />
                  <span className="guide-exchange" role="img" aria-label="for">
                    <GameIcon name="next" size={18} />
                  </span>
                  <GuideResource resource="brick" count={1} />
                </div>
                <small>Example: a Timber port</small>
              </article>
            </div>
            <aside className="guide-tip">
              <GameIcon name="boat" size={36} />
              <div>
                <strong>Follow the ship’s two bridges.</strong>
                <p>
                  A settlement or city at either connected coastal corner unlocks the port. A road alone does
                  not. The port’s picture is what you <em>pay</em>; take any different resource available in
                  the bank.
                </p>
              </div>
            </aside>
            <p className="guide-caption">
              The question-mark ports are general 3:1 ports. There are four of these and one 2:1 port for each
              resource.
            </p>
          </section>
          <section id="development" className="guide-section">
            <GuideHeading number="05" icon="development">
              Development cards
            </GuideHeading>
            <p className="guide-section-intro">
              Select a held development card to read its effect, then play it. No dragging required.
            </p>
            <div className="guide-card-timing">
              <GameIcon name="timer" size={29} />
              <p>
                <strong>One action card per turn.</strong> Bought it this turn? Wait until your next. Hidden
                Victory Point cards count immediately.
              </p>
            </div>
            <ul className="guide-development-cards">
              {(
                [
                  [
                    'knight',
                    'Knight',
                    'Move the robber and steal from an eligible neighbor. Nobody discards. Played Knights count toward Largest Army.',
                  ],
                  [
                    'roadBuilding',
                    'Road Building',
                    'Place two legal roads without paying their resource costs, subject to your remaining pieces and available sites.',
                  ],
                  [
                    'yearOfPlenty',
                    'Year of Plenty',
                    'Choose two available resource cards from the bank. They can be the same resource or two different ones.',
                  ],
                  [
                    'monopoly',
                    'Monopoly',
                    'Choose one resource. Every opponent gives you all the cards they hold of that type.',
                  ],
                  [
                    'victoryPoint',
                    'Victory Point',
                    'One hidden point, including on the turn you buy it. It counts toward your total; you do not need to play it as an action.',
                  ],
                ] as const
              ).map(([kind, name, description]) => (
                <li key={kind} data-card={kind}>
                  <div className="guide-development-art">
                    <DevelopmentArt kind={kind} />
                  </div>
                  <div>
                    <h3>{name}</h3>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ul>
            <details className="guide-note">
              <summary>Rare card cases in this playtest</summary>
              <p>
                Road Building requires a legal first road and uses a second whenever possible. Year of Plenty
                takes one card if it is the only card left in the bank, and cannot be played into an empty
                bank. These are provisional interpretations; the{' '}
                <a href={`${REPOSITORY_URL}/blob/main/docs/RULE_SOURCES.md`}>compatibility ledger</a> tracks
                the remaining source questions.
              </p>
            </details>
          </section>
          <section id="winning" className="guide-section">
            <GuideHeading number="06" icon="trophy">
              How to win
            </GuideHeading>
            <div className="guide-win-goal">
              <span aria-hidden="true">10</span>
              <div>
                <h3>Win on your own turn.</h3>
                <p>
                  Reach ten points <strong>on your own turn</strong> to win immediately. If you reach ten on
                  someone else’s turn, wait until your turn and still have enough then.
                </p>
              </div>
              <GameIcon name="trophy" size={60} />
            </div>
            <div className="guide-scoring" aria-label="Victory point values">
              {(
                [
                  ['settlement', 'Settlement', '1'],
                  ['city', 'City', '2'],
                  ['development', 'Hidden point card', '1'],
                  ['road', 'Longest Road', '2'],
                  ['shield', 'Largest Army', '2'],
                ] as const
              ).map(([icon, name, points]) => (
                <div key={name}>
                  <GameIcon name={icon} size={34} />
                  <strong>{points}</strong>
                  <span>{name}</span>
                </div>
              ))}
            </div>
            <p className="guide-caption">
              A city is worth two points <em>total</em>, replacing the settlement’s point. Roads do not score
              points by themselves.
            </p>
            <div className="guide-awards">
              <article>
                <GameIcon name="road" size={40} />
                <div>
                  <h3>Longest Road</h3>
                  <p>
                    The first continuous route of at least <strong>five roads</strong> earns it. Opponents’
                    buildings can break a route; separate branches do not simply add together.
                  </p>
                </div>
              </article>
              <article>
                <GameIcon name="shield" size={40} />
                <div>
                  <h3>Largest Army</h3>
                  <p>
                    The first player to play <strong>three Knights</strong> earns it. Knights still in your
                    hand do not count.
                  </p>
                </div>
              </article>
            </div>
            <p>
              Both awards appear on player profiles. To take one, exceed the holder’s qualifying total. Ties
              normally leave an award where it is; the{' '}
              <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md#10-longest-road`}>full road rules</a>{' '}
              cover ties after a route is broken.
            </p>
          </section>
          <section id="accounts" className="guide-section">
            <GuideHeading number="07" icon="profile">
              Your profile & seat
            </GuideHeading>
            <div className="guide-account-notes">
              <article>
                <GameIcon name="profile" size={38} />
                <h3>A profile that stays yours</h3>
                <p>
                  Google sign-in keeps your profile and enables friends. Guests expire after seven days of
                  inactivity. Guests can link Google to keep their username. They cannot add friends while
                  still guests.
                </p>
              </article>
              <article>
                <GameIcon name="connection" size={38} />
                <h3>Connection dropped?</h3>
                <p>
                  Let the game reconnect. Return with the same account and invite to recover your seat. The
                  connection panel shows ping and sync status. Keep your guest session and browser storage
                  while playing.
                </p>
              </article>
            </div>
          </section>
          <div className="guide-ready">
            <div>
              <h2>Ready to play?</h2>
              <p>Create a room or join a friend’s invitation.</p>
            </div>
            <a className="guide-play" href="/">
              Play with friends <GameIcon name="next" size={22} />
            </a>
          </div>
          <footer className="guide-footer">
            <div>
              <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`}>Full rulebook</a>
              <a href={`${REPOSITORY_URL}/blob/main/docs/PLAYTEST.md`}>Playtest limitations</a>
              <a href={REPOSITORY_URL}>Open on GitHub</a>
              <a className="guide-back-top" href="#guide-content">
                Back to top <GameIcon name="next" size={18} />
              </a>
            </div>
            <p>
              Catanova is an independent, unofficial project, unaffiliated with CATAN’s owners. CATAN is a
              trademark of its respective owners. This guide covers the current playtest; development is
              ongoing.
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}

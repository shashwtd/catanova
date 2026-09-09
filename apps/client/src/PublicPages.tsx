import { EntryScreen } from './EntryScreen.js';
import { BrandLogo } from './BrandLogo.js';
import { ResourceIcon } from './Board.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import { COSTS, RESOURCES, RESOURCE_NAMES } from '../../../packages/rules/src/index.js';
import type { useAuth } from './auth.js';

export const SITE_URL = 'https://catanova.io';
export const REPOSITORY_URL = 'https://github.com/shashwtd/catanova';
export const PUBLIC_PAGES = [
  {
    path: '/',
    title: 'Catanova — Open-Source Catan Alternative for Friends',
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
  ['start', 'Start a game'],
  ['resources', 'Resources & costs'],
  ['turn', 'Your turn'],
  ['trading', 'Trading & ports'],
  ['development', 'Development cards'],
  ['winning', 'Winning'],
  ['accounts', 'Accounts & reconnecting'],
] as const;

/** A small public reference, built as HTML with no client bundle or sign-in requirement. */
export function PublicGuide() {
  return (
    <>
      <a className="guide-skip" href="#guide-content">
        Skip to guide
      </a>
      <header className="guide-header">
        <a href="/" aria-label="Catanova home">
          <BrandLogo />
        </a>
        <a className="guide-play" href="/">
          Play with friends
        </a>
      </header>
      <div className="guide-layout">
        <nav className="guide-nav" aria-label="On this page">
          <strong>How to play</strong>
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
          <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`}>Full rulebook</a>
        </nav>
        <main id="guide-content" className="guide-paper">
          <p className="guide-eyebrow">The Catanova field guide</p>
          <h1>How to play Catanova</h1>
          <p className="guide-lead">
            Build roads, trade with friends and grow settlements into cities. First to 10 points on their own
            turn wins.
          </p>
          <p>
            Catanova is an open-source Catan alternative for private multiplayer games in your browser. Play
            with 2–4 players in a room; there is no solo mode or public matchmaking.
          </p>
          <section id="start">
            <h2>Start a game</h2>
            <ol>
              <li>
                <strong>Create room</strong> starts your own lobby. <strong>Join room</strong> opens a
                friend’s room using their code. An invite link takes you directly to that room’s join screen.
              </li>
              <li>Continue with Google or play as a guest, then choose your username and portrait.</li>
              <li>
                Share the room link. Other players select <strong>Ready</strong>; the host selects{' '}
                <strong>Start</strong>. The host does not need to mark themselves ready.
              </li>
            </ol>
            <p>
              Place one settlement and an adjoining road, then take a second placement in reverse player
              order. Your second settlement gives you one starting resource from each neighboring productive
              tile. Leave at least two road edges between settlements, including opponents’ settlements.
            </p>
            <aside>
              Two-player rooms are Catanova’s custom option using the same island and ten-point goal. They do
              not implement the official neutral-player variant. The default balanced map also uses custom
              fairness constraints.
            </aside>
          </section>
          <section id="resources">
            <h2>Resources & building costs</h2>
            <p>
              Each landscape produces its own resource when its number is rolled. The desert produces nothing.
            </p>
            <div className="guide-resources">
              {RESOURCES.map((resource) => (
                <div key={resource}>
                  <ResourceIcon resource={resource} />
                  <strong>{RESOURCE_NAMES[resource]}</strong>
                </div>
              ))}
            </div>
            <div className="guide-table-scroll">
              <table>
                <caption>Pay these cards back to the bank</caption>
                <thead>
                  <tr>
                    <th scope="col">Build or buy</th>
                    <th scope="col">Cost</th>
                    <th scope="col">What you get</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['road', 'Road', 'Extends your route along one edge'],
                      [
                        'settlement',
                        'Settlement',
                        '1 point; collects 1 resource per neighboring producing tile',
                      ],
                      ['city', 'City upgrade', '2 points total; collects 2 instead of 1'],
                      ['developmentCard', 'Development card', 'A hidden card from the deck'],
                    ] as const
                  ).map(([kind, name, benefit]) => (
                    <tr key={kind}>
                      <th scope="row">{name}</th>
                      <td>
                        {RESOURCES.filter((r) => COSTS[kind][r])
                          .map((r) => `${COSTS[kind][r]} ${RESOURCE_NAMES[r]}`)
                          .join(' + ')}
                      </td>
                      <td>{benefit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              After setup, new settlements must connect to your roads and keep the distance rule. Cities
              replace your own settlements. Choose a build action or hover a legal, affordable site, then
              confirm the placement.
            </p>
          </section>
          <section id="turn">
            <h2>Your turn</h2>
            <p>
              <strong>Roll, collect, trade, build, end.</strong> A matching tile supplies neighboring
              settlements and cities, whoever rolled. The bank’s limited supply can reduce or prevent a
              payout. A tile with the robber produces nothing.
            </p>
            <p>
              On a <strong>7</strong>, no tiles produce. Everyone holding more than seven resource cards
              discards half, rounded down. The active player moves the robber to another tile and steals one
              random resource from an eligible neighboring opponent.
            </p>
            <p>
              You can trade and build in any order after resolving the roll. A playable development card may
              also be used before rolling. Follow the activity icon beside the active player’s portrait.
            </p>
            <p>
              The host can leave the timer off or choose 40, 65, 90, 115 or 140 seconds. When enabled, expiry
              completes required actions using the server’s rule-valid defaults and ends the turn; setup
              placements are untimed.
            </p>
          </section>
          <section id="trading">
            <h2>Trading & ports</h2>
            <p>
              Select <strong>Trade</strong> on your turn. Click the cards you offer and the cards you want.
              Choose <strong>?</strong> for an open offer so another player can propose the return. You choose
              whether to accept.
            </p>
            <p>
              The bank normally takes <strong>4 identical resources for 1</strong> resource of your choice. A
              general port changes that to <strong>3:1</strong>; a specific port trades{' '}
              <strong>2 of its named resource for 1</strong>. Own a settlement or city at either of the ship’s
              two connected coastal corners to use it.
            </p>
            <p>
              A question-mark port is a general port, not a hidden reward. There are four general ports and
              one for each of the five resources. Trades depend on the cards actually available.
            </p>
          </section>
          <section id="development">
            <h2>Development cards</h2>
            <p>
              Buy with Sheep, Hay and Rock. New action cards become playable on your next turn, and you may
              play at most one action card per turn. Select a held card to read its effect and play it; you
              never need to drag it onto the island.
            </p>
            <dl className="guide-effects">
              <div>
                <dt>Knight</dt>
                <dd>
                  Move the robber and steal from an eligible neighbor. Knights played count toward Largest
                  Army.
                </dd>
              </div>
              <div>
                <dt>Road Building</dt>
                <dd>
                  Place two roads without paying their resource costs, subject to legal sites and your
                  remaining pieces.
                </dd>
              </div>
              <div>
                <dt>Year of Plenty</dt>
                <dd>
                  Take two resources of your choice from the bank, or one if only one card remains in the
                  entire bank.
                </dd>
              </div>
              <div>
                <dt>Monopoly</dt>
                <dd>Name a resource. Every opponent gives you all of that resource.</dd>
              </div>
              <div>
                <dt>Victory Point</dt>
                <dd>A hidden point that counts immediately. It is not an action card you need to play.</dd>
              </div>
            </dl>
          </section>
          <section id="winning">
            <h2>Race to ten</h2>
            <p>
              Settlements are worth <strong>1 point</strong>; cities are worth <strong>2 total</strong>.
              Hidden Victory Point cards add to your own total. Reach ten on your turn to win.
            </p>
            <p>
              <strong>Longest Road</strong> and <strong>Largest Army</strong> each add two points and appear
              as profile badges. The first qualifying route needs at least five roads; the first army needs
              three played Knights. A challenger must exceed the holder’s qualifying total to take the award.
              For blocked routes and ties after a route is broken, see the full rulebook.
            </p>
          </section>
          <section id="accounts">
            <h2>Keep your seat</h2>
            <p>
              Google sign-in keeps your profile and enables friends. Guest profiles expire after seven days of
              inactivity. Guests can link Google to keep their username and unlock friends; they cannot add
              friends while still guests.
            </p>
            <p>
              If the connection drops, let the game reconnect. Return using the same account and invite to
              recover an account-owned seat. The connection panel shows ping and sync status. Avoid clearing
              your guest session or browser storage while a game is in progress.
            </p>
            <p>
              Development is ongoing.{' '}
              <a href={`${REPOSITORY_URL}/blob/main/docs/PLAYTEST.md`}>Current limitations</a> and the{' '}
              <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`}>complete rulebook</a> explain edge
              cases and the current compatibility target.
            </p>
          </section>
          <footer className="guide-footer">
            <p>
              Made for playing together. <a href={REPOSITORY_URL}>Explore Catanova on GitHub</a>.
            </p>
            <small>
              Catanova is an independent, unofficial project, unaffiliated with CATAN’s owners. CATAN is a
              trademark of its respective owners.
            </small>
          </footer>
        </main>
      </div>
    </>
  );
}

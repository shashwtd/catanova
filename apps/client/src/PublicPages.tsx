import type { ReactNode } from 'react';
import { EntryScreen } from './EntryScreen.js';
import { BrandLogo } from './BrandLogo.js';
import { ResourceIcon } from './Board.js';
import { DevelopmentArt } from './DevelopmentCards.js';
import { GameIcon, GithubMark } from './GameIcons.js';
import { ReactionFace } from './ReactionArt.js';
import { REACTIONS, REACTION_LIST } from '../../../packages/protocol/src/reactions.js';
import type { GameIconName } from './GameIcons.js';
import type { Resource } from '../../../packages/rules/src/index.js';
import { defaultProfile } from '../../../packages/protocol/src/profile.js';
import {
  COSTS,
  DEVELOPMENT_DECK,
  RESOURCES,
  RESOURCE_NAMES,
  RULESET,
  SUPPLY,
} from '../../../packages/rules/src/index.js';
import type { useAuth } from './auth.js';

export const SITE_URL = 'https://catanova.io';
export const REPOSITORY_URL = 'https://github.com/shashwtd/catanova';
export const SOCIAL_CARD_ALT =
  'The Catanova wordmark in gold above a sunny island coast, under the line Build. Trade. Settle.';
/**
 * What a search result says.
 *
 * Written as sentences a person would say out loud. The old ones were title
 * case with an em dash in the middle and a list of keywords after it, which is
 * how a page announces that nobody wrote it. Catan is named because that is
 * genuinely the fastest way to tell somebody what this is, and the footer of
 * every page says plainly that this is not an official CATAN game.
 */
export const PUBLIC_PAGES = [
  {
    path: '/',
    title: 'Catanova: play a Catan-style game with friends',
    description:
      'A free island trading game for two to four friends, in your browser. Build, trade and race to ten points. If you know Catan, you already know how to play.',
  },
  {
    path: '/guide/',
    title: 'How to play Catanova: rules, costs and your first game',
    description:
      'Create a room, invite friends and learn what everything costs. A short guide to your first game of Catanova, from the opening placements to the tenth point.',
  },
  {
    path: '/privacy/',
    title: 'Privacy at Catanova: what we keep and who handles it',
    description:
      'What Catanova keeps when you play, which services help run it, how to turn analytics on or off, and how to ask for your data to be deleted.',
  },
] as const;

/**
 * Where people write about their data.
 *
 * TODO(owner): a placeholder, not an address. Replace it with a real inbox that
 * somebody reads before this page is deployed; the build warns while it is
 * still the placeholder. Never invent one.
 */
export const PRIVACY_CONTACT = 'TODO-owner-email';
/** The date the privacy page last changed, shown on the page and in its structured data. */
export const PRIVACY_UPDATED = { text: '23 September 2026', iso: '2026-09-23' } as const;

/**
 * The questions people actually arrive with.
 *
 * Kept here rather than inline in the page because they are rendered twice:
 * once for a reader, and once as structured data for search engines and the
 * assistants that now answer these questions on a site's behalf. Two copies
 * that could drift apart would eventually be a page that says one thing and a
 * search result that says another, so there is only one.
 */
export const GUIDE_FAQ = [
  {
    question: 'What is Catanova?',
    answer:
      'Catanova is a free online island-building game for two to four friends: collect resources, trade, and build your way to ten points. It is an independent game with its own artwork, rules text and interface, not an official CATAN game, and its code is open source on GitHub.',
  },
  {
    question: 'Is Catanova free to play?',
    answer:
      'Yes. The whole game is free, there is nothing to buy inside it, and no part of the board is held back. You can start a room as a guest without making an account.',
  },
  {
    question: 'Can phones and computers play together?',
    answer:
      'Yes. Open catanova.io in any modern browser and join the same private room from a phone, tablet or computer. Nothing is installed. You need an internet connection while you play.',
  },
  {
    question: 'How many players do you need?',
    answer:
      'Two to four. Three and four player games follow the familiar rules. Two player games are our own option, on the same island and to the same ten points, without neutral players.',
  },
  {
    question: 'Can I play on my own, or fill an empty seat?',
    answer:
      'Yes. The host can add a bot to any open seat, and bots also cover a seat if somebody loses their connection mid-game, handing it straight back when that player returns. There is no public matchmaking: rooms are private and you share a code or a link.',
  },
  {
    question: 'What happens if someone disconnects?',
    answer:
      'After about half a minute, a bot covers their turns while someone remains at the table. They resume the current game state when they reconnect, including moves made by the bot. If everyone disconnects, play pauses and the room is abandoned after three minutes without a return.',
  },
] as const;

/**
 * What the machines are told.
 *
 * Two audiences read a page now: search engines, which want the facts as
 * data, and the assistants people increasingly ask instead of searching,
 * which quote whatever is unambiguous. Both are served by saying the same
 * things the page says, in a shape that cannot be misread: the number of
 * players, the price, that it runs in a browser, and that it is not an
 * official CATAN game. None of it claims anything the page does not.
 */
function structuredData(page: (typeof PUBLIC_PAGES)[number]) {
  const game = {
    '@type': 'VideoGame',
    '@id': `${SITE_URL}/#game`,
    name: 'Catanova',
    alternateName: 'Catanova island trading game',
    url: `${SITE_URL}/`,
    description: PUBLIC_PAGES[0].description,
    image: `${SITE_URL}/branding/social-card-v3.jpg`,
    applicationCategory: 'GameApplication',
    genre: ['Strategy', 'Board game', 'Multiplayer'],
    gamePlatform: 'Web browser',
    operatingSystem: 'Any modern web browser',
    playMode: 'MultiPlayer',
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 2, maxValue: 4 },
    inLanguage: 'en',
    isAccessibleForFree: true,
    isFamilyFriendly: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
    },
    license: `${REPOSITORY_URL}/blob/main/LICENSE`,
    sameAs: [REPOSITORY_URL],
    disambiguatingDescription:
      'An independent, open-source game inspired by Catan. Not affiliated with or endorsed by the owners of the CATAN trademark.',
  };
  const graph: Record<string, unknown>[] =
    page.path === '/guide/'
      ? [
          {
            '@type': 'HowTo',
            '@id': `${SITE_URL}/guide/#howto`,
            name: page.title,
            description: page.description,
            url: `${SITE_URL}/guide/`,
            about: { '@id': `${SITE_URL}/#game` },
            step: [
              {
                '@type': 'HowToStep',
                name: 'Open a room',
                text: 'Create a room, or join a friend with their code or invite link.',
              },
              {
                '@type': 'HowToStep',
                name: 'Place your first settlements',
                text: 'Each player places two settlements and two roads, in order and then back again.',
              },
              {
                '@type': 'HowToStep',
                name: 'Take turns',
                text: 'Roll the dice, collect what your settlements and cities produce, then build or trade.',
              },
              {
                '@type': 'HowToStep',
                name: 'Reach ten points',
                text: 'Settlements, cities, the longest road, the largest army and victory point cards all score. Ten on your own turn wins.',
              },
            ],
          },
          {
            '@type': 'FAQPage',
            '@id': `${SITE_URL}/guide/#faq`,
            mainEntity: GUIDE_FAQ.map((entry) => ({
              '@type': 'Question',
              name: entry.question,
              acceptedAnswer: { '@type': 'Answer', text: entry.answer },
            })),
          },
          game,
        ]
      : page.path === '/privacy/'
        ? [
            {
              '@type': 'WebPage',
              '@id': `${SITE_URL}/privacy/#page`,
              name: page.title,
              description: page.description,
              url: `${SITE_URL}/privacy/`,
              inLanguage: 'en',
              dateModified: PRIVACY_UPDATED.iso,
            },
          ]
        : [game];
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

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
      <meta property="og:image" content={`${SITE_URL}/branding/social-card-v3.jpg`} />
      <meta property="og:image:type" content="image/jpeg" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={SOCIAL_CARD_ALT} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={page.title} />
      <meta name="twitter:description" content={page.description} />
      <meta name="twitter:image" content={`${SITE_URL}/branding/social-card-v3.jpg`} />
      <meta name="twitter:image:alt" content={SOCIAL_CARD_ALT} />
      <link rel="icon" type="image/x-icon" href="/branding/favicon.ico" />
      <link rel="icon" type="image/png" sizes="48x48" href="/branding/favicon-48.png" />
      <link rel="icon" type="image/png" sizes="96x96" href="/branding/favicon-96.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/branding/apple-touch-icon.png" />
      <link rel="manifest" href="/site.webmanifest" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData(page) }} />
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
        href="/art/optimized/catanova-logo-v2.e377bbe647d6.webp"
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

/**
 * The guide is a reference article, not a sales page.
 *
 * It is laid out the way somebody reading about a game expects: a contents
 * rail that stays put, an infobox of the numbers you came to look up, section
 * headings that rule off the page, and tables wherever the answer is a value
 * rather than a paragraph. Somebody arriving from a search for "catan city
 * cost" should be able to stop reading after four seconds.
 */
export const GUIDE_SECTIONS = [
  ['start', 'Your first game', ['Getting everyone in', 'The opening placements']],
  ['resources', 'Resources and building costs', ['What everything costs']],
  ['turn', 'Taking a turn', ['Rolling a seven']],
  ['trading', 'Trading and ports', ['Trading with a player', 'Trading with the bank']],
  ['development', 'Development cards', []],
  ['winning', 'Reaching ten points', ['The two awards']],
  ['bots', 'Playing against bots', ['Which bot turned up', 'They think before they move']],
  ['setup', 'Setting up a room', []],
  ['table', 'At the table', ['Your colour is yours', 'Reactions']],
  ['accounts', 'Your profile and seat', ['A profile that stays yours', 'If your connection drops']],
  ['questions', 'Common questions', []],
  ['glossary', 'Glossary', []],
  ['see-also', 'See also', []],
  ['references', 'Notes and references', []],
] as const;

/** A subsection's anchor, built from its section so the two can never disagree. */
export const subId = (section: string, title: string) =>
  `${section}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

const terrainNames: Record<Resource, string> = {
  wood: 'Forest',
  brick: 'Hills',
  sheep: 'Pasture',
  wheat: 'Fields',
  ore: 'Mountains',
};

/** Build names, costs and blurbs in one place: the costs table, the resource table and the glossary all read from it. */
const BUILDS = [
  {
    kind: 'road',
    name: 'Road',
    plural: 'Roads',
    icon: 'road' as GameIconName,
    benefit:
      'Extends your route by one edge. It must touch your own road or building, and it cannot pass through an opponent’s settlement or city.',
  },
  {
    kind: 'settlement',
    name: 'Settlement',
    plural: 'Settlements',
    icon: 'settlement' as GameIconName,
    benefit:
      'Worth one point. Collects one resource from each neighbouring tile that produces. After setup it must touch one of your roads.',
  },
  {
    kind: 'city',
    name: 'City upgrade',
    plural: 'Cities',
    icon: 'city' as GameIconName,
    benefit:
      'Worth two points in total, replacing the settlement’s point. Collects two resources instead of one. The settlement piece returns to your supply.',
  },
  {
    kind: 'developmentCard',
    name: 'Development card',
    plural: 'Development cards',
    icon: 'development' as GameIconName,
    benefit:
      'Draws a hidden card from the deck. You may buy more than one in a turn while you can pay and cards remain.',
  },
] as const satisfies readonly { kind: keyof typeof COSTS; [key: string]: unknown }[];

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

function Cost({ kind }: { kind: keyof typeof COSTS }) {
  return (
    <span className="guide-cost-list">
      {RESOURCES.filter((resource) => COSTS[kind][resource]).map((resource) => (
        <GuideResource key={resource} resource={resource} count={COSTS[kind][resource]} />
      ))}
    </span>
  );
}

/**
 * A section heading with its number and its own permanent link.
 *
 * The number is the same one the contents rail shows, so "§4" in one place and
 * "4 Trading and ports" in the other are obviously the same section.
 */
function GuideHeading({ id, index, children }: { id: string; index: number; children: string }) {
  return (
    <div className="guide-heading">
      <h2>
        <span className="guide-heading-index" aria-hidden="true">
          {index}
        </span>
        {children}
      </h2>
      <a className="guide-anchor" href={`#${id}`} aria-label={`Link to section ${index}, ${children}`}>
        §
      </a>
    </div>
  );
}

/**
 * The contents, rendered twice.
 *
 * A wide window gets the rail beside the article; a phone gets the same list
 * as a closed disclosure after the opening paragraph, which is where somebody
 * scrolling a reference actually wants it. Only one is in the page at a time,
 * so nothing is announced twice.
 */
function ContentsList() {
  return (
    <ol className="guide-nav-links">
      {GUIDE_SECTIONS.map(([id, label, subs], index) => (
        <li key={id}>
          <a href={`#${id}`}>
            <span aria-hidden="true">{index + 1}</span>
            {label}
          </a>
          {subs.length > 0 && (
            <ol>
              {subs.map((sub, subIndex) => (
                <li key={sub}>
                  <a href={`#${subId(id, sub)}`}>
                    <span aria-hidden="true">{`${index + 1}.${subIndex + 1}`}</span>
                    {sub}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * A subsection heading that carries the anchor the contents point at.
 *
 * The id is derived from the title rather than typed beside it, so a heading
 * somebody renames cannot quietly leave a dead entry in the contents.
 */
function Sub({ section, children }: { section: string; children: string }) {
  const id = subId(section, children);
  return (
    <h3 id={id}>
      {children}
      <a className="guide-anchor" href={`#${id}`} aria-label={`Link to ${children}`}>
        §
      </a>
    </h3>
  );
}

/** A numbered note, linked both ways so a reader can get back to where they were. */
function Ref({ n }: { n: number }) {
  return (
    <sup className="guide-ref">
      <a id={`ref-${n}`} href={`#note-${n}`} aria-label={`Note ${n}`}>
        [{n}]
      </a>
    </sup>
  );
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="guide-info-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** An illustrated public reference, rendered as HTML with no client bundle or sign-in requirement. */
export function PublicGuide() {
  const deckTotal = Object.values(DEVELOPMENT_DECK).reduce((sum, count) => sum + count, 0);
  return (
    <>
      <a className="guide-skip" href="#guide-content">
        Skip to guide
      </a>
      <header className="guide-bar">
        <a className="guide-brand" href="/" aria-label="Catanova home">
          <BrandLogo />
        </a>
        <p className="guide-bar-title" aria-hidden="true">
          Player guide
        </p>
        <a className="guide-play" href="/">
          Play with friends <GameIcon name="next" size={20} />
        </a>
      </header>
      <div className="guide-layout">
        <nav className="guide-nav" aria-label="Contents">
          <strong>Contents</strong>
          <ContentsList />
          <div className="guide-nav-aside">
            <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`} target="_blank" rel="noopener noreferrer">
              <GameIcon name="help" size={17} />
              Full rulebook
            </a>
            <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
              <GithubMark size={16} />
              Source on GitHub
            </a>
          </div>
        </nav>
        <main id="guide-content" className="guide-content">
          <p className="guide-breadcrumb">
            <a href="/">Catanova</a>
            <span aria-hidden="true">›</span>
            Player guide
          </p>
          <h1>How to play Catanova</h1>
          <p className="guide-subtitle">
            An island trading and building game for two to four players, in a browser
          </p>
          <aside className="guide-infobox" aria-label="Catanova at a glance">
            <p className="guide-infobox-title">Catanova</p>
            <figure className="guide-infobox-figure">
              <img
                src="/art/optimized/guide-game.796f79200bc4.webp"
                alt="A game in progress: an island of hexagons with roads, settlements and cities in four colours, harbours around the coast, and the four players listed down the right."
                width="1920"
                height="1200"
                decoding="async"
              />
              <figcaption>A four-player game, partway through.</figcaption>
            </figure>
            <dl>
              <InfoRow label="Players">2–4</InfoRow>
              <InfoRow label="Playing time">30–60 minutes</InfoRow>
              <InfoRow label="Goal">
                10 victory points <span className="guide-info-note">(host may set 8–15)</span>
              </InfoRow>
              <InfoRow label="Dice">Two six-sided</InfoRow>
              <InfoRow label="Resources">
                {RESOURCES.length} kinds, {SUPPLY.resourcesPerType} cards each
              </InfoRow>
              <InfoRow label="Development deck">{deckTotal} cards</InfoRow>
              <InfoRow label="Pieces per player">
                {SUPPLY.roads} roads, {SUPPLY.settlements} settlements, {SUPPLY.cities} cities
              </InfoRow>
              <InfoRow label="Runs on">Any modern browser</InfoRow>
              <InfoRow label="Price">Free, open source</InfoRow>
              <InfoRow label="Ruleset">
                <code>{RULESET}</code>
              </InfoRow>
            </dl>
          </aside>
          <p className="guide-lead">
            <strong>Catanova</strong> is a free, browser-based island game for two to four friends. Each
            player settles a shared island, collects the resources their settlements produce, trades for what
            the dice did not give them, and builds towards ten victory points. A game takes about an hour.
            This page covers the whole of it: the opening placements, what everything costs, how a turn runs,
            and the handful of things this version does its own way.
          </p>
          <p className="guide-hatnote">
            In a hurry? Jump to <a href="#resources">building costs</a>, the{' '}
            <a href="#turn">order of a turn</a>, or the <a href="#glossary">glossary</a>.
          </p>
          <details className="guide-toc">
            <summary>Contents</summary>
            <ContentsList />
          </details>
          <section id="start" className="guide-section">
            <GuideHeading id="start" index={1}>
              Your first game
            </GuideHeading>
            <p>
              A game happens in a private room. There is no lobby browser and no matchmaking: somebody
              creates a room and passes the code or the link around.
            </p>
            <Sub section="start">Getting everyone in</Sub>
            <ol className="guide-steps">
              <li>
                <strong>Find your room.</strong> <em>Create room</em> opens your lobby. Choose{' '}
                <em>Join room</em> for a friend’s code, or open their invite link.
              </li>
              <li>
                <strong>Choose your profile.</strong> Continue with Google or as a guest, pick a username and
                portrait, then share the room link.
              </li>
              <li>
                <strong>Ready, then start.</strong> Everyone else selects <em>Ready</em>. The host selects{' '}
                <em>Start</em> once the table is full and connected.
              </li>
            </ol>
            <Sub section="start">The opening placements</Sub>
            <p>
              Before the first roll, each player places a settlement and a road touching it. Everyone takes a
              first placement in seat order, then the order reverses for the second. Setup pieces are free.
            </p>
            <p>
              Your <strong>second settlement</strong> pays immediately: you collect one resource from each
              neighbouring tile that produces. Placing last in the first round means placing first in the
              second, which is what keeps the opening fair.
            </p>
            <figure className="guide-figure guide-draft">
              <div
                aria-label="Four-player setup order: one, two, three, four, four, three, two, one"
                className="guide-draft-seats"
              >
                {[1, 2, 3, 4, 4, 3, 2, 1].map((seat, index) => (
                  <span key={index} data-seat={seat} aria-hidden="true">
                    {seat}
                  </span>
                ))}
              </div>
              <figcaption>Four-player placement order: clockwise, then back again.</figcaption>
            </figure>
            <aside className="guide-note">
              <strong>Balanced islands</strong>
              <p>
                The default map uses Catanova’s own fairness constraints to spread the resources across the
                island and keep red number tokens off adjacent tiles. Every new room gets a new island.
                <Ref n={1} />
              </p>
            </aside>
          </section>
          <section id="resources" className="guide-section">
            <GuideHeading id="resources" index={2}>
              Resources and building costs
            </GuideHeading>
            <p>
              Five resources pay for everything. A tile produces when its number is rolled, for every player
              with a settlement or city on one of its corners, whoever rolled it. The desert produces
              nothing.
            </p>
            <figure className="guide-table-figure">
              <figcaption>The five resources and where they come from</figcaption>
              <div className="guide-table-scroll">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th scope="col">Resource</th>
                      <th scope="col">Terrain</th>
                      <th scope="col">Pays for</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RESOURCES.map((resource) => (
                      <tr key={resource}>
                        <th scope="row">
                          <span className="guide-row-icon" aria-hidden="true">
                            <ResourceIcon resource={resource} />
                          </span>
                          {RESOURCE_NAMES[resource]}
                        </th>
                        <td>{terrainNames[resource]}</td>
                        <td>
                          {BUILDS.filter((build) => COSTS[build.kind][resource])
                            .map((build) => build.plural.toLowerCase())
                            .join(', ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
            <Sub section="resources">What everything costs</Sub>
            <p>
              Costs are paid to the bank. You can build in any order, as many times as you can afford, during
              your own action phase.
            </p>
            <figure className="guide-table-figure">
              <figcaption>Building costs</figcaption>
              <div className="guide-table-scroll">
                <table className="guide-table guide-table-costs">
                  <thead>
                    <tr>
                      <th scope="col">Build</th>
                      <th scope="col">Cost</th>
                      <th scope="col">What it gives you</th>
                    </tr>
                  </thead>
                  <tbody>
                    {BUILDS.map((build) => (
                      <tr key={build.kind}>
                        <th scope="row">
                          <span className="guide-row-icon" aria-hidden="true">
                            <GameIcon name={build.icon} size={26} />
                          </span>
                          {build.name}
                        </th>
                        <td>
                          <Cost kind={build.kind} />
                        </td>
                        <td>{build.benefit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
            <aside className="guide-note">
              <strong>Leave room to grow</strong>
              <p>
                Every settlement and city needs at least one empty corner between it and the next one,
                including your own. Preview a legal site before you confirm the placement.
              </p>
            </aside>
          </section>
          <section id="turn" className="guide-section">
            <GuideHeading id="turn" index={3}>
              Taking a turn
            </GuideHeading>
            <p>A turn is three steps, and only the middle one is open-ended.</p>
            <ol className="guide-steps guide-steps-turn">
              <li>
                <strong>Roll and collect.</strong> The matching tiles pay every player who touches them, not
                only you. Settlements collect one card; cities collect two.
              </li>
              <li>
                <strong>Trade and build.</strong> Trade and buy in any order, for as long as you have legal
                moves and the resources to make them.
              </li>
              <li>
                <strong>End your turn.</strong> Play passes on. The next player’s portrait shows what they
                owe the table, such as a roll or a robber move.
              </li>
            </ol>
            <p>
              A playable development card can be used before you roll or during your action phase, but only
              one per turn. Finish its effect before doing anything else.
            </p>
            <Sub section="turn">Rolling a seven</Sub>
            <p>
              No tile produces. Everyone holding <strong>more than seven resource cards</strong> discards
              half, rounded down; development cards do not count towards the limit.<Ref n={2} /> Once the discards are in,
              the roller moves the robber to a different land tile and steals one random card from one
              eligible neighbouring opponent. That tile stops producing until the robber moves again.
            </p>
            <p className="guide-hatnote">
              A Knight moves the robber the same way without anybody discarding. See{' '}
              <a href="#development">§5, Development cards</a>.
            </p>
            <details className="guide-detail">
              <summary>What if the bank runs short?</summary>
              <p>
                If several players are owed a resource the bank cannot cover, nobody receives that resource
                from the roll. If only one player is entitled to it, they receive what remains, up to their
                entitlement. The other resources still produce normally.
              </p>
            </details>
            <details className="guide-detail">
              <summary>The optional turn timer</summary>
              <p>
                New rooms start at 90 seconds; the host can choose 40, 65, 115 or 140 instead, or switch it
                off. When a turn expires the server completes whatever the rules require, using valid
                defaults, and ends the turn. It does not buy pieces or accept trades on your behalf. Setup
                placements are untimed, and a required discard has its own countdown.
              </p>
            </details>
          </section>
          <section id="trading" className="guide-section">
            <GuideHeading id="trading" index={4}>
              Trading and ports
            </GuideHeading>
            <p>
              Short one card for a city? Ask the table first; the bank is always there but it is expensive.
            </p>
            <Sub section="trading">Trading with a player</Sub>
            <p>
              On your turn, select <strong>Trade</strong>, then the cards you are giving and the cards you
              want. Choose <strong>Open to offers</strong> to let anyone propose a return instead. Both sides
              must give something, and every trade includes the player whose turn it is.
            </p>
            <Sub section="trading">Trading with the bank</Sub>
            <p>
              A settlement or city on either corner a port touches unlocks that port for you. A road along
              the coast does not. The picture on the port is what you <em>pay</em>; you can take any other
              resource the bank still has.
            </p>
            <figure className="guide-table-figure">
              <figcaption>Exchange rates</figcaption>
              <div className="guide-table-scroll">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th scope="col">Where</th>
                      <th scope="col">Rate</th>
                      <th scope="col">Example</th>
                      <th scope="col">Requirement</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">The bank</th>
                      <td className="guide-ratio">4:1</td>
                      <td>
                        <span className="guide-trade-example">
                          <GuideResource resource="brick" count={4} />
                          <span className="guide-exchange" aria-label="for">
                            <GameIcon name="next" size={16} />
                          </span>
                          <GuideResource resource="wheat" count={1} />
                        </span>
                      </td>
                      <td>None. Always available on your turn.</td>
                    </tr>
                    <tr>
                      <th scope="row">General port</th>
                      <td className="guide-ratio">3:1</td>
                      <td>
                        <span className="guide-trade-example">
                          <GuideResource resource="sheep" count={3} />
                          <span className="guide-exchange" aria-label="for">
                            <GameIcon name="next" size={16} />
                          </span>
                          <GuideResource resource="ore" count={1} />
                        </span>
                      </td>
                      <td>Build on the port. Any one resource, three of a kind.</td>
                    </tr>
                    <tr>
                      <th scope="row">Resource port</th>
                      <td className="guide-ratio">2:1</td>
                      <td>
                        <span className="guide-trade-example">
                          <GuideResource resource="wood" count={2} />
                          <span className="guide-exchange" aria-label="for">
                            <GameIcon name="next" size={16} />
                          </span>
                          <GuideResource resource="brick" count={1} />
                        </span>
                      </td>
                      <td>Build on the port. Only the resource it names.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </figure>
            <p className="guide-caption">
              The island carries four general ports, marked with a question mark, and one 2:1 port for each of
              the five resources.
            </p>
          </section>
          <section id="development" className="guide-section">
            <GuideHeading id="development" index={5}>
              Development cards
            </GuideHeading>
            <p>
              Development cards are bought face down from a shuffled deck of {deckTotal}. Select one in your
              hand to read what it does, then play it. Nothing needs dragging.
            </p>
            <aside className="guide-note">
              <strong>One action card per turn</strong>
              <p>
                A card bought this turn waits until your next one. Hidden Victory Point cards are the
                exception: they count the moment you buy them, and are never played as an action.
              </p>
            </aside>
            <figure className="guide-table-figure">
              <figcaption>The deck, card by card</figcaption>
              <div className="guide-table-scroll">
                <table className="guide-table guide-table-cards">
                  <thead>
                    <tr>
                      <th scope="col">Card</th>
                      <th scope="col">In deck</th>
                      <th scope="col">Effect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        [
                          'knight',
                          'Knight',
                          'Move the robber and steal from an eligible neighbour. Nobody discards. Played Knights count towards Largest Army.',
                        ],
                        [
                          'roadBuilding',
                          'Road Building',
                          'Place two legal roads without paying for them, subject to your remaining pieces and the sites available.',
                        ],
                        [
                          'yearOfPlenty',
                          'Year of Plenty',
                          'Take two resource cards from the bank. They can be the same resource or two different ones.',
                        ],
                        [
                          'monopoly',
                          'Monopoly',
                          'Name one resource. Every opponent hands you every card they hold of that type.',
                        ],
                        [
                          'victoryPoint',
                          'Victory Point',
                          'One hidden point, counted from the moment you buy it. It is never played as an action.',
                        ],
                      ] as const
                    ).map(([kind, name, description]) => (
                      <tr key={kind}>
                        <th scope="row">
                          <span className="guide-card-art" aria-hidden="true">
                            <DevelopmentArt kind={kind} />
                          </span>
                          {name}
                        </th>
                        <td className="guide-numeric">{DEVELOPMENT_DECK[kind]}</td>
                        <td>{description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
            <details className="guide-detail">
              <summary>Rare card cases in this playtest</summary>
              <p>
                Road Building requires a legal first road and uses a second whenever one is possible. Year of
                Plenty takes a single card if that is all the bank has left, and cannot be played into an
                empty bank. These are provisional readings<Ref n={3} />; the{' '}
                <a href={`${REPOSITORY_URL}/blob/main/docs/RULE_SOURCES.md`} target="_blank" rel="noopener noreferrer">compatibility ledger</a> tracks
                the source questions still open.
              </p>
            </details>
          </section>
          <section id="winning" className="guide-section">
            <GuideHeading id="winning" index={6}>
              Reaching ten points
            </GuideHeading>
            <p>
              Ten points wins, and you must reach them <strong>on your own turn</strong>. If a trade or an
              award pushes you to ten while somebody else is playing, nothing happens until your turn comes
              round and you still have them.
            </p>
            <figure className="guide-table-figure">
              <figcaption>Where victory points come from</figcaption>
              <div className="guide-table-scroll">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Points</th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        ['settlement', 'Settlement', 1, 'Up to five of them, and the first two are free.'],
                        [
                          'city',
                          'City',
                          2,
                          'Two points in total, not two on top of the settlement it replaces.',
                        ],
                        [
                          'road',
                          'Longest Road',
                          2,
                          'Five or more connected roads. Held by one player at a time.',
                        ],
                        ['shield', 'Largest Army', 2, 'Three or more Knights played. Held by one player.'],
                        [
                          'development',
                          'Victory Point card',
                          1,
                          'Hidden from everyone else until the game ends.',
                        ],
                      ] as const
                    ).map(([icon, name, points, note]) => (
                      <tr key={name}>
                        <th scope="row">
                          <span className="guide-row-icon" aria-hidden="true">
                            <GameIcon name={icon} size={26} />
                          </span>
                          {name}
                        </th>
                        <td className="guide-numeric guide-points">{points}</td>
                        <td>{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </figure>
            <p className="guide-caption">Roads score nothing by themselves. Only the award pays.</p>
            <Sub section="winning">The two awards</Sub>
            <p>
              <strong>Longest Road</strong> goes to the first continuous route of at least five roads.
              Opponents’ buildings break a route, and two branches off the same trunk do not simply add
              together. <strong>Largest Army</strong> goes to the first player to play three Knights; Knights
              still in hand do not count.
            </p>
            <p>
              Both sit on the player profiles all game. To take one, you have to beat the holder’s total
              rather than match it, so a tie leaves an award where it is.<Ref n={5} /> The{' '}
              <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md#10-longest-road`} target="_blank" rel="noopener noreferrer">full road rules</a>{' '}
              cover what happens to a tie after a route is broken.
            </p>
          </section>
          <section id="bots" className="guide-section">
            <GuideHeading id="bots" index={7}>
              Playing against bots
            </GuideHeading>
            <p>
              Short a player? The host can sit a bot in any open seat, and one will also cover a seat whose
              player has dropped out of the game.
            </p>
            <Sub section="bots">Which bot turned up</Sub>
            <p>
              You find out by playing them. Three kinds exist and the game never tells you which one took the
              seat. One plays a
              steady game. One pays attention to whoever is in front. One plans every move around winning,
              chases both awards, and is genuinely hard to beat. Which turns up is the room’s draw, not a
              setting.
            </p>
            <Sub section="bots">They think before they move</Sub>
            <p>
              A bot pauses before each move, longer over the decisions that matter and longest over the
              opening placement. Answering the instant the rules allow is the one thing that reads as
              software rather than as an opponent.
            </p>
            <aside className="guide-note guide-note-wide">
              <strong>They are not cheating</strong>
              <p>
                A bot is handed exactly the view of the table your browser is handed: no opponent’s hand, no
                looking through the development deck, no adjusted dice, and no shared plans between two bots
                at the same table. Everything a bot knows is on the board or on the player cards, and
                everything it does goes through the same rules your moves do. A bot that beats you beat you
                with what was in front of both of you.
              </p>
            </aside>
          </section>
          <section id="setup" className="guide-section">
            <GuideHeading id="setup" index={8}>
              Setting up a room
            </GuideHeading>
            <p>
              Three settings belong to the table rather than to a player. The host sets them before the game
              starts; everyone else can read them.
            </p>
            <figure className="guide-table-figure">
              <figcaption>Room settings</figcaption>
              <div className="guide-table-scroll">
                <table className="guide-table">
                  <thead>
                    <tr>
                      <th scope="col">Setting</th>
                      <th scope="col">Default</th>
                      <th scope="col">What it changes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">
                        <span className="guide-row-icon" aria-hidden="true">
                          <GameIcon name="trophy" size={24} />
                        </span>
                        Points to win
                      </th>
                      <td className="guide-numeric">10</td>
                      <td>
                        Anywhere from 8 to 15. Eight is a short game; fifteen is a long evening.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        <span className="guide-row-icon" aria-hidden="true">
                          <GameIcon name="timer" size={24} />
                        </span>
                        Turn timer
                      </th>
                      <td>90 seconds</td>
                      <td>
                        A turn lasts 40, 65, 90, 115 or 140 seconds, or the host switches the timer off. The
                        game plays a sensible move for anyone who runs out.
                      </td>
                    </tr>
                    <tr>
                      <th scope="row">
                        <span className="guide-row-icon" aria-hidden="true">
                          <GameIcon name="dice" size={24} />
                        </span>
                        Natural or balanced dice
                      </th>
                      <td>Balanced</td>
                      <td>
                        Natural is two ordinary dice: every roll independent, seven the most common total.
                        Balanced draws from a deck of all thirty-six dice pairs, removing each drawn pair
                        and refreshing the deck after twenty-four rolls. Pairs matching the previous total
                        have a lower draw weight. The next roll therefore depends on earlier rolls; rare
                        totals can still be missed, and no frequency is guaranteed.
                        <Ref n={4} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </figure>
            <aside className="guide-note">
              <strong>Changing them later</strong>
              <p>
                Settings lock when the game starts, and changing one before that clears everyone’s Ready, so
                nobody begins a game under rules they did not see. The room code and invite link sit in the
                lobby footer and stay the same all evening.
              </p>
            </aside>
          </section>
          <section id="table" className="guide-section">
            <GuideHeading id="table" index={9}>
              At the table
            </GuideHeading>
            <p>Two small things that make a game feel like a table rather than a screen.</p>
            <Sub section="table">Your colour is yours</Sub>
            <p>
              Pick one of eight in the lobby, under your own card. Nobody can take a colour somebody else is
              holding, and it is worth choosing deliberately: the pieces on the island carry no names, so
              colour is the only thing that says a road is yours. Your portrait wears it all game, and the
              cloth behind your name lightens when it is your turn.
            </p>
            <Sub section="table">Reactions</Sub>
            <p>
              Twelve faces, drawn for this game rather than borrowed from your phone’s emoji font, so
              everyone at the table sees the same expression. Tap one and it flies across the board with your
              name under it. A short burst is fine; after that the button rests for a moment, which is the
              difference between a table and a chat room.
            </p>
            <figure className="guide-table-figure">
              <figcaption>The twelve, in tray order</figcaption>
              <ul className="guide-reactions">
                {REACTION_LIST.map((name) => (
                  <li key={name}>
                    <span className="guide-reaction-face" aria-hidden="true">
                      <ReactionFace name={name} />
                    </span>
                    <span>{REACTIONS[name].label}</span>
                  </li>
                ))}
              </ul>
            </figure>
          </section>
          <section id="accounts" className="guide-section">
            <GuideHeading id="accounts" index={10}>
              Your profile and seat
            </GuideHeading>
            <Sub section="accounts">A profile that stays yours</Sub>
            <p>
              Google sign-in keeps your profile and enables friends. Guest profiles expire after seven days
              of inactivity, and a guest can link a Google account later to keep their username. They cannot
              add friends while still guests.
            </p>
            <figure className="guide-figure guide-plate guide-plate-narrow">
              <img
                src="/art/optimized/guide-players.07d025acd09f.webp"
                alt="Four player cards: a portrait in a coloured border, a name, a victory point count, a card count and a development card count."
                width="414"
                height="677"
                loading="lazy"
                decoding="async"
              />
              <figcaption>
                One card a player. The border is their colour, the first number their points, then what they
                are holding. A leader carries a number one; a machine carries a small robot.
              </figcaption>
            </figure>
            <Sub section="accounts">If your connection drops</Sub>
            <p>
              Let the game reconnect on its own, or come back with the same account and invite while the
              match is still active. The connection panel shows ping and sync status. Keep your guest session
              and browser storage while a game is running.
            </p>
            <aside className="guide-note guide-note-wide">
              <strong>What an empty chair looks like</strong>
              <p>
                A seat whose player has dropped shows <strong>Away</strong> and a countdown. After about half
                a minute the card says <strong>Bot playing</strong> instead, and a machine mark appears
                beside the name: that seat is being covered, not forfeited. Both marks clear the moment they
                reconnect.
              </p>
              <p>
                Leaving on purpose is a different thing, and says <strong>Resigned</strong>. If{' '}
                <em>everyone</em> disconnects, the game pauses. After three minutes without a return,
                the room is abandoned. Reconnecting to an active match restores its current state,
                including any moves made by the covering bot.
              </p>
            </aside>
          </section>
          <section id="questions" className="guide-section">
            <GuideHeading id="questions" index={11}>
              Common questions
            </GuideHeading>
            <dl className="guide-faq">
              {GUIDE_FAQ.map((entry) => (
                <div key={entry.question}>
                  <dt>{entry.question}</dt>
                  <dd>{entry.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section id="glossary" className="guide-section">
            <GuideHeading id="glossary" index={12}>
              Glossary
            </GuideHeading>
            <p>Everything this page and the game call things, in one place.</p>
            <dl className="guide-glossary">
              {(
                [
                  ['Bank', 'The shared supply everything is bought from and traded with at 4:1.'],
                  [
                    'Bot',
                    'A seat played by the server rather than a person. Added by the host, or covering somebody who dropped.',
                  ],
                  [
                    'City',
                    'An upgraded settlement. Two points, and it collects two of a resource instead of one.',
                  ],
                  [
                    'Development card',
                    'A hidden card bought from the deck: a Knight, one of three one-off effects, or a hidden point.',
                  ],
                  [
                    'Hand limit',
                    'Seven. Roll a seven holding more and you discard half, rounded down. Development cards do not count.',
                  ],
                  [
                    'Harbour',
                    'A port on the coast. Build on either corner it touches to trade at 3:1 or 2:1.',
                  ],
                  ['Host', 'Whoever created the room. Sets the rules, adds bots, starts the game.'],
                  [
                    'Largest Army',
                    'Two points, to the first player to play three Knights, then to anyone who passes them.',
                  ],
                  [
                    'Longest Road',
                    'Two points, to the first continuous route of five or more roads, then to anyone who passes it.',
                  ],
                  [
                    'Pips',
                    'The dots under a number. Five dots means five of the thirty-six dice combinations make it, so it pays often.',
                  ],
                  ['Production', 'What a tile pays out when its number is rolled.'],
                  ['Resource', 'Timber, clay, sheep, hay or rock. The five things everything is built from.'],
                  [
                    'Robber',
                    'The piece that stops a tile producing and steals a card. Moved on a seven or by a Knight.',
                  ],
                  [
                    'Room code',
                    'Four characters that let a friend join your lobby. The invite link does the same.',
                  ],
                  [
                    'Setup',
                    'The opening. Each player places a settlement and a road in order, then again in reverse, and the second settlement pays out.',
                  ],
                  [
                    'Victory point',
                    'What you are counting to ten. Settlements, cities, the two awards and hidden point cards all give them.',
                  ],
                ] as const
              ).map(([term, meaning]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section id="see-also" className="guide-section guide-seealso">
            <GuideHeading id="see-also" index={13}>
              See also
            </GuideHeading>
            <ul>
              <li>
                <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`} target="_blank" rel="noopener noreferrer">The rulebook</a>, which carries every
                rule as the code enforces it, including the edge cases this page leaves out.
              </li>
              <li>
                <a href={`${REPOSITORY_URL}/blob/main/docs/RULE_SOURCES.md`} target="_blank" rel="noopener noreferrer">The compatibility ledger</a>, for
                the places Catanova had to choose a reading, and why.
              </li>
              <li>
                <a href={`${REPOSITORY_URL}/blob/main/docs/PLAYTEST.md`} target="_blank" rel="noopener noreferrer">Playtest limitations</a>, for what is
                not finished yet.
              </li>
              <li>
                <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">The source on GitHub</a>: the server, the rules package and this
                page.
              </li>
            </ul>
          </section>
          <section id="references" className="guide-section">
            <GuideHeading id="references" index={14}>
              Notes and references
            </GuideHeading>
            <p className="guide-caption">
              The places where this page describes a decision Catanova made, rather than a rule everybody
              already knows.
            </p>
            <ol className="guide-references">
              {(
                [
                  [
                    'The island generator, and the constraints it places on numbers and terrain.',
                    'RULEBOOK.md',
                    'Rulebook, board setup',
                  ],
                  [
                    'The hand limit, and what counts towards it on a seven.',
                    'RULEBOOK.md',
                    'Rulebook, the robber',
                  ],
                  [
                    'Where the published rules leave a case open, the reading Catanova took and why.',
                    'RULE_SOURCES.md',
                    'Compatibility ledger',
                  ],
                  [
                    'How the balanced deal is built, and what it does and does not change.',
                    'RULEBOOK.md',
                    'Rulebook, dice',
                  ],
                  [
                    'Ties, and what happens to an award once a route is broken.',
                    'RULEBOOK.md',
                    'Rulebook, longest road',
                  ],
                ] as const
              ).map(([text, file, label], index) => (
                <li id={`note-${index + 1}`} key={label + index}>
                  <a className="guide-backref" href={`#ref-${index + 1}`} aria-label="Back to the text">
                    ↑
                  </a>
                  <span>
                    {text} <a href={`${REPOSITORY_URL}/blob/main/docs/${file}`} target="_blank" rel="noopener noreferrer">{label}</a>.
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <aside className="guide-ready">
            <div>
              <strong>Ready to play?</strong>
              <p>Create a room, or join a friend’s invitation.</p>
            </div>
            <a className="guide-play" href="/">
              Play with friends <GameIcon name="next" size={20} />
            </a>
          </aside>
          <footer className="guide-footer">
            <p>
              Catanova is an independent, unofficial project, unaffiliated with CATAN’s owners. CATAN is a
              trademark of its respective owners. This guide describes the current playtest; development is
              ongoing.
            </p>
            <p>
              The rules here are the ones in{' '}
              <a href={`${REPOSITORY_URL}/blob/main/docs/RULEBOOK.md`} target="_blank" rel="noopener noreferrer">the rulebook</a>, and the code that
              enforces them is <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">on GitHub</a>. Catanova is open source.
            </p>
            <p className="guide-categories">
              <span>Categories</span>
              {['Gameplay', 'Rules', 'Setup', 'Reference', 'Catanova'].map((category) => (
                <b key={category}>{category}</b>
              ))}
            </p>
            <p className="guide-colophon">
              <span>
                Ruleset <code>{RULESET}</code>
              </span>
              <span>
                Costs, deck and piece counts on this page are generated from the rules the server runs
              </span>
              <a href="/privacy/">Privacy</a>
              <a className="guide-back-top" href="#guide-content">
                Back to top
              </a>
            </p>
          </footer>
        </main>
      </div>
    </>
  );
}

/** Every service that handles data for Catanova, and what it does. */
const PRIVACY_SERVICES = [
  [
    'Supabase',
    'Accounts and sign-in: the email address of your Google account if you use Google, and your username, avatar and friends.',
  ],
  ['Microsoft Azure', 'Hosts our game server and its database, in the Central India region.'],
  ['Cloudflare Turnstile', 'Checks that a new guest is a person when you choose Play as guest.'],
  ['Google Analytics 4', 'Counts visits to the home page, the guide and this page, only if you allow it.'],
  [
    'TypeSafe',
    'Works out moves for bots from the state of the game. Bot requests carry that game state, not your name or email.',
  ],
] as const;

/**
 * What Catanova keeps, who else handles it, and how to have it deleted.
 *
 * Every sentence is a claim about the code, and each one can be traced to it:
 * `supabase/schema.sql` for accounts, friends and the seven-day guest expiry,
 * the game server's SQLite store for games, last-seen times and the switch
 * that hides them, the room access limits for IP addresses, and `analytics.ts`
 * for the consent control below, which that loader wires up. Change one of
 * those and this page has to change with it.
 */
export function PublicPrivacy() {
  return (
    <>
      <a className="guide-skip" href="#privacy-content">
        Skip to content
      </a>
      <header className="guide-bar">
        <a className="guide-brand" href="/" aria-label="Catanova home">
          <BrandLogo />
        </a>
        <p className="guide-bar-title" aria-hidden="true">
          Privacy
        </p>
        <a className="guide-play" href="/">
          Play with friends <GameIcon name="next" size={20} />
        </a>
      </header>
      <main id="privacy-content" className="privacy-page">
        <p className="guide-breadcrumb">
          <a href="/">Catanova</a>
          <span aria-hidden="true">›</span>
          Privacy
        </p>
        <h1>Privacy</h1>
        <p className="guide-subtitle">Last updated: {PRIVACY_UPDATED.text}</p>
        <p className="guide-lead">
          Catanova is a free game you play in your browser. This page lists what it keeps about you, the
          services that help run it, and how to have your data deleted.
        </p>
        <section aria-labelledby="privacy-keep">
          <div className="guide-heading">
            <h2 id="privacy-keep">What we keep</h2>
          </div>
          <ul className="privacy-list">
            <li>
              <strong>Your account.</strong> Signing in goes through Supabase. If you continue with Google,
              that includes the email address of your Google account; Catanova does not use your Google name
              or photo. Supabase also keeps the username and avatar you choose, and your friends list.
            </li>
            <li>
              <strong>Guest profiles.</strong> A guest profile expires after seven days without activity. Its
              username and avatar are then deleted, and the name can be taken again. Games it played stay in
              our game records.
            </li>
            <li>
              <strong>Your games.</strong> Our own server keeps every game you play: each move, the result and
              who played, linked to your account. That is what lets you reconnect and see your match history.
              These records are not deleted automatically.
            </li>
            <li>
              <strong>What other players see.</strong> Your username and avatar appear at the table, and
              players signed in with Google can find you by username. Friends see whether you are online and
              can watch a game you are playing. They also see how long ago you were last online, unless you
              turn off <em>Show when you were last online</em> in Settings, under Privacy.
            </li>
            <li>
              <strong>IP addresses.</strong> Our server holds your IP address briefly in memory to limit how
              often requests can be made. It never writes it to the game database.
            </li>
            <li>
              <strong>Visits to these pages.</strong> Only if you allow analytics. See{' '}
              <a href="#analytics">Analytics</a>.
            </li>
            <li>
              <strong>In your browser.</strong> Your sign-in session, the seat you are playing, your settings
              and your analytics answer are kept in this browser’s storage. Catanova itself sets no cookies.
            </li>
          </ul>
        </section>
        <section aria-labelledby="privacy-services">
          <div className="guide-heading">
            <h2 id="privacy-services">Who else handles it</h2>
          </div>
          <figure className="guide-table-figure">
            <figcaption>Services that handle data for Catanova</figcaption>
            <div className="guide-table-scroll">
              <table className="guide-table">
                <thead>
                  <tr>
                    <th scope="col">Service</th>
                    <th scope="col">What it does</th>
                  </tr>
                </thead>
                <tbody>
                  {PRIVACY_SERVICES.map(([name, role]) => (
                    <tr key={name}>
                      <th scope="row">{name}</th>
                      <td>{role}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </figure>
        </section>
        <section id="analytics" className="privacy-section" aria-labelledby="privacy-analytics">
          <div className="guide-heading">
            <h2 id="privacy-analytics">Analytics</h2>
          </div>
          <p>
            If you allow it, Google Analytics records visits to the home page, the guide and this page, with
            the usual details it collects about your device and browser, and sets its own cookies. Room codes,
            invitation links and the page you came from are removed first, and it never runs in rooms or
            games. Until you allow it, Google’s analytics code is not loaded at all.
          </p>
          <div className="privacy-choice" data-consent-control="" hidden>
            <div aria-live="polite">
              <p data-consent-state="unset">Not chosen yet. Nothing is measured until you allow it.</p>
              <p data-consent-state="granted" hidden>
                Allowed. Google Analytics counts your visits to these pages.
              </p>
              <p data-consent-state="denied" hidden>
                Not allowed. Nothing is measured.
              </p>
            </div>
            <div className="privacy-choice-actions">
              <button type="button" data-consent-choice="granted">
                Allow analytics
              </button>
              <button type="button" data-consent-choice="denied">
                No thanks
              </button>
            </div>
          </div>
          <noscript>
            <p className="guide-caption">
              With JavaScript turned off, Google Analytics cannot run, so there is nothing to choose.
            </p>
          </noscript>
        </section>
        <section aria-labelledby="privacy-delete">
          <div className="guide-heading">
            <h2 id="privacy-delete">Deleting your data</h2>
          </div>
          <p>
            There is no delete button yet. To have your account or your games deleted, or to ask what we hold
            about you, email <a href={`mailto:${PRIVACY_CONTACT}`}>{PRIVACY_CONTACT}</a> with your username.
          </p>
        </section>
        <footer className="guide-footer">
          <p>
            Catanova is open source, and the code this page describes is{' '}
            <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
              on GitHub
            </a>
            . New to the game? Read <a href="/guide/">how to play</a>.
          </p>
        </footer>
      </main>
    </>
  );
}

# Catanova launch infrastructure

Recommendation checked **9 September 2026**. The wiki must be **free to host**; the provider choice is pending. Prices below are USD before tax and credits. This is a proposal: no hosting, DNS or wiki account has been provisioned by this document, and credit eligibility has not been confirmed.

## Recommended first deployment

For the first small online playtest, run the **frontend and authoritative Node game server together on one Azure Linux VM with a managed data disk**, using eligible Azure credits if available. Keep the current SQLite game store and Supabase accounts/friends. Keep one repository and one application image. The free wiki is a separate service; it does not need a paid plan or a game database migration.

Mount a persistent managed data disk into the container's data directory, keep a single game-server process, and arrange HTTPS, OS/security updates and application-consistent off-host backups. Never put the game database on the VM's temporary disk. A retained data disk supports recovery after replacing a VM, but a single host still has downtime during recovery. Quote the actual region, VM size, OS/data disks, public IP, backup storage and traffic before provisioning. [Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)

Build the image before deploying it; do not size the runtime VM around an unnecessarily heavy on-server build. Choose memory and CPU from a small load test, not an assumed player count. A free wiki is settled as a budget constraint; game compute is usage-billed even when credits pay the invoice.

## A later managed-container option

**Azure Container Apps plus Supabase game-state Postgres remains a future option, not a prerequisite for the initial VM playtest.** Start in one region close to the players and measure the Azure-to-Supabase round trip before choosing the exact region pair.

Azure Container Apps supports the existing HTTP/WebSocket distribution and managed HTTPS. Use Consumption with minimum and maximum replicas both set to one initially. This avoids sleeping between games; a restart still causes a reconnect window. [Azure ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview), [scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app).

**The current code needs storage work before this deployment.** It persists rooms, accepted actions, private state and command receipts in single-process SQLite. Supabase accounts/friends are implemented, but the game-state Postgres adapter is absent. Container-local files disappear on restart; replica-scoped files disappear with the replica. Mounting Azure Files is not an appropriate shortcut for the current SQLite WAL database: SQLite documents that WAL does not work over a network filesystem. [Azure storage lifetimes](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts), [SQLite WAL](https://sqlite.org/wal.html).

Implement the Postgres adapter with the same commit-before-acknowledgment contract: one transaction saves the accepted state, chosen random outcomes, event and command receipt. Duplicate commands must return their original result. Keep full game tables inaccessible to browser roles; the server returns each player's permitted view. Verify crash, lost-acknowledgment retry, redeployment, clock recovery and backup restoration against the real hosted database.

Use a small server-side connection pool, shared across rooms. Persistent servers can use Supabase's direct connection; an IPv4-only deployment can use its session pooler. Each player does not need a dedicated Postgres connection. [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

The [hosting comparison](HOSTING.md) also records Fly Machines with a persistent volume as a paid alternative. Azure credits do not pay Fly charges. Neither single-host option should be described as seamless failover.

## Scaling without losing games

First optimize asset downloads and measure active rooms, acknowledgment latency, database commit time, event-loop delay, memory and reconnect success. Set admission limits from load tests; there is no measured concurrent-player capacity yet. A turn-based game does not need a high-frequency simulation loop, but that does not establish a capacity figure.

Before adding replicas, implement a **single authoritative owner per room**. A room directory routes all participants to that owner. Ownership uses a lease and monotonically increasing fencing token, checked during every committed write, so an old process cannot continue accepting moves after replacement. Timers must follow the same ownership rule. Deployments stop admitting rooms, drain or transfer existing rooms, and recover from committed state. Azure's per-client session affinity does not ensure that four different people reach the same room owner. [Azure session affinity](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions).

Once those mechanisms pass fault tests, scale by rooms: add a bounded number of replicas, then increase database compute when measurements warrant it. Add regions when player latency justifies them, assigning each match one region for its lifetime. A paid service tier or extra replicas alone do not provide this application-level correctness.

Frontend assets can move independently to Cloudflare Workers Static Assets when bandwidth or origin load merits it. Static asset requests and storage are currently free; Worker execution has separate pricing. Splitting the current application requires deliberate `/api/config`, API/WebSocket routing, origin policy and coordinated asset/protocol releases. Keeping the initial frontend alongside Node avoids that work now. [Cloudflare static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

Cloudflare Durable Objects are a credible alternative architecture, with one object per room, strongly consistent attached storage and WebSocket hibernation. They would require porting the Node server/storage/timer code; their SQLite API is not the existing `node:sqlite` file. Evaluate that as a separate architecture choice if Azure stops fitting the measured workload. [Durable Objects](https://developers.cloudflare.com/durable-objects/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## A free player encyclopedia

**Wiki hosting budget: $0/month. Provider choice: pending.** MyWikis is no longer recommended for the requested initial plan. Use a hosted MediaWiki service for search, infoboxes, categories, illustrations and editing history; keep the prepared [content pack](wiki/README.md) portable.

| Free option  | Address and reader experience                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Miraheze** | Free community MediaWiki hosting with custom-domain support; proposed address `wiki.catanova.io`. Its service is presented as ad-free. [Miraheze features](https://miraheze.org/), [MediaWiki service description](https://www.mediawiki.org/wiki/Miraheze)                                  | Best candidate when the owned address and uncluttered reading matter. Acceptance, content rules and inactivity policy must be checked; it is not a purchased support/SLA contract. |
| **Fandom**   | Free hosted wiki at a `*.fandom.com` address, with advertising and familiar game-wiki/community tools. A domain redirect is not custom-domain hosting. [Creation help](https://community.fandom.com/wiki/Help:Start_a_new_community), [URL help](https://community.fandom.com/wiki/Help:URL) | A reasonable free option if its reading experience and community governance are acceptable. The owner is choosing; no community has been created.                                  |
| **wiki.gg**  | Free game-oriented hosting by application, with ads; current FAQ supports `*.wiki.gg`, not a custom hostname. [Hosting FAQ](https://support.wiki.gg/wiki/Creating_a_new_wiki), [ads](https://support.wiki.gg/wiki/Ads)                                                                       | Alternative application, not an instant or guaranteed allocation.                                                                                                                  |

Fandom is not simply a bad service: it supplies hosting, tools and an established community network without a monthly hosting bill. Its tradeoffs matter for this game's clean presentation. Logged-out readers see ads; current help describes an ad-light experience for registered readers and little-to-no ads for recent editors. An editor's view therefore does not represent a new player's view. [Account and ad experience](https://community.fandom.com/wiki/Help:Create_an_account)

Fandom wikis are community projects rather than founder-owned sites. General article editing must stay open under its rules, so the earlier idea of permanently restricting editing to our own team is not a Fandom plan. Leaving is possible, but the Fandom wiki normally remains when a community forks, with restrictions on promoting the new location. [Community creation/content policy](https://www.fandom.com/community-creation-policy), [forking policy](https://community.fandom.com/wiki/Forking_Policy)

### Content and eligibility checks

Describe the wiki as an encyclopedia of the actual Catanova game: mechanics, interface, resources and troubleshooting. Being developer-supported is not a substitute for complying with the host's policies. Do not treat the wiki as a sales page, an image dump, or a duplicate official CATAN encyclopedia.

The original game artwork includes generated assets, and the starter articles were prepared with AI assistance. Review every page against the implemented game, preserve provenance and licensing, and disclose these facts in the request. Fandom's terms require the right to upload images and compliance with its content rules; they do not establish blanket approval of our particular assets. Do not infer permission from another wiki's AI policy or from the provider using AI in its own features. [Fandom terms](https://www.fandom.com/terms-of-use)

Miraheze's live [Content Policy](https://meta.miraheze.org/wiki/Content_Policy), [Dormancy Policy](https://meta.miraheze.org/wiki/Dormancy_Policy) and [custom-domain instructions](https://meta.miraheze.org/wiki/Custom_domains) were not accessible to the research tool during this check. Its current treatment of generated artwork/text, developer-operated or commercial game documentation, and exact inactivity deadlines therefore remains **unverified**. Check those pages in the account/browser flow and resolve any ambiguity with the wiki reviewers before importing the pack. Free hosting and custom domains do not by themselves prove this project's eligibility.

### What is needed to create the free wiki

For **Fandom**:

1. A signed-in owner-controlled Fandom account with a confirmed email. Registration can use email or a supported social provider; the owner supplies any birthdate, password, email verification and CAPTCHA directly. [Account help](https://community.fandom.com/wiki/Help:Create_an_account)
2. Check for an existing Catanova community. Choose `Catanova Wiki`, an available `catanova.fandom.com`-style address, English, a concise game-specific description and the Games category. URL availability is not confirmed.
3. Review the creation/content policy and open [Start a Wiki](https://createnewwiki.fandom.com/wiki/Special:CreateNewWiki). Address any duplicate-topic warning accurately, then choose a theme. No payment is part of the documented creation workflow. [Creation steps](https://community.fandom.com/wiki/Help:Start_a_new_community)
4. Import reviewed articles/images with the correct licenses and set up navigation and moderation. A Fandom account is separate from the game's Google/Supabase account.

For **Miraheze**:

1. An owner-controlled Miraheze account and access to its recovery email. Confirm the email if the request form requires it; the live requirement was not verified here.
2. Submit a [wiki request](https://meta.miraheze.org/wiki/Special:RequestWiki) for `Catanova Wiki`, an available base subdomain, English and public reading. Give the real game's scope, repository, intended pages, editing approach and asset/text provenance; respond to reviewer questions. Requests can be approved or declined. [Request workflow](https://www.mediawiki.org/wiki/Extension:CreateWiki)
3. Once accepted, request the custom hostname and follow the provider's actual DNS/certificate instructions for `wiki.catanova.io`. This needs access to the existing domain's DNS; it does not require purchasing another domain. Do not copy internal sysadmin instructions or guess a CNAME target. [Custom-domain instructions](https://meta.miraheze.org/wiki/Custom_domains)
4. Import only after eligibility/licensing checks, configure permitted editor roles, and maintain the wiki under the current activity policy. Keep exports of articles, history and images; a text dump alone is not a complete backup. [MediaWiki backup scope](https://www.mediawiki.org/wiki/Manual:Backing_up_a_wiki)

Keep one canonical encyclopedia. Neither Fandom's network nor an owned hostname guarantees search rankings or players. A wiki provider should be chosen for its reading, editing and portability tradeoffs. [Google SEO guidance](https://developers.google.com/search/docs/fundamentals/seo-starter-guide)

## Domains and launch checklist

| Address                                        | Initial destination                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `catanova.io`                                  | Azure application: landing, lobby and game                                          |
| `catanova.io/api/*` and `wss://catanova.io/ws` | Same authoritative Node service                                                     |
| `www.catanova.io`                              | Permanent redirect to the canonical apex domain                                     |
| `wiki.catanova.io`                             | Miraheze if accepted/chosen; otherwise an optional redirect to the chosen free host |
| `assets.catanova.io`                           | Reserve for a later CDN; unnecessary initially                                      |

1. Use the existing registrar's DNS or Cloudflare DNS; no registrar transfer is required. Preserve any email and verification records.
2. For the VM path, point the game hostname at the actual assigned public IP and configure the HTTPS reverse proxy, certificate renewal and WebSocket forwarding. If the later Container Apps route is selected instead, follow its distinct A/CNAME, `asuid` TXT and managed-certificate requirements; those are not VM setup instructions. Keep records DNS-only when required for ACA managed certificates. [ACA custom-domain instructions](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates)
3. For Miraheze, use its approved custom-domain target and certificate instructions. For Fandom/wiki.gg, use the assigned platform URL; an optional owned-domain redirect is a separate configuration and changes the address seen by the reader.
4. Set the production Supabase Site URL and exact OAuth callback, Google provider callback, Turnstile hostname and WebSocket origin rules. Verify Google sign-in, guest signup, account linking and invites from the public domain.
5. Test TLS renewal, redirects, WebSocket reconnects, cache policy and recovery before inviting a wider audience. If a proxy/CDN is added later, never cache personalized APIs or game state. Cloudflare can terminate sockets during network updates, so recovery remains necessary. [Cloudflare WebSocket behavior](https://developers.cloudflare.com/network/websockets/).

## Where the earlier $90–105 estimate came from

This was a **historical planning estimate for a more managed setup**, not a required first-launch bill and not current spending. It included a paid wiki that the owner has now declined.

At **730 hours/month**, an always-active ACA Consumption replica of **0.5 vCPU / 1 GiB** is about **$34.02/month** with unused subscription free grants, or **$39.42** without them. Central India retail rates checked today are $0.000024/vCPU-second and $0.000003/GiB-second; requests beyond the grant are $0.40/million. The free grants are 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests per subscription. This calculation is a resource example, not a player-capacity claim. [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [queried retail meters](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20Container%20Apps%27%20and%20armRegionName%20eq%20%27centralindia%27%20and%20priceType%20eq%20%27Consumption%27&currencyCode=USD).

| Monthly item                                        |              Historical planning allowance |
| --------------------------------------------------- | -----------------------------------------: |
| Azure application resources                         |                                     $34–40 |
| Supabase Pro, one Micro project                     |                                        $25 |
| Modest logs, registry, traffic and backup allowance |                                     $10–20 |
| MyWikis Pro, month-to-month — now removed           |                                     $17.99 |
| **Exact sum of those ranges**                       | **$86.99–102.99/month before credits/tax** |
| **Earlier rounded allowance**                       |       **$90–105/month before credits/tax** |

With a free wiki, the **same hypothetical ACA/Postgres plan is $69–85/month** before credits/tax: $34–40 + $25 + $10–20 + $0. The $10–20 line is an operating allowance, not a fixed provider fee. We have not chosen or purchased this stack.

## Initial spending plan

| Item                                         | Current approach                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wiki                                         | **$0 hosting**; free provider choice and acceptance pending.                                                                                                                                                                                                      |
| Game host                                    | One Azure VM with managed persistent storage; obtain the regional/account-specific quote for compute, disks, public IP, backups and traffic. Offset only eligible charges with verified credits.                                                                  |
| Accounts/friends                             | Keep the existing Supabase project; no extra game-state Postgres instance is required for the SQLite playtest. Use its actual current plan and eligible credits. Free can support a controlled test within limits; Pro is optional until its benefits are needed. |
| Domain                                       | `catanova.io` is already purchased; renewal is separate. `wiki.catanova.io` does not require a second registration.                                                                                                                                               |
| Paid wiki, ads, paid support, extra replicas | **Not included.**                                                                                                                                                                                                                                                 |

There is no honest single new monthly total until the VM configuration, Supabase plan and credits are inspected. Cash spending can be lower than the gross resource bill while eligible credits last; do not describe that as permanently free hosting.

Supabase Pro starts at $25/month and includes compute credit for one Micro project and seven days of daily backups. Free projects can pause after inactivity, so a free playtest must not promise an always-available service. Higher paid-plan usage can increase the bill. Supabase's account backups do not back up the VM's SQLite game database. [Supabase pricing](https://supabase.com/pricing)

The allowance is not a hard billing cap: unusually heavy traffic, abuse, larger assets or extended logs can exceed it. Start with one server, capped log retention and measured admission limits. Configure actual and forecast cost alerts at 50%, 80% and 100% of the approved operating budget. Azure budgets notify; they do not stop resources automatically. [Azure budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

Azure and Supabase credits can reduce eligible charges, but their balances, expiry, service exclusions and billing organizations need checking in their respective portals. Do not assume either pays for the wiki host or domain, or that credits are interchangeable. Keep the full post-credit monthly budget visible. Nothing in this plan requires an LLM or image-generation call during ordinary gameplay.

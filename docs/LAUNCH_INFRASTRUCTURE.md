# Catanova launch infrastructure

Recommendation checked **9 September 2026**. Prices below are USD before tax and credits. This is a proposal: no hosting, DNS or wiki account has been provisioned, and credit eligibility has not been inspected.

## Recommended first deployment

Run the **frontend and authoritative Node game server together on Azure Container Apps**, with **Supabase Postgres for accounts and durable game state**, and a separately hosted **MediaWiki encyclopedia at `wiki.catanova.io`**. Keep one repository and one application image. Start in one region close to the first players and measure the Azure-to-Supabase round trip before choosing the exact region pair.

Azure Container Apps supports the existing HTTP/WebSocket distribution and managed HTTPS. Use Consumption with minimum and maximum replicas both set to one initially. This avoids sleeping between games; a restart still causes a reconnect window. [Azure ingress](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview), [scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app).

**The current code needs storage work before this deployment.** It persists rooms, accepted actions, private state and command receipts in single-process SQLite. Supabase accounts/friends are implemented, but the game-state Postgres adapter is absent. Container-local files disappear on restart; replica-scoped files disappear with the replica. Mounting Azure Files is not an appropriate shortcut for the current SQLite WAL database: SQLite documents that WAL does not work over a network filesystem. [Azure storage lifetimes](https://learn.microsoft.com/en-us/azure/container-apps/storage-mounts), [SQLite WAL](https://sqlite.org/wal.html).

Implement the Postgres adapter with the same commit-before-acknowledgment contract: one transaction saves the accepted state, chosen random outcomes, event and command receipt. Duplicate commands must return their original result. Keep full game tables inaccessible to browser roles; the server returns each player's permitted view. Verify crash, lost-acknowledgment retry, redeployment, clock recovery and backup restoration against the real hosted database.

Use a small server-side connection pool, shared across rooms. Persistent servers can use Supabase's direct connection; an IPv4-only deployment can use its session pooler. Each player does not need a dedicated Postgres connection. [Supabase connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres).

If we need a controlled online playtest before that adapter is ready, use **one Azure Linux VM with a managed data disk**, mounting that disk into the existing container. This preserves the current storage model but adds OS patching, HTTPS/reverse-proxy setup, backups and recovery operations. Store the database on the managed disk, never the VM's temporary disk. It remains a single host with downtime during recovery. Price its exact VM, disk, public IP and backup configuration before choosing it; it is an interim option, not the preferred scaling path. [Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview).

## Scaling without losing games

First optimize asset downloads and measure active rooms, acknowledgment latency, database commit time, event-loop delay, memory and reconnect success. Set admission limits from load tests; there is no measured concurrent-player capacity yet. A turn-based game does not need a high-frequency simulation loop, but that does not establish a capacity figure.

Before adding replicas, implement a **single authoritative owner per room**. A room directory routes all participants to that owner. Ownership uses a lease and monotonically increasing fencing token, checked during every committed write, so an old process cannot continue accepting moves after replacement. Timers must follow the same ownership rule. Deployments stop admitting rooms, drain or transfer existing rooms, and recover from committed state. Azure's per-client session affinity does not ensure that four different people reach the same room owner. [Azure session affinity](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions).

Once those mechanisms pass fault tests, scale by rooms: add a bounded number of replicas, then increase database compute when measurements warrant it. Add regions when player latency justifies them, assigning each match one region for its lifetime. A paid service tier or extra replicas alone do not provide this application-level correctness.

Frontend assets can move independently to Cloudflare Workers Static Assets when bandwidth or origin load merits it. Static asset requests and storage are currently free; Worker execution has separate pricing. Splitting the current application requires deliberate `/api/config`, API/WebSocket routing, origin policy and coordinated asset/protocol releases. Keeping the initial frontend alongside Node avoids that work now. [Cloudflare static asset billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/).

Cloudflare Durable Objects are a credible alternative architecture, with one object per room, strongly consistent attached storage and WebSocket hibernation. They would require porting the Node server/storage/timer code; their SQLite API is not the existing `node:sqlite` file. Evaluate that as a separate architecture choice if Azure stops fitting the measured workload. [Durable Objects](https://developers.cloudflare.com/durable-objects/), [WebSocket hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

## A player encyclopedia on our domain

Use **managed MediaWiki**, with search, illustrated resource/card pages, infoboxes, categories, related guides, edit history and a visual editor. This gives readers the familiar game-wiki experience without making them navigate developer documentation or submit GitHub pull requests.

| Option                           | `wiki.catanova.io` remains in the address bar? | Fit                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MyWikis Pro — recommendation** | Yes: bring your own domain                     | Managed MediaWiki, VisualEditor, no ads. $17.99/month, or $14.99/month paid annually. [Plan features](https://www.mywikis.com/)                                                                                                                                                                                                       |
| **Miraheze — free alternative**  | Yes: custom domains supported                  | Free, ad-free MediaWiki with VisualEditor. Community hosting; check current acceptance, activity and support policies before choosing it for an official project. [Miraheze features](https://miraheze.org/cs)                                                                                                                        |
| **wiki.gg**                      | No                                             | Free game-oriented hosting, application required, with advertising. Its current FAQ explicitly supports only `*.wiki.gg`; an owned domain can redirect there. [Hosting FAQ](https://support.wiki.gg/wiki/Creating_a_new_wiki), [ads](https://support.wiki.gg/wiki/Ads)                                                                |
| **Fandom**                       | No standard custom-domain option               | The documented creation flow uses `*.fandom.com`; its official moving guide recommends redirecting an owned domain to that address. This does not host the wiki at our domain. [URL help](https://community.fandom.com/wiki/Help:URL), [moving guide](https://community.fandom.com/wiki/Community_Central:Moving_your_wiki_to_FANDOM) |

Fandom supplies a familiar network and discovery surface, but it also supplies advertising and controls the platform. Its policy keeps the Fandom wiki active when contributors fork elsewhere. Starting there and later copying the articles can leave two competing versions. I would establish the official encyclopedia on our domain from the beginning. [Fandom moving guide](https://community.fandom.com/wiki/Community_Central:Moving_your_wiki_to_FANDOM), [forking policy](https://community.fandom.com/wiki/Forking_Policy).

Give the wiki Catanova's artwork and a clean game-reference layout. Start with about 15 useful pages: getting started, winning, setup, each resource, building costs, trading/ports, robber/discards, development cards, awards and reconnect help. Let anyone read; initially use a small trusted editing team, then open contributions with moderation. Wiki accounts can be separate from game accounts initially; sharing Google/Supabase login would be an additional integration.

Keep pages public and crawlable, with descriptive titles, helpful original explanations, internal links, a sitemap and links from the game. Add the domain to Search Console and inspect indexing. The provider's name does not guarantee rankings or players. Keep one canonical version of each article rather than launching duplicate full wikis. [Google SEO guidance](https://developers.google.com/search/docs/fundamentals/seo-starter-guide).

Retain exportable article history and uploaded images. A wiki database dump alone is not a complete image/configuration backup. MyWikis advertises automatic backups, while daily downloadable backups are a separate $5/month option; confirm export access before purchase. [MediaWiki backups](https://www.mediawiki.org/wiki/Manual:Backing_up_a_wiki), [MyWikis plans](https://www.mywikis.com/plans).

## Domains and launch checklist

| Address                                        | Initial destination                             |
| ---------------------------------------------- | ----------------------------------------------- |
| `catanova.io`                                  | Azure application: landing, lobby and game      |
| `catanova.io/api/*` and `wss://catanova.io/ws` | Same authoritative Node service                 |
| `www.catanova.io`                              | Permanent redirect to the canonical apex domain |
| `wiki.catanova.io`                             | Chosen managed MediaWiki host                   |
| `assets.catanova.io`                           | Reserve for a later CDN; unnecessary initially  |

1. Use the existing registrar's DNS or Cloudflare DNS; no registrar transfer is required. Preserve any email and verification records.
2. Add the actual Azure-provided apex A record and `asuid` TXT verification. A subdomain uses a direct CNAME to the application and its matching verification TXT. Bind each served hostname and HTTPS certificate. Keep Cloudflare records **DNS-only** if using Azure's free managed certificates: Azure requires direct records for issuance and renewal. If CAA records exist, allow the documented issuer. [Azure custom domains and certificate requirements](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates).
3. Configure the wiki host's supplied DNS target and certificate for `wiki.catanova.io`; do not invent its target or proxy it without the host's instructions.
4. Set the production Supabase Site URL and exact OAuth callback, Google provider callback, Turnstile hostname and WebSocket origin rules. Verify Google sign-in, guest signup, account linking and invites from the public domain.
5. Test TLS renewal, redirects, WebSocket reconnects, cache policy and recovery before inviting a wider audience. If a proxy/CDN is added later, never cache personalized APIs or game state. Cloudflare can terminate sockets during network updates, so recovery remains necessary. [Cloudflare WebSocket behavior](https://developers.cloudflare.com/network/websockets/).

## Starter budget and spending controls

At **730 hours/month**, an always-active ACA Consumption replica of **0.5 vCPU / 1 GiB** is about **$34.02/month** with unused subscription free grants, or **$39.42** without them. Central India retail rates checked today are $0.000024/vCPU-second and $0.000003/GiB-second; requests beyond the grant are $0.40/million. The free grants are 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests per subscription. This calculation is a resource example, not a player-capacity claim. [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [queried retail meters](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20Container%20Apps%27%20and%20armRegionName%20eq%20%27centralindia%27%20and%20priceType%20eq%20%27Consumption%27&currencyCode=USD).

| Monthly item                                        |           Initial planning allowance |
| --------------------------------------------------- | -----------------------------------: |
| Azure application resources                         |                               $34–40 |
| Supabase Pro, one Micro project                     |                                  $25 |
| Modest logs, registry, traffic and backup allowance |                               $10–20 |
| MyWikis Pro, month-to-month                         |                               $17.99 |
| **Plan around**                                     | **$90–105/month before credits/tax** |

Supabase Pro includes $10 compute credits covering one Micro instance, 8 GB database disk and daily backups with seven-day retention. Higher compute, extra projects, disk and usage can increase the bill. Free projects can pause after inactivity, which is unsuitable for the intended always-available game. [Supabase pricing](https://supabase.com/pricing).

Domain renewal is already a separate registrar expense. The allowance is not a hard billing cap: unusually heavy traffic, abuse, larger assets or extended logs can exceed it. Start with one replica, capped log retention and measured admission limits. Configure actual and forecast cost alerts at 50%, 80% and 100% of the operating budget. Azure budgets notify; they do not stop resources automatically. [Azure budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets).

Azure and Supabase credits can reduce eligible charges, but their balances, expiry, service exclusions and billing organizations need checking in their respective portals. Do not assume either pays for the wiki host or domain, or that credits are interchangeable. Keep the full post-credit monthly budget visible. Nothing in this plan requires an LLM or image-generation call during ordinary gameplay.

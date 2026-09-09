# Catanova launch infrastructure

Deployment status updated **10 September 2026**; retail estimates were checked **9 September 2026**, in USD before tax and credits. The game is deployed to one Azure VM. DNS-based HTTPS/access checks, a full reboot and isolated two-client state recovery passed. Private backup upload, authenticated download and snapshot integrity checks passed; the fifteen-minute timer is active. Supabase advertises Google and anonymous signups as enabled. Real Google/Turnstile sessions and recovery of a played match from a downloaded backup remain untested. Credit balances and expiry are unknown; monitoring alerts are not configured. [Deployment record](../deploy/single-vm/AZURE.md), [operator runbook](../deploy/single-vm/OPERATIONS.md)

There will be **no paid wiki subscription**. Fandom and a branded self-hosted wiki are being considered; no wiki has been created. Self-hosting uses cloud resources even though the software is free.

## First deployment

The first small online playtest runs the **frontend and authoritative Node game server together on one Azure Linux VM with a managed data disk**: `catanova-game-01`, Central India zone 2, `Standard_B2als_v2`, at `74.225.248.124`. Release `8741e4459853277b41547e8cdc2d0a5c0d689eee` keeps the current SQLite game store and Supabase accounts/friends, with one repository and one game application image. The wiki is independent; it does not need a paid subscription or a game database migration.

Persistent container volumes live on a retained managed data disk, behind Caddy HTTPS, with a single game-server process. Reboot recovery and private backups have been checked; recovering a played match from backup and ongoing monitoring remain separate work. Never put the game database on the VM's temporary disk. A retained data disk supports recovery after replacing a VM, but a single host still has downtime during recovery. Requote compute, OS/data disks, public IP, backup storage and traffic before resizing or adding workloads. [Azure managed disks](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)

The release procedure builds a reviewed image before replacing the container. Move larger builds to CI if they start competing with gameplay; size the runtime from load measurements, not an assumed player count. No paid wiki subscription is settled as a budget constraint; game compute and any self-hosted wiki resources are usage-billed even when credits pay the invoice.

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

**Wiki subscription budget: $0/month. Deployment choice: pending.** MyWikis is no longer recommended. The owner is considering both Fandom and a branded wiki. The [wiki plan and portable content pack](wiki/README.md) explain the editing and operational differences.

| Option                           | Address and editing                                                                                                                                                                                                                                                                            | Cost and fit                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fandom**                       | Free hosted community at a `*.fandom.com` address, with browser editing, ads and community tools. An owned-domain redirect is not custom-domain hosting. [Creation help](https://community.fandom.com/wiki/Help:Start_a_new_community), [URL help](https://community.fandom.com/wiki/Help:URL) | $0 hosting subscription; provider operates the service. Suitable for community articles.                                                                   |
| **Self-hosted MediaWiki**        | Editable encyclopedia at `wiki.catanova.io`; MediaWiki LTS, VisualEditor and a separate MariaDB database behind the VM's HTTPS proxy. [Supported software](https://www.mediawiki.org/wiki/Download)                                                                                            | $0 software/subscription; added VM memory, CPU, persistent storage and backups are not automatically free. Best fit for an owned editable encyclopedia.    |
| **Static branded documentation** | Existing `/guide/` now; an expanded static encyclopedia would need a content build and article routes. Edited through Git, not a wiki editor.                                                                                                                                                  | No extra service for the existing guide. A separate static build can use free static hosting within its limits. Lowest maintenance for the first playtest. |

For the first 2–4-player playtest, keep the guide useful and add Fandom if desired. Add self-hosted MediaWiki when browser editing on our own domain is needed and the measured VM budget supports it. Resource limits, independent wiki data and off-host backups keep this optional service from consuming the game's entire host. It still shares a single VM's outage window. There is no new paid wiki plan in either path.

Fandom is not simply a bad service: it supplies hosting, tools and an established community network without a monthly hosting bill. Its tradeoffs matter for this game's clean presentation. Logged-out readers see ads; current help describes an ad-light experience for registered readers and little-to-no ads for recent editors. An editor's view therefore does not represent a new player's view. [Account and ad experience](https://community.fandom.com/wiki/Help:Create_an_account)

Fandom wikis are community projects rather than founder-owned sites. General article editing must stay open under its rules, so the earlier idea of permanently restricting editing to our own team is not a Fandom plan. Leaving is possible, but the Fandom wiki normally remains when a community forks, with restrictions on promoting the new location. [Community creation/content policy](https://www.fandom.com/community-creation-policy), [forking policy](https://community.fandom.com/wiki/Forking_Policy)

### Content and eligibility checks

Describe the wiki as an encyclopedia of the actual Catanova game: mechanics, interface, resources and troubleshooting. Being developer-supported is not a substitute for complying with the host's policies. Do not treat the wiki as a sales page, an image dump, or a duplicate official CATAN encyclopedia.

The original game artwork includes generated assets, and the starter articles were prepared with AI assistance. Review every page against the implemented game, preserve provenance and licensing, and disclose these facts in the request. Fandom's terms require the right to upload images and compliance with its content rules; they do not establish blanket approval of our particular assets. Do not infer permission from another wiki's AI policy or from the provider using AI in its own features. [Fandom terms](https://www.fandom.com/terms-of-use)

### What is needed to create the free wiki

For **Fandom**:

1. A signed-in owner-controlled Fandom account with a confirmed email. Registration can use email or a supported social provider; the owner supplies any birthdate, password, email verification and CAPTCHA directly. [Account help](https://community.fandom.com/wiki/Help:Create_an_account)
2. Check for an existing Catanova community. Choose `Catanova Wiki`, an available `catanova.fandom.com`-style address, English, a concise game-specific description and the Games category. URL availability is not confirmed.
3. Review the creation/content policy and open [Start a Wiki](https://createnewwiki.fandom.com/wiki/Special:CreateNewWiki). Address any duplicate-topic warning accurately, then choose a theme. No payment is part of the documented creation workflow. [Creation steps](https://community.fandom.com/wiki/Help:Start_a_new_community)
4. Import reviewed articles/images with the correct licenses and set up navigation and moderation. A Fandom account is separate from the game's Google/Supabase account.

For **self-hosted MediaWiki**, we need VM/DNS access, persistent wiki storage, a separate database, private installation settings, an owner administrator account, recovery email delivery and a working backup/restore process. Import the reviewed pack after installation and test browser editing, uploads and gameplay together. Follow the [concrete wiki deployment plan](wiki/README.md#concrete-self-hosted-mediawiki-plan); no hosted-wiki subscription or game-account integration is required.

If both sites launch, use the branded site for release-checked mechanics and help, and Fandom for standalone community explanations, strategy examples and discussion. Link relevant articles and preserve attribution when reusing community contributions. Avoid automatic full mirrors because they add maintenance and can diverge, not because ordinary duplicate content creates an automatic search penalty. Google may choose one representative URL; neither hostname guarantees extra rankings or players. [Canonicalization guidance](https://developers.google.com/search/docs/crawling-indexing/canonicalization)

## Domains and launch checklist

| Address                                        | Initial destination                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| `catanova.io`                                  | Azure application: landing, lobby and game                                         |
| `catanova.io/api/*` and `wss://catanova.io/ws` | Same authoritative Node service                                                    |
| `www.catanova.io`                              | Optional redirect to the apex; not part of the verified launch                     |
| `wiki.catanova.io`                             | Optional self-hosted MediaWiki or static encyclopedia; destination not provisioned |
| `assets.catanova.io`                           | Reserve for a later CDN; unnecessary initially                                     |

1. Use the existing registrar's DNS or Cloudflare DNS; no registrar transfer is required. Preserve any email and verification records.
2. The VM's `catanova.io` A record points to `74.225.248.124`, and normal DNS-based HTTPS and Caddy's certificate have been verified. Keep renewal checks in routine operations. If the later Container Apps route is selected instead, follow its distinct A/CNAME, `asuid` TXT and managed-certificate requirements; those are not VM setup instructions. Keep records DNS-only when required for ACA managed certificates. [ACA custom-domain instructions](https://learn.microsoft.com/en-us/azure/container-apps/custom-domains-managed-certificates)
3. For self-hosted MediaWiki, route the wiki hostname to its own HTTPS virtual host on the VM. For a separate static build, use the chosen static host's domain setup. Fandom remains on its assigned platform URL; an optional owned-domain redirect changes the address seen by the reader and is unnecessary if both sites have distinct content.
4. The owner confirmed the Supabase and Turnstile production-domain settings. Verify real Google sign-in, guest signup, account linking and invites from the public domain; the server's authenticated-mode response does not prove those user flows.
5. Test TLS renewal, redirects, WebSocket reconnects, cache policy and recovery before inviting a wider audience. If a proxy/CDN is added later, never cache personalized APIs or game state. Cloudflare can terminate sockets during network updates, so recovery remains necessary. [Cloudflare WebSocket behavior](https://developers.cloudflare.com/network/websockets/).

## Where the earlier $90–105 estimate came from

This was a **historical planning estimate for a more managed setup**, not a required first-launch bill and not current spending. It included a paid wiki that the owner has now declined.

At **730 hours/month**, an always-active ACA Consumption replica of **0.5 vCPU / 1 GiB** is about **$34.02/month** with unused subscription free grants, or **$39.42** without them. Central India retail rates checked on 9 September 2026 are $0.000024/vCPU-second and $0.000003/GiB-second; requests beyond the grant are $0.40/million. The free grants are 180,000 vCPU-seconds, 360,000 GiB-seconds and two million requests per subscription. This calculation is a resource example, not a player-capacity claim. [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/), [queried retail meters](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20Container%20Apps%27%20and%20armRegionName%20eq%20%27centralindia%27%20and%20priceType%20eq%20%27Consumption%27&currencyCode=USD).

| Monthly item                                        |              Historical planning allowance |
| --------------------------------------------------- | -----------------------------------------: |
| Azure application resources                         |                                     $34–40 |
| Supabase Pro, one Micro project                     |                                        $25 |
| Modest logs, registry, traffic and backup allowance |                                     $10–20 |
| MyWikis Pro, month-to-month — now removed           |                                     $17.99 |
| **Exact sum of those ranges**                       | **$86.99–102.99/month before credits/tax** |
| **Earlier rounded allowance**                       |       **$90–105/month before credits/tax** |

With free hosted Fandom or a free static wiki, the **same hypothetical ACA/Postgres plan is $69–85/month** before credits/tax: $34–40 + $25 + $10–20 + $0. This does not price a new self-hosted MediaWiki workload. The $10–20 line is an operating allowance, not a fixed provider fee. We have not chosen or purchased this stack.

## Initial spending plan

| Item                                         | Current approach                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wiki                                         | **$0 subscription**. Fandom hosting is free; self-hosted MediaWiki adds resource/backup usage to the VM quote. Deployment choice pending.                                                                                                                         |
| Game host                                    | Deployed Azure VM with managed persistent storage; $32.37/month base retail estimate and $35–40 light-usage allowance, before Supabase/tax. Offset only eligible charges with verified credits.                                                                   |
| Accounts/friends                             | Keep the existing Supabase project; no extra game-state Postgres instance is required for the SQLite playtest. Use its actual current plan and eligible credits. Free can support a controlled test within limits; Pro is optional until its benefits are needed. |
| Domain                                       | `catanova.io` is already purchased; renewal is separate. `wiki.catanova.io` does not require a second registration.                                                                                                                                               |
| Paid wiki, ads, paid support, extra replicas | **Not included.**                                                                                                                                                                                                                                                 |

The [Central India deployment record](../deploy/single-vm/AZURE.md) itemizes a **$32.37/month base retail estimate** and the approved **$35–40 light-usage allowance** for the deployed game server. This excludes Supabase, tax and any separate wiki workload. These are estimates, not a measured monthly bill; credit balance/expiry and the Supabase bill remain unverified. Cash spending can be lower than the gross resource bill while eligible credits last; do not describe that as permanently free hosting.

Supabase Pro starts at $25/month and includes compute credit for one Micro project and seven days of daily backups. Free projects can pause after inactivity, so a free playtest must not promise an always-available service. Higher paid-plan usage can increase the bill. Supabase's account backups do not back up the VM's SQLite game database. [Supabase pricing](https://supabase.com/pricing)

The allowance is not a hard billing cap: unusually heavy traffic, abuse, larger assets or extended logs can exceed it. Keep one server with capped log retention and establish admission limits through measurements. **Cost and service alerts are not configured yet.** Configure actual and forecast cost alerts at 50%, 80% and 100% of the approved operating budget. Azure budgets notify; they do not stop resources automatically. [Azure budgets](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-acm-create-budgets)

Azure and Supabase credits can reduce eligible charges, but their balances, expiry, service exclusions and billing organizations need checking in their respective portals. Do not assume either pays for the wiki host or domain, or that credits are interchangeable. Keep the full post-credit monthly budget visible. Nothing in this plan requires an LLM or image-generation call during ordinary gameplay.

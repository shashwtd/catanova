# Hosting, reliability, and costs

For `catanova.io`, the **free wiki choice (pending)**, rollout sequence and explanation of the historical $90–105 estimate, use the [launch infrastructure plan](LAUNCH_INFRASTRUCTURE.md). The current plan has **$0 wiki hosting**, with no paid wiki subscription. The ACA calculations below describe a later architecture, not a required first-launch bill.

Planning estimate checked **9 September 2026**, in **USD before taxes**, credits, and negotiated discounts. This document proposes a deployment; it does not provision cloud resources. No Azure or Supabase account has been inspected, and no credit balance or eligibility is assumed.

## Recommendation

Use one repository and one distributable application image. For a small hosted playtest, keep the existing SQLite store on **one Azure Linux VM with a managed data disk**, using eligible Azure credits after checking the account. Keep Supabase for the implemented accounts/friends system. Select the region and VM size from real latency and memory/load measurements; there is no established concurrent-player capacity yet.

Mount the managed disk into the application's data directory, retain it across VM replacement, and keep one game-server process. Supply HTTPS, updates, monitoring and off-host database backups. Do not use the VM's temporary disk: its contents can disappear during maintenance or redeployment. The VM, OS/data disks, public IP, bandwidth and backup storage need an actual regional quote; no fixed all-in VM price is assumed. [Azure disk guidance](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)

This gives us a route to testing online without first rewriting game storage. A single VM can still fail and cause a recovery window. Persistent storage and tested backups improve recovery; they do not make the service continuously available through host or regional failures.

### Future managed-container deployment

Azure Container Apps with Supabase Postgres game state is an option after implementing the storage adapter. Keep server/database regions close and measure the cross-provider round trip.

Azure HTTP ingress supports WebSockets, managed TLS termination, and an assigned hostname. This allows the application and socket endpoint to share one origin. [Azure ingress documentation](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)

Start with minimum replicas = 1. Keep maximum replicas = 1 until room ownership and broadcast routing work correctly across instances. An always-on instance avoids scale-to-zero startup delays but does not prevent crashes or platform restarts. Sticky sessions alone do not place all players in one room on the same authoritative owner. [Session affinity](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions)

Supabase account authentication and private friend/profile access are implemented; the cloud game-state adapter remains planned. Players send game commands to the game server. Browser clients must not arbitrate state through direct database writes or use broadcasts as the only source of truth.

## What the current prototype can host

The playable game currently persists rooms, state, events and command receipts in local SQLite. The Compose file includes a named data volume. It can recover from a process restart while that volume survives. It is **not** ready to run unchanged on an ephemeral Azure Container Apps filesystem: replicas and revisions can lose those local files.

Before any Container Apps deployment, implement and test the Postgres game-state adapter and schema setup. Do not substitute an Azure Files network share for SQLite WAL, which needs processes on the same host. Account/invite controls, per-player state projections and local recovery exist; hosted OAuth, disk recovery and backup restore remain deployment checks. No cloud app has been deployed by this plan. [SQLite WAL constraints](https://sqlite.org/wal.html)

### Fly Machines alternative

A single Fly Machine with a mounted Fly Volume is another route for the current SQLite container. Volumes are local persistent storage attached to one Machine; Fly does not automatically replicate their contents. Keep one writer and plan backups and downtime on host failure. This is an alternative paid provider, not an Azure-credit destination. [Fly Volumes](https://fly.io/docs/volumes/overview/)

Current Fly pricing lists **$0.15/GB/month** for provisioned volumes and **$0.08/GB/month** for snapshot storage after the first 10 GB. Machine prices vary by region and memory. Add compute, outbound traffic, any chargeable IP/certificates and taxes before comparing totals; a volume's tiny price is not the price of hosting the game. India public-internet egress is currently **$0.12/GB**. New billing organizations require a payment card; do not assume an old free-tier allowance. Verify the selected regional compute quote and retain ordinary usage billing unless another commitment is explicitly chosen. [Fly pricing](https://fly.io/docs/about/pricing/)

## Historical ACA resource examples

The following estimates assume 730 hours/month, one replica, fully active billing, no extra projects, unused subscription-level free grants, and little traffic. They are resource-cost examples, not measured game capacity.

| Item                                                            |        Lean probe-sized example | More comfortable starting allocation |
| --------------------------------------------------------------- | ------------------------------: | -----------------------------------: |
| Azure app resources                                             | 0.25 vCPU / 0.5 GiB: **$14.31** |         0.5 vCPU / 1 GiB: **$34.02** |
| Supabase Pro with first Micro project                           |                         **$25** |                              **$25** |
| Planning allowance: logs, small storage/registry, modest egress |                       **$5–15** |                            **$5–20** |
| Estimated total before credits/tax                              |          **about $45–55/month** |               **about $65–80/month** |

These are the earlier **game-service-only** examples, using a $5–20 operating allowance and excluding any wiki. The historical combined launch estimate used $10–20 for operations and added $17.99 for MyWikis, yielding $86.99–102.99, rounded to $90–105. Removing the paid wiki from that same combined model gives **$69–85**, but the initial VM/SQLite route must be quoted separately. None of these figures is current spending or a promise of player capacity.

The existing Supabase project does not need to be upgraded merely to run the SQLite playtest. Free can be used within its limits for a controlled test, with possible inactivity pausing and no always-available promise. Pro starts at $25/month with compute credit for one Micro project; extra usage can increase charges. Check the actual plan and credits before changing it. [Supabase pricing](https://supabase.com/pricing)

## Azure calculation

The Azure public retail API was queried for `serviceName eq 'Azure Container Apps'`, `armRegionName eq 'centralindia'`, and Consumption pricing. The Standard meters returned these retail rates:

| Meter                     |                  USD rate |
| ------------------------- | ------------------------: |
| Active vCPU               | $0.000024 per vCPU-second |
| Idle vCPU                 | $0.000003 per vCPU-second |
| Active or idle memory     |  $0.000003 per GiB-second |
| Requests beyond allowance |         $0.40 per million |

Source: [Azure Retail Prices API](https://prices.azure.com/api/retail/prices?%24filter=serviceName%20eq%20%27Azure%20Container%20Apps%27%20and%20armRegionName%20eq%20%27centralindia%27%20and%20priceType%20eq%20%27Consumption%27&currencyCode=USD), and [API documentation](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

The Consumption plan currently includes 180,000 vCPU-seconds, 360,000 GiB-seconds, and 2 million requests per subscription per month. Other apps can consume that allowance. Active and idle billing depend on actual activity; the table deliberately assumes active rates rather than promising the lowest idle bill. [Azure Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)

For 0.5 vCPU and 1 GiB, 730 hours = 2,628,000 seconds:

```text
CPU: max(0, 0.5 × 2,628,000 − 180,000) × 0.000024 = $27.216
RAM: max(0, 1.0 × 2,628,000 − 360,000) × 0.000003 =  $6.804
Total resource charge                                         $34.020
```

Without those free grants, the same active resource allocation is about $39.42/month; the 0.25/0.5 allocation is about $19.71/month. These figures exclude HTTP request overages, outbound bandwidth, logging, registry, extra infrastructure, and taxes. Confirm service availability, the precise region, and account offer in the Azure calculator before provisioning. Do not accidentally choose dedicated profiles, private endpoints, GPUs, premium ingress, or other separately billed environment features when estimating a simple Consumption app.

## Other costs and credit caveats

- **A domain:** the owner has purchased `catanova.io`. DNS and HTTPS still need configuration; renewal remains a separate registrar expense.
- **Artwork and sound:** production costs rather than a per-turn expense. Generate and license assets during development, compress them, then serve the resulting files. Ordinary gameplay should require no image-generation or LLM API call.
- **Asset bandwidth:** large textures and audio can outweigh game-command traffic. Texture atlases, caching, compression, and eventual CDN delivery help. Measure download sizes before forecasting a public launch.
- **Observability:** sample routine logs, cap retention, and alert on save failures, reconnect spikes, memory, and database latency. Unbounded logs can create a significant bill.
- **Email/authentication:** Google and guest sign-in are implemented. Additional login providers, email delivery and abuse controls may add costs if introduced.
- **Backups:** accepted moves live in the VM's SQLite database in the initial plan; Supabase account backups do not cover those files. Make application-consistent copies to separate storage and test restoration. If game state later moves to Postgres, Supabase backup/PITR choices become relevant; paid PITR is not part of the initial plan. A daily backup alone can lose the intervening day's changes in disaster recovery. [SQLite backup guidance](https://sqlite.org/backup.html), [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- **Credits:** Azure credits can offset eligible Azure charges; Supabase credits offset eligible Supabase charges according to their grant terms. They are not interchangeable, may expire, and may exclude some services. Keep a post-credit budget and billing alerts. The owner must check amounts, expiration dates, and eligible services in the account portals.

## Release gates for reliability

1. Preserve the existing atomic save of state, events, randomness and command receipts on the managed disk; verify an acknowledged move survives process death and VM replacement with that retained disk. If migrating to Postgres later, prove the same contract there.
2. Test a lost acknowledgment followed by retry and a saved match resumed after redeployment.
3. Choose the game server region after measuring player latency. Measure the auth-service hop too; if game state later moves to Supabase Postgres, include that hop in every command's commit-latency measurements.
4. Test reconnects across real Wi-Fi interruption, mobile backgrounding, and the cloud proxy. Heartbeats help detect a dead path; they do not prevent network loss.
5. Test backup restore separately from ordinary application restart. State the resulting recovery-point and recovery-time expectations.
6. Load-test to set room limits and memory headroom. Measure p95 and p99 acknowledgment time under load.
7. Before multiple replicas, implement exclusive room ownership with fencing, routing, coordinated broadcasts, and deployment draining.
8. Keep protocol and ruleset versions with saved matches so a code update does not reinterpret a game in progress.

A single managed instance plus durable data is a reasonable first service, with brief interruption and recovery on a restart. Seamless failover and resilience to a database or regional outage require additional design and spending. Credits help fund that work; they do not replace it.

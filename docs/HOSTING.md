# Hosting, reliability, and costs

For `catanova.io`, the wiki options, rollout sequence and explanation of the historical $90–105 estimate, use the [launch infrastructure plan](LAUNCH_INFRASTRUCTURE.md). There is **no paid wiki subscription**: Fandom hosting is free, while self-hosted MediaWiki is free software that consumes cloud resources. Neither wiki is provisioned by this plan. The ACA calculations below describe a later architecture, not a required first-launch bill.

Retail estimate checked **9 September 2026**, in **USD before taxes**, credits, and negotiated discounts. The Azure VM was deployed on **10 September 2026**: `catanova-game-01`, Central India zone 2, `Standard_B2als_v2`. HTTPS/access checks, a full reboot and isolated two-client state recovery passed. Private backup upload, authenticated download and snapshot integrity checks passed; the fifteen-minute timer is active. Real Google/guest sessions and recovery of a played match from a downloaded backup remain untested. No monitoring alerts or wiki have been created; credit balance, expiry and Supabase billing remain unverified. The [deployment record](../deploy/single-vm/AZURE.md) has a **$32.37/month base retail estimate**, with **$35–40/month** allowed for initial light usage rather than a hard cap. See the [operator runbook](../deploy/single-vm/OPERATIONS.md).

## Recommendation

The hosted playtest uses one repository and one distributable game application image, with SQLite on **one Azure Linux VM with a managed data disk**. Supabase handles the implemented accounts/friends system. Revisit the initial region and VM size using real latency and memory/load measurements; there is no established concurrent-player capacity yet.

The managed disk holds the container volumes, with one game-server process and Caddy HTTPS. It is retained across VM replacement; keep its contents and certificate volumes during updates. Reboot persistence and an isolated snapshot's structure have been verified, while played-match restoration from backup and monitoring setup remain outstanding. Do not use the VM's temporary disk: its contents can disappear during maintenance or redeployment. The linked deployment record itemizes compute, disks, IP and backup capacity; actual usage, tax and credits remain separate. [Azure disk guidance](https://learn.microsoft.com/en-us/azure/virtual-machines/managed-disks-overview)

This gives us a route to testing online without first rewriting game storage. A single VM can still fail and cause a recovery window. Persistent storage and tested backups improve recovery; they do not make the service continuously available through host or regional failures.

The existing static `/guide/` needs no extra service. An optional Fandom community adds browser editing without running another server. For an owned editable encyclopedia, the [MediaWiki plan](wiki/README.md#concrete-self-hosted-mediawiki-plan) uses separate MediaWiki and MariaDB workloads, persistent uploads/configuration and off-host backups. Those workloads need measured memory/CPU headroom and resource limits; they share the VM's outage window and may require a larger VM. Free software does not establish $0 incremental hosting cost.

### Future managed-container deployment

Azure Container Apps with Supabase Postgres game state is an option after implementing the storage adapter. Keep server/database regions close and measure the cross-provider round trip.

Azure HTTP ingress supports WebSockets, managed TLS termination, and an assigned hostname. This allows the application and socket endpoint to share one origin. [Azure ingress documentation](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)

Start with minimum replicas = 1. Keep maximum replicas = 1 until room ownership and broadcast routing work correctly across instances. An always-on instance avoids scale-to-zero startup delays but does not prevent crashes or platform restarts. Sticky sessions alone do not place all players in one room on the same authoritative owner. [Session affinity](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions)

Supabase account authentication and private friend/profile access are implemented; the cloud game-state adapter remains planned. Players send game commands to the game server. Browser clients must not arbitrate state through direct database writes or use broadcasts as the only source of truth.

## What the current prototype can host

The playable game currently persists rooms, state, events and command receipts in local SQLite. The Compose file includes a named data volume. It can recover from a process restart while that volume survives. It is **not** ready to run unchanged on an ephemeral Azure Container Apps filesystem: replicas and revisions can lose those local files.

Before any Container Apps deployment, implement and test the Postgres game-state adapter and schema setup. Do not substitute an Azure Files network share for SQLite WAL, which needs processes on the same host. The deployed VM passed reboot and isolated state-recovery checks; hosted OAuth and played-match restoration from backup remain untested. Replacing a lost VM is a separate recovery scenario from rebooting it. Container Apps has not been deployed. [SQLite WAL constraints](https://sqlite.org/wal.html)

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

These are the earlier **game-service-only** examples, using a $5–20 operating allowance and excluding any wiki. The historical combined launch estimate used $10–20 for operations and added $17.99 for MyWikis, yielding $86.99–102.99, rounded to $90–105. Removing the paid wiki from that same combined model gives **$69–85** with free hosted Fandom or a free static wiki; this does not price a self-hosted MediaWiki workload. The initial VM/SQLite route and any colocated wiki must be quoted separately. None of these figures is current spending or a promise of player capacity.

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

- **A domain:** `catanova.io` resolves to the VM, and ordinary DNS-based HTTPS has a verified certificate. Renewal remains a separate registrar expense.
- **Artwork and sound:** production costs rather than a per-turn expense. Generate and license assets during development, compress them, then serve the resulting files. Ordinary gameplay should require no image-generation or LLM API call.
- **Asset bandwidth:** large textures and audio can outweigh game-command traffic. Texture atlases, caching, compression, and eventual CDN delivery help. Measure download sizes before forecasting a public launch.
- **Observability:** sample routine logs, cap retention, and alert on save failures, reconnect spikes, memory, and database latency. Unbounded logs can create a significant bill.
- **Email/authentication:** Google and guest sign-in are implemented. Additional login providers, email delivery and abuse controls may add costs if introduced.
- **Backups:** accepted moves live in the deployed VM's SQLite database; Supabase account backups do not cover those files. The private backup worker has completed uploads before and after reboot; a downloaded snapshot passed isolated structural checks. Recovery of a played match from backup remains untested. Monitor successful backups, since a configured schedule alone does not establish a recovery point. If game state later moves to Postgres, Supabase backup/PITR choices become relevant; paid PITR is not part of the initial plan. [SQLite backup guidance](https://sqlite.org/backup.html), [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- **Credits:** Azure credits can offset eligible Azure charges; Supabase credits offset eligible Supabase charges according to their grant terms. They are not interchangeable, may expire, and may exclude some services. Keep a post-credit budget and billing alerts. The owner must check amounts, expiration dates, and eligible services in the account portals.

## Release gates for reliability

1. Preserve the existing atomic save of state, events, randomness and command receipts on the managed disk; verify an acknowledged move survives process death and VM replacement with that retained disk. If migrating to Postgres later, prove the same contract there.
2. Test a lost acknowledgment followed by retry and a saved match resumed after redeployment.
3. Measure player latency to the initial Central India region and revisit placement if needed. Measure the auth-service hop too; if game state later moves to Supabase Postgres, include that hop in every command's commit-latency measurements.
4. Test reconnects across real Wi-Fi interruption, mobile backgrounding, and the cloud proxy. Heartbeats help detect a dead path; they do not prevent network loss.
5. Test backup restore separately from ordinary application restart. State the resulting recovery-point and recovery-time expectations.
6. Load-test to set room limits and memory headroom. Measure p95 and p99 acknowledgment time under load.
7. Before multiple replicas, implement exclusive room ownership with fencing, routing, coordinated broadcasts, and deployment draining.
8. Keep protocol and ruleset versions with saved matches so a code update does not reinterpret a game in progress.

A single managed instance plus durable data is a reasonable first service, with brief interruption and recovery on a restart. Seamless failover and resilience to a database or regional outage require additional design and spending. Credits help fund that work; they do not replace it.

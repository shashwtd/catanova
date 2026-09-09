# Hosting, reliability, and costs

For the current `catanova.io` domain, managed wiki, rollout sequence and combined budget, use the [launch infrastructure plan](LAUNCH_INFRASTRUCTURE.md). The resource calculations below exclude the wiki and remain supporting estimates.

Planning estimate checked **9 September 2026**, in **USD before taxes**, credits, and negotiated discounts. This document proposes a deployment; it does not provision cloud resources. No Azure or Supabase account has been inspected, and no credit balance or eligibility is assumed.

## Recommendation

Use one repository and one distributable application image. For the first hosted playable release, run an always-on **Azure Container Apps Consumption** replica and store accepted game state in **Supabase Postgres**. Keep the server and database geographically close and measure their round-trip time from the intended players. Supabase's AWS Mumbai region and an available nearby Azure region are candidates, not a measured conclusion.

Azure HTTP ingress supports WebSockets, managed TLS termination, and an assigned hostname. This allows the application and socket endpoint to share one origin. [Azure ingress documentation](https://learn.microsoft.com/en-us/azure/container-apps/ingress-overview)

Start with minimum replicas = 1. Keep maximum replicas = 1 until room ownership and broadcast routing work correctly across instances. An always-on instance avoids scale-to-zero startup delays but does not prevent crashes or platform restarts. Sticky sessions alone do not place all players in one room on the same authoritative owner. [Session affinity](https://learn.microsoft.com/en-us/azure/container-apps/sticky-sessions)

Supabase account authentication and private friend/profile access are implemented; the cloud game-state adapter remains planned. Players send game commands to the game server. Browser clients must not arbitrate state through direct database writes or use broadcasts as the only source of truth.

## What the current prototype can host

The playable game currently persists rooms, state, events and command receipts in local SQLite. The Compose file includes a named data volume. It can recover from a process restart while that volume survives. It is **not** ready to run unchanged on an ephemeral Azure Container Apps filesystem: replicas and revisions can lose those local files.

Before the recommended Container Apps deployment, implement and test the Postgres game-state adapter and schema setup. Account/invite controls, per-player state projections and local game recovery are implemented and tested; hosted OAuth, cloud storage and failover remain separate checks. A single managed-disk VM is an interim playtest alternative described in the launch plan. No cloud app has been deployed.

## Monthly starter budget

The following estimates assume 730 hours/month, one replica, fully active billing, no extra projects, unused subscription-level free grants, and little traffic. They are resource-cost examples, not measured game capacity.

| Item                                                            |        Lean probe-sized example | More comfortable starting allocation |
| --------------------------------------------------------------- | ------------------------------: | -----------------------------------: |
| Azure app resources                                             | 0.25 vCPU / 0.5 GiB: **$14.31** |         0.5 vCPU / 1 GiB: **$34.02** |
| Supabase Pro with first Micro project                           |                         **$25** |                              **$25** |
| Planning allowance: logs, small storage/registry, modest egress |                       **$5–15** |                            **$5–20** |
| Estimated total before credits/tax                              |          **about $45–55/month** |               **about $65–80/month** |

I would budget around **$65–80/month** for the first small hosted service until measurements justify a smaller allocation. A leaner instance may work, but we have not load-tested it. This is not a quotation or a promise of a particular number of players. Paid plans do not make the whole application highly available by themselves.

Supabase Pro starts at $25/month and includes $10 in compute credits, enough for one Micro project. It includes 8 GB database disk, 250 GB ordinary egress, and daily backups retained for seven days. Extra projects, compute, storage, or egress can increase the bill. Free projects can pause after a week of inactivity, so they are unsuitable for an always-available promise. [Supabase pricing](https://supabase.com/pricing)

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
- **Backups:** regular accepted moves live in the primary database. Supabase daily backups are a separate disaster-recovery layer. Point-in-time recovery currently starts at roughly $100/month for seven-day retention and requires suitable compute; it is not included in the $25 plan. A daily backup can lose the intervening day's changes when used for disaster recovery. [Backup documentation](https://supabase.com/docs/guides/platform/backups), [pricing](https://supabase.com/pricing)
- **Credits:** Azure credits can offset eligible Azure charges; Supabase credits offset eligible Supabase charges according to their grant terms. They are not interchangeable, may expire, and may exclude some services. Keep a post-credit budget and billing alerts. The owner must check amounts, expiration dates, and eligible services in the account portals.

## Release gates for reliability

1. Save state, events, randomness, and command receipts atomically in Postgres; verify an acknowledged move survives server death.
2. Test a lost acknowledgment followed by retry and a saved match resumed after redeployment.
3. Choose server/database regions after measuring latency, including the extra cross-provider hop.
4. Test reconnects across real Wi-Fi interruption, mobile backgrounding, and the cloud proxy. Heartbeats help detect a dead path; they do not prevent network loss.
5. Test backup restore separately from ordinary application restart. State the resulting recovery-point and recovery-time expectations.
6. Load-test to set room limits and memory headroom. Measure p95 and p99 acknowledgment time under load.
7. Before multiple replicas, implement exclusive room ownership with fencing, routing, coordinated broadcasts, and deployment draining.
8. Keep protocol and ruleset versions with saved matches so a code update does not reinterpret a game in progress.

A single managed instance plus durable data is a reasonable first service, with brief interruption and recovery on a restart. Seamless failover and resilience to a database or regional outage require additional design and spending. Credits help fund that work; they do not replace it.

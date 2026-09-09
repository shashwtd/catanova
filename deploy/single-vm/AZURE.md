# Initial Azure deployment

Deployment record updated **10 September 2026**. Release **`8741e4459853277b41547e8cdc2d0a5c0d689eee`** is running on the Azure VM below, using [the single-VM bundle](README.md). The app and authoritative game server share one origin; Supabase handles accounts and friends. See [Operations](OPERATIONS.md) for the deployed paths, safe updates and recovery commands.

## Deployed resources

The dedicated resource group is **`catanova-prod-centralindia`**, in **Central India**. Its static public IP is **`74.225.248.124`**, serving **`https://catanova.io`**.

| Resource                | Configuration                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| VM `catanova-game-01`   | Ubuntu 24.04 LTS, Gen2, x64; `Standard_B2als_v2`, 2 vCPU / 4 GiB RAM; availability zone **2**; regular hourly billing, no Spot or reservation    |
| OS disk                 | Persistent **64 GiB Standard SSD LRS**, E6; no ephemeral OS disk                                                                                 |
| Managed data disk, LUN0 | Persistent **32 GiB Premium SSD LRS**, P4, in zone 2; host caching **None**; VM deletion policy **Detach**, so deleting the VM retains this disk |
| Network                 | Dedicated VNet/subnet, NIC, and network security group; one **Standard static IPv4** with an Azure DNS hostname                                  |
| Inbound access          | Public TCP **80/443**; SSH TCP **22** only from the administrator's current public IP/CIDR, using SSH keys; no public 3000 or Caddy admin port   |
| Backup storage          | Private, same-region StorageV2 account with **Hot LRS** blob storage and a container-scoped VM identity; initial cost allowance assumes 10 GB    |

The ext4 data disk is mounted by UUID at `/srv/catanova`. Docker and containerd persistent storage use `/srv/catanova/docker` and `/srv/catanova/containerd`; systemd mount dependencies prevent starting against an empty mountpoint. The game data and Caddy certificate volumes must survive both container replacement and VM replacement. Retaining a disk does not protect against deleting the disk or its resource group.

The initial quota and SKU checks passed, and allocation in zone 2 succeeded. The pre-deployment catalog restricted zone 1 and the older `Standard_B2s` for this subscription. Recheck eligibility and quota before a replacement or resize; successful allocation today does not reserve future capacity.

Basv2 is **burstable**: this size has a 30% CPU baseline and uses credits above it. Start with controlled rooms, monitor CPU credits and server latency, and resize if sustained demand warrants it. This is not a tested player-capacity claim. [Azure Basv2 specifications](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/basv2-series)

## Expected Azure cost

Public USD retail rates retrieved on **9 September 2026** from the [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), using Central India, consumption pricing, and the ordinary Linux VM product. The estimate assumes **730 running hours per month**; it is not a subscription-specific invoice or a credits balance.

| Item                        | Verified unit rate | Monthly estimate |
| --------------------------- | ------------------ | ---------------: |
| B2als v2 Linux VM           | $0.0246/hour       |           $17.96 |
| E6 LRS OS disk, 64 GiB      | $5.28/month        |            $5.28 |
| P4 LRS data disk, 32 GiB    | $5.2795/month      |            $5.28 |
| Standard static IPv4        | $0.005/hour        |            $3.65 |
| Hot LRS backup blobs, 10 GB | $0.02/GB-month     |            $0.20 |
| **Base total**              |                    | **$32.37/month** |

The exact compute meter is **Virtual Machines Basv2 Series / B2als v2**, excluding Windows, Cloud Services, Spot, and Low Priority. [Live compute query](https://prices.azure.com/api/retail/prices?$filter=armRegionName%20eq%20%27centralindia%27%20and%20armSkuName%20eq%20%27Standard_B2als_v2%27%20and%20productName%20eq%20%27Virtual%20Machines%20Basv2%20Series%27%20and%20priceType%20eq%20%27Consumption%27)

The approved allowance is **$35–40/month for initial light usage**, before taxes and Supabase. This is not an enforced cap. Standard SSD OS-disk transactions add $0.0028 per 10,000 operations, or $0.28 per million. Backup operations also add small usage charges; the quoted backup amount covers blob storage for our scheduled worker, not the managed Azure Backup service. Shared-disk extra-mount fees do not apply to these single-attached disks. [Managed disk pricing](https://azure.microsoft.com/en-us/pricing/details/managed-disks/), [IP pricing](https://azure.microsoft.com/en-us/pricing/details/ip-addresses/), [Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)

Traffic is additional: Azure publishes a first-100-GB monthly internet-egress allowance, then **$0.12/GB** from Asia through Microsoft's network for the next tier. Confirm the allowance available to this billing account; do not assume every workload receives a separate allowance. An additional 50 billable GB would add $6. [Bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/)

The inspected subscription reports a **sponsored offer** and `spendingLimit: Off`. Its remaining credits, expiry date, and any post-credit billing terms were **not established** by the APIs inspected. Confirm those in the sponsorship/billing portal. Other Azure workloads, domain renewal, wiki hosting, optional paid monitoring, and Supabase charges are outside this Catanova estimate. Cost and service alerts are not configured yet.

## Launch verification

- **HTTPS and routing passed:** requests returned 200 for the home page, guide, guide stylesheet, health and public configuration. A valid Let's Encrypt certificate was verified; HTTP redirects to HTTPS with 308. Ordinary DNS-based HTTPS also returned 200 without an IP override.
- **Access checks passed:** runtime mode is `authenticated`; `/api/account` without credentials returns 401; `/.env` and `/data/probe.sqlite` return 404. The WSS endpoint connects, and a tokenless room-creation request is rejected with `AUTH_REQUIRED`.
- **Provider configuration checked:** the owner confirmed the Supabase and Turnstile production-domain settings; Supabase's public settings report Google and anonymous signups enabled. Actual Google login and guest Turnstile sessions have not yet been tested.
- **Private backup checks passed:** the systemd worker uploaded through the VM identity with `Result=success`; anonymous download was denied. Authenticated download matched SHA-256, and an isolated decompressed snapshot passed SQLite integrity, foreign-key and required-table checks. The fifteen-minute timer is enabled and active. This is structural restore verification, not recovery of a played match.
- **Reboot and isolated game recovery passed:** the Linux boot ID changed, the data-disk UUID matched, and game/Caddy services returned healthy automatically. The production database retained its integrity and table counts. A separate two-client fixture preserved its original seats, settlement, road, private game views and history; replaying an accepted road command returned `duplicate: true` without another move. The backup timer remained active, a fresh backup succeeded, and external HTTPS returned 200 after reboot.
- **Test cleanup completed:** the disposable recovery container, volume and proof files were removed; the two production containers and three production volumes remain.
- **Still pending:** real Google/guest sessions and account/invite flows, recovery of a played match from a downloaded backup, monitoring alerts, credit confirmation and measured player capacity. No wiki has been created. The reboot test used isolated data and does not establish real-user OAuth or a backup-based match recovery.

Keep both disks and all game/certificate volumes during updates. Follow [the operator runbook](OPERATIONS.md), including backups and domain changes. LRS backups are off the VM but remain in the same region; this setup does not provide region failover.

This first release has one game process and brief deployment/recovery interruptions. Adding replicas requires room ownership and fencing plus a shared persistence design; duplicating this SQLite container is not a scaling strategy.

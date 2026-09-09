# Initial Azure deployment

Proposed configuration, checked **9 September 2026**. No Catanova Azure resources have been created by this setup. This runs the current app and authoritative game server together using [the single-VM bundle](README.md); Supabase continues to handle accounts and friends.

## Resources to create

Use a separate resource group, **`catanova-prod-centralindia`**, in **Central India**, without changing existing workloads.

| Resource                          | Proposed configuration                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VM `catanova-game-01`             | Ubuntu 24.04 LTS, Gen2, x64; `Standard_B2als_v2`, 2 vCPU / 4 GiB RAM; availability zone **2**; regular hourly billing, no Spot or reservation           |
| OS disk                           | Persistent **64 GiB Standard SSD LRS**, E6; no ephemeral OS disk                                                                                        |
| Data disk `catanova-game-data-01` | Persistent **32 GiB Premium SSD LRS**, P4, in zone 2; host caching **None**; VM deletion policy **Detach**, so deleting the VM retains this disk        |
| Network                           | Dedicated VNet/subnet, NIC, and network security group; one **Standard static IPv4** with an Azure DNS hostname                                         |
| Inbound access                    | Public TCP **80/443**; SSH TCP **22** only from the administrator's current public IP/CIDR, using SSH keys; no public 3000 or Caddy admin port          |
| Backup storage                    | A private, same-region StorageV2 account with **Hot LRS** blob storage; plan for 10 GB initially; use a managed identity scoped to the backup container |

Mount the data disk by UUID and place Docker's persistent volume storage there **before first launch**. Ensure Docker cannot start against an empty mountpoint if the disk fails to mount. The game data and Caddy certificate volumes must survive both container replacement and VM replacement. Retaining a disk does not protect against deleting the disk or its resource group.

The subscription's SKU catalog allowed this VM size in zones 2 and 3; zone 1 was restricted. The older `Standard_B2s` was unavailable for this subscription. Central India's total regional and Basv2-family quotas both showed **0 of 65 vCPUs used**; Standard IPv4 public-IP quota showed **0 of 100 used**. These checks establish eligibility, not guaranteed allocation capacity; recheck during provisioning.

Basv2 is **burstable**: this size has a 30% CPU baseline and uses credits above it. Start with controlled rooms, monitor CPU credits and server latency, and resize if sustained demand warrants it. This is not a tested player-capacity claim. [Azure Basv2 specifications](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/general-purpose/basv2-series)

## Expected Azure cost

Public USD retail rates retrieved from the [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices), using Central India, consumption pricing, and the ordinary Linux VM product. The estimate assumes **730 running hours per month**; it is not a subscription-specific invoice or a credits balance.

| Item                        | Verified unit rate | Monthly estimate |
| --------------------------- | ------------------ | ---------------: |
| B2als v2 Linux VM           | $0.0246/hour       |           $17.96 |
| E6 LRS OS disk, 64 GiB      | $5.28/month        |            $5.28 |
| P4 LRS data disk, 32 GiB    | $5.2795/month      |            $5.28 |
| Standard static IPv4        | $0.005/hour        |            $3.65 |
| Hot LRS backup blobs, 10 GB | $0.02/GB-month     |            $0.20 |
| **Base total**              |                    | **$32.37/month** |

The exact compute meter is **Virtual Machines Basv2 Series / B2als v2**, excluding Windows, Cloud Services, Spot, and Low Priority. [Live compute query](https://prices.azure.com/api/retail/prices?$filter=armRegionName%20eq%20%27centralindia%27%20and%20armSkuName%20eq%20%27Standard_B2als_v2%27%20and%20productName%20eq%20%27Virtual%20Machines%20Basv2%20Series%27%20and%20priceType%20eq%20%27Consumption%27)

Allow **$35–40/month for initial light usage**, before taxes and Supabase. This is a planning allowance, not an enforced cap. Standard SSD OS-disk transactions add $0.0028 per 10,000 operations, or $0.28 per million. Backup operations also add small usage charges; the quoted backup amount buys storage, not a managed Azure Backup service or an implemented backup schedule. Shared-disk extra-mount fees do not apply to these single-attached disks. [Managed disk pricing](https://azure.microsoft.com/en-us/pricing/details/managed-disks/), [IP pricing](https://azure.microsoft.com/en-us/pricing/details/ip-addresses/), [Blob pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)

Traffic is additional: Azure publishes a first-100-GB monthly internet-egress allowance, then **$0.12/GB** from Asia through Microsoft's network for the next tier. Confirm the allowance available to this billing account; do not assume every workload receives a separate allowance. An additional 50 billable GB would add $6. [Bandwidth pricing](https://azure.microsoft.com/en-us/pricing/details/bandwidth/)

The inspected subscription reports a **sponsored offer** and `spendingLimit: Off`. Its remaining credits, expiry date, and any post-credit billing terms were **not established** by the APIs inspected. Confirm those in the sponsorship/billing portal before launch. Other Azure workloads, domain renewal, wiki hosting, optional paid monitoring, and Supabase charges are outside this Catanova estimate.

## Setup sequence

1. Confirm this configuration and spend allowance, check available sponsorship credits, and set cost alerts for the new resource group. Alerts do not stop spending.
2. Create the dedicated network, restricted SSH rule, static IP, VM, retained data disk, and private backup storage. Keep both disks persistent; enable the data-disk mount and verify its failure behavior before installing the app.
3. Install Docker Engine/Compose, place its persistent volumes on the data disk, and deploy a reviewed full Git commit using [README.md](README.md). Keep authentication required and the server accessible only through Caddy HTTPS.
4. Point `catanova.io` at the assigned static IP and use it as the first public game origin. Set the Supabase Site URL to `https://catanova.io`, allow `https://catanova.io/auth/callback`, and add `catanova.io` to Turnstile's allowed hostnames. Then test HTTPS, Google login, guest verification, room joins, gameplay, restart, and reconnect. If DNS must wait, the assigned Azure hostname can support a temporary preview, with its own explicit auth configuration; avoid inviting guests on that temporary origin because their browser sessions do not transfer across hostnames.
5. Configure scheduled **consistent SQLite backups** to private blobs, retain multiple versions, and complete a restore test on isolated data. LRS backups are off the VM but remain in the same region; this setup does not provide region failover.
6. Keep all game and certificate volumes during updates. If a temporary Azure preview was used, follow the domain-cutover instructions in the deployment README before inviting more players.

This first release has one game process and brief deployment/recovery interruptions. Adding replicas requires room ownership and fencing plus a shared persistence design; duplicating this SQLite container is not a scaling strategy.

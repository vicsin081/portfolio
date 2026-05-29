# Azure HomeLab — Hub-Spoke Network (Basic)

Terraform deployment of a hub-spoke network on Azure covering core AZ-104 topics: VNet peering, Standard Load Balancer, Network Security Groups, Azure Bastion, and VPN Gateway.

## Architecture

```
                                   Internet
                                      |
                                   HTTP :80
                                      |
                                      v
                             +------------------+
                             |     pip-lb       |
                             |  Static Public IP|
                             +------------------+
                                      |
+----------------------------------------------------------+
|            Resource Group: rg-homelab-basic              |
|                      Australia East                      |
+----------------------------------------------------------+
          |                                      |
+---------+------------+          +--------------+----------+
| Hub VNet 10.0.0.0/16 |          | Spoke VNet 10.1.0.0/16  |
+----------------------+          +-------------------------+
|                      |          |                         |
| GatewaySubnet        |          | workload-subnet         |
| 10.0.1.0/27          |          | 10.1.1.0/24             |
| [VPN GW - disabled]  |  VNet    |                         |
|                      | Peering  | NSG (nsg-spoke-workload)|
| AzureBastionSubnet   |<========>| Internet     -> :80     |
| 10.0.2.0/26          |(bidirect)| AzureLoadBalancer->:80  |
|                      |          | 10.0.2.0/26  -> :22     |
| +------------------+ |          |                         |
| | Azure Bastion    | |          | Standard Load Balancer  |
| | bastion-hub      +-+--SSH:22->|   lb-spoke              |
| | Basic SKU        | |          |   HTTP probe :80 / 5s   |
| +------------------+ |          |        /         \      |
|                      |          |       / Round-Robin\    |
+----------------------+          |   [vm-1]         [vm-2] |
         |                        |   Nginx           Nginx |
    +-----------+                 |   Ubuntu 22.04  D2s_v3  |
    |pip-bastion|                 +-------------------------+
    |Static IP  |
    +-----------+
         |
    Browser HTTPS
    (SSH Management)
```

| Component | Specification |
|---|---|
| Hub VNet | 10.0.0.0/16 — gateway transit and Bastion |
| Spoke VNet | 10.1.0.0/16 — workload VMs behind load balancer |
| VNet Peering | Bidirectional, gateway transit enabled |
| Standard Load Balancer | Round-robin HTTP across 2 Ubuntu VMs running Nginx |
| Azure Bastion | Browser-based SSH — no public port 22 exposure |
| NSG | Internet→80, AzureLoadBalancer→80, Bastion subnet→22 |

## Prerequisites

- Azure CLI authenticated — `az login`
- Terraform >= 1.5.0
- Standard DSv3 vCPU quota in target region (2 vCPUs per VM, 4 total)

## Deploy

```powershell
$env:TF_VAR_admin_password = "YourStrongP@ssw0rd!"
cd terraform
terraform init
terraform plan
terraform apply
```

Deployment takes approximately 10–15 minutes. Azure Bastion is the bottleneck at ~10 minutes.

## Verify

Open `load_balancer_public_ip` from the Terraform output in a browser.  
Refresh to observe round-robin responses alternating between `vm-1` and `vm-2`.

## Cost Controls

| Measure | Detail |
|---|---|
| Budget alert | $50 AUD with 50/80/100% email notifications |
| VM size | Standard_D2s_v3 — B1s frequently sold out in region |
| OS disk | Standard_LRS — ~60% cheaper than Premium SSD |
| Bastion SKU | Basic — ~50% cheaper than Standard |
| VPN Gateway | Commented out by default — ~$6 AUD/day when active |
| Tags | `Project=HomeLab-Basic` for cost filtering in Cost Management |

## AZ-104 Coverage

- Virtual Networks, subnets, CIDR allocation
- VNet Peering (bidirectional, gateway transit)
- VPN Gateway (RouteBased, VpnGw1 SKU)
- Azure Bastion (vs. jump box pattern)
- Standard Load Balancer (health probes, backend pools, NSG interaction)
- Network Security Groups (service tags, rule priority)
- Resource Group governance and tagging

## File Reference

| File | Purpose |
|---|---|
| `main.tf` | Provider config and resource group |
| `variables.tf` | Input variables with defaults |
| `network.tf` | Hub/Spoke VNets, subnets, peering, NSG |
| `compute.tf` | VMs and NIC-to-LB backend associations |
| `loadbalancer.tf` | Public IP, LB, health probe, forwarding rules |
| `vpn.tf` | VPN Gateway (commented out by default) and Azure Bastion |
| `outputs.tf` | LB public IP and Bastion name post-deploy |

## Cleanup

```powershell
terraform destroy -auto-approve
```

Confirm `rg-homelab-basic` is removed in the Azure Portal before closing the session.

## Troubleshooting

See [troubleshoot.md](troubleshoot.md) for issues encountered during deployment and their resolutions.  
Each fix is preserved as a separate commit in git history.

# Azure HomeLab

Production-style Azure infrastructure built with Terraform, documented from first deployment error to working architecture.

## Projects

### 01 — Hub-Spoke Network &nbsp; ✓ Complete

Hub-spoke network covering core AZ-104 networking topics: VNet peering, Standard Load Balancer, Azure Bastion, and NSG service tags.

```
                              Internet
                                 |
                              HTTP :80
                                 |
                    +-------------------------+
                    |  Standard Load Balancer |
                    |  Round-robin across VMs |
                    +-------------------------+
                           /           \
+---------------------------+     +---------------------------+
| Hub VNet  10.0.0.0/16     |     | Spoke VNet  10.1.0.0/16  |
|                           |     |                           |
|  Azure Bastion            |<===>|  vm-1  (Nginx)            |
|  (browser SSH, no :22)    |VNet |  vm-2  (Nginx)            |
|                           |Peer |  NSG: Internet→:80        |
|  VPN Gateway stub         |     |       Bastion→:22         |
+---------------------------+     +---------------------------+
```

| Skill | Detail |
|---|---|
| Terraform | Multi-file structure, variable injection, state recovery |
| Azure Networking | VNet peering, gateway transit, NSG service tags |
| Load Balancing | Standard LB health probes, backend pools, round-robin HTTP |
| Secure Access | Azure Bastion — no public port 22 exposure |
| Cost Controls | Budget alerts, SKU selection, tag-based cost filtering |

Five real issues hit and resolved during deployment — region capacity limits, subscription quota, Terraform state corruption after interrupted destroy, and NSG source IP behaviour with Standard LB. Every fix is a separate commit with a root cause explanation.

→ [Architecture + Deploy instructions](01-hub-spoke-network/README.md) &nbsp;·&nbsp; [Troubleshooting log](01-hub-spoke-network/troubleshoot.md)

---

### [02 — AKS + CI/CD + RBAC + Monitor](02-aks-cicd-monitor/)

GitHub Actions pipeline deploying AKS with Managed Identity, scoped RBAC roles, and Log Analytics observability.

→ [Architecture + Deploy instructions](02-aks-cicd-monitor/README.md)

---

## AZ-104 Coverage

| Domain | Topics Covered |
|---|---|
| Virtual Networking | VNet, subnets, CIDR, peering, gateway transit |
| Network Security | NSG rules, service tags (Internet, AzureLoadBalancer) |
| Load Balancing | Standard LB, health probes, backend pools |
| Secure Access | Azure Bastion, VPN Gateway |
| Governance | Resource groups, tagging, budget alerts |
| Identity & RBAC | Managed Identity, scoped RBAC roles |
| Containers | AKS, ACR |
| Monitoring | Log Analytics, Container Insights, metric alerts |
| CI/CD | GitHub Actions + Terraform remote state (Azure Blob) |

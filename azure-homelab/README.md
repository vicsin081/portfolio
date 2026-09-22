# Azure HomeLab

Production-style Azure infrastructure built with Terraform against a live subscription.
Each project is documented from the first failed deployment to the final working
architecture, and every fix is recorded with its root cause.

| | |
|---|---|
| **Purpose** | Hands-on practice for the AZ-104 Azure Administrator domains using real deployments, not simulations |
| **Region** | Australia East |
| **Tooling** | Terraform (azurerm provider), Azure CLI, GitHub Actions |
| **Source repository** | [vicsin081/azure-homelab](https://github.com/vicsin081/azure-homelab) (history preserved in this folder) |

---

## Projects

| # | Project | What it builds | Status | Issues resolved |
|---|---|---|---|---|
| 01 | [Hub-Spoke Network](01-hub-spoke-network/README.md) | Hub and spoke VNets with peering, a Standard Load Balancer in front of two Nginx VMs, Azure Bastion for SSH, and NSG rules | Complete | [5](01-hub-spoke-network/TROUBLESHOOTING.md) |
| 02 | [AKS, CI/CD and Monitoring](02-aks-cicd-monitor/README.md) | AKS cluster with managed identity, ACR with RBAC-only image pulls, Log Analytics and a CPU alert, deployed by GitHub Actions | Complete | [3](02-aks-cicd-monitor/TROUBLESHOOTING.md) |

### 01 - Hub-Spoke Network

```
                              Internet
                                 |
                              HTTP :80
                                 |
                    +-------------------------+
                    |  Standard Load Balancer |
                    +-------------------------+
                           /           \
+---------------------------+     +---------------------------+
| Hub VNet  10.0.0.0/16     |     | Spoke VNet  10.1.0.0/16   |
|                           |     |                           |
|  Azure Bastion            |<===>|  vm-1  (Nginx)            |
|  (browser SSH, no :22)    |VNet |  vm-2  (Nginx)            |
|                           |Peer |  NSG: Internet -> :80     |
|  VPN Gateway (optional)   |     |       Bastion  -> :22     |
+---------------------------+     +---------------------------+
```

### 02 - AKS, CI/CD and Monitoring

```
git push --> GitHub Actions --> Terraform (remote state in Azure Blob)
                                    |
             +----------------------+----------------------+
             |                      |                      |
        AKS cluster  --AcrPull-->  ACR            Log Analytics --> CPU alert
     (managed identity)       (admin disabled)   (Container Insights)
```

---

## AZ-104 coverage

| Domain | Topics | Project |
|---|---|---|
| Virtual networking | VNets, subnets, CIDR planning, peering, gateway transit | 01 |
| Network security | NSG rules and priorities, service tags (`Internet`, `AzureLoadBalancer`) | 01 |
| Load balancing | Standard Load Balancer, health probes, backend pools | 01 |
| Secure access | Azure Bastion, VPN Gateway | 01 |
| Identity and RBAC | System-assigned managed identity, service principals, scoped role assignments | 02 |
| Containers | AKS, Azure Container Registry | 02 |
| Monitoring | Log Analytics, Container Insights, metric alerts | 02 |
| Storage | Blob Storage as a Terraform remote backend | 02 |
| Governance | Resource groups, tagging, budget alerts | 01, 02 |

---

## Documentation conventions

Every project folder contains the same files:

| File | Contents |
|---|---|
| `README.md` | Overview, architecture, components, deployment, verification, cost controls, cleanup |
| `TROUBLESHOOTING.md` | Each deployment issue: symptom, root cause, resolution, verification, lesson |
| `terraform/` | The infrastructure code |
| `screenshots/` | Evidence captured from the Azure Portal and GitHub after deployment |

## Note on CI/CD

The workflow in [`.github/workflows/deploy-aks.yml`](.github/workflows/deploy-aks.yml) ran from the
standalone repository, where the Azure credentials are stored as GitHub Secrets. It is kept here
as a reference copy; GitHub only runs workflows from a repository's top-level `.github` folder,
so it does not run in this portfolio repository.

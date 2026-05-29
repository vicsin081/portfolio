# Azure HomeLab — AKS + CI/CD + RBAC + Monitor

GitHub Actions pipeline that deploys an AKS cluster with Managed Identity, ACR with credential-free image pulls, and Log Analytics observability — all provisioned by Terraform with remote state in Azure Blob Storage.

## Architecture

```
GitHub push to master
        |
        | (path filter: 02-aks-cicd-monitor/terraform/**)
        v
+-------------------------+
|   GitHub Actions        |
|   ubuntu-latest runner  |
|   terraform init        |
|   terraform plan        |
|   terraform apply       |
+-------------------------+
        |
        | ARM credentials (GitHub Secrets)
        v
+----------------------------------------------------------+
|         Resource Group: rg-homelab-aks  (Australia East) |
+----------------------------------------------------------+
|                                                          |
|  +----------------------+    AcrPull RBAC assignment     |
|  | AKS  aks-homelab     |------------------------------> |
|  | 1x Standard_D2s_v3   |    Azure Container Registry   |
|  | System-Assigned MI   |    acrhomelab<id>  (Basic SKU) |
|  | OMS Agent enabled    |    admin_enabled = false        |
|  +----------------------+                                |
|           |                                              |
|           | sends metrics & logs                         |
|           v                                              |
|  +----------------------+                                |
|  | Log Analytics        |                                |
|  | law-homelab-aks      |                                |
|  | 30-day retention     |                                |
|  +----------------------+                                |
|           |                                              |
|           | triggers when node CPU > 80%                 |
|           v                                              |
|  +----------------------+                                |
|  | Monitor Metric Alert |                                |
|  | alert-aks-node-cpu   |                                |
|  +----------------------+                                |
|                                                          |
+----------------------------------------------------------+

Terraform state → Azure Blob Storage (rg-tfstate / satfstate*)
```

| Component | Specification |
|---|---|
| AKS | 1 node, Standard_D2s_v3, System-Assigned Managed Identity |
| ACR | Basic SKU, admin disabled — pulls via RBAC only |
| RBAC | AKS kubelet identity → AcrPull on ACR (no stored credentials) |
| Log Analytics | PerGB2018 SKU, 30-day retention, Container Insights via OMS agent |
| Alert | Node CPU > 80% average, severity 2 |
| CI/CD | GitHub Actions — triggers on push to `02-aks-cicd-monitor/terraform/**` |
| Terraform state | Azure Blob Storage backend (remote, supports CI/CD) |

## Prerequisites

- Azure CLI authenticated — `az login`
- Terraform >= 1.5.0
- GitHub repository with Actions enabled

## Bootstrap (one-time, manual)

Before the pipeline can run, create the storage account for Terraform remote state and a Service Principal for GitHub Actions to authenticate with.

```powershell
# 1. Set your subscription
$SUB = az account show --query id -o tsv

# 2. Create storage account for Terraform state
az group create --name rg-tfstate --location australiaeast
az storage account create `
  --name satfstatehomelab `
  --resource-group rg-tfstate `
  --sku Standard_LRS `
  --allow-blob-public-access false
az storage container create `
  --name tfstate `
  --account-name satfstatehomelab

# 3. Create Service Principal with Contributor on the subscription
az ad sp create-for-rbac `
  --name "sp-homelab-cicd" `
  --role Contributor `
  --scopes /subscriptions/$SUB
# Save the output — you need clientId, clientSecret, tenantId
```

> If `satfstatehomelab` is already taken (names are globally unique), add a short suffix — e.g. `satfstatehomelab42`.

## GitHub Secrets Setup

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Value |
|---|---|
| `ARM_CLIENT_ID` | `clientId` from SP output |
| `ARM_CLIENT_SECRET` | `clientSecret` from SP output |
| `ARM_SUBSCRIPTION_ID` | your Azure subscription ID |
| `ARM_TENANT_ID` | `tenantId` from SP output |
| `TF_STATE_RESOURCE_GROUP` | `rg-tfstate` |
| `TF_STATE_STORAGE_ACCOUNT` | `satfstatehomelab` (or your suffix) |

## Deploy

**Option A — via GitHub Actions (CI/CD):**

Push any change to `02-aks-cicd-monitor/terraform/**` to trigger the pipeline automatically.  
Or trigger manually: **Actions → Deploy AKS Infrastructure → Run workflow**

**Option B — local:**

```powershell
cd terraform
terraform init `
  -backend-config="resource_group_name=rg-tfstate" `
  -backend-config="storage_account_name=satfstatehomelab" `
  -backend-config="container_name=tfstate" `
  -backend-config="key=homelab-aks.tfstate"

terraform plan
terraform apply
```

Deployment takes approximately 8–12 minutes. AKS node provisioning is the bottleneck.

## Verify

```powershell
# Connect kubectl to the cluster
az aks get-credentials --resource-group rg-homelab-aks --name aks-homelab

# Confirm nodes are Ready
kubectl get nodes

# Confirm system pods are running
kubectl get pods -n kube-system
```

## Screenshots

Take these after `terraform apply` completes.

| # | Where | What to capture |
|---|---|---|
| 1 | GitHub → Actions tab | Successful workflow run with all steps green |
| 2 | Portal → Kubernetes services → aks-homelab → Overview | Cluster status Running, node count, Kubernetes version |
| 3 | Portal → aks-homelab → Node pools → system → Nodes | Node status = Ready |
| 4 | Portal → Container registries → acrhomelab* → Access control (IAM) → Role assignments | AcrPull assigned to AKS kubelet identity |
| 5 | Portal → Log Analytics workspaces → law-homelab-aks → Logs | Run `KubePodInventory \| take 10`, capture query results |
| 6 | Portal → Monitor → Alerts → Alert rules | CPU alert rule listed |

Save screenshots to `screenshots/` and reference them in this file.

## Cost Controls

| Measure | Detail |
|---|---|
| Node count | 1 node — scale up only when needed |
| VM size | Standard_D2s_v3 — consistent with project 01 quota |
| ACR SKU | Basic — sufficient for lab use |
| Log retention | 30 days — minimum before additional charges |
| No PVC / managed disks | Stateless workloads only in lab |
| Tags | `Project=HomeLab-AKS` for cost filtering |

Estimated cost: ~AUD 8–12/day when running (AKS control plane free; VM + ACR + Log Analytics).  
**Destroy when not in use.**

## AZ-104 Coverage

| Domain | Topics |
|---|---|
| Compute | AKS cluster, node pools, VM sizing |
| Identity | System-Assigned Managed Identity, Service Principal |
| RBAC | Role assignments, built-in roles (AcrPull), least-privilege scope |
| Containers | Azure Container Registry, image pull without credentials |
| Monitoring | Log Analytics workspace, Container Insights, metric alerts |
| Storage | Azure Blob Storage (Terraform remote state) |
| Governance | Resource group tagging, budget awareness |
| CI/CD | GitHub Actions, Terraform remote state for pipeline deployments |

## File Reference

| File | Purpose |
|---|---|
| `main.tf` | Provider config, remote backend, resource group |
| `variables.tf` | Input variables with defaults |
| `aks.tf` | AKS cluster, node pool, OMS agent |
| `acr.tf` | Container Registry with random-suffix name |
| `monitoring.tf` | Log Analytics workspace, CPU metric alert |
| `rbac.tf` | AcrPull role assignment for AKS identity |
| `outputs.tf` | Cluster name, ACR login server, kubectl command |
| `../../.github/workflows/deploy-aks.yml` | GitHub Actions CI/CD pipeline |

## Cleanup

```powershell
cd terraform
terraform destroy -auto-approve
```

Confirm `rg-homelab-aks` is removed in the Azure Portal.  
The `rg-tfstate` storage account persists by design — delete manually if no longer needed.

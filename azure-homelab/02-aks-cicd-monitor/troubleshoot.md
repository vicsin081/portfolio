# Troubleshooting Log — Azure HomeLab AKS + CI/CD

Issues encountered during deployment and their resolutions. Each fix corresponds to a commit in git history.

---

## Issue 1: GitHub Actions — ARM_* Variables Empty, Falls Back to Azure CLI

**Error:**
```
Error: Error building ARM Config: obtain subscription() from Azure CLI:
parsing json result from the Azure CLI: waiting for the Azure CLI:
exit status 1: ERROR: Please run 'az login' to setup account.
```

**Root cause:**
GitHub Actions workflow ran but all `ARM_*` environment variables were empty strings. When the AzureRM Terraform provider receives empty credentials, it falls through to the next authentication method — Azure CLI — which doesn't exist on the GitHub-hosted runner.

The variables were empty because GitHub Secrets had not yet been configured. The workflow references secrets via `${{ secrets.ARM_CLIENT_ID }}` etc.; if a secret doesn't exist, GitHub substitutes an empty string silently rather than failing.

**Fix:**
Created a Service Principal and populated six GitHub Secrets:

```powershell
# Create Service Principal
$SUB = az account show --query id -o tsv
az ad sp create-for-rbac --name "sp-homelab-cicd" --role Contributor --scopes /subscriptions/$SUB
```

| Secret | Value source |
|---|---|
| `ARM_CLIENT_ID` | `appId` from SP output |
| `ARM_CLIENT_SECRET` | `password` from SP output |
| `ARM_TENANT_ID` | `tenant` from SP output |
| `ARM_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `TF_STATE_RESOURCE_GROUP` | `rg-tfstate` |
| `TF_STATE_STORAGE_ACCOUNT` | storage account name |

**Lesson:** GitHub does not warn when a referenced secret is missing — it substitutes an empty string. Always verify secrets are set before the first run.

---

## Issue 2: Role Assignment Fails — Contributor Cannot Write RBAC

**Error:**
```
authorization.RoleAssignmentsClient#Create: Failure responding to request:
StatusCode=403 Code="AuthorizationFailed"
Message="The client does not have authorization to perform action
'Microsoft.Authorization/roleAssignments/write'"
```

**Root cause:**
`rbac.tf` creates an `azurerm_role_assignment` resource (AcrPull for the AKS kubelet identity). This requires the `Microsoft.Authorization/roleAssignments/write` permission. The Service Principal was created with only the `Contributor` role, which explicitly excludes all `Microsoft.Authorization/*` actions.

| Role | Can manage resources | Can assign roles |
|---|---|---|
| Contributor | ✓ | ✗ |
| User Access Administrator | ✗ | ✓ |
| Owner | ✓ | ✓ |

**Fix:**
Added `User Access Administrator` to the existing SP (kept Contributor, added a second role):

```powershell
$SUB = az account show --query id -o tsv
az role assignment create `
  --assignee "<SP appId>" `
  --role "User Access Administrator" `
  --scope /subscriptions/$SUB
```

Then waited ~5 minutes for Azure RBAC propagation before re-running the workflow.

**Lesson:** Any Terraform config that creates `azurerm_role_assignment` resources requires the deploying identity to have `User Access Administrator` (or `Owner`) in addition to `Contributor`.

---

## Issue 3: AKS Update Fails — OIDC Issuer Cannot Be Disabled

**Error:**
```
Error: updating Kubernetes Cluster
"code": "OIDCIssuerFeatureCannotBeDisabled"
"message": "OIDC issuer feature cannot be disabled."
```

**Root cause:**
On first deploy, Azure automatically enabled the OIDC issuer on the AKS cluster (enforced for Kubernetes 1.34+). The Terraform config did not include `oidc_issuer_enabled`, so its implicit value was `false`. On the re-run triggered to fix Issue 2, Terraform read the existing cluster from state, computed a diff (`oidc_issuer_enabled: true → false`), and tried to apply it. Azure rejected the update because OIDC cannot be disabled once enabled.

```
Terraform state:  oidc_issuer_enabled = true   (Azure's actual value)
aks.tf (no setting): oidc_issuer_enabled = false  (Terraform's default)
                                           ↓
                               Terraform plans an update → Azure rejects
```

**Fix:**
Added `oidc_issuer_enabled = true` explicitly to `aks.tf` to match the Azure-enforced state:

```hcl
resource "azurerm_kubernetes_cluster" "main" {
  ...
  oidc_issuer_enabled = true   # Required: Azure enforces this on K8s 1.34+
  ...
}
```

**Lesson:** Some AKS features are silently enabled by Azure based on the Kubernetes version. When Terraform re-runs against an existing cluster, it will try to revert these to their Terraform defaults. Always check `terraform plan` output for unexpected diffs on existing resources.

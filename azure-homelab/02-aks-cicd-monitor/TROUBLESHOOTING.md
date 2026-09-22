# Troubleshooting Log - 02 AKS, CI/CD and Monitoring

Issues found while deploying [02 - AKS, CI/CD and Monitoring](README.md) through GitHub Actions,
in the order they occurred. Each entry follows the same format: symptom, root cause,
resolution, verification, lesson.

## Summary

| # | Issue | Category | Resolution | Commit |
|---|---|---|---|---|
| 1 | Pipeline fell back to Azure CLI authentication | CI/CD configuration | Created a service principal and GitHub Secrets | Configuration (no code change) |
| 2 | Role assignment failed with `AuthorizationFailed` | RBAC | Granted `User Access Administrator` to the pipeline identity | Configuration (no code change) |
| 3 | AKS update rejected: OIDC issuer cannot be disabled | Configuration drift | Declared `oidc_issuer_enabled = true` | [`d55e005`](https://github.com/vicsin081/portfolio/commit/d55e005) |

---

## Issue 1 - Pipeline fell back to Azure CLI authentication

**Symptom**

```
Error: Error building ARM Config: obtain subscription() from Azure CLI:
parsing json result from the Azure CLI: waiting for the Azure CLI:
exit status 1: ERROR: Please run 'az login' to setup account.
```

**Root cause**

The workflow reads credentials from `${{ secrets.ARM_* }}`. The secrets had not been created yet,
and GitHub substitutes an empty string for a missing secret without raising an error. With empty
`ARM_*` variables, the azurerm provider moved on to its next authentication method, Azure CLI,
which is not signed in on a GitHub-hosted runner.

**Resolution**

Created a service principal and stored its values as repository secrets:

```powershell
$SUB = az account show --query id -o tsv
az ad sp create-for-rbac --name "sp-homelab-cicd" --role Contributor --scopes /subscriptions/$SUB
```

| Secret | Source |
|---|---|
| `ARM_CLIENT_ID` | `appId` |
| `ARM_CLIENT_SECRET` | `password` |
| `ARM_TENANT_ID` | `tenant` |
| `ARM_SUBSCRIPTION_ID` | `az account show --query id -o tsv` |
| `TF_STATE_RESOURCE_GROUP` | `rg-tfstate` |
| `TF_STATE_STORAGE_ACCOUNT` | Storage account name |

**Verification**

The next run passed `terraform init` and `terraform plan` using the service principal.

**Lesson**

GitHub does not warn about a missing secret. Confirm that all required secrets exist before the
first run, or add an early workflow step that fails when a required variable is empty.

---

## Issue 2 - Role assignment failed with `AuthorizationFailed`

**Symptom**

```
authorization.RoleAssignmentsClient#Create: Failure responding to request:
StatusCode=403 Code="AuthorizationFailed"
Message="The client does not have authorization to perform action
'Microsoft.Authorization/roleAssignments/write'"
```

**Root cause**

`rbac.tf` creates an `azurerm_role_assignment` (`AcrPull` for the AKS kubelet identity). That
needs `Microsoft.Authorization/roleAssignments/write`. The service principal had only
`Contributor`, which excludes all `Microsoft.Authorization/*` write actions.

| Role | Manage resources | Assign roles |
|---|---|---|
| Contributor | Yes | No |
| User Access Administrator | No | Yes |
| Owner | Yes | Yes |

**Resolution**

Added `User Access Administrator` to the service principal alongside `Contributor`, rather than
granting `Owner`:

```powershell
$SUB = az account show --query id -o tsv
az role assignment create `
  --assignee "<appId>" `
  --role "User Access Administrator" `
  --scope /subscriptions/$SUB
```

Waited about five minutes for RBAC propagation, then re-ran the workflow.

**Verification**

The re-run created the role assignment, and the ACR access-control blade showed `AcrPull`
assigned to the AKS kubelet identity (README screenshot 4).

**Lesson**

Any Terraform configuration that creates role assignments needs a deploying identity with
`User Access Administrator` or `Owner`. In production, scope that role to the target resource
group rather than the whole subscription.

---

## Issue 3 - AKS update rejected: OIDC issuer cannot be disabled

**Symptom**

```
Error: updating Kubernetes Cluster
"code": "OIDCIssuerFeatureCannotBeDisabled"
"message": "OIDC issuer feature cannot be disabled."
```

**Root cause**

On the first deployment, Azure enabled the OIDC issuer on the cluster automatically, as it does
for current Kubernetes versions. The Terraform configuration did not set `oidc_issuer_enabled`,
so its value defaulted to `false`. On the re-run for Issue 2, Terraform compared the real cluster
with the configuration, planned a change from `true` to `false`, and Azure rejected it.

```
Actual cluster (Azure):          oidc_issuer_enabled = true
Configuration (aks.tf, unset):   oidc_issuer_enabled = false
Result:                          Terraform plans an update -> Azure rejects it
```

**Resolution**

Declared the setting explicitly so the configuration matches the platform:

```hcl
resource "azurerm_kubernetes_cluster" "main" {
  # ...
  oidc_issuer_enabled = true  # Enabled by Azure and cannot be turned off
  # ...
}
```

**Verification**

`terraform plan` showed no changes to the cluster, and the workflow completed successfully
(README screenshot 1).

**Lesson**

Managed services can enable features on their own. Read `terraform plan` carefully for
unexpected in-place updates to existing resources, and declare any platform-enforced settings in
code.

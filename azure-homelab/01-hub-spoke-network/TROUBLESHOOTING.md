# Troubleshooting Log - 01 Hub-Spoke Network

Issues found while deploying [01 - Hub-Spoke Network](README.md), in the order they occurred.
Each entry follows the same format: symptom, root cause, resolution, verification, lesson.
Where a code change was needed, the fix is a separate commit linked below.

## Summary

| # | Issue | Category | Resolution | Commit |
|---|---|---|---|---|
| 1 | `Standard_B1s` capacity unavailable in Southeast Asia | Capacity | Moved deployment to Australia East | [`566714b`](https://github.com/vicsin081/portfolio/commit/566714b) |
| 2 | `Standard_B2s_v2` quota is zero on the subscription | Quota | Reverted to a VM family with quota | [`1085e27`](https://github.com/vicsin081/portfolio/commit/1085e27), [`3b8079d`](https://github.com/vicsin081/portfolio/commit/3b8079d) |
| 3 | `Standard_B1s` also unavailable in Australia East | Capacity | Selected `Standard_D2s_v3` after checking capacity and quota | [`5f890d7`](https://github.com/vicsin081/portfolio/commit/5f890d7) |
| 4 | Terraform state out of sync after an interrupted destroy | State management | Manual cleanup and state reset | Operational (no code change) |
| 5 | Website unreachable although Nginx was running | Network security | Added an NSG rule for `Internet` traffic | [`d477f10`](https://github.com/vicsin081/portfolio/commit/d477f10) |

---

## Issue 1 - `Standard_B1s` capacity unavailable in Southeast Asia

**Symptom**

```
SkuNotAvailable: The requested VM size for resource
'Following SKUs have failed for Capacity Restrictions: Standard_B1s'
is currently not available in location 'southeastasia'.
```

**Root cause**

Azure regions can run out of physical capacity for specific VM sizes. `Standard_B1s` is a
popular low-cost size and is frequently sold out in high-demand regions.

**Resolution**

Changed the deployment region to Australia East.

```hcl
# variables.tf
variable "location" {
  default = "Australia East"  # was "Southeast Asia"
}
```

**Verification**

```powershell
az vm list-skus --location <region> --size Standard_B1s --output table
# A non-empty Restrictions column means the size cannot be deployed in that region.
```

**Lesson**

Check SKU availability before deploying. When `SkuNotAvailable` appears, try another region
before changing the VM size.

---

## Issue 2 - `Standard_B2s_v2` quota is zero on the subscription

**Symptom**

```
OperationNotAllowed: standardBsv2Family Cores quota exceeded.
Current Limit: 0, Current Usage: 0, Additional Required: 2
```

**Root cause**

`Standard_B2s_v2` belongs to the newer `standardBsv2Family`. New VM families start with zero
quota by default, even on Pay-As-You-Go subscriptions. Capacity and quota are separate checks,
and both must pass:

| Check | Command | What it shows |
|---|---|---|
| Capacity | `az vm list-skus` | Whether Azure has hardware available in the region |
| Quota | `az vm list-usage` | Whether the subscription is allowed to use it |

| Family | Example sizes | Default quota |
|---|---|---|
| Standard BS Family (legacy) | `Standard_B1s`, `Standard_B2s` | 10 vCPUs |
| Standard Bsv2 Family | `Standard_B2s_v2`, `Standard_B4s_v2` | 0 vCPUs |

**Resolution**

Reverted to `Standard_B1s` (BS family, quota 10). That size then failed on capacity in
Australia East - see Issue 3.

**Verification**

```powershell
az vm list-usage --location australiaeast --output table | findstr /i "BS Bsv2"
# Confirm the Limit column is greater than zero for the family before deploying.
```

**Lesson**

A size with available capacity but zero quota still fails. Always run both checks.

---

## Issue 3 - `Standard_B1s` also unavailable in Australia East

**Symptom**

```
SkuNotAvailable: The requested VM size for resource
'Following SKUs have failed for Capacity Restrictions: Standard_B1s'
is currently not available in location 'australiaeast'.
```

**Root cause**

The legacy BS family had quota (limit 10) but no hardware capacity for `Standard_B1s` in
Australia East.

**Resolution**

Listed the sizes with no capacity restrictions, then confirmed quota for the chosen family.

```powershell
# Step 1 - sizes with no capacity restrictions
az vm list-skus --location australiaeast --resource-type virtualMachines --output json |
  python -c "import json,sys; [print(s['name']) for s in json.load(sys.stdin) if not s.get('restrictions')]"
# Output included Standard_D2s_v3

# Step 2 - quota for the DSv3 family
az vm list-usage --location australiaeast --output table | findstr DSv3
# Standard DSv3 Family vCPUs   0   10   (2 VMs x 2 vCPUs = 4, within the limit)
```

```hcl
# variables.tf
variable "vm_size" {
  default = "Standard_D2s_v3"  # 2 vCPU, 8 GB RAM
}
```

**Verification**

`terraform apply` completed and both VMs reached the Running state.

**Lesson**

Choose the VM size from data: filter for sizes with no restrictions, then confirm quota for
that family.

---

## Issue 4 - Terraform state out of sync after an interrupted destroy

**Symptom**

```
Provider produced inconsistent result after apply
Root object was present, but now absent.

ResourceNotFound: The Resource 'Microsoft.Network/virtualNetworks/vnet-hub' was not found.
```

**Root cause**

A `terraform destroy` was interrupted. Azure had already deleted some resources, but the local
`terraform.tfstate` still listed them. The next `terraform apply` tried to update resources
that no longer existed.

**Resolution**

1. Deleted the resource group in the Azure Portal and waited for deletion to finish.
2. Removed the stale local state files:
   ```powershell
   Remove-Item terraform.tfstate, terraform.tfstate.backup, .terraform.tfstate.lock.info
   ```
3. Ran `terraform apply` from a clean state.

**Verification**

`terraform plan` showed only resources to create, with no references to missing resources.

**Lesson**

Never interrupt `terraform destroy`. For a disposable lab environment, deleting the resource
group and resetting local state is the fastest recovery. In shared environments, use a remote
backend with state locking (as in [project 02](../02-aks-cicd-monitor/README.md)) and
`terraform state rm` or `terraform import` instead.

---

## Issue 5 - Website unreachable although Nginx was running

**Symptom**

- `terraform apply` succeeded and the load balancer received a public IP.
- Through Bastion, `curl http://localhost` on the VM returned `<h1>Hello from vm-1</h1>`.
- From a browser, the load balancer IP returned `ERR_CONNECTION_TIMED_OUT`.
- The backend pool health status was empty.

**Root cause**

A Standard Load Balancer forwards traffic with the original client source IP (destination NAT
only, no source NAT). The NSG therefore sees requests from the client's own public IP, not from
the load balancer. The first version of the NSG allowed port 80 only from the
`AzureLoadBalancer` service tag:

| Traffic | Source IP seen by the NSG | Matched by `AzureLoadBalancer` |
|---|---|---|
| Health probe | `168.63.129.16` | Yes |
| Browser request | Client's public IP | No - dropped |

Health probes were allowed, but every real client request was dropped by the NSG.

**Resolution**

Added a separate rule for client traffic and kept the probe rule:

```hcl
# network.tf
security_rule {
  name                   = "Allow-HTTP-from-Internet"
  priority               = 100
  source_address_prefix  = "Internet"           # client traffic
  destination_port_range = "80"
}

security_rule {
  name                   = "Allow-HTTP-from-LB-Probe"
  priority               = 110
  source_address_prefix  = "AzureLoadBalancer"  # health probes from 168.63.129.16
  destination_port_range = "80"
}
```

**Verification**

The browser returned responses from both VMs in turn, and the backend pool showed both
instances as Healthy.

![NSG inbound rules](screenshots/08-nsg-inbound-rules.png)

![LB backend pool healthy](screenshots/05-lb-backend-pool-healthy.png)

**Lesson**

With a Standard Load Balancer in front of an NSG, two rules are required: one for client
traffic (`Internet` or specific client ranges) and one for health probes (`AzureLoadBalancer`).
A healthy probe does not prove that client traffic can reach the backend.

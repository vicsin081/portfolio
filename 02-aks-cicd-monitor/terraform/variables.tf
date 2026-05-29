variable "location" {
  default = "australiaeast"
}

variable "resource_group_name" {
  default = "rg-homelab-aks"
}

variable "aks_cluster_name" {
  default = "aks-homelab"
}

variable "node_vm_size" {
  default = "Standard_D2s_v3"
}

variable "node_count" {
  default = 1
}

variable "log_analytics_workspace_name" {
  default = "law-homelab-aks"
}

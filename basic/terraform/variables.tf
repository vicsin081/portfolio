variable "resource_group_name" {
  description = "Resource Group name"
  type        = string
  default     = "rg-homelab-basic"
}

variable "location" {
  description = "Azure region"
  type        = string
  default     = "Australia East"
}

variable "admin_username" {
  description = "VM admin username"
  type        = string
  default     = "azureuser"
}

variable "admin_password" {
  description = "VM admin password"
  type        = string
  sensitive   = true
}

variable "vm_size" {
  description = "VM size"
  type        = string
  default     = "Standard_D2s_v3"
}

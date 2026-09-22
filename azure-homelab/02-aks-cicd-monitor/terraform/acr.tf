resource "random_id" "acr_suffix" {
  byte_length = 4
}

resource "azurerm_container_registry" "main" {
  name                = "acrhomelab${random_id.acr_suffix.hex}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = false

  tags = {
    Project     = "HomeLab-AKS"
    Environment = "Lab"
    ManagedBy   = "Terraform"
  }
}

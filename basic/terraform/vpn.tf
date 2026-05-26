# VPN Gateway: 30-45 min deploy time, ~$1 USD/day -- comment out for peering-only labs

# resource "azurerm_public_ip" "vpn" { ... }
# resource "azurerm_virtual_network_gateway" "vpn" { ... }

# Azure Bastion -- browser-based SSH without exposing port 22
resource "azurerm_public_ip" "bastion" {
  name                = "pip-bastion"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_bastion_host" "main" {
  name                = "bastion-hub"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "Basic"
  ip_configuration {
    name                 = "configuration"
    subnet_id            = azurerm_subnet.bastion.id
    public_ip_address_id = azurerm_public_ip.bastion.id
  }
}

output "load_balancer_public_ip" {
  description = "Open in browser to verify round-robin load balancing"
  value       = azurerm_public_ip.lb.ip_address
}

# output "vpn_gateway_public_ip" {
#   value = azurerm_public_ip.vpn.ip_address
# }

output "bastion_name" {
  value = azurerm_bastion_host.main.name
}

resource "azurerm_log_analytics_workspace" "main" {
  name                = var.log_analytics_workspace_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30

  tags = {
    Project     = "HomeLab-AKS"
    Environment = "Lab"
    ManagedBy   = "Terraform"
  }
}

resource "azurerm_monitor_metric_alert" "node_cpu" {
  name                = "alert-aks-node-cpu-high"
  resource_group_name = azurerm_resource_group.main.name
  scopes              = [azurerm_kubernetes_cluster.main.id]
  description         = "Node CPU usage exceeds 80%"
  severity            = 2

  criteria {
    metric_namespace = "Microsoft.ContainerService/managedClusters"
    metric_name      = "node_cpu_usage_percentage"
    aggregation      = "Average"
    operator         = "GreaterThan"
    threshold        = 80
  }

  tags = {
    Project     = "HomeLab-AKS"
    Environment = "Lab"
    ManagedBy   = "Terraform"
  }
}

terraform {
  required_version = ">= 1.5.0"
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.100"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }

  # Backend values are injected at runtime via -backend-config flags.
  # See README.md § Bootstrap for the one-time setup command.
  backend "azurerm" {}
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location

  tags = {
    Project     = "HomeLab-AKS"
    Environment = "Lab"
    ManagedBy   = "Terraform"
  }
}

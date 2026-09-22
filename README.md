# Portfolio - Yat San Sin

Cloud infrastructure and automation work: Azure environments built with Terraform, and
Python tools written to solve real operational problems at work.

Each project follows the same documentation layout:

- `README.md` - what the project is, how it is built, how to run it, and the evidence that it works.
- A companion log - `TROUBLESHOOTING.md`, `ENGINEERING-LOG.md` or `ANALYSIS.md` - recording the problems found,
  their root causes, and the decisions taken.

---

## Projects

| Project | Area | Stack | Documentation |
|---|---|---|---|
| [Azure HomeLab - 01 Hub-Spoke Network](azure-homelab/01-hub-spoke-network/) | Cloud networking | Terraform, Azure VNet, Standard Load Balancer, Bastion, NSG | [README](azure-homelab/01-hub-spoke-network/README.md) - [Troubleshooting log](azure-homelab/01-hub-spoke-network/TROUBLESHOOTING.md) |
| [Azure HomeLab - 02 AKS, CI/CD and Monitoring](azure-homelab/02-aks-cicd-monitor/) | Containers, DevOps | Terraform, AKS, ACR, GitHub Actions, Log Analytics | [README](azure-homelab/02-aks-cicd-monitor/README.md) - [Troubleshooting log](azure-homelab/02-aks-cicd-monitor/TROUBLESHOOTING.md) |
| [Shipping Mark Generator](work-samples/shipping-mark-generator/) | Business automation | Python, Tkinter, openpyxl, PyInstaller | [README](work-samples/shipping-mark-generator/README.md) - [Engineering log](work-samples/shipping-mark-generator/ENGINEERING-LOG.md) |
| [AI Phone-Receptionist Pipeline](work-samples/ai-receptionist-pipeline/) | Applied AI | Python, Whisper, LLM via OpenRouter, 3CX | [README](work-samples/ai-receptionist-pipeline/README.md) - [Analysis log](work-samples/ai-receptionist-pipeline/ANALYSIS.md) |

### Azure HomeLab

Two Terraform projects built against a live Azure subscription and aligned to the AZ-104
(Azure Administrator) exam domains. Every deployment failure was diagnosed, fixed in a
separate commit, and written up with its root cause.

[Section overview](azure-homelab/README.md)

### Work Samples

Two internal tools built at Excel Intelligent Pty Ltd, published as sanitised copies.
Company names, supplier names, internal endpoints, credentials and all customer data have
been removed or replaced with placeholders.

[Section overview](work-samples/README.md)

---

## Repository layout

```
portfolio/
|-- azure-homelab/
|   |-- 01-hub-spoke-network/        Terraform, screenshots, troubleshooting log
|   |-- 02-aks-cicd-monitor/         Terraform, screenshots, troubleshooting log
|   `-- .github/workflows/           CI/CD pipeline used by project 02
`-- work-samples/
    |-- shipping-mark-generator/     Python desktop application
    `-- ai-receptionist-pipeline/    Python data pipeline and AI agent prototypes
```

The `azure-homelab` folder was imported from the standalone repository
[vicsin081/azure-homelab](https://github.com/vicsin081/azure-homelab) with its full commit
history, so every fix referenced in the troubleshooting logs can be inspected commit by commit.

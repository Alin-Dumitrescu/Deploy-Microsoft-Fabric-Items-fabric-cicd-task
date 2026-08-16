# Privacy Policy for Deploy Microsoft Fabric items with fabric-cicd

This extension is designed for use within Azure DevOps and does not collect or transmit user personal data (PII) as part of its normal operation. This policy describes what (if anything) the extension collects, how it is used, and how to contact the maintainers. Plus, the GitHub repository for this is publicly viewable to show transparency.

## Data the extension collects

- No personal data is stored or transmitted by this extension.
- The extension uses Azure DevOps service connections to authenticate to Azure when deploying Fabric items; credentials (service principal id, secret, tenant id) are handled by Azure DevOps and are not persisted by this extension.
- The extension executes scripts and Python packages on the build/release agent and may trigger network requests for dependencies (e.g., pip installs). Those network operations are performed on the agent and follow the agent environment's network and security policies.

## Telemetry and diagnostics

- This extension does not collect diagnostic telemetry by default. If you add any diagnostic logging or telemetry, it will be made clear in the repository and will include an opt-out instruction. To the best of our knowledge the same is said for the Python libraries we work with.

## Third-party services

- The extension may use PyPI to install `fabric-cicd` and other dependencies during the task. The policy for those services is governed by their respective privacy policies.
- Ensure that your build agents are allowed to access those resources and that your network policies are configured appropriately.

## How we handle credentials

- Do NOT store Azure client secrets directly in source control or task inputs. Use Azure DevOps Service Connections (AzureRM) instead.
- The extension leverages environment variables and Azure DevOps service connections; it does not store client secrets or tenant IDs outside the run context.

## Data retention

- The extension does not store data beyond the ephemeral run on the agent.
- Any log output is stored by the Azure DevOps build or release logs per your organization settings. Do not print secrets to logs.

## Contact & updating this policy

- This privacy policy may be updated; the latest version will be available at the repository link in the extension metadata.


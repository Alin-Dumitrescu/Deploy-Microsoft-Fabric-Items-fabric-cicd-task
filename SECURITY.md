# Security Policy

## Supported Versions

The following versions of this extension are actively supported for security fixes:

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |


## Reporting a Vulnerability

If you discover a security vulnerability in this extension you may file a private issue with the label `security` on the GitHub repository: https://github.com/ChantifiedLens/Deploy-Microsoft-Fabric-Items-Task.

Do not open a public issue with PoC code or sensitive details—this could expose users.

We will respond when possible and provide updates on mitigation steps and timelines.


## Security Best Practices (for users of this extension)

- Use Azure Service Connections (recommended) rather than entering long-lived client secrets directly into the task inputs.
- Use least-privilege for the service principal (grant only the minimal permissions required).
- Keep dependencies pinned (use `requirements.txt` or `pip-compile`), and use automated dependency scanning in your CI.
- For extra safety, run your build in a minimal, ephemeral agent.


## Triage & Disclosure

- We follow a coordinated disclosure model. After acknowledgement, we will provide remediation timeline and patches privately.
- For severe vulnerabilities we will coordinate with the Azure DevOps Marketplace team if required.



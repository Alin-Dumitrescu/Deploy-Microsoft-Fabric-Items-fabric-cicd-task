import os
from azure.identity import ClientSecretCredential, WorkloadIdentityCredential
from fabric_cicd import deploy_with_config, append_feature_flag

import argparse
# append_feature_flag("enable_experimental_features")

parser = argparse.ArgumentParser(description='Process one variable.')
parser.add_argument('--Environment', type=str)
parser.add_argument('--ConfigFilePath', type=str)
args = parser.parse_args()

# Select the right TokenCredential based on available environment variables.
# deploy.ps1 sets AZURE_CLIENT_SECRET for secret-based auth, or
# AZURE_FEDERATED_TOKEN_FILE (and AZURE_FEDERATED_TOKEN) for Workload Identity Federation.
client_id = os.environ["AZURE_CLIENT_ID"]
tenant_id = os.environ["AZURE_TENANT_ID"]
client_secret = os.environ.get("AZURE_CLIENT_SECRET")

if client_secret:
    token_credential = ClientSecretCredential(
        tenant_id=tenant_id,
        client_id=client_id,
        client_secret=client_secret,
    )
else:
    # WorkloadIdentityCredential reads AZURE_FEDERATED_TOKEN_FILE automatically.
    # deploy.ps1 guarantees the file exists when using Workload Identity Federation.
    token_credential = WorkloadIdentityCredential(
        tenant_id=tenant_id,
        client_id=client_id,
    )

# Deploy using a config file
deploy_with_config(
    config_file_path=args.ConfigFilePath,
    token_credential=token_credential,
    environment=args.Environment
)


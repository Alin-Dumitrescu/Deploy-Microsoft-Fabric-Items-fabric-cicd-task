# Copyright (c) Microsoft Corporation.
# Licensed under the MIT License.

"""
Example of authenticating with SPN + Secret
Can be expanded to retrieve values from Key Vault or other sources
"""
# Kevin Chant extended this...
# START-EXAMPLE
import os
from azure.identity import ClientSecretCredential, WorkloadIdentityCredential
from fabric_cicd import FabricWorkspace, publish_all_items, unpublish_all_orphan_items
import argparse

parser = argparse.ArgumentParser(description='Process some variables.')
parser.add_argument('--WorkspaceId', type=str)
parser.add_argument('--Environment', type=str)
parser.add_argument('--RepositoryDirectory', type=str)
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

# Initialize the FabricWorkspace object with the required parameters
target_workspace = FabricWorkspace(
    workspace_id= args.WorkspaceId,
    environment=args.Environment,
    repository_directory=args.RepositoryDirectory, 
    token_credential=token_credential,
    # item_type_in_scope=item_type_in_scope,  
)

# Publish all items defined in item_type_in_scope
publish_all_items(target_workspace)


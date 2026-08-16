const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');

function requestOidcToken(uri, serviceConnectionId) {
  return new Promise((resolve, reject) => {
    if (!uri) return resolve(null);

    const postData = JSON.stringify({});

    // Include SYSTEM_ACCESSTOKEN for authentication if available
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    };

    const sysAccessToken = process.env['SYSTEM_ACCESSTOKEN'] || process.env['SYSTEM_ACCESS_TOKEN'];
    if (sysAccessToken) {
      headers['Authorization'] = `Bearer ${sysAccessToken}`;
    }

    const parseTokenFromBody = (body) => {
      const json = JSON.parse(body);
      return json.oidcToken || json.token || json.value || json.id_token || null;
    };

    const doRequest = (targetUrl) => new Promise((resResolve, resReject) => {
      const options = {
        hostname: targetUrl.hostname,
        port: targetUrl.port || 443,
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        headers: headers
      };

      const req = https.request(options, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const token = parseTokenFromBody(data);
              if (token && typeof token === 'string') {
                const parts = token.split('.');
                if (parts.length < 3) {
                  console.warn('OIDC token does not appear to be a JWT (missing segments).');
                }
                return resResolve(token);
              }
              return resReject(new Error('OIDC token response missing expected token field (oidcToken/token/value/id_token).'));
            } catch (e) {
              return resReject(new Error(`Failed to parse OIDC token response: ${e.message}`));
            }
          }

          const snippet = (data || '').slice(0, 500);
          return resReject(new Error(`OIDC token request failed with status ${res.statusCode} at ${targetUrl.origin}${targetUrl.pathname}${targetUrl.search}: ${snippet}`));
        });
      });

      req.on('error', err => resReject(err));
      req.write(postData);
      req.end();
    });

    const baseUrl = new URL(uri);
    const attempts = [];

    // Attempt 1: use SYSTEM_OIDCREQUESTURI exactly as provided.
    attempts.push(new URL(baseUrl.toString()));

    // Attempt 2: append serviceConnectionId only when missing and available.
    if (!baseUrl.searchParams.has('serviceConnectionId') && serviceConnectionId) {
      const withSc = new URL(baseUrl.toString());
      withSc.searchParams.set('serviceConnectionId', serviceConnectionId);
      attempts.push(withSc);
    }

    // Attempt 3: use the modern preview API version for OIDC token API.
    // Avoid hardcoding 7.0, which can resolve to non-existent route variants.
    const withPreviewApi = new URL(baseUrl.toString());
    withPreviewApi.searchParams.set('api-version', '7.2-preview.1');
    if (!withPreviewApi.searchParams.has('serviceConnectionId') && serviceConnectionId) {
      withPreviewApi.searchParams.set('serviceConnectionId', serviceConnectionId);
    }
    attempts.push(withPreviewApi);

    // De-duplicate attempts by final URL string
    const uniqueAttempts = [];
    const seen = new Set();
    for (const a of attempts) {
      const key = a.toString();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueAttempts.push(a);
      }
    }

    (async () => {
      let lastError = null;
      for (let i = 0; i < uniqueAttempts.length; i++) {
        const target = uniqueAttempts[i];
        try {
          if (i > 0) {
            console.log(`Retrying OIDC token request with URI variant ${i + 1}/${uniqueAttempts.length}...`);
          }
          const token = await doRequest(target);
          return resolve(token);
        } catch (err) {
          lastError = err;
          console.warn(`OIDC token attempt ${i + 1}/${uniqueAttempts.length} failed: ${err.message}`);
        }
      }

      if (lastError) {
        return reject(lastError);
      }
      return reject(new Error('OIDC token request failed with unknown error.'));
    })();
  });
}

async function run() {
  try {
    const scriptPath = path.join(__dirname, 'deploy.ps1');

    // Collect inputs from environment variables set by Azure DevOps
    const inputs = {
      azureSubscription: process.env['INPUT_AZURESUBSCRIPTION'],
      azureClientId: process.env['INPUT_AZURECLIENTID'],
      azureClientSecret: process.env['INPUT_AZURECLIENTSECRET'],
      azureTenantId: process.env['INPUT_AZURETENANTID'],
      workspaceId: process.env['INPUT_WORKSPACEID'],
      environmentName: process.env['INPUT_ENVIRONMENTNAME'],
      fabricCicdVersion: process.env['INPUT_FABRICCICDVERSION'],
      repositoryDirectory: process.env['INPUT_REPOSITORYDIRECTORY'],
      includeConfig: process.env['INPUT_INCLUDECONFIG'],
      configFilePath: process.env['INPUT_CONFIGFILEPATH'],
      itemsInScope: process.env['INPUT_ITEMSINSCOPE']
    };

    // Auto-detect endpoint id if user didn't pass azureSubscription but exactly one AzureRM endpoint exists
    function tryResolveEndpointId() {
      if (inputs.azureSubscription) return inputs.azureSubscription;
      const regex = /^ENDPOINT_AUTH_PARAMETER_(.+)_SERVICEPRINCIPALID$/i;
      const matches = Object.keys(process.env)
        .map(k => k.match(regex))
        .filter(Boolean)
        .map(m => m[1]);
      if (matches.length === 1) {
        console.log(`Using detected service connection: ${matches[0]}`);
        return matches[0];
      }
      if (matches.length === 0) {
        console.warn('No AzureRM service connections detected via environment. If you intended to use one, ensure "azureSubscription" input is set.');
      } else {
        console.warn(`Multiple AzureRM service connections detected (${matches.length}). Specify the azureSubscription input to pick the correct one.`);
      }
      return undefined;
    }

    // Prepare environment for child process, sourcing creds from service connection when available
    const childEnv = { ...process.env };
    const epId = tryResolveEndpointId();
    if (epId) {
      const spId = process.env[`ENDPOINT_AUTH_PARAMETER_${epId}_SERVICEPRINCIPALID`];
      const spKey = process.env[`ENDPOINT_AUTH_PARAMETER_${epId}_SERVICEPRINCIPALKEY`];
      const tenantId = process.env[`ENDPOINT_AUTH_PARAMETER_${epId}_TENANTID`];
      const authorityHost = process.env[`ENDPOINT_DATA_${epId}_ENVIRONMENTAUTHORITYURI`];
      const subscriptionId = process.env[`ENDPOINT_DATA_${epId}_SUBSCRIPTIONID`];
      const authScheme = process.env[`ENDPOINT_AUTH_SCHEME_${epId}`];

      console.log(`Service connection ${epId} auth scheme: ${authScheme || 'unknown'}`);

      // For WorkloadIdentityFederation, Azure DevOps provides the OIDC token via SYSTEM_ACCESSTOKEN or SYSTEM_OIDCREQUESTURI
      let federatedToken;
      let federatedTokenFile;
      let tokenSource;

      if (authScheme && authScheme.toLowerCase().includes('workloadidentityfederation')) {
        // WIF connection: use SYSTEM_ACCESSTOKEN only to authenticate the OIDC request; the federated token is what the request returns
        const oidcUri = process.env['SYSTEM_OIDCREQUESTURI'];
        let authToken = process.env['SYSTEM_ACCESSTOKEN'] || process.env['SYSTEM_ACCESS_TOKEN'];
        const jobAccessToken = process.env['SYSTEM_JOBTOKEN'] || process.env['AZURE_DEVOPS_EXT_PAT'];
        
        console.log('\n=== WIF Environment Diagnostics ===');
        console.log(`SYSTEM_ACCESSTOKEN: ${authToken ? 'present' : 'MISSING'}`);
        console.log(`SYSTEM_JOBTOKEN: ${process.env['SYSTEM_JOBTOKEN'] ? 'present' : 'not set'}`);
        console.log(`AZURE_DEVOPS_EXT_PAT: ${process.env['AZURE_DEVOPS_EXT_PAT'] ? 'present' : 'not set'}`);
        console.log(`SYSTEM_OIDCREQUESTURI: ${oidcUri ? 'available' : 'NOT SET'}`);
        console.log(`Agent type: ${process.env['AGENT_NAME'] || 'unknown'}`);
        console.log(`Build.Repository.Provider: ${process.env['BUILD_REPOSITORY_PROVIDER'] || 'unknown'}`);
        console.log('===================================\n');
        
        if (!authToken && jobAccessToken) {
          console.warn('SYSTEM_ACCESSTOKEN not available but SYSTEM_JOBTOKEN found. Trying as fallback auth...');
          authToken = jobAccessToken;
        }
        
        if (!authToken) {
          console.error('\n=== WORKLOAD IDENTITY FEDERATION SETUP ISSUE ===');
          console.error('No authentication token available for OIDC request despite checkout: persistCredentials: true.');
          console.error('\nPossible causes:');
          console.error('1. Self-hosted agent may need additional job access token configuration');
          console.error('2. Repository is not Azure Repos (GitHub may require different setup)');
          console.error('3. Job permissions may restrict token access');
          console.error('4. SYSTEM_ACCESSTOKEN may need to be explicitly mapped into the task env:');
          console.error('   env:\n     SYSTEM_ACCESSTOKEN: $(System.AccessToken)');
          console.error('\nWorkaround options:');
          console.error('A) Provide azureClientId, azureClientSecret, azureTenantId inputs for secret-based auth');
          console.error('B) Use AzureCLI@2 task which handles WIF natively');
          console.error('C) Grant job-level OAuth access in project settings\n');
        }
        
        if (oidcUri && authToken) {
          try {
            // Temporarily override process.env for the request
            const origToken = process.env['SYSTEM_ACCESSTOKEN'];
            process.env['SYSTEM_ACCESSTOKEN'] = authToken;
            federatedToken = await requestOidcToken(oidcUri, epId);
            process.env['SYSTEM_ACCESSTOKEN'] = origToken;
            if (federatedToken) {
              tokenSource = 'SYSTEM_OIDCREQUESTURI';
              console.log('Successfully requested OIDC token via SYSTEM_OIDCREQUESTURI.');
            } else {
              console.warn('OIDC token request returned empty token.');
            }
          } catch (err) {
            console.warn(`Failed to request OIDC token: ${err.message}`);
          }
        } else if (!oidcUri) {
          console.warn('Auth scheme is WorkloadIdentityFederation but SYSTEM_OIDCREQUESTURI is not set. Check pipeline configuration.');
        }
      } else {
        // Try to locate a federated/OIDC token from endpoint parameters (fallback)
        const paramPrefix = `ENDPOINT_AUTH_PARAMETER_${epId}_`;
        const tokenKey = Object.keys(process.env).find(k => {
          if (!k.startsWith(paramPrefix)) return false;
          if (k.toUpperCase().includes('SYSTEMVSSCONNECTION')) return false;
          const suffix = k.substring(paramPrefix.length).toUpperCase();
          return suffix === 'IDTOKEN' || suffix === 'FEDERATEDTOKEN' || suffix.includes('TOKEN');
        });
        federatedToken = tokenKey ? process.env[tokenKey] : undefined;
        if (federatedToken) {
          tokenSource = tokenKey || 'endpoint parameter token';
          console.log(`Detected federated token from ${tokenSource}.`);
        } else if (!spKey) {
            console.warn(`No federated token or client secret found for service connection ${epId}. Ensure the connection uses Workload Identity Federation or provides a secret.`);
        }
      }

      if (spId) childEnv.AZURE_CLIENT_ID = spId;
      if (spKey) childEnv.AZURE_CLIENT_SECRET = spKey;
      if (tenantId) childEnv.AZURE_TENANT_ID = tenantId;
      if (authorityHost) childEnv.AZURE_AUTHORITY_HOST = authorityHost;
      if (subscriptionId) childEnv.AZURE_SUBSCRIPTION_ID = subscriptionId;

      // Common aliases used by tools
      if (spId) childEnv.ARM_CLIENT_ID = spId;
      if (spKey) childEnv.ARM_CLIENT_SECRET = spKey;
      if (tenantId) childEnv.ARM_TENANT_ID = tenantId;
      if (subscriptionId) childEnv.ARM_SUBSCRIPTION_ID = subscriptionId;

      // Propagate federated token to environments that understand OIDC (Az CLI/Az PowerShell/DefaultAzureCredential)
      if (federatedToken) {
        childEnv.AZURE_FEDERATED_TOKEN = federatedToken;
        // Write to a temp file so AZURE_FEDERATED_TOKEN_FILE is also available
        federatedTokenFile = path.join(os.tmpdir(), `federated_token_${Date.now()}.jwt`);
        try {
          fs.writeFileSync(federatedTokenFile, federatedToken, { encoding: 'utf8', flag: 'w' });
          childEnv.AZURE_FEDERATED_TOKEN_FILE = federatedTokenFile;
          childEnv.ARM_OIDC_TOKEN = federatedToken;
          childEnv.ARM_OIDC_TOKEN_FILE = federatedTokenFile;
          childEnv.AZURE_CLIENT_SECRET = childEnv.AZURE_CLIENT_SECRET || '';
          const tokenLabel = tokenSource || 'detected variable';
          console.log(`Using federated token from ${tokenLabel} (value not logged).`);
        } catch (err) {
          // Don't fail the task for token file issues; the PowerShell script will handle fallbacks
          console.warn('Warning: unable to persist federated token to file:', err?.message || err);
        }
      }
    } else {
      // Fallback to direct inputs
      if (inputs.azureClientId) childEnv.AZURE_CLIENT_ID = inputs.azureClientId;
      if (inputs.azureClientSecret) childEnv.AZURE_CLIENT_SECRET = inputs.azureClientSecret;
      if (inputs.azureTenantId) childEnv.AZURE_TENANT_ID = inputs.azureTenantId;

      // Absolute last-resort federated token detection when no azureSubscription was provided
      // Exclude SYSTEMVSSCONNECTION tokens (Azure DevOps system tokens)
      if (!childEnv.AZURE_CLIENT_SECRET) {
        const tokenKey = Object.keys(process.env).find(k => {
          const upper = k.toUpperCase();
          if (upper.includes('SYSTEMVSSCONNECTION')) return false;
          return (upper.includes('IDTOKEN') || (upper.includes('FEDERATED') && upper.includes('TOKEN')) || (upper.includes('OIDC') && upper.includes('TOKEN')));
        });
        if (tokenKey && process.env[tokenKey]) {
          const federatedToken = process.env[tokenKey];
          childEnv.AZURE_FEDERATED_TOKEN = federatedToken;
          const federatedTokenFile = path.join(os.tmpdir(), `federated_token_${Date.now()}.jwt`);
          try {
            fs.writeFileSync(federatedTokenFile, federatedToken, { encoding: 'utf8', flag: 'w' });
            childEnv.AZURE_FEDERATED_TOKEN_FILE = federatedTokenFile;
            childEnv.ARM_OIDC_TOKEN = federatedToken;
            childEnv.ARM_OIDC_TOKEN_FILE = federatedTokenFile;
            console.log(`Using fallback federated token from ${tokenKey} (value not logged).`);
          } catch (err) {
            console.warn('Warning: unable to persist fallback federated token to file:', err?.message || err);
          }
        } else {
          console.warn('No federated token detected. If using WIF, ensure azureSubscription input is set to your AzureRM service connection name.');
        }
      }
    }

    // Build PowerShell arguments with splatting style
    // Convert includeConfig to boolean - handle string, whitespace, and case variations
    const includeConfigValue = inputs.includeConfig && inputs.includeConfig.toString().trim().toLowerCase() === 'true' ? '1' : '0';
    
    const args = [
      '-NoLogo', '-NoProfile', '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      // Pass IDs as args if provided, but avoid passing secret via args
      '-azureClientId', inputs.azureClientId || '',
      '-azureClientSecret', '',
      '-azureTenantId', inputs.azureTenantId || '',
      '-workspaceId', inputs.workspaceId || '',
      '-environmentName', inputs.environmentName || '',
      '-fabricCicdVersion', inputs.fabricCicdVersion || '',
      '-repositoryDirectory', inputs.repositoryDirectory || '',
      '-includeConfig', includeConfigValue,
      '-configFilePath', inputs.configFilePath || '',
      '-itemsInScope', inputs.itemsInScope || ''
    ];

    const child = cp.spawn('pwsh', args, { stdio: 'inherit', env: childEnv });

    child.on('exit', code => process.exit(code));
  } catch (err) {
    console.error('Task failed:', err);
    process.exit(1);
  }
}

run();

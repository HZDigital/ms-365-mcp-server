# Production Deployment

The server can be hosted centrally so that multiple users in an organization share a single MCP endpoint. Each user
authenticates with their own Microsoft account via OAuth — the server is stateless and does not store tokens.

## Architecture

```
MCP Clients (Claude Desktop, Claude Code, Open WebUI, ...)
         │  Streamable HTTP + OAuth 2.1
         ▼
   ┌─────────────────────────────┐
   │  ms-365-mcp-server --http   │  Azure Container Apps / App Service / Docker
   │  (stateless, no token store)│
   └─────────────┬───────────────┘
                 │  OBO token exchange (per-user, when --obo)
                 ├─────────────────────► Microsoft Graph API
                 └─────────────────────► Dataverse API (when configured)
```

## Headless stdio auth-cache storage

Production HTTP deployments are stateless: normal Graph requests carry a per-user bearer token, including On-Behalf-Of (`--obo`) deployments, and the server does not store MSAL token state for those requests.

For headless stdio deployments that use local MSAL login (`--login`, `--verify-login`, auth tools, account selection, and regular stdio Graph calls), `MS365_MCP_AUTH_CACHE_COMMAND` can point at an external executable wrapper that stores the MSAL token cache and selected-account metadata in a deployment-approved backing store. The package only defines the provider-neutral command protocol; provider-specific scripts for AWS, Azure, GCP, Redis, databases, or other stores live outside this package.

In HTTP mode, `MS365_MCP_AUTH_CACHE_COMMAND` is skipped at startup and per Graph request unless local auth tools are explicitly enabled with `--enable-auth-tools` or a local account command such as `--login`, `--verify-login`, `--list-accounts`, `--select-account`, `--remove-account`, or `--logout` is invoked.

## Docker

A `Dockerfile` is included for containerized deployments:

```bash
# Build the image
docker build -t ms-365-mcp-server .

# Run with environment variables
docker run -p 3000:3000 \
  -e MS365_MCP_CLIENT_ID=your-client-id \
  -e MS365_MCP_TENANT_ID=your-tenant-id \
  -e MS365_MCP_CLIENT_SECRET=your-secret \
  -e MS365_MCP_ORG_MODE=true \
  ms-365-mcp-server \
  --http 3000 --org-mode
```

For production, use Azure Key Vault instead of environment variables for secrets (see [Azure Key Vault Integration](../README.md#azure-key-vault-integration)):

```bash
docker run -p 3000:3000 \
  -e MS365_MCP_KEYVAULT_URL=https://your-keyvault.vault.azure.net \
  -e MS365_MCP_ORG_MODE=true \
  -e MS365_MCP_PUBLIC_URL=https://mcp.example.com \
  ms-365-mcp-server \
  --http 3000 --org-mode
```

### Dynamics 365 CRM / Dataverse

Configure exactly one Dataverse organization origin and run the server with HTTP OBO and organization mode. The URL is deployment configuration rather than a secret, but it is an authorization boundary: only this HTTPS origin receives a Dataverse token.

```bash
docker run -p 3000:3000 \
  -e MS365_MCP_CLIENT_ID=your-client-id \
  -e MS365_MCP_TENANT_ID=your-tenant-id \
  -e MS365_MCP_CLIENT_SECRET=your-secret \
  -e MS365_MCP_DYNAMICS_URL=https://contoso.crm.dynamics.com \
  ms-365-mcp-server \
  --http 3000 --obo --org-mode --preset dynamics
```

The configured URL must be an HTTPS origin with no path, credentials, query string, or fragment. OBO retains the incoming MCP token as the user assertion and exchanges it independently for Graph and Dataverse `/.default` tokens. Configure the Entra application to expose its `access_as_user` scope, add **Dynamics CRM** delegated `user_impersonation` and the required Microsoft Graph delegated permissions, then grant admin consent. Dataverse security roles continue to govern which records each caller can access or change.

To make the same deployment configuration safe for staging, set both variables below. When `MS365_MCP_IS_STAGING=true` (or `1`), the server uses `MS365_MCP_DYNAMICS_STAGING_URL` and refuses to start if it is absent or empty; it never falls back to `MS365_MCP_DYNAMICS_URL` in staging.

```bash
-e MS365_MCP_IS_STAGING=true \
-e MS365_MCP_DYNAMICS_STAGING_URL=https://contoso-staging.crm.dynamics.com
```

## Azure Container Apps

> **Turnkey Bicep example**: see [`examples/azure-container-apps/`](../examples/azure-container-apps/) for a complete Bicep template + PowerShell deploy script that provisions Log Analytics, UAMI, Key Vault (RBAC), Container Apps Environment and the Container App in one command.

1. **Push the image** to Azure Container Registry:

   ```bash
   az acr build --registry yourregistry --image ms365-mcp-server:latest .
   ```

2. **Create the Container App** with system-assigned managed identity:

   ```bash
   az containerapp create \
     --name mcp-server \
     --resource-group your-rg \
     --environment your-cae \
     --image yourregistry.azurecr.io/ms365-mcp-server:latest \
     --target-port 3000 \
     --ingress external \
     --min-replicas 1 \
     --max-replicas 3 \
     --cpu 0.5 --memory 1Gi \
     --system-assigned \
     --env-vars \
        "MS365_MCP_KEYVAULT_URL=https://your-keyvault.vault.azure.net" \
       "MS365_MCP_ORG_MODE=true" \
       "MS365_MCP_PUBLIC_URL=https://mcp.example.com" \
      --command "node" "dist/index.js" "--http" "3000" "--org-mode"
   ```

3. **Grant Key Vault access** to the managed identity:

   ```bash
   PRINCIPAL_ID=$(az containerapp show --name mcp-server --resource-group your-rg \
     --query identity.principalId -o tsv)
   az keyvault set-policy --name your-keyvault --object-id $PRINCIPAL_ID \
     --secret-permissions get list
   ```

## Azure App Service

```bash
az webapp create \
  --name mcp-server \
  --resource-group your-rg \
  --plan your-plan \
  --runtime "NODE:22-lts" \
  --assign-identity

az webapp config appsettings set --name mcp-server --resource-group your-rg \
  --settings \
    MS365_MCP_KEYVAULT_URL="https://your-keyvault.vault.azure.net" \
    MS365_MCP_ORG_MODE="true" \
    MS365_MCP_PUBLIC_URL="https://mcp-server.azurewebsites.net" \
    WEBSITES_PORT="3000"

az webapp config set --name mcp-server --resource-group your-rg \
  --startup-file "node dist/index.js --http 3000 --org-mode"
```

## Azure AD App Registration (for organizations)

When deploying for an organization, create a dedicated app registration instead of using the built-in client ID:

1. **Create the app** in [Azure Portal](https://portal.azure.com) > App registrations > New registration
   - Name: `MS365 MCP Server`
   - Supported account types: **Accounts in this organizational directory only** (single tenant)
   - Redirect URI (platform type **Web**): the **MCP client's** OAuth callback URL, not the server's own domain. The server proxies the OAuth flow and forwards the client's `redirect_uri` to Microsoft Entra, so Entra delivers the authorization code directly to the client. Register one redirect URI per MCP client you want to support, for example:
     - Claude (claude.ai, Desktop, Cowork): `https://claude.ai/api/mcp/auth_callback`
     - Other clients: check the `redirect_uri` query parameter your client sends to the server's `/authorize` endpoint (visible in the server logs)

   > **Common pitfall**: registering `https://your-server-domain/callback` here breaks sign-in with `AADSTS50011` (redirect URI mismatch) after the user authenticates. The server has no callback endpoint of its own; the authorization code always goes to the MCP client. Note that platform type **Web** applies because this setup uses a client secret; an app without a secret must register the redirect URI under "Mobile and desktop applications" instead.

2. **Add API permissions** > Microsoft Graph > Delegated permissions
   Run `npx @softeria/ms-365-mcp-server --org-mode --list-permissions` to print the exact list of permissions required for your enabled tools.

For Dynamics OBO deployments, also expose the MCP app's `access_as_user` delegated permission, add **Dynamics CRM** > Delegated `user_impersonation`, and configure the exact `MS365_MCP_DYNAMICS_URL` organization origin. The application needs a client secret for OBO.

3. **Grant admin consent** to skip per-user consent prompts:

   ```bash
   az ad app permission admin-consent --id your-app-client-id
   ```

4. **Create a client secret** under Certificates & secrets, then store it in Key Vault

5. **Store credentials** in Key Vault (see [Azure Key Vault Integration](../README.md#azure-key-vault-integration))

## SharePoint Document Extraction

For an AI client that needs to answer questions from SharePoint documents, keep the server read-only and expose only the retrieval tools it needs. The following configuration enables tenant-wide document discovery and bounded server-side text extraction:

```bash
MS365_MCP_ORG_MODE=true
READ_ONLY=1
ENABLED_TOOLS='^(search-sharepoint-content|extract-drive-item-content|search-sharepoint-sites|list-sharepoint-site-drives|get-drive-item|search-onedrive-files)$'
MS365_MCP_ALLOWED_SCOPES='Files.Read Files.Read.All Sites.Read.All'
MS365_MCP_MAX_EXTRACT_FILE_BYTES=10485760
MS365_MCP_MAX_EXTRACT_CHARACTERS=24000
```

`search-sharepoint-content` uses Microsoft Search to return ranked document hits with `driveId` and `itemId`. `extract-drive-item-content` then downloads one selected file with the connecting user's delegated token and returns bounded extracted text with its stable SharePoint URL. It supports PDF, DOCX, PPTX, XLSX, CSV, and text files. OCR is deliberately disabled, so scanned PDFs or image-only documents can have little or no extracted text.

The extraction defaults are a 10 MiB file and 24,000-character result. A 30-second deadline covers Graph response headers and streamed download bytes, without retries; Office/PDF parsing runs in one of at most two 128 MiB workers and each worker is terminated after 30 seconds. Limits can be lowered or raised through the variables above, but files and output are hard-capped at 25 MiB and 50,000 characters. Reauthenticate MCP users after adding `Files.Read.All` or `Sites.Read.All` to the app registration so their delegated tokens contain the new scopes.

Do not expose `download-bytes` or `get-download-url` for this model workflow: the former sends whole files as base64 into model context and the latter returns a signed URL that most MCP model hosts cannot download and parse. The generic `search-query` tool is read-only, but declares broad cross-service permissions; `search-sharepoint-content` is the narrower SharePoint document-search surface.

## Redirect URI Validation

The /authorize endpoint defensively validates client-supplied `redirect_uri` values before forwarding them to Microsoft Entra (CWE-601, Open Redirect). Microsoft Entra also validates the URI against your app registration, but this server-side check rejects obviously dangerous schemes (`javascript:`, `data:`, `file:`, …) and arbitrary remote `http://` origins before the request leaves the server.

Default behaviour (no explicit allowlist):

- Only `http:` and `https:` schemes are accepted.
- `http:` is only allowed for loopback hosts (`localhost`, `127.0.0.1`, `::1`).
- All other `https://` origins are accepted (Entra still has the final say).

For production deployments, configure an explicit allowlist via the `MS365_MCP_ALLOWED_REDIRECT_URIS` environment variable. It takes a comma-separated list of exact URIs; only exact string matches pass validation:

```bash
# Single redirect URI
MS365_MCP_ALLOWED_REDIRECT_URIS=https://mcp.example.com/auth/callback

# Multiple URIs (comma-separated, no spaces required)
MS365_MCP_ALLOWED_REDIRECT_URIS=https://mcp.example.com/auth/callback,https://staging.example.com/auth/callback
```

The list should mirror the redirect URIs registered on your Azure AD app registration. Leaving the variable unset falls back to the default behaviour above, which is appropriate for local development but not recommended for shared/production deployments.

## Reverse Proxy / Custom Domain

When running behind a reverse proxy, set `MS365_MCP_PUBLIC_URL` so that the OAuth authorize URL handed back to the user's browser is resolvable from outside the server's network:

```bash
# Via environment variable
MS365_MCP_PUBLIC_URL=https://mcp.example.com

# Or via CLI flag
--public-url https://mcp.example.com
```

Only browser-facing fields (`issuer`, `authorization_endpoint`, `authorization_servers`) are pinned to this URL. Server-to-server endpoints (`token_endpoint`, `registration_endpoint`, `resource`) stay on the request origin, so clients that reach the server over an internal network (e.g. another container on the same Docker network) don't have to round-trip back through the public URL.

## Client Configuration

Once deployed, users connect by pointing their MCP client to the server URL:

**Claude Desktop:**

```json
{
  "mcpServers": {
    "ms365": {
      "type": "streamable-http",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add ms365 --transport http https://mcp.example.com/mcp
```

The client automatically discovers OAuth endpoints and opens a browser for authentication on first use.

## Security Considerations

- **Stateless**: the server does not store tokens — each request carries the user's Bearer token
- **Account pinning**: `MS365_MCP_EXPECTED_USERNAME` and `MS365_MCP_EXPECTED_HOME_ACCOUNT_ID` protect local MSAL cache flows for headless stdio deployments. In `--http`, `--obo`, or `MS365_MCP_OAUTH_TOKEN` deployments they are warning-only because Graph calls use request-provided tokens.
- **Admin consent**: grant tenant-wide consent to avoid per-user consent prompts
- **Managed identity**: use managed identity for Key Vault access (no secrets in environment variables)
- **Read-only mode**: use `--read-only` to disable all write operations (send, delete, update, create)
- **Tool filtering**: use `--enabled-tools <regex>` or `--preset <names>` to restrict available tools
- **CORS**: configure `MS365_MCP_CORS_ORIGIN` to restrict allowed origins (defaults to `http://localhost:3000`). You can provide a comma-separated allowlist such as `https://app.example.com,https://admin.example.com`; set explicitly when clients run on a different origin
- **Disable Dynamic Client Registration**: when only a known client talks to the server, set `MS365_MCP_DISABLE_DCR=true` (or pass `--no-dynamic-registration`) to close the anonymous `/register` endpoint
- **Structured audit log**: enabled by default. Every tool invocation emits one JSON line on stdout (captured by the container platform's log collector) and to `~/.ms-365-mcp-server/logs/audit.log` (mode `0o600`) with `{ event, request_id, user_principal_name, tool, http_method, status, duration_ms, error_type?, error_code? }`. The schema is intentionally narrow — tool parameters and Graph response bodies are NEVER recorded, and error messages are reduced to `error_type` / `error_code` so upstream library errors do not leak token fragments or query-string PII. Forms the "who accessed what, when" trail required for GDPR / HIPAA / PIPEDA / SOC 2 audit. Opt-out: `MS365_MCP_AUDIT_LOG=false`
- **Graph resilience**: every call to Microsoft Graph is wrapped with a fetch timeout (default 100 s via `MS365_MCP_GRAPH_TIMEOUT_MS`), retry-with-backoff on 429 / 503 / 504 / network errors (default 3 retries, full-jitter exponential backoff, honours `Retry-After`; 503 / 504 / network errors only retried for idempotent methods, 429 retried on all methods), and a process-wide circuit breaker that opens after 5 consecutive failures and cools down for 30 s (`MS365_MCP_GRAPH_CIRCUIT_THRESHOLD` / `MS365_MCP_GRAPH_CIRCUIT_COOLDOWN_MS`). Disable the breaker for trusted automation: `MS365_MCP_GRAPH_CIRCUIT_DISABLED=true`
- **Confirm gate on destructive tools**: opt-in, **off by default**. Enable with `MS365_MCP_REQUIRE_CONFIRM=true`. When on, destructive tools (POST except `readOnly`, PATCH, PUT, DELETE — `delete-mail-message`, `send-mail`, `update-event`, etc.) return `{ "error": "confirmation_required" }` until the caller re-invokes them with `"confirm": true`. Mitigates accidental writes when an LLM misroutes a request or follows an injected instruction. Shipped opt-in so it is a non-breaking, additive layer that can coexist with client-side elicitation prompts (MCP Elicitation API) where the client supports them.

## Exposed Endpoints

| Path                                      | Method   | Description                     | Auth Required |
| ----------------------------------------- | -------- | ------------------------------- | ------------- |
| `/`                                       | GET      | Health check                    | No            |
| `/mcp`                                    | GET/POST | MCP protocol endpoint           | Bearer token  |
| `/authorize`                              | GET      | OAuth — redirect to Microsoft   | No            |
| `/token`                                  | POST     | OAuth — code exchange / refresh | No            |
| `/register`                               | POST     | OAuth — dynamic registration    | No            |
| `/.well-known/oauth-authorization-server` | GET      | OAuth server metadata           | No            |
| `/.well-known/oauth-protected-resource`   | GET      | Protected resource metadata     | No            |

/**
 * Scope requirements for server utility tools. Generated Graph endpoints carry
 * their own metadata in endpoints.json; utilities need an explicit registry so
 * OAuth scope derivation and MS365_MCP_ALLOWED_SCOPES enforce the same boundary.
 */
export const UTILITY_TOOL_SCOPE_GROUPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  'search-sharepoint-content': [['Files.Read.All', 'Sites.Read.All']],
  'extract-drive-item-content': [['Files.Read']],
};

// These tools use Microsoft Search and document-library drive IDs, both of
// which are work-account features. Keep them out of personal-mode surfaces.
const WORK_ACCOUNT_UTILITY_TOOL_NAMES = new Set(Object.keys(UTILITY_TOOL_SCOPE_GROUPS));

export function getUtilityToolScopeGroups(toolName: string): string[][] {
  return (UTILITY_TOOL_SCOPE_GROUPS[toolName] ?? []).map((group) => [...group]);
}

export function isWorkAccountUtilityTool(toolName: string): boolean {
  return WORK_ACCOUNT_UTILITY_TOOL_NAMES.has(toolName);
}

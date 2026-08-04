export interface DynamicsConfig {
  origin: string;
  apiBaseUrl: string;
  scope: string;
}

/**
 * Dataverse is deliberately configured once at startup. Tool inputs must never
 * select an organization host because that could leak a delegated token.
 */
export function parseDynamicsUrl(value: string | undefined): DynamicsConfig | undefined {
  if (value === undefined) return undefined;

  const raw = value.trim();
  if (raw === '') {
    throw new Error(
      'MS365_MCP_DYNAMICS_URL / --dynamics-url was provided but is empty. Provide an HTTPS Dataverse organization URL.'
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('--dynamics-url must be a valid HTTPS Dataverse organization URL.');
  }

  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      '--dynamics-url must be an HTTPS organization origin only, without credentials, a path, query string, or fragment.'
    );
  }

  const origin = url.origin;
  return {
    origin,
    apiBaseUrl: `${origin}/api/data/v9.2`,
    scope: `${origin}/.default`,
  };
}

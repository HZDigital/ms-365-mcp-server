import { AsyncLocalStorage } from 'node:async_hooks';

export type DownstreamResource = 'graph' | 'dynamics';

export interface RequestContext {
  /** Existing direct Graph bearer path, retained for non-OBO HTTP requests. */
  accessToken?: string;
  /** Incoming MCP API assertion, retained only for OBO token exchanges. */
  userAssertion?: string;
  getAccessToken?: (resource: DownstreamResource) => Promise<string>;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestTokens(): RequestContext | undefined {
  return requestContext.getStore();
}

/**
 * Returns the token whose identity should be recorded in an audit event. OBO
 * contexts retain the incoming assertion for this purpose while downstream
 * requests obtain resource-specific tokens through getAccessToken.
 */
export function getRequestAuditToken(): string | undefined {
  const context = getRequestTokens();
  return context?.userAssertion ?? context?.accessToken;
}

export async function getRequestAccessToken(
  resource: DownstreamResource
): Promise<string | undefined> {
  const context = getRequestTokens();
  if (!context) return undefined;
  if (context.getAccessToken) return context.getAccessToken(resource);
  return resource === 'graph' ? context.accessToken : undefined;
}

/** Builds a request-local, promise-aware OBO token cache. */
export function createOboRequestContext(
  userAssertion: string,
  exchangeToken: (resource: DownstreamResource) => Promise<string>,
  initialTokens: Partial<Record<DownstreamResource, string>> = {}
): RequestContext {
  const tokens = new Map<DownstreamResource, Promise<string>>();
  for (const resource of ['graph', 'dynamics'] as const) {
    const token = initialTokens[resource];
    if (token) tokens.set(resource, Promise.resolve(token));
  }

  return {
    userAssertion,
    getAccessToken(resource) {
      let token = tokens.get(resource);
      if (!token) {
        token = exchangeToken(resource);
        tokens.set(resource, token);
        void token.catch(() => tokens.delete(resource));
      }
      return token;
    },
  };
}

/**
 * Validates an incoming OBO assertion before a request handler is dispatched.
 * The validated Graph token is retained in the request-local cache, while
 * tokens for other downstream resources remain lazy.
 */
export async function createValidatedOboRequestContext(
  userAssertion: string,
  exchangeToken: (resource: DownstreamResource) => Promise<string>
): Promise<RequestContext> {
  const graphToken = await exchangeToken('graph');
  return createOboRequestContext(userAssertion, exchangeToken, { graph: graphToken });
}

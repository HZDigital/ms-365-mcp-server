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
  exchangeToken: (resource: DownstreamResource) => Promise<string>
): RequestContext {
  const tokens = new Map<DownstreamResource, Promise<string>>();
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

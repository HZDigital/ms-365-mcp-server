import type { DynamicsConfig } from './dynamics-config.js';
import { fetchDataverseWithResilience } from './lib/dataverse-resilience.js';
import { getRequestAccessToken } from './request-context.js';

export interface DataverseRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  preferRepresentation?: boolean;
  accessToken?: string;
}

export class DataverseClient {
  constructor(private readonly config: DynamicsConfig) {}

  private urlFor(path: string): string {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('://')) {
      throw new Error(
        'Dataverse request paths must be relative to the configured organization API root.'
      );
    }
    const apiRoot = new URL(`${this.config.apiBaseUrl}/`);
    const url = new URL(path.slice(1), apiRoot);
    if (url.origin !== this.config.origin || !url.pathname.startsWith(`${apiRoot.pathname}`)) {
      throw new Error(
        'Dataverse request paths must remain within the configured organization API root.'
      );
    }
    return url.toString();
  }

  private urlForNextLink(nextLink: string): string {
    let url: URL;
    try {
      url = new URL(nextLink);
    } catch {
      throw new Error('Dataverse returned an invalid @odata.nextLink.');
    }
    if (url.origin !== this.config.origin || !url.pathname.startsWith('/api/data/v9.2/')) {
      throw new Error('Dataverse @odata.nextLink is outside the configured organization.');
    }
    return url.toString();
  }

  async request(path: string, options: DataverseRequestOptions = {}): Promise<unknown> {
    return this.fetch(this.urlFor(path), options);
  }

  async requestNextLink(nextLink: string): Promise<unknown> {
    return this.fetch(this.urlForNextLink(nextLink), { method: 'GET' });
  }

  private async fetch(url: string, options: DataverseRequestOptions): Promise<unknown> {
    const accessToken = options.accessToken ?? (await getRequestAccessToken('dynamics'));
    if (!accessToken) {
      throw new Error(
        'No Dataverse access token is available. Dynamics tools require HTTP mode with --obo.'
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'OData-MaxVersion': '4.0',
      'OData-Version': '4.0',
      ...options.headers,
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json; charset=utf-8';
    if (options.preferRepresentation) headers.Prefer = 'return=representation';

    const response = await fetchDataverseWithResilience(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const entityId =
      response.headers.get('OData-EntityId') ?? response.headers.get('odata-entityid');
    const etag = response.headers.get('ETag') ?? response.headers.get('etag');

    if (!response.ok) {
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; code?: string } };
        detail = parsed.error?.message ?? detail;
      } catch {
        // Preserve non-JSON Dataverse gateway errors.
      }
      throw new Error(`Dataverse API error: ${response.status} ${response.statusText} - ${detail}`);
    }

    let body: unknown = undefined;
    if (text !== '') {
      try {
        body = JSON.parse(text);
      } catch {
        body = { rawResponse: text };
      }
    }

    if (body && typeof body === 'object' && !Array.isArray(body)) {
      return {
        ...(body as Record<string, unknown>),
        ...(etag ? { _etag: etag } : {}),
        ...(entityId ? { _entityId: entityId } : {}),
      };
    }

    return {
      success: true,
      ...(body === undefined ? {} : { data: body }),
      ...(etag ? { _etag: etag } : {}),
      ...(entityId ? { _entityId: entityId } : {}),
    };
  }
}

export default DataverseClient;

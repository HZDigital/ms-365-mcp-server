import { afterEach, describe, expect, it, vi } from 'vitest';
import DataverseClient from '../src/dataverse-client.js';
import { parseDynamicsUrl } from '../src/dynamics-config.js';
import { createDynamicsTools, DYNAMICS_TOOL_PRESETS } from '../src/dynamics-tools.js';
import type { UtilityToolContext } from '../src/graph-tools.js';
import { __resetDataverseBreakerForTests } from '../src/lib/dataverse-resilience.js';
import { createOboRequestContext, requestContext } from '../src/request-context.js';

describe('Dynamics configuration', () => {
  it('normalizes a configured organization origin and derives its API audience', () => {
    expect(parseDynamicsUrl('https://contoso.crm.dynamics.com/')).toEqual({
      origin: 'https://contoso.crm.dynamics.com',
      apiBaseUrl: 'https://contoso.crm.dynamics.com/api/data/v9.2',
      scope: 'https://contoso.crm.dynamics.com/.default',
    });
  });

  it.each([
    'http://contoso.crm.dynamics.com',
    'https://user:password@contoso.crm.dynamics.com',
    'https://contoso.crm.dynamics.com/api/data/v9.2',
    'https://contoso.crm.dynamics.com/?x=1',
    'https://contoso.crm.dynamics.com/#fragment',
  ])('rejects non-origin configuration: %s', (url) => {
    expect(() => parseDynamicsUrl(url)).toThrow(/dynamics-url/i);
  });
});

describe('Dataverse client', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    __resetDataverseBreakerForTests();
    vi.restoreAllMocks();
  });

  it('uses the configured API root, Dynamics token, and required OData headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: [{ name: 'Contoso' }], '@odata.context': 'kept' }), {
        status: 200,
        headers: { 'content-type': 'application/json', ETag: 'W/"1"' },
      })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new DataverseClient(parseDynamicsUrl('https://contoso.crm.dynamics.com')!);

    const result = await requestContext.run(
      {
        getAccessToken: async (resource) => {
          expect(resource).toBe('dynamics');
          return 'DYNAMICS_TOKEN';
        },
      },
      () => client.request('/accounts?$select=name')
    );

    expect(result).toEqual({
      value: [{ name: 'Contoso' }],
      '@odata.context': 'kept',
      _etag: 'W/"1"',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://contoso.crm.dynamics.com/api/data/v9.2/accounts?$select=name',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer DYNAMICS_TOKEN',
          Accept: 'application/json',
          'OData-MaxVersion': '4.0',
          'OData-Version': '4.0',
        }),
      })
    );
  });

  it('returns entity identity for a 204 mutation response', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 204,
        headers: {
          'OData-EntityId': 'https://contoso.crm.dynamics.com/api/data/v9.2/accounts(guid)',
        },
      })
    ) as unknown as typeof fetch;
    const client = new DataverseClient(parseDynamicsUrl('https://contoso.crm.dynamics.com')!);

    const result = await requestContext.run({ getAccessToken: async () => 'DYNAMICS_TOKEN' }, () =>
      client.request('/accounts(00000000-0000-4000-8000-000000000000)', { method: 'DELETE' })
    );

    expect(result).toEqual({
      success: true,
      _entityId: 'https://contoso.crm.dynamics.com/api/data/v9.2/accounts(guid)',
    });
  });

  it('refuses pagination links outside the configured organization before fetching', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new DataverseClient(parseDynamicsUrl('https://contoso.crm.dynamics.com')!);

    await requestContext.run({ getAccessToken: async () => 'DYNAMICS_TOKEN' }, async () => {
      await expect(
        client.requestNextLink('https://attacker.example/api/data/v9.2/accounts?$skiptoken=1')
      ).rejects.toThrow(/outside the configured organization/);
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses relative paths that escape the configured API root', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const client = new DataverseClient(parseDynamicsUrl('https://contoso.crm.dynamics.com')!);

    await requestContext.run({ getAccessToken: async () => 'DYNAMICS_TOKEN' }, async () => {
      await expect(client.request('/../api/data/v9.2/accounts')).rejects.toThrow(
        /within the configured organization API root/
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Dynamics tools', () => {
  it('declares generic, core CRM, and concrete activity tools', () => {
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-query-records');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-create-account');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-create-contact');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-create-lead');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-create-opportunity');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-list-activities');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-list-audits');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-get-audit');
    expect(DYNAMICS_TOOL_PRESETS).toContain('dynamics-create-task');
  });

  it('marks writes as destructive while metadata and queries remain read-only', () => {
    const client = new DataverseClient(parseDynamicsUrl('https://contoso.crm.dynamics.com')!);
    const tools = createDynamicsTools(client);
    expect(tools.find((tool) => tool.name === 'dynamics-query-records')?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'dynamics-list-audits')?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'dynamics-get-audit')?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'dynamics-create-record')?.readOnlyHint).toBe(false);
    expect(tools.every((tool) => tool.orgOnly && tool.service === 'dynamics')).toBe(true);
  });

  it('passes metadata expansions through to Dataverse', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ value: [] }),
    } as unknown as DataverseClient;
    const tool = createDynamicsTools(client).find((item) => item.name === 'dynamics-list-tables')!;

    await tool.execute({ expand: 'Attributes($select=LogicalName)' }, {} as UtilityToolContext);

    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining('$expand=Attributes(%24select%3DLogicalName)')
    );
  });

  it('uses the read-only audits entity set for audit helpers', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ value: [] }),
    } as unknown as DataverseClient;
    const tools = createDynamicsTools(client);

    await tools
      .find((item) => item.name === 'dynamics-list-audits')!
      .execute({ top: 10, orderby: 'createdon desc' }, {} as UtilityToolContext);
    await tools
      .find((item) => item.name === 'dynamics-get-audit')!
      .execute(
        { id: '00000000-0000-4000-8000-000000000000', select: 'action,createdon' },
        {} as UtilityToolContext
      );

    expect(client.request).toHaveBeenNthCalledWith(1, '/audits?$orderby=createdon%20desc&$top=10');
    expect(client.request).toHaveBeenNthCalledWith(
      2,
      '/audits(00000000-0000-4000-8000-000000000000)?$select=action%2Ccreatedon'
    );
  });
});

describe('OBO request context', () => {
  it('memoizes per-resource exchanges without mixing Graph and Dynamics tokens', async () => {
    const exchange = vi.fn(async (resource: 'graph' | 'dynamics') => `${resource}-token`);
    const context = createOboRequestContext('MCP_ASSERTION', exchange);
    const [graphA, graphB, dynamics] = await Promise.all([
      context.getAccessToken!('graph'),
      context.getAccessToken!('graph'),
      context.getAccessToken!('dynamics'),
    ]);

    expect(graphA).toBe('graph-token');
    expect(graphB).toBe('graph-token');
    expect(dynamics).toBe('dynamics-token');
    expect(context.userAssertion).toBe('MCP_ASSERTION');
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange).toHaveBeenCalledWith('graph');
    expect(exchange).toHaveBeenCalledWith('dynamics');
  });
});

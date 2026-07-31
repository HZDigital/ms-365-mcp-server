import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { registerGraphTools } from '../src/graph-tools.js';
import type { GraphClient } from '../src/graph-client.js';
import type { UtilityTool } from '../src/graph-tools.js';

function createMockServer() {
  const tools = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  return {
    tools,
    tool: vi.fn(
      (
        name: string,
        _description: string,
        _schema: unknown,
        _annotations: unknown,
        handler: (params: Record<string, unknown>) => Promise<unknown>
      ) => tools.set(name, handler)
    ),
    registerTool: vi.fn(),
  };
}

describe('manual Dynamics tool policy', () => {
  afterEach(() => {
    delete process.env.MS365_MCP_REQUIRE_CONFIRM;
  });

  it('applies confirmation and removes the confirmation marker before execution', async () => {
    process.env.MS365_MCP_REQUIRE_CONFIRM = 'true';
    const execute = vi.fn().mockResolvedValue({ content: [] });
    const dynamicsWrite: UtilityTool = {
      name: 'dynamics-test-write',
      method: 'POST',
      path: 'tool:dynamics-test-write',
      description: 'Test Dataverse write.',
      buildSchema: () => ({ value: z.string() }),
      execute,
      readOnlyHint: false,
      orgOnly: true,
      service: 'dynamics',
    };
    const server = createMockServer();

    registerGraphTools(
      server as never,
      {} as GraphClient,
      false,
      '^dynamics-test-write$',
      true,
      undefined,
      false,
      [],
      undefined,
      [dynamicsWrite]
    );

    const handler = server.tools.get('dynamics-test-write')!;
    await expect(handler({ value: 'record' })).resolves.toMatchObject({ isError: true });
    expect(execute).not.toHaveBeenCalled();

    await handler({ value: 'record', confirm: true });
    expect(execute).toHaveBeenCalledWith({ value: 'record' }, expect.any(Object));
  });
});

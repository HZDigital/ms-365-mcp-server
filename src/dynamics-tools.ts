import { z } from 'zod';
import DataverseClient from './dataverse-client.js';
import type { CallToolResult, UtilityTool } from './graph-tools.js';

const ENTITY_SET = /^[A-Za-z][A-Za-z0-9_]*$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const querySchema = {
  select: z.string().describe('Comma-separated Dataverse columns to return.').optional(),
  filter: z.string().describe('Dataverse OData $filter expression.').optional(),
  expand: z.string().describe('Dataverse OData $expand expression.').optional(),
  orderby: z.string().describe('Dataverse OData $orderby expression.').optional(),
  top: z.number().int().min(1).max(5000).describe('Maximum records to return (1-5000).').optional(),
};

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function entitySet(value: unknown): string {
  if (typeof value !== 'string' || !ENTITY_SET.test(value)) {
    throw new Error(
      'entity_set must be a Dataverse entity-set name containing only letters, numbers, and underscores.'
    );
  }
  return value;
}

function recordId(value: unknown): string {
  if (typeof value !== 'string' || !GUID.test(value)) {
    throw new Error(
      'id must be a Dataverse GUID. Alternate-key addressing is not supported by this tool.'
    );
  }
  return value;
}

function queryString(params: Record<string, unknown>): string {
  const values: Array<[string, string]> = [];
  for (const name of ['select', 'filter', 'expand', 'orderby', 'top']) {
    const value = params[name];
    if (value === undefined) continue;
    values.push([`$${name}`, String(value)]);
  }
  return values.length === 0
    ? ''
    : `?${values.map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('&')}`;
}

function recordPath(set: string, id?: string): string {
  return id === undefined ? `/${set}` : `/${set}(${id})`;
}

function coreBody(properties: Record<string, z.ZodTypeAny>, required: string[] = []): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, schema] of Object.entries(properties)) {
    shape[name] = required.includes(name) ? schema : schema.optional();
  }
  return z.object(shape).passthrough();
}

interface CoreEntity {
  name: string;
  plural: string;
  entitySet: string;
  createBody: z.ZodTypeAny;
  updateBody: z.ZodTypeAny;
}

const coreEntities: readonly CoreEntity[] = [
  {
    name: 'account',
    plural: 'accounts',
    entitySet: 'accounts',
    createBody: coreBody({ name: z.string().min(1).describe('Account name.') }, ['name']),
    updateBody: coreBody({ name: z.string().min(1).describe('Account name.') }),
  },
  {
    name: 'contact',
    plural: 'contacts',
    entitySet: 'contacts',
    createBody: coreBody(
      {
        firstname: z.string().describe('Given name.'),
        lastname: z.string().min(1).describe('Family name.'),
        emailaddress1: z.string().email().describe('Primary email address.'),
      },
      ['lastname']
    ),
    updateBody: coreBody({
      firstname: z.string().describe('Given name.'),
      lastname: z.string().min(1).describe('Family name.'),
      emailaddress1: z.string().email().describe('Primary email address.'),
    }),
  },
  {
    name: 'lead',
    plural: 'leads',
    entitySet: 'leads',
    createBody: coreBody(
      {
        firstname: z.string().describe('Given name.'),
        lastname: z.string().min(1).describe('Family name.'),
        subject: z.string().describe('Lead topic.'),
        emailaddress1: z.string().email().describe('Primary email address.'),
      },
      ['lastname']
    ),
    updateBody: coreBody({
      firstname: z.string().describe('Given name.'),
      lastname: z.string().min(1).describe('Family name.'),
      subject: z.string().describe('Lead topic.'),
      emailaddress1: z.string().email().describe('Primary email address.'),
    }),
  },
  {
    name: 'opportunity',
    plural: 'opportunities',
    entitySet: 'opportunities',
    createBody: coreBody({ name: z.string().min(1).describe('Opportunity name.') }, ['name']),
    updateBody: coreBody({ name: z.string().min(1).describe('Opportunity name.') }),
  },
];

function dynamicsTool(
  name: string,
  method: UtilityTool['method'],
  description: string,
  buildSchema: UtilityTool['buildSchema'],
  execute: UtilityTool['execute'],
  readOnlyHint = method === 'GET'
): UtilityTool {
  return {
    name,
    method,
    path: `dynamics:${name}`,
    description,
    searchKeywords: `dynamics dataverse crm ${name}`,
    service: 'dynamics',
    orgOnly: true,
    presets: ['dynamics'],
    readOnlyHint,
    openWorldHint: true,
    buildSchema,
    execute,
  };
}

export const DYNAMICS_TOOL_PRESETS = [
  'dynamics-list-tables',
  'dynamics-get-table-metadata',
  'dynamics-query-records',
  'dynamics-get-record',
  'dynamics-get-next-page',
  'dynamics-create-record',
  'dynamics-update-record',
  'dynamics-delete-record',
  ...coreEntities.flatMap((entity) => [
    `dynamics-list-${entity.plural}`,
    `dynamics-get-${entity.name}`,
    `dynamics-create-${entity.name}`,
    `dynamics-update-${entity.name}`,
    `dynamics-delete-${entity.name}`,
  ]),
  'dynamics-list-activities',
  'dynamics-get-activity',
  'dynamics-list-audits',
  'dynamics-get-audit',
  'dynamics-create-task',
  'dynamics-create-phonecall',
  'dynamics-create-appointment',
] as const;

export function createDynamicsTools(client: DataverseClient): readonly UtilityTool[] {
  const tools: UtilityTool[] = [
    dynamicsTool(
      'dynamics-list-tables',
      'GET',
      'List Dataverse tables and entity-set names available in the configured Dynamics organization.',
      () => ({ ...querySchema }),
      async (params) =>
        textResult(
          await client.request(
            `/EntityDefinitions${queryString({
              select: params.select ?? 'LogicalName,EntitySetName,DisplayName',
              filter: params.filter,
              expand: params.expand,
              orderby: params.orderby,
              top: params.top,
            })}`
          )
        )
    ),
    dynamicsTool(
      'dynamics-get-table-metadata',
      'GET',
      'Get Dataverse metadata and column definitions for one logical table name.',
      () => ({
        logical_name: z.string().regex(ENTITY_SET).describe('Dataverse logical table name.'),
      }),
      async (params) => {
        const logicalName = entitySet(params.logical_name);
        return textResult(
          await client.request(
            `/EntityDefinitions(LogicalName='${logicalName}')?$expand=Attributes($select=LogicalName,DisplayName,AttributeType,IsValidForCreate,IsValidForUpdate)`
          )
        );
      }
    ),
    dynamicsTool(
      'dynamics-query-records',
      'GET',
      'Query records from any configured Dataverse entity set with constrained OData options.',
      () => ({
        entity_set: z
          .string()
          .regex(ENTITY_SET)
          .describe('Dataverse entity-set name, e.g. accounts or new_customentities.'),
        ...querySchema,
      }),
      async (params) => {
        const set = entitySet(params.entity_set);
        return textResult(
          await client.request(recordPath(set) + queryString(params as Record<string, unknown>))
        );
      }
    ),
    dynamicsTool(
      'dynamics-get-record',
      'GET',
      'Get one Dataverse record by entity-set name and GUID.',
      () => ({
        entity_set: z.string().regex(ENTITY_SET).describe('Dataverse entity-set name.'),
        id: z.string().regex(GUID).describe('Dataverse record GUID.'),
        ...querySchema,
      }),
      async (params) => {
        const set = entitySet(params.entity_set);
        return textResult(
          await client.request(
            recordPath(set, recordId(params.id)) + queryString(params as Record<string, unknown>)
          )
        );
      }
    ),
    dynamicsTool(
      'dynamics-get-next-page',
      'GET',
      'Follow a Dataverse @odata.nextLink returned by a previous Dynamics tool. The link must remain within the configured organization.',
      () => ({
        next_link: z
          .string()
          .url()
          .describe('Exact @odata.nextLink from a previous Dynamics response.'),
      }),
      async (params) => textResult(await client.requestNextLink(String(params.next_link)))
    ),
    dynamicsTool(
      'dynamics-create-record',
      'POST',
      'Create a record in any configured Dataverse entity set. Record fields are organization-specific.',
      () => ({
        entity_set: z.string().regex(ENTITY_SET).describe('Dataverse entity-set name.'),
        body: z
          .record(z.unknown())
          .describe('Dataverse record payload, including custom columns and lookup bindings.'),
      }),
      async (params) =>
        textResult(
          await client.request(recordPath(entitySet(params.entity_set)), {
            method: 'POST',
            body: params.body as Record<string, unknown>,
            preferRepresentation: true,
          })
        ),
      false
    ),
    dynamicsTool(
      'dynamics-update-record',
      'PATCH',
      'Update a Dataverse record by entity set and GUID. Record fields are organization-specific.',
      () => ({
        entity_set: z.string().regex(ENTITY_SET).describe('Dataverse entity-set name.'),
        id: z.string().regex(GUID).describe('Dataverse record GUID.'),
        body: z.record(z.unknown()).describe('Partial Dataverse record payload.'),
      }),
      async (params) =>
        textResult(
          await client.request(recordPath(entitySet(params.entity_set), recordId(params.id)), {
            method: 'PATCH',
            body: params.body as Record<string, unknown>,
            preferRepresentation: true,
          })
        ),
      false
    ),
    dynamicsTool(
      'dynamics-delete-record',
      'DELETE',
      'Delete a Dataverse record by entity set and GUID.',
      () => ({
        entity_set: z.string().regex(ENTITY_SET).describe('Dataverse entity-set name.'),
        id: z.string().regex(GUID).describe('Dataverse record GUID.'),
      }),
      async (params) =>
        textResult(
          await client.request(recordPath(entitySet(params.entity_set), recordId(params.id)), {
            method: 'DELETE',
          })
        ),
      false
    ),
  ];

  for (const entity of coreEntities) {
    tools.push(
      dynamicsTool(
        `dynamics-list-${entity.plural}`,
        'GET',
        `List Dynamics ${entity.plural} from the configured organization.`,
        () => ({ ...querySchema }),
        async (params) =>
          textResult(await client.request(`/${entity.entitySet}${queryString(params)}`))
      ),
      dynamicsTool(
        `dynamics-get-${entity.name}`,
        'GET',
        `Get one Dynamics ${entity.name} by GUID.`,
        () => ({
          id: z.string().regex(GUID).describe(`Dynamics ${entity.name} GUID.`),
          ...querySchema,
        }),
        async (params) =>
          textResult(
            await client.request(
              `${recordPath(entity.entitySet, recordId(params.id))}${queryString(params)}`
            )
          )
      ),
      dynamicsTool(
        `dynamics-create-${entity.name}`,
        'POST',
        `Create a Dynamics ${entity.name}. Standard fields are shown; custom columns are accepted.`,
        () => ({ body: entity.createBody }),
        async (params) =>
          textResult(
            await client.request(recordPath(entity.entitySet), {
              method: 'POST',
              body: params.body as Record<string, unknown>,
              preferRepresentation: true,
            })
          ),
        false
      ),
      dynamicsTool(
        `dynamics-update-${entity.name}`,
        'PATCH',
        `Update a Dynamics ${entity.name}. Standard fields are shown; custom columns are accepted.`,
        () => ({
          id: z.string().regex(GUID).describe(`Dynamics ${entity.name} GUID.`),
          body: entity.updateBody,
        }),
        async (params) =>
          textResult(
            await client.request(recordPath(entity.entitySet, recordId(params.id)), {
              method: 'PATCH',
              body: params.body as Record<string, unknown>,
              preferRepresentation: true,
            })
          ),
        false
      ),
      dynamicsTool(
        `dynamics-delete-${entity.name}`,
        'DELETE',
        `Delete a Dynamics ${entity.name} by GUID.`,
        () => ({ id: z.string().regex(GUID).describe(`Dynamics ${entity.name} GUID.`) }),
        async (params) =>
          textResult(
            await client.request(recordPath(entity.entitySet, recordId(params.id)), {
              method: 'DELETE',
            })
          ),
        false
      )
    );
  }

  tools.push(
    dynamicsTool(
      'dynamics-list-activities',
      'GET',
      'List polymorphic Dynamics activities using the read-oriented activitypointer table.',
      () => ({ ...querySchema }),
      async (params) => textResult(await client.request(`/activitypointers${queryString(params)}`))
    ),
    dynamicsTool(
      'dynamics-get-activity',
      'GET',
      'Get a Dynamics activity by GUID from the activitypointer table.',
      () => ({ id: z.string().regex(GUID).describe('Dynamics activity GUID.'), ...querySchema }),
      async (params) =>
        textResult(
          await client.request(
            `${recordPath('activitypointers', recordId(params.id))}${queryString(params)}`
          )
        )
    ),
    dynamicsTool(
      'dynamics-list-audits',
      'GET',
      "List Dataverse audit records. Audit access is governed by the caller's Dynamics security role and organization audit settings.",
      () => ({ ...querySchema }),
      async (params) => textResult(await client.request(`/audits${queryString(params)}`))
    ),
    dynamicsTool(
      'dynamics-get-audit',
      'GET',
      "Get one Dataverse audit record by GUID. Audit access is governed by the caller's Dynamics security role and organization audit settings.",
      () => ({
        id: z.string().regex(GUID).describe('Dynamics audit record GUID.'),
        ...querySchema,
      }),
      async (params) =>
        textResult(
          await client.request(`${recordPath('audits', recordId(params.id))}${queryString(params)}`)
        )
    )
  );

  for (const activity of [
    { name: 'task', entitySet: 'tasks' },
    { name: 'phonecall', entitySet: 'phonecalls' },
    { name: 'appointment', entitySet: 'appointments' },
  ]) {
    tools.push(
      dynamicsTool(
        `dynamics-create-${activity.name}`,
        'POST',
        `Create a concrete Dynamics ${activity.name} activity. Abstract activities cannot be created directly.`,
        () => ({
          body: z
            .object({ subject: z.string().min(1).describe('Activity subject.') })
            .passthrough()
            .describe(
              'Dataverse activity payload. Add scheduled times, parties, and custom columns as needed.'
            ),
        }),
        async (params) =>
          textResult(
            await client.request(`/${activity.entitySet}`, {
              method: 'POST',
              body: params.body as Record<string, unknown>,
              preferRepresentation: true,
            })
          ),
        false
      )
    );
  }

  return tools;
}

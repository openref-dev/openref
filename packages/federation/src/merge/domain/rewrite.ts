import type {
  IRChannel,
  IRChannelOperation,
  IRDriftIssue,
  IRErrorContract,
  IRErrorContracts,
  IREncoding,
  IRHeader,
  IRJsonSchema,
  IRMediaType,
  IRMessage,
  IRNode,
  IRNodeRuntime,
  IROperation,
  IRRequestBody,
  IRResponse,
  IRSchema,
  IRSchemaSlot,
  IRSecurityRequirement,
  IRServer,
} from '@openref/core';

/**
 * Moving every reference in a value from the names one service used to the names the merge gave.
 *
 * IT IS FIELD BY FIELD RATHER THAN A WALK OVER SHAPES, and the choice is deliberate. A generic
 * walker that rewrote every property called `$ref` would also rewrite one inside `extensions`,
 * which is vendor data this project promises to carry verbatim, and one inside `raw`, which is
 * the source of a schema whose dialect the pipeline does not understand. Naming the fields costs
 * a longer file and gains the property that nothing is rewritten by accident.
 *
 * WHAT KEEPS IT HONEST IS NOT THIS FILE. A field added to the IR and forgotten here would carry
 * a stale id silently, so `references.ts` walks the merged document afterwards and reports every
 * reference that resolves to nothing. That check runs inside the merge, on every merge.
 *
 * RECURSION IS BOUNDED BY THE SOURCE DOCUMENT ALREADY HAVING BEEN HASHED. A document carrying a
 * hash went through `canonicalize`, which refuses a value deeper than `CANONICAL_MAX_DEPTH`, so
 * a schema this file walks has a depth a stack holds.
 */

/** The same shape, writable while it is being built. */
type Draft<T> = { -readonly [Key in keyof T]: T[Key] };

/** How one service's names map onto the merged document's names. */
export interface RewriteMaps {
  /** Source node id to merged node id, covering nodes and webhooks alike. */
  readonly nodeIds: ReadonlyMap<string, string>;
  /** Source schema id to merged schema id. */
  readonly schemaIds: ReadonlyMap<string, string>;
  /** Source security scheme id to merged security scheme id. */
  readonly schemeIds: ReadonlyMap<string, string>;
}

/**
 * Replaces every schema reference inside a normalized schema through a mapping function.
 *
 * ONE WALK FOR TWO CALLERS, and they ask different questions of it. The merge asks for the
 * merged id of a target; schema identity asks for the signature of a target, so that two schemas
 * are the same only when what they point at is the same. Both are "replace the target of every
 * `$ref` and `$cycle`", and a second copy of this walk is a second place to forget `prefixItems`.
 *
 * @param schema - Normalized schema to rewrite
 * @param map - Called with the target of each reference, returns what to put in its place
 * @returns A new schema; the input is not written to
 */
export function mapSchemaReferences(
  schema: IRJsonSchema,
  map: (target: string) => string,
): IRJsonSchema {
  const draft: Draft<IRJsonSchema> = { ...schema };

  if (schema.$ref !== undefined) draft.$ref = map(schema.$ref);
  if (schema.$cycle !== undefined) draft.$cycle = map(schema.$cycle);

  if (schema.properties !== undefined) draft.properties = mapSchemaRecord(schema.properties, map);
  if (schema.patternProperties !== undefined) {
    draft.patternProperties = mapSchemaRecord(schema.patternProperties, map);
  }
  if (schema.propertyNames !== undefined) {
    draft.propertyNames = mapSchemaReferences(schema.propertyNames, map);
  }
  if (typeof schema.additionalProperties === 'object') {
    draft.additionalProperties = mapSchemaReferences(schema.additionalProperties, map);
  }

  if (schema.if !== undefined) draft.if = mapSchemaReferences(schema.if, map);
  if (schema.then !== undefined) draft.then = mapSchemaReferences(schema.then, map);
  if (schema.else !== undefined) draft.else = mapSchemaReferences(schema.else, map);

  if (schema.items !== undefined) draft.items = mapSchemaReferences(schema.items, map);
  if (schema.prefixItems !== undefined) {
    draft.prefixItems = schema.prefixItems.map((entry) => mapSchemaReferences(entry, map));
  }

  if (schema.allOf !== undefined) {
    draft.allOf = schema.allOf.map((entry) => mapSchemaReferences(entry, map));
  }
  if (schema.oneOf !== undefined) {
    draft.oneOf = schema.oneOf.map((entry) => mapSchemaReferences(entry, map));
  }
  if (schema.anyOf !== undefined) {
    draft.anyOf = schema.anyOf.map((entry) => mapSchemaReferences(entry, map));
  }
  if (schema.not !== undefined) draft.not = mapSchemaReferences(schema.not, map);

  if (schema.variants !== undefined) {
    draft.variants = schema.variants.map((variant) => ({
      ...variant,
      schema: mapSchemaReferences(variant.schema, map),
    }));
  }

  return draft;
}

/**
 * Rewrites a named schema into its merged identity.
 *
 * `discriminator.mapping` IS LEFT EXACTLY AS THE DOCUMENT WROTE IT. Its values are the source
 * document's own reference strings, such as `#/components/schemas/Cat`, which the normalizer
 * carries verbatim and no consumer resolves against `document.schemas`. Rewriting them would
 * turn a true statement about the source into a false one about the merge.
 *
 * @param schema - Schema as its own service wrote it
 * @param id - Id it has in the merged document
 * @param maps - How this service's names map onto the merged ones
 * @returns The merged schema
 */
export function rewriteSchema(schema: IRSchema, id: string, maps: RewriteMaps): IRSchema {
  const draft: Draft<IRSchema> = { ...schema, id };

  if (schema.normalized !== undefined) {
    draft.normalized = mapSchemaReferences(schema.normalized, (target) =>
      resolveSchemaId(target, maps),
    );
  }

  return draft;
}

/**
 * Rewrites one node into its merged identity.
 *
 * @param node - Node as its own service wrote it
 * @param identity - The merged node id, the merged address, and the service it belongs to
 * @param maps - How this service's names map onto the merged ones
 * @returns The merged node
 */
export function rewriteNode(node: IRNode, identity: NodeIdentity, maps: RewriteMaps): IRNode {
  return node.kind === 'operation'
    ? rewriteOperation(node, identity, maps)
    : rewriteChannel(node, identity, maps);
}

/** Where one node ends up: its id, its address, and whose it is. */
export interface NodeIdentity {
  readonly id: string;
  /** Merged path for an operation, merged address for a channel. Absent leaves the address alone. */
  readonly address?: string;
  readonly serviceId: string;
}

/**
 * Rewrites an HTTP operation.
 *
 * `tags` ARE NOT NAMESPACED. A service is a parent tag in the navigation of SPEC 15, which is a
 * second axis over the tags a service already declared, not a replacement for them. Two services
 * that both tag an endpoint `orders` have both said something true, and rewriting either one to
 * `billing_orders` would put a name in the reference that no document and no reader ever used.
 */
function rewriteOperation(
  operation: IROperation,
  identity: NodeIdentity,
  maps: RewriteMaps,
): IROperation {
  const draft: Draft<IROperation> = {
    ...operation,
    id: identity.id,
    serviceId: identity.serviceId,
    parameters: operation.parameters.map((parameter) =>
      parameter.schema === undefined
        ? parameter
        : { ...parameter, schema: rewriteSlot(parameter.schema, maps) },
    ),
    responses: operation.responses.map((response) => rewriteResponse(response, maps)),
    security: operation.security.map((requirement) => rewriteRequirement(requirement, maps)),
  };

  if (identity.address !== undefined) draft.path = identity.address;
  if (operation.requestBody !== undefined) {
    draft.requestBody = rewriteRequestBody(operation.requestBody, maps);
  }
  if (operation.callbacks !== undefined) {
    draft.callbacks = Object.fromEntries(
      Object.entries(operation.callbacks).map(([name, ids]) => [
        name,
        ids.map((id) => resolveNodeId(id, maps)),
      ]),
    );
  }
  if (operation.runtime !== undefined) draft.runtime = rewriteRuntime(operation.runtime, maps);

  return draft;
}

/** Rewrites an event channel. */
function rewriteChannel(channel: IRChannel, identity: NodeIdentity, maps: RewriteMaps): IRChannel {
  const draft: Draft<IRChannel> = {
    ...channel,
    id: identity.id,
    serviceId: identity.serviceId,
    operations: channel.operations.map((operation) => rewriteChannelOperation(operation, maps)),
    messages: channel.messages.map((message) => rewriteMessage(message, maps)),
  };

  if (identity.address !== undefined) draft.address = identity.address;
  if (channel.runtime !== undefined) draft.runtime = rewriteRuntime(channel.runtime, maps);

  return draft;
}

/**
 * Rewrites a channel operation.
 *
 * `messageIds` ARE NOT REWRITTEN, and the IR says why: they refer into the channel's own message
 * list, which travels with the channel, so they are local names rather than document ones.
 *
 * `security` IS REWRITTEN, SINCE `T051`, AND IT NAMES THE DOCUMENT RATHER THAN THE CHANNEL. Each
 * requirement carries a scheme id out of `IRDocument.security`, which the merge renames whenever
 * two services claim one name, so leaving it alone would point a channel page at a scheme the
 * merged document does not hold. The reference walk of `references.ts` reads `schemeId` and would
 * refuse the merge, which is that walk doing its job rather than a reason to skip this.
 */
function rewriteChannelOperation(
  operation: IRChannelOperation,
  maps: RewriteMaps,
): IRChannelOperation {
  const draft: Draft<IRChannelOperation> = { ...operation };

  if (operation.runtime !== undefined) draft.runtime = rewriteRuntime(operation.runtime, maps);
  if (operation.security !== undefined) {
    draft.security = operation.security.map((requirement) => rewriteRequirement(requirement, maps));
  }

  return draft;
}

/**
 * Rewrites the security a server declares, per SPEC 8.2, onto the merged scheme ids.
 *
 * A SERVER TRAVELS WHOLE ONTO `IRService.servers` AND ITS SCHEME IDS DO NOT. The merged document's
 * own `servers` come from the caller and carry no security, so this is only ever about the per
 * service record, which is exactly where a stale scheme id would sit unnoticed: nothing draws it
 * yet, and the reference walk is the only thing that reads it today.
 *
 * @param servers - The servers a source document declared
 * @param maps - How this service's names map onto the merged ones
 * @returns The same servers, addressing the merged scheme table
 */
export function rewriteServers(
  servers: readonly IRServer[],
  maps: RewriteMaps,
): readonly IRServer[] {
  return servers.map((server) =>
    server.security === undefined
      ? server
      : {
          ...server,
          security: server.security.map((requirement) => rewriteRequirement(requirement, maps)),
        },
  );
}

/** Rewrites a message payload and headers. */
function rewriteMessage(message: IRMessage, maps: RewriteMaps): IRMessage {
  const draft: Draft<IRMessage> = { ...message };

  if (message.payload !== undefined) draft.payload = rewriteSlot(message.payload, maps);
  if (message.headers !== undefined) draft.headers = rewriteSlot(message.headers, maps);

  return draft;
}

/** Rewrites a request body and every media type under it. */
function rewriteRequestBody(body: IRRequestBody, maps: RewriteMaps): IRRequestBody {
  return { ...body, content: body.content.map((media) => rewriteMediaType(media, maps)) };
}

/** Rewrites a response, its headers, its content and its 3.2 item schema. */
function rewriteResponse(response: IRResponse, maps: RewriteMaps): IRResponse {
  const draft: Draft<IRResponse> = {
    ...response,
    content: response.content.map((media) => rewriteMediaType(media, maps)),
  };

  if (response.headers !== undefined) {
    draft.headers = response.headers.map((header) => rewriteHeader(header, maps));
  }
  if (response.itemSchema !== undefined) {
    draft.itemSchema = rewriteSlot(response.itemSchema, maps);
  }

  return draft;
}

/** Rewrites one media type, including the per property encoding headers. */
function rewriteMediaType(media: IRMediaType, maps: RewriteMaps): IRMediaType {
  const draft: Draft<IRMediaType> = { ...media };

  if (media.schema !== undefined) draft.schema = rewriteSlot(media.schema, maps);
  if (media.encoding !== undefined) {
    draft.encoding = Object.fromEntries(
      Object.entries(media.encoding).map(([name, encoding]) => [
        name,
        rewriteEncoding(encoding, maps),
      ]),
    );
  }

  return draft;
}

/** Rewrites the headers a multipart encoding declares. */
function rewriteEncoding(encoding: IREncoding, maps: RewriteMaps): IREncoding {
  if (encoding.headers === undefined) return encoding;
  return { ...encoding, headers: encoding.headers.map((header) => rewriteHeader(header, maps)) };
}

/** Rewrites one header's schema. */
function rewriteHeader(header: IRHeader, maps: RewriteMaps): IRHeader {
  if (header.schema === undefined) return header;
  return { ...header, schema: rewriteSlot(header.schema, maps) };
}

/** Rewrites one security requirement onto the merged scheme id. */
function rewriteRequirement(
  requirement: IRSecurityRequirement,
  maps: RewriteMaps,
): IRSecurityRequirement {
  const schemeId = maps.schemeIds.get(requirement.schemeId);
  if (schemeId === undefined || schemeId === requirement.schemeId) return requirement;
  return { ...requirement, schemeId };
}

/**
 * Rewrites the runtime facts of one node.
 *
 * @param runtime - Runtime facts as the service's collectors produced them
 * @param maps - How this service's names map onto the merged ones
 * @returns The merged runtime facts
 */
export function rewriteRuntime(runtime: IRNodeRuntime, maps: RewriteMaps): IRNodeRuntime {
  const draft: Draft<IRNodeRuntime> = { ...runtime };

  if (runtime.errors !== undefined) draft.errors = rewriteErrorContracts(runtime.errors, maps);

  if (runtime.streaming?.value.itemSchema !== undefined) {
    draft.streaming = {
      ...runtime.streaming,
      value: {
        ...runtime.streaming.value,
        itemSchema: rewriteSlot(runtime.streaming.value.itemSchema, maps),
      },
    };
  }

  if (runtime.drift !== undefined) {
    draft.drift = runtime.drift.map((issue) => rewriteDriftIssue(issue, maps));
  }

  return draft;
}

/** Rewrites the three groups of error contracts. */
function rewriteErrorContracts(contracts: IRErrorContracts, maps: RewriteMaps): IRErrorContracts {
  return {
    declared: contracts.declared.map((contract) => rewriteErrorContract(contract, maps)),
    runtimeDerived: contracts.runtimeDerived.map((contract) =>
      rewriteErrorContract(contract, maps),
    ),
    global: contracts.global.map((contract) => rewriteErrorContract(contract, maps)),
  };
}

/** Rewrites the schema an error contract points at. */
function rewriteErrorContract(contract: IRErrorContract, maps: RewriteMaps): IRErrorContract {
  if (contract.schema === undefined) return contract;
  return { ...contract, schema: rewriteSlot(contract.schema, maps) };
}

/**
 * Rewrites the subject of one drift finding.
 *
 * @param issue - Finding as the service's drift engine recorded it
 * @param maps - How this service's names map onto the merged ones
 * @returns The finding, addressing the merged document
 */
export function rewriteDriftIssue(issue: IRDriftIssue, maps: RewriteMaps): IRDriftIssue {
  const draft: Draft<IRDriftIssue> = { ...issue };

  if (issue.nodeId !== undefined) draft.nodeId = resolveNodeId(issue.nodeId, maps);
  if (issue.schemaId !== undefined) draft.schemaId = resolveSchemaId(issue.schemaId, maps);

  return draft;
}

/**
 * Rewrites a schema slot, which is a named reference or an inline schema.
 *
 * @param slot - Slot as the service wrote it
 * @param maps - How this service's names map onto the merged ones
 * @returns The merged slot
 */
export function rewriteSlot(slot: IRSchemaSlot, maps: RewriteMaps): IRSchemaSlot {
  if (slot.kind === 'named') {
    const schemaId = resolveSchemaId(slot.schemaId, maps);
    return schemaId === slot.schemaId ? slot : { kind: 'named', schemaId };
  }

  return { kind: 'inline', schema: rewriteSchema(slot.schema, slot.schema.id, maps) };
}

/**
 * The merged id of a schema, or the source id when the merge did not move it.
 *
 * A TARGET THE MAP DOES NOT KNOW IS LEFT ALONE RATHER THAN DROPPED. A reference to a schema that
 * the source document never registered is already broken, and inventing a merged id for it would
 * hide that from `unresolvedReferences`, which is the check that reports it.
 */
function resolveSchemaId(target: string, maps: RewriteMaps): string {
  return maps.schemaIds.get(target) ?? target;
}

/** The merged id of a node, or the source id when the merge did not move it, for the same reason. */
function resolveNodeId(target: string, maps: RewriteMaps): string {
  return maps.nodeIds.get(target) ?? target;
}

/** Rewrites a record of schemas, keeping the keys as the document wrote them. */
function mapSchemaRecord(
  record: Readonly<Record<string, IRJsonSchema>>,
  map: (target: string) => string,
): Record<string, IRJsonSchema> {
  return Object.fromEntries(
    Object.entries(record).map(([name, schema]) => [name, mapSchemaReferences(schema, map)]),
  );
}

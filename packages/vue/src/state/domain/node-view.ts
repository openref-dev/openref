import type {
  IRChannel,
  IRChannelOperation,
  IRDocument,
  IRMessage,
  IRNode,
  IROperation,
  IRParameter,
  IRParameterLocation,
  IRResponse,
  IRSchema,
  IRSchemaSlot,
  IRSecurityScheme,
} from '@openref/core';

/**
 * Materialized view of a node: the derived shape a theme renders, computed once per node.
 *
 * The IR carries every node, but deriving a view of one is not free, and a large document has
 * six hundred of them. Materialization is therefore per node and on demand, and the result is
 * cached in the document state. Nothing is derived for a node nobody opens.
 */

/** Order parameters are grouped in, which is the order a reference shows them. */
export const PARAMETER_LOCATIONS: readonly IRParameterLocation[] = [
  'path',
  'query',
  'header',
  'cookie',
];

/**
 * Parameters in the order a reference shows them: grouped by location, document order within.
 *
 * ONE ORDER, NAMED ONCE, BECAUSE TWO SURFACES SHOW THE SAME LIST. The parameter table renders
 * `OperationView.parameters`, which this constant groups; the try-it console renders
 * `RunnerOperationView.parameters`, which used to be the document's own order. On the demo the
 * table read `... perPage, page, sort, createdBefore, createdAfter, X-Request-Id` and the form
 * under it read `... maxAmount, X-Request-Id, perPage, page, ...`, so the one header parameter
 * sat in the middle of the query ones and a reader filling the form after reading the table had
 * to find every field twice.
 *
 * THE ORDER THE AUTHOR WROTE SURVIVES INSIDE A LOCATION, which is the half of this that is not
 * a preference. Grouping moves a parameter only past parameters that are somewhere else, so the
 * query string the runner builds is unchanged.
 *
 * @param parameters - Parameters as the node carries them
 * @returns The same parameters, grouped
 */
export function orderedParameters(parameters: readonly IRParameter[]): readonly IRParameter[] {
  return PARAMETER_LOCATIONS.flatMap((location) =>
    parameters.filter((parameter) => parameter.in === location),
  );
}

/** A security requirement with its scheme already looked up. */
export interface ResolvedSecurityRequirement {
  readonly schemeId: string;
  /** The scheme itself, absent when the document requires one it never declared. */
  readonly scheme?: IRSecurityScheme;
  readonly scopes: readonly string[];
}

/** Materialized HTTP operation. */
export interface OperationView {
  readonly kind: 'operation';
  readonly id: string;
  readonly node: IROperation;
  readonly title: string;
  readonly deprecated: boolean;
  /** Parameters grouped by location, in {@link PARAMETER_LOCATIONS} order, empty groups dropped. */
  readonly parameters: ReadonlyMap<IRParameterLocation, readonly IRParameter[]>;
  readonly responses: readonly IRResponse[];
  readonly security: readonly ResolvedSecurityRequirement[];
  /** Every schema slot the operation uses, so a viewer can open one without walking the node. */
  readonly schemaSlots: readonly IRSchemaSlot[];
}

/** Materialized event channel. */
export interface ChannelView {
  readonly kind: 'channel';
  readonly id: string;
  readonly node: IRChannel;
  readonly title: string;
  readonly deprecated: boolean;
  readonly operations: readonly IRChannelOperation[];
  readonly messages: readonly IRMessage[];
  readonly schemaSlots: readonly IRSchemaSlot[];
}

/** Materialized node, discriminated the same way {@link IRNode} is. */
export type NodeView = OperationView | ChannelView;

function slotsOfOperation(operation: IROperation): IRSchemaSlot[] {
  const slots: IRSchemaSlot[] = [];

  for (const parameter of operation.parameters) {
    if (parameter.schema !== undefined) slots.push(parameter.schema);
  }
  for (const media of operation.requestBody?.content ?? []) {
    if (media.schema !== undefined) slots.push(media.schema);
  }
  for (const response of operation.responses) {
    for (const header of response.headers ?? []) {
      if (header.schema !== undefined) slots.push(header.schema);
    }
    for (const media of response.content) {
      if (media.schema !== undefined) slots.push(media.schema);
    }
    if (response.itemSchema !== undefined) slots.push(response.itemSchema);
  }

  return slots;
}

function slotsOfChannel(channel: IRChannel): IRSchemaSlot[] {
  const slots: IRSchemaSlot[] = [];

  for (const message of channel.messages) {
    if (message.payload !== undefined) slots.push(message.payload);
    if (message.headers !== undefined) slots.push(message.headers);
  }

  return slots;
}

function operationTitle(operation: IROperation): string {
  return operation.summary ?? `${operation.method.toUpperCase()} ${operation.path}`;
}

function channelTitle(channel: IRChannel): string {
  return channel.title ?? channel.address ?? channel.id;
}

/**
 * Derives the view of one node.
 *
 * @param node - The node as it sits in the IR
 * @param document - The document it belongs to, for resolving security schemes
 * @returns The materialized view
 *
 * @example
 * const view = materializeNode(document.nodes.get('get-orders')!, document);
 */
export function materializeNode(node: IRNode, document: IRDocument): NodeView {
  if (node.kind === 'channel') {
    return {
      kind: 'channel',
      id: node.id,
      node,
      title: channelTitle(node),
      deprecated: node.deprecated,
      operations: node.operations,
      messages: node.messages,
      schemaSlots: slotsOfChannel(node),
    };
  }

  const schemes = new Map(document.security.map((scheme) => [scheme.id, scheme]));
  const parameters = new Map<IRParameterLocation, IRParameter[]>();
  for (const location of PARAMETER_LOCATIONS) {
    const group = node.parameters.filter((parameter) => parameter.in === location);
    if (group.length > 0) parameters.set(location, group);
  }

  return {
    kind: 'operation',
    id: node.id,
    node,
    title: operationTitle(node),
    deprecated: node.deprecated,
    parameters,
    responses: node.responses,
    security: node.security.map((requirement) => {
      const scheme = schemes.get(requirement.schemeId);
      return {
        schemeId: requirement.schemeId,
        ...(scheme === undefined ? {} : { scheme }),
        scopes: requirement.scopes,
      };
    }),
    schemaSlots: slotsOfOperation(node),
  };
}

/** Resolve a use site slot to the schema behind it, whether it names one or carries one. */
export function resolveSchemaSlot(
  slot: IRSchemaSlot,
  schemas: ReadonlyMap<string, IRSchema>,
): IRSchema | undefined {
  return slot.kind === 'named' ? schemas.get(slot.schemaId) : slot.schema;
}

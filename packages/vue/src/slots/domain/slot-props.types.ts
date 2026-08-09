import type {
  IRDocument,
  IRHealthReport,
  IRNavNode,
  IRParameter,
  IRParameterLocation,
  IRRequestBody,
  IRResponse,
  IRSchemaView,
} from '@openref/core';
import type { SearchHit } from '../../state/application/ports/search.port';
import type {
  ChannelView,
  OperationView,
  ResolvedSecurityRequirement,
} from '../../state/domain/node-view';
import type { SchemaTreeNode } from '../../state/domain/schema-expansion';

/**
 * The fixed slot registry, per SPEC 10.4.
 *
 * These props are public API. A theme written against them keeps working until a major
 * version, which is the whole point of the L1 level: replace a piece of markup without
 * forking the reference. `slot-contract.spec.ts` pins every entry at the type level, so
 * changing one fails compilation rather than silently breaking a theme downstream.
 *
 * The set is fixed rather than open on purpose. An open set of slots is an open contract, and
 * an open contract cannot be frozen.
 */
export interface SlotPropsMap {
  /** The whole page, replaced by an L2 theme. */
  layout: { document: IRDocument; activeNodeId: string | undefined };

  sidebar: { navigation: readonly IRNavNode[]; activeNodeId: string | undefined };
  'sidebar.item': { item: IRNavNode; depth: number; active: boolean };

  'search.box': { query: string; available: boolean };
  'search.results': { hits: readonly SearchHit[]; query: string };

  operation: { operation: OperationView };
  'operation.header': { operation: OperationView };
  'operation.parameters': {
    operation: OperationView;
    parameters: ReadonlyMap<IRParameterLocation, readonly IRParameter[]>;
  };
  'operation.request-body': { operation: OperationView; requestBody: IRRequestBody | undefined };
  'operation.responses': { operation: OperationView; responses: readonly IRResponse[] };
  'operation.security': {
    operation: OperationView;
    security: readonly ResolvedSecurityRequirement[];
  };

  /** Event channels arrive in M5. The slot exists from M0 because the registry is fixed. */
  channel: { channel: ChannelView };

  schema: { root: SchemaTreeNode; view: IRSchemaView };
  'schema.row': { node: SchemaTreeNode; expanded: boolean; depth: number };

  'try-it': { operation: OperationView; available: boolean };
  health: { report: IRHealthReport | undefined };
  footer: { document: IRDocument };
}

/** Name of a slot a theme may override. */
export type SlotName = keyof SlotPropsMap;

/** Props a given slot receives. */
export type SlotProps<TName extends SlotName> = SlotPropsMap[TName];

/**
 * Every slot name, in the order a reference renders them.
 *
 * Declared as a tuple rather than derived from the type, because a runtime list is needed to
 * validate a theme, and a derived list would have no order. `SLOT_NAMES_ARE_COMPLETE` below
 * makes the two disagree at compile time rather than at runtime.
 */
export const SLOT_NAMES = [
  'layout',
  'sidebar',
  'sidebar.item',
  'search.box',
  'search.results',
  'operation',
  'operation.header',
  'operation.parameters',
  'operation.request-body',
  'operation.responses',
  'operation.security',
  'channel',
  'schema',
  'schema.row',
  'try-it',
  'health',
  'footer',
] as const satisfies readonly SlotName[];

/**
 * Compile time proof that {@link SLOT_NAMES} lists every key of {@link SlotPropsMap}.
 *
 * `satisfies` above catches a name that is not a slot. This catches a slot that is not named,
 * which is the direction that would otherwise ship a slot no theme can reach.
 */
export type SLOT_NAMES_ARE_COMPLETE = SlotName extends (typeof SLOT_NAMES)[number] ? true : never;

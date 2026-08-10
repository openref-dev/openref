import type {
  IRConfidence,
  IRDocument,
  IRDriftIssue,
  IRDriftRule,
  IRErrorContract,
  IRHealthReport,
  IRNavNode,
  IRNodeRuntime,
  IRParameter,
  IRParameterLocation,
  IRRequestBody,
  IRResponse,
  IRRuntimeMeta,
  IRSchemaView,
  IRServer,
} from '@openref/core';
import type { SearchHit } from '../../state/application/ports/search.port';
import type { OperationView, ResolvedSecurityRequirement } from '../../state/domain/node-view';
import type { SchemaTreeNode } from '../../state/domain/schema-expansion';
import type {
  CodeSampleView,
  ColorScheme,
  ColorSchemePreference,
  StateNoticeKind,
} from './slot-value.types';

/**
 * The fixed slot registry, per SPEC 10.4 and `ai-docs/design/CONTRACT.md`.
 *
 * These props are public API. A theme written against them keeps working until a major
 * version, which is the whole point of the L1 level: replace a piece of markup without
 * forking the reference. `slot-contract.spec.ts` pins every entry at the type level, so
 * changing one fails compilation rather than silently breaking a theme downstream.
 *
 * The set is fixed rather than open on purpose. An open set of slots is an open contract, and
 * an open contract cannot be frozen.
 *
 * A SLOT IS A COMPONENT, NOT A REGION OF A PAGE. The registry named page regions until the
 * design handoff, and the three reference themes are what settled it: vernier puts the
 * specification and the runtime in two equal columns with a ruler between them, telltale puts
 * the runtime block ahead of the specification, forge is a code host with tabs. A name like
 * `operation.parameters` denotes a different position in each of those layouts, which is to
 * say it denotes nothing that survives a layout change. A component name survives one, so the
 * registry names components and the layouts are free to place them.
 */
export interface SlotPropsMap {
  /**
   * The whole page: header, navigation rail, content column, and the order of the blocks
   * inside it. Replaced by an L2 theme.
   *
   * Block order is deliberately the shell's business rather than a slot of its own. It is the
   * main thing the three reference themes disagree about, and a slot per region would have
   * frozen one theme's answer into the contract.
   */
  AppShell: { document: IRDocument; activeNodeId: string | undefined };

  /** Tree of operations and channels, with the item rendering inside it. */
  NavTree: { navigation: readonly IRNavNode[]; activeNodeId: string | undefined };

  /** The search overlay: the field, the results, and the empty and no-results states. */
  CommandPalette: {
    open: boolean;
    query: string;
    hits: readonly SearchHit[];
    available: boolean;
  };

  /** Method, path, summary and the count of discrepancies. */
  OperationHeader: { operation: OperationView; drift: readonly IRDriftIssue[] };

  /**
   * Runtime facts about one node, each with where it came from.
   *
   * Keyed by node id rather than by an operation view, because a channel has runtime facts on
   * the same shape and this panel does not care which kind of node it is looking at.
   */
  RuntimePanel: {
    nodeId: string | undefined;
    runtime: IRNodeRuntime | undefined;
    meta: IRRuntimeMeta | undefined;
    available: boolean;
  };

  /** The declared, derived or inferred mark on a single fact, per SPEC 6.1. */
  ProvenanceTag: { confidence: IRConfidence; collector: string };

  /** One finding: what the runtime says, what the specification says, and the fix. */
  DriftCard: { issue: IRDriftIssue };

  /** Parameters of an operation, grouped by location. */
  ParamTable: {
    operation: OperationView;
    parameters: ReadonlyMap<IRParameterLocation, readonly IRParameter[]>;
  };

  /** Response codes of an operation. */
  ResponseList: { operation: OperationView; responses: readonly IRResponse[] };

  /**
   * Error contracts, in the three groups SPEC 6.4 keeps apart.
   *
   * `available` separates "no collector ran" from "this operation declares no errors". One
   * list with no such distinction would read as the second while meaning the first.
   */
  ErrorContract: { errors: readonly IRErrorContract[]; available: boolean };

  /** The schema tree, one level at a time, with the viewer's own cycle stops. */
  SchemaTree: { root: SchemaTreeNode; view: IRSchemaView };

  /** Choice of branch at a `oneOf` or `anyOf` position. */
  BranchPicker: {
    node: SchemaTreeNode;
    branches: readonly SchemaTreeNode[];
    activePath: string | undefined;
  };

  /**
   * Filling a request body whose shape depends on the values already entered.
   *
   * This is the input side of a request body. The read only documentation of the same body is
   * a {@link SlotPropsMap.SchemaTree} with `view: 'request'`.
   */
  ShapeForm: {
    operation: OperationView;
    requestBody: IRRequestBody | undefined;
    root: SchemaTreeNode | undefined;
  };

  /** An object whose keys are described by a pattern rather than named. */
  PatternKeys: { node: SchemaTreeNode; patterns: readonly SchemaTreeNode[] };

  /** An array whose types are fixed per position. */
  TupleField: { node: SchemaTreeNode; positions: readonly SchemaTreeNode[] };

  /** Credentials for the schemes an operation requires. */
  AuthPanel: {
    operation: OperationView;
    security: readonly ResolvedSecurityRequirement[];
  };

  /** Choice of server, disabled when the document declares one. */
  ServerSelect: { servers: readonly IRServer[]; activeServerUrl: string | undefined };

  /** Sending the request. `available` is false in a build with no runner. */
  SendButton: { operation: OperationView; available: boolean; pending: boolean };

  /** Status, headers, body and timings of the last response. */
  ResponseView: { operation: OperationView; available: boolean; pending: boolean };

  /** A streaming response as it arrives. Event channels populate it from M5. */
  StreamLog: { nodeId: string | undefined; available: boolean };

  /** Call samples, one tab per language, per SPEC 18. */
  CodeSample: {
    operation: OperationView;
    samples: readonly CodeSampleView[];
    activeLang: string | undefined;
  };

  /** Documentation Health, per SPEC 7.2. `available` means something measured the document. */
  HealthScore: { report: IRHealthReport | undefined; available: boolean };

  /** Filter over the drift rules, with the count each one found. */
  RuleFilter: {
    rules: readonly IRDriftRule[];
    counts: ReadonlyMap<IRDriftRule, number>;
    activeRule: IRDriftRule | undefined;
  };

  /** Empty and degraded states, which are content rather than an absence of it. */
  StateNotice: { kind: StateNoticeKind; message: string | undefined };

  /** Colour scheme switch. `preference` is what was asked for, `resolved` is what is painted. */
  ThemeToggle: { preference: ColorSchemePreference; resolved: ColorScheme };
}

/** Name of a slot a theme may override. */
export type SlotName = keyof SlotPropsMap;

/** Props a given slot receives. */
export type SlotProps<TName extends SlotName> = SlotPropsMap[TName];

/**
 * Every slot name, in the order the design contract lists them.
 *
 * Declared as a tuple rather than derived from the type, because a runtime list is needed to
 * validate a theme, and a derived list would have no order. `SLOT_NAMES_ARE_COMPLETE` below
 * makes the two disagree at compile time rather than at runtime.
 */
export const SLOT_NAMES = [
  'AppShell',
  'NavTree',
  'CommandPalette',
  'OperationHeader',
  'RuntimePanel',
  'ProvenanceTag',
  'DriftCard',
  'ParamTable',
  'ResponseList',
  'ErrorContract',
  'SchemaTree',
  'BranchPicker',
  'ShapeForm',
  'PatternKeys',
  'TupleField',
  'AuthPanel',
  'ServerSelect',
  'SendButton',
  'ResponseView',
  'StreamLog',
  'CodeSample',
  'HealthScore',
  'RuleFilter',
  'StateNotice',
  'ThemeToggle',
] as const satisfies readonly SlotName[];

/**
 * Compile time proof that {@link SLOT_NAMES} lists every key of {@link SlotPropsMap}.
 *
 * `satisfies` above catches a name that is not a slot. This catches a slot that is not named,
 * which is the direction that would otherwise ship a slot no theme can reach.
 */
export type SLOT_NAMES_ARE_COMPLETE = SlotName extends (typeof SLOT_NAMES)[number] ? true : never;

import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';

/**
 * `@openref/vue`: the headless layer a theme is written against.
 *
 * It carries state and composables, and no markup and no styles at all. That is what makes an
 * L2 theme possible in M2 and L3 possible in M7 without the core being reworked, per SPEC
 * 10.2: everything a theme needs is reachable through a composable, so a theme never needs to
 * reach into a store.
 */

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/vue';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE];

export { createDocState } from './state/domain/doc-state';
export type { DocState, DocStateOptions } from './state/domain/doc-state';
export { DOC_STATE_KEY, provideDocState, useDocState } from './state/api/context';

export {
  materializeNode,
  orderedParameters,
  PARAMETER_LOCATIONS,
  resolveSchemaSlot,
} from './state/domain/node-view';
export type {
  ChannelView,
  NodeView,
  OperationView,
  ResolvedSecurityRequirement,
} from './state/domain/node-view';

export {
  expandSchemaNode,
  inlineSchemaTreeRoot,
  schemaDisplayName,
  schemaTreeRoot,
} from './state/domain/schema-expansion';
export type {
  SchemaExpansionOptions,
  SchemaTreeNode,
  SchemaTreeRelation,
} from './state/domain/schema-expansion';

export type { ISearchPort, SearchHit, SearchHitKind } from './state/application/ports/search.port';

export type {
  IRunnerPort,
  RunnerBody,
  RunnerBodyEditor,
  RunnerBodyField,
  RunnerBodyFieldView,
  RunnerBodyMediaTypeView,
  RunnerDeviceAuthorization,
  RunnerFile,
  RunnerNotice,
  RunnerOAuthClient,
  RunnerOAuthFlowKind,
  RunnerOAuthFlowView,
  RunnerOperationView,
  RunnerParameterView,
  RunnerResult,
  RunnerResultHeader,
  RunnerSecuritySchemeView,
  RunnerSendInput,
  RunnerSessionStatus,
  RunnerSignInOutcome,
  RunnerStreamElement,
  RunnerStreamEnd,
  RunnerStreamEndReason,
  RunnerStreamHandle,
  RunnerStreamHandlers,
  RunnerStreamView,
  RunnerValue,
  RunnerValueKind,
  StreamItemSchemaView,
} from './runner/application/ports/runner.port';
export { provideRunner, RUNNER_KEY, useRunnerPort } from './runner/api/context';
export { runnerOperationOf } from './runner/domain/runner-operation';

export type {
  ISocketPort,
  SocketHandshakeBlockView,
  SocketLogEntryView,
  SocketLogStateView,
  SocketMessageDirectionView,
  SocketMessageSchemaView,
  SocketNamedMessageView,
  SocketOpenInput,
  SocketSecuritySchemeView,
  SocketSessionHandlersView,
  SocketSessionStateView,
  SocketSessionView,
  SocketStatusView,
  SocketTransportKindView,
} from './socket/application/ports/socket.port';
export { provideSocket, SOCKET_KEY, useSocketPort } from './socket/api/context';

export type {
  BindingModel,
  ChannelModel,
  ChannelOperationModel,
  ChannelParameterModel,
  ChannelReplyModel,
  ChannelServerModel,
  CodeSampleLanguageModel,
  CodeSampleModel,
  CodeSampleNoteModel,
  CodeSampleRefusalModel,
  DriftModel,
  ErrorContractGroupModel,
  ErrorContractItemModel,
  FrameModel,
  FrameStatsModel,
  FrameTabKind,
  FrameTabModel,
  HealthCheckModel,
  HealthKpiModel,
  HealthModel,
  HealthRuleModel,
  MediaTypeModel,
  MessageBodyModel,
  MessageExampleModel,
  MessageModel,
  NavEntryModel,
  NodeHeaderModel,
  NodeModel,
  NodeSectionMark,
  PageKind,
  PageModel,
  PaletteHitModel,
  ParameterModel,
  ParityFixModel,
  ParityRowKind,
  ParityRowModel,
  ParitySideModel,
  ParityVerdict,
  ResponseMarkModel,
  ResponseModel,
  RuntimeModel,
  RuntimeRowKind,
  RuntimeRowModel,
  RuntimeValueModel,
  SchemaPageModel,
  SecurityModel,
  ServicePageModel,
  StaticProxyModel,
} from './page/domain/page-model.types';

export {
  SERVER_RESOLVED_ROOTS,
  SERVER_RESOLVED_SLOTS,
  SLOT_NAMES,
} from './slots/domain/slot-props.types';
export type {
  ServerResolvedSlot,
  SLOT_NAMES_ARE_COMPLETE,
  SlotName,
  SlotProps,
  SlotPropsMap,
} from './slots/domain/slot-props.types';
export type { StateNoticeKind, StreamCounts } from './slots/domain/slot-value.types';
export type { SchemaPayloadMap } from './slots/domain/slot-props.types';

/**
 * The IR types this package declares its own props in, re-exported so a theme installs one package.
 *
 * EIGHT NAMES, EACH ONE THE DECLARED TYPE OF SOMETHING A THEME IS HANDED. `IRConfidence` is
 * `ProvenanceTag.confidence`, `IRSchemaView` is `SchemaTree.view`, `IRSchema` is the value type of
 * `SchemaPayloadMap`, and `UnsendableCause` is `RunnerSecuritySchemeView.unsendableCause`. Without
 * them a theme that types the value it is handed reaches for `@openref/core`, which SPEC 4 promises
 * it does not have to. Found on `T032` from outside, where a boundary defect is visible, and closed
 * on `T031-R1`.
 *
 * FOUR MORE ARRIVED AT `T052` FOR THE SAME REASON, and they arrived together because a theme that
 * draws the graph walks all four. `IRTopology` is `DocumentOverview.topology` and
 * `PageModel.topology`; `IRTopologyGroup`, `IRTopologyEdge` and `IRTopologyEndpoint` are what a
 * walk of it reaches, and a theme that could name the top of the shape and not the rows under it
 * would be back at `@openref/core` on the second line.
 *
 * ONE MORE ARRIVED AT `T055` FOR THE FIRST OF THOSE REASONS: `HandshakeBlockedCause` is the type of
 * `SocketHandshakeBlockView.cause`, so a theme that draws the statement SPEC 14.7 requires, one
 * sentence per cause and total over the union, would otherwise reach for `@openref/core` to name
 * what it was handed.
 *
 * A TYPE RE-EXPORT AND NOT A VALUE ONE. `export type` erases, so the emitted module gains nothing
 * and no reader of any page pays a byte; and the four names widen no contract, because adding a
 * name to this surface is a minor version by `PUBLIC-API.md` while the types themselves stay
 * frozen where they are declared, in `@openref/core`.
 */
export type {
  HandshakeBlockedCause,
  IRConfidence,
  IRSchema,
  IRSchemaView,
  IRTopology,
  IRTopologyEdge,
  IRTopologyEndpoint,
  IRTopologyGroup,
  UnsendableCause,
} from '@openref/core';
export { createSlotRegistry } from './slots/domain/slot-registry';
export type { SlotRegistry } from './slots/domain/slot-registry';
export { provideSlots, SLOT_REGISTRY_KEY, useSlotRegistry } from './slots/api/context';

export { defineTheme } from './theme/api/define-theme';
export { FALLBACK_THEME_NAME, resolveSlots, resolveTheme } from './theme/domain/theme';
export type {
  ResolvedTheme,
  ThemeAssets,
  ThemeDefinition,
  ThemeTokens,
} from './theme/domain/theme.types';

export { useChannel } from './composables/useChannel';
export type { UseChannel } from './composables/useChannel';
export { useDocument } from './composables/useDocument';
export type { UseDocument } from './composables/useDocument';
export { useHealth } from './composables/useHealth';
export type { UseHealth } from './composables/useHealth';
export { useNode } from './composables/useNode';
export type { UseNode } from './composables/useNode';
export { useOperation } from './composables/useOperation';
export type { UseOperation } from './composables/useOperation';
export { useRuntime } from './composables/useRuntime';
export type { UseRuntime } from './composables/useRuntime';
export { useSchemaView } from './composables/useSchemaView';
export type { UseSchemaView } from './composables/useSchemaView';
export { DEFAULT_HIT_LIMIT, useSearch } from './composables/useSearch';
export type { UseSearch } from './composables/useSearch';
export { useSlot } from './composables/useSlot';
export { useSocket } from './composables/useSocket';
export type { UseSocket, UseSocketConnectArgs } from './composables/useSocket';
export { useTheme } from './composables/useTheme';
export type { UseTheme } from './composables/useTheme';

// THE ERROR CLASSES A CONSUMER OF THIS PACKAGE CAN BE HANDED, RE-EXPORTED SO THEY CAN CATCH THEM.
// ADDED 2026-09-02. Every composable in this package documents `@throws {ThemeContractError} When
// no state was provided above`, and a theme author reading that could not import the name. The
// registry raises `SlotNotFoundError` on a misspelled slot, which is the failure a theme author
// meets most, and `useRunner` raises `RunnerError` when the host supplied no runner.
//
// THESE ARE `@openref/core`'s OWN CLASSES AND NOT COPIES. This package depends on it at runtime
// and does not bundle it, so `instanceof` answers true for an error this package threw.
export {
  ErrorCode,
  OpenRefError,
  RunnerError,
  SlotNotFoundError,
  ThemeContractError,
  ThemeError,
} from '@openref/core';

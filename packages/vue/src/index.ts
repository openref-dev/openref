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
  CodeSampleModel,
  DriftModel,
  ErrorContractGroupModel,
  ErrorContractItemModel,
  FrameModel,
  FrameStatsModel,
  FrameTabKind,
  FrameTabModel,
  HealthCheckModel,
  HealthModel,
  HealthRuleModel,
  MediaTypeModel,
  NavEntryModel,
  NodeHeaderModel,
  NodeModel,
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
} from './page/domain/page-model.types';

export { SLOT_NAMES } from './slots/domain/slot-props.types';
export type {
  SLOT_NAMES_ARE_COMPLETE,
  SlotName,
  SlotProps,
  SlotPropsMap,
} from './slots/domain/slot-props.types';
export type { StateNoticeKind, StreamCounts } from './slots/domain/slot-value.types';
export type { SchemaPayloadMap } from './slots/domain/slot-props.types';
export { createSlotRegistry } from './slots/domain/slot-registry';
export type { SlotRegistry } from './slots/domain/slot-registry';
export { provideSlots, SLOT_REGISTRY_KEY, useSlotRegistry } from './slots/api/context';

export { defineTheme } from './theme/api/define-theme';
export { DEFAULT_THEME_NAME, resolveSlots, resolveTheme } from './theme/domain/theme';
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
export type { UseSocket } from './composables/useSocket';
export { useTheme } from './composables/useTheme';
export type { UseTheme } from './composables/useTheme';

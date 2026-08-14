import type { IRConfidence, IRSchemaView } from '@openref/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CodeSampleModel,
  DriftModel,
  ErrorContractGroupModel,
  FrameModel,
  FrameStatsModel,
  HealthModel,
  NavEntryModel,
  NodeHeaderModel,
  PageKind,
  PaletteHitModel,
  ParameterModel,
  ResponseMarkModel,
  ResponseModel,
  RunnerBodyMediaTypeView,
  RunnerDeviceAuthorization,
  RunnerFile,
  RunnerOAuthFlowView,
  RunnerResult,
  RunnerSecuritySchemeView,
  RunnerSessionStatus,
  RunnerStreamElement,
  RunnerStreamEnd,
  RuntimeModel,
  SchemaPageModel,
  SchemaPayloadMap,
  SchemaTreeNode,
  SlotName,
  SlotProps,
  SlotPropsMap,
  StateNoticeKind,
  StreamCounts,
  SLOT_NAMES_ARE_COMPLETE,
} from '../../src/index';
import { SLOT_NAMES } from '../../src/index';

/**
 * The slot props are public API, per SPEC 10.4 and CLAUDE.md rule 10.
 *
 * This file is the pin. `pnpm lint` typechecks the test tree, so changing a slot's props makes
 * these assertions fail to compile rather than silently breaking every theme built against
 * them. Anything changed here is a major version, deliberately, not incidentally.
 *
 * THE NAMES ARE THE 21 OF `TX-SLOTWIRE`, and the count is a decision rather than a state. It was
 * 25 while nothing resolved a slot on a page a reader opens; wiring the registry into the shipped
 * renderer removed six names no position could draw and added two pages the registry had never
 * covered. Every one of the 21 is driven through the real renderer by `slot-wiring.spec.ts`,
 * which is what the freeze rests on: evidence per name rather than a count.
 */

describe('slot registry contract', () => {
  it('should expose exactly the slots the contract names, in registry order', () => {
    // Given, the list is written out rather than derived, so a rename is visible in the diff.
    const expected = [
      'AppShell',
      'NavTree',
      'CommandPalette',
      'DocumentOverview',
      'SchemaPage',
      'OperationHeader',
      'RuntimePanel',
      'ProvenanceTag',
      'DriftCard',
      'ParamTable',
      'ResponseList',
      'CodeSample',
      'SchemaTree',
      'ShapeForm',
      'AuthPanel',
      'ServerSelect',
      'SendButton',
      'ResponseView',
      'StreamLog',
      'HealthScore',
      'StateNotice',
    ];

    // When
    const actual = [...SLOT_NAMES];

    // Then
    expect(actual).toEqual(expected);
  });

  it('should name none of the six the wiring removed', () => {
    // Given, each of these was a name in the frozen registry that no shipped path could resolve:
    // three schema row kinds of one component, the three error rows of the runtime block, a
    // filter the Health panel does with `details`, and a colour scheme control that would cost a
    // flash and an inline script. They are named here so that removing one and quietly adding it
    // back is a failing test rather than a diff nobody reads.
    const removed = [
      'ErrorContract',
      'BranchPicker',
      'PatternKeys',
      'TupleField',
      'RuleFilter',
      'ThemeToggle',
    ];

    // When
    const present = removed.filter((name) => (SLOT_NAMES as readonly string[]).includes(name));

    // Then
    expect(present).toEqual([]);
  });

  it('should name every slot the props map declares, with nothing left unreachable', () => {
    // Given, `SLOT_NAMES_ARE_COMPLETE` resolves to `never` when a slot has no name.
    const complete: SLOT_NAMES_ARE_COMPLETE = true;

    // When
    const proof = complete;

    // Then
    expect(proof).toBe(true);
    expectTypeOf<SlotName>().toEqualTypeOf<(typeof SLOT_NAMES)[number]>();
  });

  it('should pin the props of every slot at the type level', () => {
    // Given, nothing at runtime: the assertions below are checked by tsc.

    // When
    expectTypeOf<SlotProps<'AppShell'>>().toEqualTypeOf<{
      title: string;
      version: string;
      basePath: string;
      activeNodeId: string | null;
      activeSchemaId: string | null;
      page: PageKind;
      // Additive at TX-FRAME, a minor version per PUBLIC-API.md: a shell written before it
      // keeps compiling and keeps rendering.
      frame: FrameModel;
    }>();
    expectTypeOf<SlotProps<'NavTree'>>().toEqualTypeOf<{
      entries: readonly NavEntryModel[];
      activeNodeId: string | null;
      activeSchemaId: string | null;
      basePath: string;
      // Additive at TX-FRAME, a minor version per PUBLIC-API.md.
      stats: FrameStatsModel;
      complete: boolean;
      total: number;
      load(): Promise<boolean>;
    }>();
    expectTypeOf<SlotProps<'CommandPalette'>>().toEqualTypeOf<{
      open: boolean;
      query: string;
      selected: number;
      hits: readonly PaletteHitModel[];
      partial: boolean;
      onOpen(): void;
      onClose(): void;
      onQuery(query: string): void;
      onSelect(index: number): void;
    }>();
    expectTypeOf<SlotProps<'DocumentOverview'>>().toEqualTypeOf<{
      title: string;
      descriptionHtml: string;
      servers: readonly string[];
      basePath: string;
    }>();
    expectTypeOf<SlotProps<'SchemaPage'>>().toEqualTypeOf<{
      schema: SchemaPageModel;
      basePath: string;
    }>();
    expectTypeOf<SlotProps<'OperationHeader'>>().toEqualTypeOf<{
      node: NodeHeaderModel;
      drift: readonly DriftModel[];
      benchHref: string;
    }>();
    expectTypeOf<SlotProps<'RuntimePanel'>>().toEqualTypeOf<{
      nodeId: string;
      runtime: RuntimeModel;
    }>();
    expectTypeOf<SlotProps<'ProvenanceTag'>>().toEqualTypeOf<{
      confidence: IRConfidence;
      collector: string;
    }>();
    expectTypeOf<SlotProps<'DriftCard'>>().toEqualTypeOf<{ issue: DriftModel }>();
    expectTypeOf<SlotProps<'ParamTable'>>().toEqualTypeOf<{
      parameters: readonly ParameterModel[];
    }>();
    expectTypeOf<SlotProps<'ResponseList'>>().toEqualTypeOf<{
      responses: readonly ResponseModel[];
      schemas: SchemaPayloadMap;
      truncated: readonly string[];
      basePath: string;
      marks: readonly ResponseMarkModel[];
      contracts: readonly ErrorContractGroupModel[];
    }>();
    expectTypeOf<SlotProps<'CodeSample'>>().toEqualTypeOf<{
      samples: readonly CodeSampleModel[];
      activeLang: string;
      onSelect(lang: string): void;
    }>();
    expectTypeOf<SlotProps<'SchemaTree'>>().toEqualTypeOf<{
      root: SchemaTreeNode;
      view: IRSchemaView;
      expand(node: SchemaTreeNode): readonly SchemaTreeNode[];
      truncated: readonly string[];
      basePath: string;
      label: string;
      borrowedLabel: boolean;
      anchors: boolean;
      anchor: string;
    }>();
    expectTypeOf<SlotProps<'ShapeForm'>>().toEqualTypeOf<{
      media: RunnerBodyMediaTypeView;
      values: Readonly<Record<string, string>>;
      files: Readonly<Record<string, RunnerFile>>;
      text: string;
      onField(name: string, value: string): void;
      onFile(name: string, file: RunnerFile | undefined): void;
      onText(text: string): void;
    }>();
    expectTypeOf<SlotProps<'AuthPanel'>>().toEqualTypeOf<{
      schemes: readonly RunnerSecuritySchemeView[];
      credentials: Readonly<Record<string, string>>;
      inputs: Readonly<Record<string, string>>;
      flows: Readonly<Record<string, readonly RunnerOAuthFlowView[]>>;
      chosenFlow: Readonly<Record<string, string>>;
      sessions: Readonly<Record<string, RunnerSessionStatus>>;
      notices: Readonly<Record<string, string>>;
      devices: Readonly<Record<string, RunnerDeviceAuthorization>>;
      pending: string | null;
      mounted: boolean;
      onCredential(schemeId: string, value: string): void;
      onInput(schemeId: string, field: string, value: string): void;
      onFlow(schemeId: string, kind: string): void;
      onSignIn(schemeId: string): void;
      onSignOut(schemeId: string): void;
    }>();
    expectTypeOf<SlotProps<'ServerSelect'>>().toEqualTypeOf<{
      servers: readonly string[];
      activeServerUrl: string;
      onSelect(url: string): void;
    }>();
    expectTypeOf<SlotProps<'SendButton'>>().toEqualTypeOf<{
      available: boolean;
      pending: boolean;
      mounted: boolean;
      notice: string;
      onSend(): void;
    }>();
    expectTypeOf<SlotProps<'ResponseView'>>().toEqualTypeOf<{
      result: RunnerResult | undefined;
      error: string | undefined;
      pending: boolean;
      declared: readonly string[];
    }>();
    expectTypeOf<SlotProps<'StreamLog'>>().toEqualTypeOf<{
      elements: readonly RunnerStreamElement[];
      counts: StreamCounts;
      end: RunnerStreamEnd | null;
      open: boolean;
      mounted: boolean;
      available: boolean;
      onStart(): void;
      onStop(): void;
    }>();
    expectTypeOf<SlotProps<'HealthScore'>>().toEqualTypeOf<{ health: HealthModel }>();
    expectTypeOf<SlotProps<'StateNotice'>>().toEqualTypeOf<{
      kind: StateNoticeKind;
      message: string;
    }>();

    // Then
    expect(SLOT_NAMES).toHaveLength(21);
  });

  it('should pin the values a slot carries that no other layer produces', () => {
    // Given, these two exist because a slot needs them, so they are frozen with it. The notice
    // kinds are restated from the notices the renderer actually draws, one per position.

    // When
    expectTypeOf<StreamCounts>().toEqualTypeOf<{
      readonly received: number;
      readonly invalid: number;
      readonly dropped: number;
    }>();

    // Then
    expectTypeOf<StateNoticeKind>().toEqualTypeOf<
      | 'nav-unavailable'
      | 'search-empty'
      | 'search-no-results'
      | 'search-partial'
      | 'no-server'
      | 'no-body-fields'
      | 'schema-missing'
      | 'no-schema'
      | 'health-missing'
    >();
  });

  it('should keep SlotProps and SlotPropsMap in step', () => {
    // Given
    type ViaMap = SlotPropsMap['OperationHeader'];

    // When
    type ViaHelper = SlotProps<'OperationHeader'>;

    // Then
    expectTypeOf<ViaHelper>().toEqualTypeOf<ViaMap>();
    expect(SLOT_NAMES).toContain('OperationHeader');
  });
});

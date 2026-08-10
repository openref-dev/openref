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
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  CodeSampleView,
  ColorScheme,
  ColorSchemePreference,
  OperationView,
  ResolvedSecurityRequirement,
  SchemaTreeNode,
  SearchHit,
  SlotName,
  SlotProps,
  SlotPropsMap,
  StateNoticeKind,
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
 * The names are the 25 of `ai-docs/design/CONTRACT.md`. They replaced the 17 region names of
 * T008 under retrofit `T008-R1`, while nothing was published.
 */

describe('slot registry contract', () => {
  it('should expose exactly the slots the contract names, in registry order', () => {
    // Given, the list is written out rather than derived, so a rename is visible in the diff.
    const expected = [
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
    ];

    // When
    const actual = [...SLOT_NAMES];

    // Then
    expect(actual).toEqual(expected);
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
      document: IRDocument;
      activeNodeId: string | undefined;
    }>();
    expectTypeOf<SlotProps<'NavTree'>>().toEqualTypeOf<{
      navigation: readonly IRNavNode[];
      activeNodeId: string | undefined;
    }>();
    expectTypeOf<SlotProps<'CommandPalette'>>().toEqualTypeOf<{
      open: boolean;
      query: string;
      hits: readonly SearchHit[];
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'OperationHeader'>>().toEqualTypeOf<{
      operation: OperationView;
      drift: readonly IRDriftIssue[];
    }>();
    expectTypeOf<SlotProps<'RuntimePanel'>>().toEqualTypeOf<{
      nodeId: string | undefined;
      runtime: IRNodeRuntime | undefined;
      meta: IRRuntimeMeta | undefined;
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'ProvenanceTag'>>().toEqualTypeOf<{
      confidence: IRConfidence;
      collector: string;
    }>();
    expectTypeOf<SlotProps<'DriftCard'>>().toEqualTypeOf<{ issue: IRDriftIssue }>();
    expectTypeOf<SlotProps<'ParamTable'>>().toEqualTypeOf<{
      operation: OperationView;
      parameters: ReadonlyMap<IRParameterLocation, readonly IRParameter[]>;
    }>();
    expectTypeOf<SlotProps<'ResponseList'>>().toEqualTypeOf<{
      operation: OperationView;
      responses: readonly IRResponse[];
    }>();
    expectTypeOf<SlotProps<'ErrorContract'>>().toEqualTypeOf<{
      errors: readonly IRErrorContract[];
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'SchemaTree'>>().toEqualTypeOf<{
      root: SchemaTreeNode;
      view: IRSchemaView;
    }>();
    expectTypeOf<SlotProps<'BranchPicker'>>().toEqualTypeOf<{
      node: SchemaTreeNode;
      branches: readonly SchemaTreeNode[];
      activePath: string | undefined;
    }>();
    expectTypeOf<SlotProps<'ShapeForm'>>().toEqualTypeOf<{
      operation: OperationView;
      requestBody: IRRequestBody | undefined;
      root: SchemaTreeNode | undefined;
    }>();
    expectTypeOf<SlotProps<'PatternKeys'>>().toEqualTypeOf<{
      node: SchemaTreeNode;
      patterns: readonly SchemaTreeNode[];
    }>();
    expectTypeOf<SlotProps<'TupleField'>>().toEqualTypeOf<{
      node: SchemaTreeNode;
      positions: readonly SchemaTreeNode[];
    }>();
    expectTypeOf<SlotProps<'AuthPanel'>>().toEqualTypeOf<{
      operation: OperationView;
      security: readonly ResolvedSecurityRequirement[];
    }>();
    expectTypeOf<SlotProps<'ServerSelect'>>().toEqualTypeOf<{
      servers: readonly IRServer[];
      activeServerUrl: string | undefined;
    }>();
    expectTypeOf<SlotProps<'SendButton'>>().toEqualTypeOf<{
      operation: OperationView;
      available: boolean;
      pending: boolean;
    }>();
    expectTypeOf<SlotProps<'ResponseView'>>().toEqualTypeOf<{
      operation: OperationView;
      available: boolean;
      pending: boolean;
    }>();
    expectTypeOf<SlotProps<'StreamLog'>>().toEqualTypeOf<{
      nodeId: string | undefined;
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'CodeSample'>>().toEqualTypeOf<{
      operation: OperationView;
      samples: readonly CodeSampleView[];
      activeLang: string | undefined;
    }>();
    expectTypeOf<SlotProps<'HealthScore'>>().toEqualTypeOf<{
      report: IRHealthReport | undefined;
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'RuleFilter'>>().toEqualTypeOf<{
      rules: readonly IRDriftRule[];
      counts: ReadonlyMap<IRDriftRule, number>;
      activeRule: IRDriftRule | undefined;
    }>();
    expectTypeOf<SlotProps<'StateNotice'>>().toEqualTypeOf<{
      kind: StateNoticeKind;
      message: string | undefined;
    }>();
    expectTypeOf<SlotProps<'ThemeToggle'>>().toEqualTypeOf<{
      preference: ColorSchemePreference;
      resolved: ColorScheme;
    }>();

    // Then
    expect(SLOT_NAMES).toHaveLength(25);
  });

  it('should pin the values a slot carries that no other layer produces yet', () => {
    // Given, these three types exist because a slot needs them, so they are frozen with it.

    // When
    expectTypeOf<CodeSampleView>().toEqualTypeOf<{
      readonly lang: string;
      readonly label: string;
      readonly source: string;
    }>();

    // Then
    expectTypeOf<StateNoticeKind>().toEqualTypeOf<
      'empty' | 'no-runtime' | 'stale-cache' | 'no-results' | 'no-descriptions' | 'unavailable'
    >();
    expectTypeOf<ColorSchemePreference>().toEqualTypeOf<'system' | 'light' | 'dark'>();
    expectTypeOf<ColorScheme>().toEqualTypeOf<'light' | 'dark'>();
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

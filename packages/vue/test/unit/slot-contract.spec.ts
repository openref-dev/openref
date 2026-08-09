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
import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  ChannelView,
  OperationView,
  ResolvedSecurityRequirement,
  SchemaTreeNode,
  SearchHit,
  SlotName,
  SlotProps,
  SlotPropsMap,
  SLOT_NAMES_ARE_COMPLETE,
} from '../../src/index';
import { SLOT_NAMES } from '../../src/index';

/**
 * The slot props are public API, per SPEC 10.4 and CLAUDE.md rule 10.
 *
 * This file is the pin. `pnpm lint` typechecks the test tree, so changing a slot's props makes
 * these assertions fail to compile rather than silently breaking every theme built against
 * them. Anything changed here is a major version, deliberately, not incidentally.
 */

describe('slot registry contract', () => {
  it('should expose exactly the slots the contract names, in registry order', () => {
    // Given, the list is written out rather than derived, so a rename is visible in the diff.
    const expected = [
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
    expectTypeOf<SlotProps<'layout'>>().toEqualTypeOf<{
      document: IRDocument;
      activeNodeId: string | undefined;
    }>();
    expectTypeOf<SlotProps<'sidebar'>>().toEqualTypeOf<{
      navigation: readonly IRNavNode[];
      activeNodeId: string | undefined;
    }>();
    expectTypeOf<SlotProps<'sidebar.item'>>().toEqualTypeOf<{
      item: IRNavNode;
      depth: number;
      active: boolean;
    }>();
    expectTypeOf<SlotProps<'search.box'>>().toEqualTypeOf<{
      query: string;
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'search.results'>>().toEqualTypeOf<{
      hits: readonly SearchHit[];
      query: string;
    }>();
    expectTypeOf<SlotProps<'operation'>>().toEqualTypeOf<{ operation: OperationView }>();
    expectTypeOf<SlotProps<'operation.header'>>().toEqualTypeOf<{ operation: OperationView }>();
    expectTypeOf<SlotProps<'operation.parameters'>>().toEqualTypeOf<{
      operation: OperationView;
      parameters: ReadonlyMap<IRParameterLocation, readonly IRParameter[]>;
    }>();
    expectTypeOf<SlotProps<'operation.request-body'>>().toEqualTypeOf<{
      operation: OperationView;
      requestBody: IRRequestBody | undefined;
    }>();
    expectTypeOf<SlotProps<'operation.responses'>>().toEqualTypeOf<{
      operation: OperationView;
      responses: readonly IRResponse[];
    }>();
    expectTypeOf<SlotProps<'operation.security'>>().toEqualTypeOf<{
      operation: OperationView;
      security: readonly ResolvedSecurityRequirement[];
    }>();
    expectTypeOf<SlotProps<'channel'>>().toEqualTypeOf<{ channel: ChannelView }>();
    expectTypeOf<SlotProps<'schema'>>().toEqualTypeOf<{
      root: SchemaTreeNode;
      view: IRSchemaView;
    }>();
    expectTypeOf<SlotProps<'schema.row'>>().toEqualTypeOf<{
      node: SchemaTreeNode;
      expanded: boolean;
      depth: number;
    }>();
    expectTypeOf<SlotProps<'try-it'>>().toEqualTypeOf<{
      operation: OperationView;
      available: boolean;
    }>();
    expectTypeOf<SlotProps<'health'>>().toEqualTypeOf<{ report: IRHealthReport | undefined }>();
    expectTypeOf<SlotProps<'footer'>>().toEqualTypeOf<{ document: IRDocument }>();

    // Then
    expect(SLOT_NAMES).toHaveLength(17);
  });

  it('should keep SlotProps and SlotPropsMap in step', () => {
    // Given
    type ViaMap = SlotPropsMap['operation.header'];

    // When
    type ViaHelper = SlotProps<'operation.header'>;

    // Then
    expectTypeOf<ViaHelper>().toEqualTypeOf<ViaMap>();
    expect(SLOT_NAMES).toContain('operation.header');
  });
});

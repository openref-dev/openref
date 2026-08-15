import { ErrorCode, SlotNotFoundError } from '@openref/core';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { createSlotRegistry, SLOT_NAMES } from '../../src/index';

const Stub = defineComponent({ name: 'Stub', setup: () => () => h('span') });
const Other = defineComponent({ name: 'Other', setup: () => () => h('em') });

describe('createSlotRegistry', () => {
  it('should hold only the overrides a theme supplied', () => {
    // Given
    const registry = createSlotRegistry({ OperationHeader: Stub });

    // When
    const overridden = registry.overridden();

    // Then
    expect(overridden).toEqual(['OperationHeader']);
    expect(registry.resolve('OperationHeader')).toBe(Stub);
    expect(registry.resolve('StateNotice')).toBeUndefined();
  });

  it('should list overrides in registry order rather than in the order they were given', () => {
    // Given
    const registry = createSlotRegistry({ StateNotice: Stub, AppShell: Other });

    // When
    const overridden = registry.overridden();

    // Then
    expect(overridden).toEqual(['AppShell', 'StateNotice']);
  });

  it('should refuse an override naming something that is not a slot', () => {
    // Given
    const build = (): unknown => createSlotRegistry({ OperationHeaders: Stub });

    // When
    let thrown: unknown;
    try {
      build();
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(SlotNotFoundError);
    expect((thrown as SlotNotFoundError).code).toBe(ErrorCode.THEME_SLOT_NOT_FOUND);
    expect((thrown as SlotNotFoundError).context?.name).toBe('OperationHeaders');
  });

  it('should refuse to resolve a name that is not a slot, rather than returning undefined', () => {
    // Given, undefined would be indistinguishable from "no override", which is the bug.
    const registry = createSlotRegistry();

    // When
    const resolve = (): unknown => registry.resolve('NavTreeItem');

    // Then
    expect(resolve).toThrow(SlotNotFoundError);
  });

  it('should refuse to register into a name that is not a slot', () => {
    // Given
    const registry = createSlotRegistry();

    // When
    const register = (): void => {
      registry.register('nope', Stub);
    };

    // Then
    expect(register).toThrow(SlotNotFoundError);
  });

  it('should replace an override when the same slot is registered again', () => {
    // Given
    const registry = createSlotRegistry({ SchemaTree: Stub });

    // When
    registry.register('SchemaTree', Other);

    // Then
    expect(registry.resolve('SchemaTree')).toBe(Other);
    expect(registry.overridden()).toEqual(['SchemaTree']);
  });

  it('should narrow a string that names a slot', () => {
    // Given
    const registry = createSlotRegistry();

    // When
    const known = SLOT_NAMES.every((name) => registry.has(name));

    // Then
    expect(known).toBe(true);
    expect(registry.has('not-a-slot')).toBe(false);
  });

  it('should give each registry its own overrides', () => {
    // Given
    const first = createSlotRegistry({ StateNotice: Stub });

    // When
    const second = createSlotRegistry();

    // Then
    expect(second.resolve('StateNotice')).toBeUndefined();
    expect(first.resolve('StateNotice')).toBe(Stub);
  });
});

describe('a theme that registers a position with nothing to render', () => {
  it('should refuse the registration rather than falling back silently', () => {
    // Given a theme whose component record carries an undefined value, which is what a broken
    // default export and a circular import both produce
    const build = (): unknown =>
      createSlotRegistry({ NavTree: undefined as unknown as typeof Stub });

    // Then it is named. Until T035 this succeeded: `resolve` returns undefined for a position
    // registered with undefined and for one never registered at all, `useSlot` reads both as
    // "fall back to the reference component", and `checkTheme` counts the keys of the record
    // rather than its values, so the theme believed it had drawn its own markup while the
    // reference drew its own, with nothing red on either side.
    expect(build).toThrow(SlotNotFoundError);
    expect(build).toThrow(/registered slot "NavTree" with nothing to render/);
  });

  it('should refuse the same through register, which is the door a layout comes through', () => {
    // Given a registry and a late registration of nothing
    const registry = createSlotRegistry({});

    // Then both doors are shut the same way
    expect(() => {
      registry.register('AppShell', undefined as unknown as typeof Stub);
    }).toThrow(SlotNotFoundError);
  });

  it('should leave a position alone when a theme omits it, which is how a theme means that', () => {
    // Given a theme that overrides one position and says nothing about the rest
    const registry = createSlotRegistry({ NavTree: Stub });

    // Then the omitted position resolves to nothing and the caller falls back, which is the
    // design the refusal above exists to keep distinguishable from a mistake
    expect(registry.resolve('CommandPalette')).toBeUndefined();
    expect(registry.overridden()).toEqual(['NavTree']);
  });
});

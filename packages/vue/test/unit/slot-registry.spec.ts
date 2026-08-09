import { ErrorCode, SlotNotFoundError } from '@openref/core';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { createSlotRegistry, SLOT_NAMES } from '../../src/index';

const Stub = defineComponent({ name: 'Stub', setup: () => () => h('span') });
const Other = defineComponent({ name: 'Other', setup: () => () => h('em') });

describe('createSlotRegistry', () => {
  it('should hold only the overrides a theme supplied', () => {
    // Given
    const registry = createSlotRegistry({ 'operation.header': Stub });

    // When
    const overridden = registry.overridden();

    // Then
    expect(overridden).toEqual(['operation.header']);
    expect(registry.resolve('operation.header')).toBe(Stub);
    expect(registry.resolve('footer')).toBeUndefined();
  });

  it('should list overrides in registry order rather than in the order they were given', () => {
    // Given
    const registry = createSlotRegistry({ footer: Stub, layout: Other });

    // When
    const overridden = registry.overridden();

    // Then
    expect(overridden).toEqual(['layout', 'footer']);
  });

  it('should refuse an override naming something that is not a slot', () => {
    // Given
    const build = (): unknown => createSlotRegistry({ 'operation.headers': Stub });

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
    expect((thrown as SlotNotFoundError).context?.name).toBe('operation.headers');
  });

  it('should refuse to resolve a name that is not a slot, rather than returning undefined', () => {
    // Given, undefined would be indistinguishable from "no override", which is the bug.
    const registry = createSlotRegistry();

    // When
    const resolve = (): unknown => registry.resolve('sidebar.items');

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
    const registry = createSlotRegistry({ schema: Stub });

    // When
    registry.register('schema', Other);

    // Then
    expect(registry.resolve('schema')).toBe(Other);
    expect(registry.overridden()).toEqual(['schema']);
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
    const first = createSlotRegistry({ footer: Stub });

    // When
    const second = createSlotRegistry();

    // Then
    expect(second.resolve('footer')).toBeUndefined();
    expect(first.resolve('footer')).toBe(Stub);
  });
});

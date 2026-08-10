import { SlotNotFoundError } from '@openref/core';
import { defineComponent, h } from 'vue';
import { describe, expect, it } from 'vitest';
import { createDocState, useSlot } from '../../src/index';
import { simpleDocument } from '../mocks/documents';
import { renderWithDocState, withDocState } from '../mocks/render';
import { CustomNotice, SlottedTree } from '../mocks/slotted-tree';

/**
 * L1 theming, per SPEC 10.1 and BUILD T009: a consumer replaces one registered slot with their
 * own component and nothing else changes.
 *
 * "Nothing else changes" is measured here rather than described. Each region of the tree comes
 * out of the registry and is wrapped in an element carrying its slot name, so the regions can
 * be compared one against one.
 */

const REGION = /<section data-region="([^"]+)">([\s\S]*?)<\/section>/g;

function regions(html: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of html.matchAll(REGION)) found.set(match[1] ?? '', match[2] ?? '');
  return found;
}

describe('overriding one slot', () => {
  it('should leave every other region byte identical', async () => {
    // Given
    const document = simpleDocument();
    const before = await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      SlottedTree,
    );

    // When
    const after = await renderWithDocState(
      createDocState({
        document,
        activeNodeId: 'get-orders',
        theme: { name: 'consumer', components: { StateNotice: CustomNotice } },
      }),
      SlottedTree,
    );

    // Then
    const left = regions(before);
    const right = regions(after);
    expect([...right.keys()]).toEqual([...left.keys()]);

    for (const name of left.keys()) {
      if (name === 'StateNotice') continue;
      expect(right.get(name)).toBe(left.get(name));
    }
  });

  it('should change exactly the region that was overridden', async () => {
    // Given
    const document = simpleDocument();
    const before = await renderWithDocState(
      createDocState({ document, activeNodeId: 'get-orders' }),
      SlottedTree,
    );

    // When
    const after = await renderWithDocState(
      createDocState({
        document,
        activeNodeId: 'get-orders',
        theme: { name: 'consumer', components: { StateNotice: CustomNotice } },
      }),
      SlottedTree,
    );

    // Then
    expect(regions(before).get('StateNotice')).not.toBe(regions(after).get('StateNotice'));
    expect(after).toContain('oref-custom');
    expect(before).not.toContain('oref-custom');
  });

  it('should render the default when the theme overrides nothing', async () => {
    // Given
    const state = createDocState({ document: simpleDocument(), activeNodeId: 'get-orders' });

    // When
    const html = await renderWithDocState(state, SlottedTree);

    // Then
    expect(html).toContain('List orders');
    expect(html).toContain('limit');
    expect(html).toContain('Orders API');
  });
});

describe('useSlot', () => {
  it('should hand back the fallback for a slot with no override', async () => {
    // Given
    const Fallback = defineComponent({ name: 'Fallback', setup: () => () => h('span') });
    const state = createDocState({ document: simpleDocument() });

    // When
    const resolved = await withDocState(state, () => useSlot('NavTree', Fallback));

    // Then
    expect(resolved.value).toBe(Fallback);
  });

  it('should prefer the override a theme supplied', async () => {
    // Given
    const Fallback = defineComponent({ name: 'Fallback', setup: () => () => h('span') });
    const Override = defineComponent({ name: 'Override', setup: () => () => h('em') });
    const state = createDocState({
      document: simpleDocument(),
      theme: { name: 'consumer', components: { NavTree: Override } },
    });

    // When
    const resolved = await withDocState(state, () => useSlot('NavTree', Fallback));

    // Then
    expect(resolved.value).toBe(Override);
  });

  it('should follow the theme when it is replaced', async () => {
    // Given
    const Fallback = defineComponent({ name: 'Fallback', setup: () => () => h('span') });
    const Override = defineComponent({ name: 'Override', setup: () => () => h('em') });
    const state = createDocState({ document: simpleDocument() });
    const resolved = await withDocState(state, () => useSlot('NavTree', Fallback));

    // When
    state.theme.value = {
      name: 'later',
      slots: state.theme.value.slots,
      tokens: {},
      assets: {},
    };
    state.theme.value.slots.register('NavTree', Override);

    // Then
    expect(resolved.value).toBe(Override);
  });

  it('should refuse a name that is not a slot', async () => {
    // Given
    const Fallback = defineComponent({ name: 'Fallback', setup: () => () => h('span') });
    const state = createDocState({ document: simpleDocument() });

    // When
    const build = async (): Promise<unknown> =>
      withDocState(state, () => useSlot('NavTreeItem' as never, Fallback).value);

    // Then
    await expect(build()).rejects.toBeInstanceOf(SlotNotFoundError);
  });
});

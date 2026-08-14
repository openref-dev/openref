import { normalizeOpenApiDocument } from '@openref/core';
import { createDocState } from '@openref/vue';
import { defineComponent, h, type VNode } from 'vue';
import { describe, expect, it } from 'vitest';
import { renderThemeSlots } from '../../src/index';

/**
 * The dev harness, per BUILD T031.
 *
 * The conformance checker never calls a component, so a theme whose components throw satisfies
 * it. This is where they run, and the thing being asserted is that a throw comes back as a
 * result beside the slot's name rather than ending the run: an author wants the list of what is
 * broken, not the first item of it.
 */

/** The smallest document the normalizer accepts, so the harness has something real to render. */
function document(): ReturnType<typeof normalizeOpenApiDocument> {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    paths: {
      '/orders': {
        get: { operationId: 'listOrders', summary: 'List orders', responses: { '200': {} } },
      },
    },
  });
}

const working = defineComponent({
  name: 'Working',
  props: { message: { type: String, default: '' } },
  setup(props) {
    return (): VNode => h('p', { class: 'oref-notice' }, props.message);
  },
});

const broken = defineComponent({
  name: 'Broken',
  setup() {
    throw new Error('this theme reads a field that is not there');
  },
});

describe('renderThemeSlots', () => {
  it('should render a slot a theme filled and hand back its markup', async () => {
    // Given
    const state = createDocState({ document: document(), activeNodeId: 'get-orders' });

    // When
    const report = await renderThemeSlots({ StateNotice: working }, state, {
      StateNotice: { message: 'nothing to show' },
    });

    // Then
    expect(report.failed).toEqual([]);
    expect(report.rendered).toHaveLength(1);
    expect(report.rendered[0]?.slot).toBe('StateNotice');
    expect(report.rendered[0]?.html).toContain('nothing to show');
  });

  it('should report a component that throws beside its slot name rather than ending the run', async () => {
    // Given
    const state = createDocState({ document: document(), activeNodeId: 'get-orders' });

    // When
    const report = await renderThemeSlots(
      { StateNotice: broken, ProvenanceTag: working },
      state,
      {},
    );

    // Then
    expect(report.failed.map((outcome) => outcome.slot)).toEqual(['StateNotice']);
    expect(report.failed[0]?.error).toContain('a field that is not there');
    expect(report.rendered.map((outcome) => outcome.slot)).toEqual(['ProvenanceTag']);
  });

  it('should refuse a name that is not a slot with the same code a running reference uses', async () => {
    // Given
    const state = createDocState({ document: document(), activeNodeId: 'get-orders' });

    // When
    const run = async (): Promise<unknown> =>
      renderThemeSlots({ OperationFooter: working }, state, {});

    // Then
    await expect(run()).rejects.toThrow(/OperationFooter/);
  });
});

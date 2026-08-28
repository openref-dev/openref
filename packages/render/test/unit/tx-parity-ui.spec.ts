// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { PALETTE_NOTICES } from '../../src/components/palette-notices';
import { PaletteOverlay } from '../../src/components/PaletteOverlay';
import { StatesPanel } from '../../src/components/StatesPanel';
import { OperationHeader } from '../../src/components/OperationHeader';
import { mergeRememberedFrame } from '../../src/page/api/remembered';
import { buildPageModel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { smallDocument } from '../mocks/documents';
import { normalizeOpenApiDocument } from '@openref/core';
import type { FrameModel, NodeHeaderModel } from '@openref/vue';

const markdown = await createMarkdownRenderer();

/**
 * The wording tie, the memory merge and the badge of TX-PARITY-UI, at the unit level.
 *
 * THE PALETTE CHECK IS THE MAINTAINER'S OWN CLAUSE: fix the wording, then add the check,
 * because two strings drifting apart silently is what the states catalogue was built to
 * prevent. Both surfaces are rendered rather than their constants compared, so the day
 * someone inlines a string again is the day this goes red.
 */

async function html(component: unknown, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(component as never, props));
}

describe('the palette wording against the states catalogue', () => {
  it('should say the same sentence on both surfaces, for every palette state', async () => {
    // Given the catalogue, rendered
    const catalogue = await html(StatesPanel, {});

    for (const [kind, sentence] of Object.entries(PALETTE_NOTICES)) {
      // When the palette is rendered in the state that says this sentence
      const query = kind === 'search-empty' ? '' : 'nothing-matches-this';
      const overlay = await html(PaletteOverlay, {
        open: true,
        query,
        selected: 0,
        hits: [],
        partial: kind === 'search-partial',
        degraded: kind === 'search-unavailable',
        onOpen: () => undefined,
        onClose: () => undefined,
        onQuery: () => undefined,
        onSelect: () => undefined,
      });

      // Then the palette says the sentence and the catalogue's specimen begins with it,
      // verbatim: the catalogue shows what the product says, never something better
      expect(overlay, `the palette does not say the ${kind} sentence`).toContain(sentence);
      expect(
        catalogue,
        `the catalogue specimen does not begin with the ${kind} sentence`,
      ).toContain(`${sentence} Specimen`);
    }
  });
});

describe('the remembered frame merge', () => {
  const stats = { operations: 2, groups: 1, drift: null };
  const memory = {
    documentHash: 'abc',
    nodeId: 'get-orders',
    crumb: 'Orders / GET /orders',
    tabs: [
      { kind: 'node' as const, href: '/get-orders', active: false, count: 2 },
      { kind: 'schema' as const, href: '/schema/Order', active: false, count: 0 },
      { kind: 'shapes' as const, href: '/shapes/Order', active: false, count: 0 },
      { kind: 'bench' as const, href: '/bench/get-orders', active: false, count: 0 },
    ],
  };

  it('should fill the missing tabs, keep the crumb, and order the bar as the prototype does', () => {
    // Given the health page's own frame: the two document tabs and no operation
    const frame: FrameModel = {
      tabs: [
        { kind: 'health', href: '/health', active: true, count: 3 },
        { kind: 'states', href: '/states', active: false, count: 0 },
      ],
      crumb: '',
      backHref: '/',
      stats,
    };

    // When
    const merged = mergeRememberedFrame(frame, memory);

    // Then the six stand in the prototype's order and the crumb is the operation's
    expect(merged.tabs.map((tab) => tab.kind)).toEqual([
      'node',
      'schema',
      'shapes',
      'bench',
      'health',
      'states',
    ]);
    expect(merged.crumb).toBe('Orders / GET /orders');
    expect(merged.tabs.find((tab) => tab.active)?.kind).toBe('health');
  });

  it('should let the page own tabs win over the remembered ones', () => {
    // Given a schema page whose own schema and shapes tabs point at its own subject
    const frame: FrameModel = {
      tabs: [
        { kind: 'schema', href: '/schema/ProblemDto', active: true, count: 0 },
        { kind: 'shapes', href: '/shapes/ProblemDto', active: false, count: 0 },
        { kind: 'health', href: '/health', active: false, count: 3 },
        { kind: 'states', href: '/states', active: false, count: 0 },
      ],
      crumb: 'Schemas / ProblemDto',
      backHref: '/',
      stats,
    };

    // When
    const merged = mergeRememberedFrame(frame, memory);

    // Then the page's schema tab survives and only the operation tabs arrive from memory
    expect(merged.tabs.find((tab) => tab.kind === 'schema')?.href).toBe('/schema/ProblemDto');
    expect(merged.tabs.find((tab) => tab.kind === 'node')?.href).toBe('/get-orders');
    expect(merged.tabs.find((tab) => tab.kind === 'bench')?.href).toBe('/bench/get-orders');
  });
});

describe('the SSE badge', () => {
  function sseDocument(): ReturnType<typeof normalizeOpenApiDocument> {
    return normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Streams', version: '1.0.0' },
      paths: {
        '/events': {
          get: {
            operationId: 'streamEvents',
            summary: 'Stream events',
            responses: {
              '200': {
                description: 'The stream.',
                content: { 'text/event-stream': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    });
  }

  it('should mark the operation in the model, for the rail and the header alike', () => {
    // Given an operation whose declared responses carry text/event-stream
    const document = sseDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then the model says so once and both surfaces read it
    expect(model.node?.sse).toBe(true);
    const entry = model.navigation
      .flatMap((group) => [group, ...group.children])
      .find((candidate) => candidate.nodeId === nodeId);
    expect(entry?.sse).toBe(true);

    // And an ordinary operation says false
    const plain = buildPageModel(smallDocument(), {
      markdown,
      nodeId: 'get-orders',
    });
    expect(plain.node?.sse).toBe(false);
  });

  it('should draw SSE as the badge of the header, with the method staying a model fact', async () => {
    // Given
    const document = sseDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';
    const model = buildPageModel(document, { markdown, nodeId });
    const node = model.node as NodeHeaderModel | null;
    if (node === null) throw new Error('the fixture page has no node');

    // When
    const header = await html(OperationHeader, { node, drift: [], benchHref: '' });

    // Then
    expect(header).toContain('oref-method-sse');
    expect(header).toContain('>SSE<');
    expect(node.method).toBe('GET');
  });
});

describe('the parameter facts of the table', () => {
  it('should join the scan verdicts and the required header fact to the rows', () => {
    // Given an operation carrying the scan's verdicts and a guard-required header. The base
    // document is frozen, so the facts enter through a rebuilt node map, the runtimeDocument
    // pattern.
    const base = smallDocument();
    const node = base.nodes.get('get-orders');
    if (node?.kind !== 'operation') throw new Error('fixture');

    const withRuntime = {
      ...node,
      runtime: {
        parameterReads: {
          value: {
            parameters: [
              { in: 'query' as const, name: 'limit', verdict: 'not-seen-read' as const },
              { in: 'header' as const, name: 'X-Trace', verdict: 'not-seen-read' as const },
            ],
          },
          confidence: 'inferred' as const,
          collector: 'parameterReadsCollector',
        },
        requiredHeaders: {
          value: ['x-trace'],
          confidence: 'inferred' as const,
          collector: 'requiredHeadersCollector',
        },
      },
    };
    const nodes = new Map(base.nodes);
    nodes.set('get-orders', withRuntime);
    const document = { ...base, nodes };

    // When
    const model = buildPageModel(document, { markdown, nodeId: 'get-orders' });
    const limit = model.node?.parameters.find((parameter) => parameter.name === 'limit');
    const trace = model.node?.parameters.find((parameter) => parameter.name === 'X-Trace');

    // Then the scan's verdict lands on the row SP010 would name, and the guard's header
    // counts as read by the application, the SP010 skip read forwards
    expect(limit?.unread).toBe(true);
    expect(limit?.runtimeNote).toBe('not seen read by the handler');
    expect(limit?.confidence).toBe('inferred');
    expect(trace?.unread).toBe(false);
    expect(trace?.runtimeNote).toBe('required by the application');
  });

  it('should leave every column empty on a document-only page', () => {
    // Given
    const model = buildPageModel(smallDocument(), { markdown, nodeId: 'get-orders' });

    // Then
    expect(
      model.node?.parameters.every(
        (parameter) =>
          parameter.runtimeNote === '' && parameter.confidence === null && !parameter.unread,
      ),
    ).toBe(true);
  });
});

import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { ResponseView } from '../../src/components/ResponseView';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildNavigation, buildPageModel } from '../../src/page/domain/page-model';
import { buildRuntimeModel } from '../../src/page/domain/runtime-model';
import { renderPage } from '../../src/render/application/services/render.service';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';
import type { IRDocument, IRErrorContracts, IRNode } from '@openref/core';
import type { RunnerResult } from '@openref/vue';

const markdown = await createMarkdownRenderer();

/**
 * The cheap markup of TX-MARKUP, at the model level and on the served page.
 *
 * What is asserted is what a reader is shown: the kicker quotes the document and draws nothing
 * the document did not write, the drift box appears above zero only, the bench button exists
 * exactly when the bench tab does, the responses merge with what the runtime knows, the error
 * contracts return as the grid with the shared sentence said once, and the schema page carries
 * its dialect, its view segment and the permanent field anchors.
 */

/** The document with one node's errors record replaced. */
function withErrors(errors: IRErrorContracts): IRDocument {
  const base = smallDocument();
  const id = runtimeNodeId(base);
  const nodes = new Map<string, IRNode>(base.nodes);
  const node = nodes.get(id);
  if (node !== undefined) nodes.set(id, { ...node, runtime: { errors } });

  return { ...base, nodes };
}

describe('the operation header model', () => {
  it('should carry the tags and the public operation id for the kicker', () => {
    // Given, the fixture writes a real operationId, which T004 keeps as the public id
    const document = smallDocument();

    // When
    const page = buildPageModel(document, { nodeId: runtimeNodeId(document), markdown });

    // Then
    expect(page.node?.tags).toEqual(['orders']);
    expect(page.node?.operationId).toBe('listOrders');
  });

  it('should leave the operation id empty on a channel, which has none to quote', () => {
    // Given, a channel is the one node kind OpenAPI's field does not exist for
    const document = runtimeDocument();
    const channelId = [...document.nodes.keys()].find(
      (id) => document.nodes.get(id)?.kind === 'channel',
    );

    // A fixture with no channel asserts nothing about them, and says so rather than passing.
    if (channelId === undefined) {
      expect([...document.nodes.values()].every((node) => node.kind === 'operation')).toBe(true);
      return;
    }

    // When
    const page = buildPageModel(document, { nodeId: channelId, markdown });

    // Then
    expect(page.node?.operationId).toBe('');
  });
});

describe('the rail row model', () => {
  it('should carry the method apart from the hint, so the badge never parses a string', () => {
    // Given
    const document = smallDocument();

    // When
    const entries = buildNavigation(document);
    const group = entries.find((entry) => entry.label === 'orders');
    const operation = group?.children.find((child) => child.nodeId?.startsWith('get') === true);

    // Then, the method stands alone and the hint still carries both halves for the palette
    expect(operation?.method).toBe('GET');
    expect(operation?.hint.startsWith('GET ')).toBe(true);
    expect(group?.method).toBe('');
  });
});

describe('the merged response marks', () => {
  it('should flag a code the runtime knows that the specification does not carry', () => {
    // Given, the fixture derives 429 from the throttler and documents 200 and 404
    const document = runtimeDocument();

    // When
    const model = buildRuntimeModel(document, runtimeNodeId(document), '');

    // Then
    const mark = model?.responseMarks.find((candidate) => candidate.statusCode === '429');
    expect(mark?.undocumented).toBe(true);
    expect(mark?.confidence).toBe('derived');
    expect(mark?.collector).toBe('throttlerCollector');
  });

  it('should keep the highest confidence when two groups know one code', () => {
    // Given, 429 declared by a person and derived from the throttler at once
    const document = withErrors({
      declared: [
        {
          status: 429,
          title: 'Too Many Requests',
          origin: 'declared',
          confidence: 'declared',
          collector: 'errorsCollector',
        },
      ],
      runtimeDerived: [
        {
          status: 429,
          title: 'Too Many Requests',
          origin: 'runtime-derived',
          confidence: 'derived',
          collector: 'throttlerCollector',
        },
      ],
      global: [],
    });

    // When
    const model = buildRuntimeModel(document, runtimeNodeId(document), '');

    // Then, one mark, and the person's declaration outranks the derivation
    const marks = model?.responseMarks.filter((mark) => mark.statusCode === '429') ?? [];
    expect(marks).toHaveLength(1);
    expect(marks[0]?.confidence).toBe('declared');
  });
});

describe('the error contracts grid model', () => {
  it('should merge the 401 and 403 pair into one item that says the shared sentence once', () => {
    // Given, the two contracts one guard fact derives: same detail, same collector
    const detail =
      'This route is behind JwtAuthGuard, so it can refuse a caller before the handler runs.';
    const document = withErrors({
      declared: [],
      runtimeDerived: [
        {
          status: 401,
          title: 'Unauthorized',
          detail,
          origin: 'runtime-derived',
          confidence: 'derived',
          collector: 'guardsCollector',
        },
        {
          status: 403,
          title: 'Forbidden',
          detail,
          origin: 'runtime-derived',
          confidence: 'derived',
          collector: 'guardsCollector',
        },
      ],
      global: [],
    });

    // When
    const model = buildRuntimeModel(document, runtimeNodeId(document), '');

    // Then
    const derived = model?.contracts.find((group) => group.kind === 'errors-runtime-derived');
    expect(derived?.items).toHaveLength(1);
    expect(derived?.items[0]?.status).toBe('401, 403');
    expect(derived?.items[0]?.title).toBe('Unauthorized, Forbidden');
    expect(derived?.items[0]?.detail).toBe(detail);
  });

  it('should keep the empty declared group as the SPEC 6.4 sentence and drop the other two', () => {
    // Given, an examined route with nothing declared and nothing derived
    const document = withErrors({ declared: [], runtimeDerived: [], global: [] });

    // When
    const model = buildRuntimeModel(document, runtimeNodeId(document), '');

    // Then, one group, the person's, with its sentence; the two that assert nothing are absent
    expect(model?.contracts.map((group) => group.kind)).toEqual(['errors-declared']);
    expect(model?.contracts[0]?.empty).toContain('declares no errors');
  });

  it('should link a contract to the schema page it names', () => {
    // Given, a declared contract answering with the named Order schema the document carries
    const document = withErrors({
      declared: [
        {
          status: 400,
          title: 'Bad Request',
          type: '/problems/validation',
          origin: 'declared',
          confidence: 'declared',
          collector: 'errorsCollector',
          schema: { kind: 'named', schemaId: 'Order' },
        },
      ],
      runtimeDerived: [],
      global: [],
    });

    // When
    const model = buildRuntimeModel(document, runtimeNodeId(document), '/docs');

    // Then
    const item = model?.contracts[0]?.items[0];
    expect(item?.schemaLabel).toBe('Order');
    expect(item?.schemaHref).toBe('/docs/schema/Order');
    expect(item?.typeUri).toBe('/problems/validation');
  });
});

describe('the schema page model', () => {
  it('should carry the dialect line and the completed crumb', () => {
    // Given
    const document = smallDocument();

    // When
    const page = buildPageModel(document, { schemaId: 'Order', markdown });

    // Then, the dialect in the reader's words: the fixture is OpenAPI 3.1, whose schemas are
    // JSON Schema 2020-12. And the crumb reads group then name, with the group's label taken
    // off the navigation rather than spelled a second time.
    expect(page.schema?.dialect).toBe('JSON Schema 2020-12');
    expect(page.frame.crumb).toBe('Schemas / Order');
  });

  it('should say nothing about the dialect of a schema it does not have', () => {
    // Given
    const document = smallDocument();

    // When
    const page = buildPageModel(document, { schemaId: 'NoSuch', markdown });

    // Then
    expect(page.schema?.missing).toBe(true);
    expect(page.schema?.dialect).toBe('');
  });
});

describe('the served operation page', () => {
  it('should draw the kicker, the drift box and the bench link where each belongs', async () => {
    // Given, the fixture with facts, findings and a runnable operation
    const document = runtimeDocument();

    // When
    const { appHtml } = await renderPage(document, { nodeId: runtimeNodeId(document), markdown });

    // Then, the kicker quotes the document, the box counts the findings, the link leads to
    // the bench, and the rail rows carry the method badge and the path
    expect(appHtml).toContain('class="oref-kicker"');
    expect(appHtml).toContain('listOrders');
    expect(appHtml).toContain('class="oref-driftbox"');
    expect(appHtml).toContain('class="oref-bench-link"');
    expect(appHtml).toContain('class="oref-nav-path"');
    expect(appHtml).toContain('class="oref-kbd"');
  });

  it('should draw no drift box on a document nothing measured', async () => {
    // Given, the same operation with no health report behind it
    const document = smallDocument();

    // When
    const { appHtml } = await renderPage(document, { nodeId: runtimeNodeId(document), markdown });

    // Then, zero draws no box, per the driftCount rule
    expect(appHtml).not.toContain('oref-driftbox');
  });

  it('should draw the undocumented 429 as a flagged row and the grid under the responses', async () => {
    // Given
    const document = runtimeDocument();

    // When
    const { appHtml } = await renderPage(document, { nodeId: runtimeNodeId(document), markdown });

    // Then
    expect(appHtml).toContain('oref-response-undocumented');
    expect(appHtml).toContain('not in the specification');
    expect(appHtml).toContain('class="oref-errgrid"');
    expect(appHtml).toContain('oref-errgroup-errors-runtime-derived');
  });
});

describe('the response verdict chip', () => {
  const result: RunnerResult = {
    status: 500,
    statusText: 'Internal Server Error',
    headers: [],
    body: '',
    durationMs: 12,
  };

  it('should name an answer the declaration does not carry, without judging whose fault it is', async () => {
    // Given a 500 against a declaration of 200 and 404
    const html = await renderToString(
      h(ResponseView, { result, error: undefined, pending: false, declared: ['200', '404'] }),
    );

    // Then
    expect(html).toContain('oref-run-verdict-off');
    expect(html).toContain('500 not among the declared codes');
  });

  it('should draw no chip at all against an empty declaration', async () => {
    // Given, an operation that documents no responses: a comparison against nothing asserts
    // nothing, so nothing is drawn
    const html = await renderToString(
      h(ResponseView, { result, error: undefined, pending: false, declared: [] }),
    );

    // Then
    expect(html).not.toContain('oref-run-verdict');
  });
});

describe('the served schema page', () => {
  it('should draw the dialect, the view segment at both, and an anchor per row', async () => {
    // Given
    const document = smallDocument();

    // When
    const { appHtml } = await renderPage(document, { schemaId: 'Order', markdown });

    // Then, the segment's two buttons are both unpressed, which is the both view, and the
    // root row carries its permanent link
    expect(appHtml).toContain('class="oref-schema-dialect"');
    expect(appHtml).toContain('class="oref-seg"');
    const unpressed = appHtml.split('aria-pressed="false"').length - 1;
    expect(unpressed).toBeGreaterThanOrEqual(2);
    expect(appHtml).toContain('class="oref-schema-anchor"');
    expect(appHtml).toContain(`href="#${encodeURIComponent('Order')}"`);
  });

  it('should keep anchors off the trees a response draws, whose fragments belong to nobody', async () => {
    // Given, an operation page whose responses draw schema trees
    const document = smallDocument();

    // When
    const { appHtml } = await renderPage(document, { nodeId: runtimeNodeId(document), markdown });

    // Then
    expect(appHtml).not.toContain('oref-schema-anchor');
  });
});

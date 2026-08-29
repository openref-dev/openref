// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildPageModel } from '../../src/page/domain/page-model';
import { serializePageModel } from '../../src/render/application/services/render.service';
import { DocumentOverview } from '../../src/components/DocumentOverview';
import { smallDocument } from '../mocks/documents';
import { buildTopology, type IRDocument, type IRRelationship } from '@openref/core';
import type { PageModel } from '@openref/vue';

/**
 * The topology section of `T052`, per SPEC 9.5.
 *
 * WHAT THIS FILE IS ABOUT IS WHETHER THE GRAPH SAYS HOW MUCH IT TRUSTS ITSELF, which is the
 * task's own definition of done. A declared edge and an inferred one have to be told apart by a
 * reader with no colour and no stylesheet, which is what `ProvenanceTag` already does for a
 * runtime fact and what the cases below assert it does here.
 *
 * AND WHETHER THE SHAPE OF THE GRAPH CAN HURT THE PAGE. Three of the task's four test clauses are
 * about that: a cycle must not hang the layout, five hundred edges must stay within the
 * interaction budget, and an event nobody consumes must be drawn as a dead end rather than
 * dropped. All three are properties of an adjacency list, and all three are asserted here against
 * the markup rather than against the model, because the model is where they are easy.
 *
 * WHAT THIS FILE CANNOT SEE, SAID HERE SO NOBODY READS IT AS COVER IT DOES NOT GIVE. Every case
 * below mounts `DocumentOverview` itself, so none of them travels through the `OverviewPosition`
 * of `packages/render/src/components/eager.ts`, where a prop that is not forwarded by name is
 * dropped in silence. Measured: deleting `topology` from that forward leaves every case in this
 * file green. The two suites that turn red are
 * `packages/render/test/integration/element.spec.ts` and
 * `packages/theme-telltale/test/integration/topology-strip.spec.ts`.
 */

const markdown = await createMarkdownRenderer();

function edge(
  from: string,
  fromKind: IRRelationship['fromKind'],
  to: string,
  toKind: IRRelationship['toKind'],
  type: IRRelationship['type'] = 'publishes',
  confidence: IRRelationship['confidence'] = 'declared',
): IRRelationship {
  return { from, fromKind, to, toKind, type, confidence };
}

/** The corpus document the overview cases render, with a graph planted on it. */
function documentWithEdges(relationships: readonly IRRelationship[]): IRDocument {
  return { ...smallDocument(), relationships };
}

async function overviewHtml(relationships: readonly IRRelationship[]): Promise<string> {
  return renderToString(
    createSSRApp(DocumentOverview as never, {
      title: 'Orders API',
      descriptionHtml: '',
      servers: [],
      basePath: '/docs',
      topology: buildTopology(documentWithEdges(relationships)),
    }),
  );
}

/**
 * How deep the deepest element in a fragment of markup is nested.
 *
 * IT COUNTS TAGS RATHER THAN ASKING A DOM, deliberately. The claim under test is about the shape
 * the renderer emits, and a parser that repairs bad nesting on the way in would answer for the
 * repair instead. Every element this section draws has a closing tag, so a counter over the tag
 * stream is exact here; a void element would need naming, and there is none.
 */
function maximumDepth(markup: string): number {
  let depth = 0;
  let deepest = 0;

  for (const tag of markup.matchAll(/<(\/?)([a-z0-9-]+)[^>]*?(\/?)>/gi)) {
    if (tag[3] === '/') continue;
    if (tag[1] === '/') depth -= 1;
    else {
      depth += 1;
      deepest = Math.max(deepest, depth);
    }
  }

  return deepest;
}

function countOf(markup: string, className: string): number {
  return markup.split(`class="${className}"`).length - 1;
}

describe('the topology section', () => {
  it('should tell a declared edge and an inferred one apart in the markup itself', async () => {
    // Given one edge of each level, which is the only pair SPEC 9 asks a reader to distinguish
    const markup = await overviewHtml([
      edge('orders', 'service', 'orders.placed', 'event'),
      edge('billing', 'service', 'billing.settled', 'event', 'publishes', 'inferred'),
    ]);

    // When
    const declared = markup.includes('oref-prov oref-prov-declared');
    const inferred = markup.includes('oref-prov oref-prov-inferred');

    // Then both marks are in the markup, they are different classes, and the three letter codes
    // are there too, so the difference survives a monochrome print and a missing stylesheet
    expect(declared).toBe(true);
    expect(inferred).toBe(true);
    expect(markup).toContain('DCL');
    expect(markup).toContain('INF');
    expect(markup).toContain('title="declared, topology"');
    expect(markup).toContain('title="inferred, topology"');
  });

  it('should draw a cycle as three groups and finish', async () => {
    // Given three services calling each other in a ring, which a real estate produces routinely
    const markup = await overviewHtml([
      edge('a', 'service', 'b', 'service', 'calls'),
      edge('b', 'service', 'c', 'service', 'calls'),
      edge('c', 'service', 'a', 'service', 'calls'),
    ]);

    // Then the render terminated, every source is a group of its own, and each holds one row
    expect(countOf(markup, 'oref-topology-node')).toBe(3);
    expect(countOf(markup, 'oref-topology-edge')).toBe(3);
    expect(markup).not.toContain('dead end');
  });

  it('should draw an event nobody consumes as a dead end rather than dropping it', async () => {
    // Given one event with a consumer and one with none
    const markup = await overviewHtml([
      edge('orders', 'service', 'orders.placed', 'event'),
      edge('orders.placed', 'event', 'ledger', 'service', 'subscribes'),
      edge('orders', 'service', 'orders.archived', 'event'),
    ]);

    // Then the edge is present first, which is what says nothing was dropped, and the words go on
    // every end nothing leaves, which is two of the three: the event nobody consumes and the
    // consumer, which publishes nothing further. Only `orders.placed` has an edge of its own
    expect(markup).toContain('orders.archived');
    expect(markup).toContain('orders.placed');
    expect(countOf(markup, 'oref-topology-edge')).toBe(3);
    expect(countOf(markup, 'oref-topology-dead')).toBe(2);
  });

  it('should draw 500 relationships at the nesting depth of 3, which is the budget', async () => {
    // Given a graph of 500 edges over 100 sources, and a three edge graph to compare it against
    const many: IRRelationship[] = [];
    for (let index = 0; index < 500; index += 1)
      many.push(
        edge(
          `service-${String(index % 100).padStart(3, '0')}`,
          'service',
          `event-${String(index).padStart(3, '0')}`,
          'event',
        ),
      );
    const few = [
      edge('a', 'service', 'x', 'event'),
      edge('b', 'service', 'y', 'event'),
      edge('c', 'service', 'z', 'event'),
    ];

    // When
    const big = await overviewHtml(many);
    const small = await overviewHtml(few);

    // Then every edge is drawn, and the deepest nesting is the same for both: the layout cost is
    // linear in the number of rows and nothing about it grows with the shape of the graph
    expect(countOf(big, 'oref-topology-edge')).toBe(500);
    expect(countOf(big, 'oref-topology-node')).toBe(100);
    expect(countOf(small, 'oref-topology-edge')).toBe(3);
    expect(maximumDepth(big)).toBe(maximumDepth(small));
  });

  it('should link an end that resolved to a node and leave an unresolved one as text', async () => {
    // Given one end naming an operation this document has and one naming a service it does not
    const markup = await overviewHtml([edge('get-orders', 'node', 'ledger', 'service')]);

    // Then, with the node asserted present in the document first
    expect(smallDocument().nodes.has('get-orders')).toBe(true);
    expect(markup).toContain('href="/docs/get-orders"');
    expect(markup).toContain('GET /orders');
    expect(markup).toContain('<span class="oref-topology-name">ledger</span>');
  });

  it('should say in words that an end leads out of what the document knows', async () => {
    // Given three ends of one document: an operation it holds, a service it does not, and an
    // event address no channel of it answers. The first is the control that keeps the mark from
    // being one that fires on everything.
    const markup = await overviewHtml([
      edge('get-orders', 'node', 'ledger-service', 'service', 'calls'),
      edge('get-orders', 'node', 'orders.placed', 'event'),
    ]);

    // Then, with the node asserted present in the document first, every edge is drawn and only
    // the two ends that lead outside carry the words. A reader with no stylesheet reads them.
    expect(smallDocument().nodes.has('get-orders')).toBe(true);
    expect(countOf(markup, 'oref-topology-edge')).toBe(2);
    expect(countOf(markup, 'oref-topology-outside')).toBe(2);
    expect(markup).toContain('<span class="oref-topology-outside">outside</span>');
    expect(markup).toContain('ledger-service');
    expect(markup).toContain('orders.placed');
  });

  it('should draw no outside mark on a graph whose every end the document holds', async () => {
    // Given the falsification pair for the case above: the same section, every end resolved
    const markup = await overviewHtml([edge('get-orders', 'node', 'get-orders', 'node', 'calls')]);

    // Then the section is there and the mark is not, so the mark reports a fact rather than
    // decorating every row
    expect(countOf(markup, 'oref-topology-edge')).toBe(1);
    expect(markup).toContain('oref-section-topology');
    expect(markup).not.toContain('oref-topology-outside');
  });

  it('should tell an outside end and a dead end apart, since they are different facts', async () => {
    // Given a service this unmerged document does know, its own id, leading to an operation it
    // holds that leads nowhere, beside a service it does not know
    const document = smallDocument();
    const markup = await renderToString(
      createSSRApp(DocumentOverview as never, {
        title: 'Orders API',
        descriptionHtml: '',
        servers: [],
        basePath: '/docs',
        topology: buildTopology({
          ...document,
          relationships: [
            edge(document.id, 'service', 'get-orders', 'node'),
            edge(document.id, 'service', 'ledger-service', 'service', 'calls'),
          ],
        }),
      }),
    );

    // Then both edges are dead ends, and only one of them is outside: an end the document holds
    // and nothing leaves is a fact about the estate, and an end the document does not hold is a
    // fact about the boundary of this composition
    expect(countOf(markup, 'oref-topology-dead')).toBe(2);
    expect(countOf(markup, 'oref-topology-outside')).toBe(1);
  });

  it('should draw no section at all for a document that declares no edge', async () => {
    // Given the same document with and without a graph, which is the falsification pair
    const without = buildPageModel(smallDocument(), { markdown });
    const with_ = buildPageModel(documentWithEdges([edge('a', 'service', 'b', 'event')]), {
      markdown,
    });

    // When
    const silent = await renderToString(
      createSSRApp(DocumentOverview as never, {
        title: 'Orders API',
        descriptionHtml: '',
        servers: [],
        basePath: '',
        topology: without.topology,
      }),
    );
    const drawn = await renderToString(
      createSSRApp(DocumentOverview as never, {
        title: 'Orders API',
        descriptionHtml: '',
        servers: [],
        basePath: '',
        topology: with_.topology,
      }),
    );

    // Then the model says null rather than an empty graph, and the planted edge is what makes
    // the section appear
    expect(without.topology).toBeNull();
    expect(silent).not.toContain('oref-section-topology');
    expect(with_.topology?.edgeCount).toBe(1);
    expect(drawn).toContain('oref-section-topology');
  });
});

describe('the topology on the page model', () => {
  it('should carry the graph on the overview and on no other page', () => {
    // Given a document that declares an edge
    const document = documentWithEdges([edge('orders', 'service', 'orders.placed', 'event')]);

    // When
    const overview = buildPageModel(document, { markdown });
    const node = buildPageModel(document, { markdown, nodeId: 'get-orders' });
    const health = buildPageModel(document, { markdown, page: 'health' });

    // Then, with the node page asserted to be a node page rather than a degraded overview
    expect(node.kind).toBe('node');
    expect(overview.topology?.edgeCount).toBe(1);
    expect(node.topology).toBeNull();
    expect(health.topology).toBeNull();
  });

  it('should keep the graph off the wire, because the position is adopted', () => {
    // Given an overview page whose graph the server drew
    const model: PageModel = buildPageModel(
      documentWithEdges([edge('orders', 'service', 'orders.placed', 'event')]),
      { markdown },
    );

    // When
    const state: unknown = JSON.parse(serializePageModel(model));

    // Then the server had one, which is what makes the null below a redaction rather than an
    // absence, and the client gets none
    expect(model.topology).not.toBeNull();
    expect((state as { topology: unknown }).topology).toBeNull();
  });
});

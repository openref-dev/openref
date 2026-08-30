import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import { eventsDocument, runtimeDocument, topologyDocument } from '../mocks/documents';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import { renderPage } from '../../../render/src/render/application/services/render.service';

/**
 * The topology of SPEC 9, as an L2 theme has to draw it.
 *
 * WHY THIS FILE EXISTS IS A FINDING RATHER THAN A FEATURE. `T052` put the graph inside the
 * `DocumentOverview` position, and this theme replaces that position, so the reference's markup
 * never reaches a telltale page at all. The boundary sweep cannot report that: it only ever sees
 * class names that survive an override, and a whole feature drawn inside one survives as nothing.
 * So a theme that placed only its children would have shipped a finished looking overview with the
 * graph missing, and every existing test would have stayed green.
 *
 * WHAT IT PINS IS THE FOUR THINGS A GRAPH HAS TO SAY. That there is one at all; that an edge whose
 * target leads nowhere says so in words; that a declared edge and an inferred one are told apart
 * without colour; and that an end which resolved to a node is a link while one that did not is
 * not, because a link to a page that does not exist is worse than plain text.
 */

const markdown = await createMarkdownRenderer();

async function overview(document: ReturnType<typeof topologyDocument>): Promise<string> {
  const rendered = await renderPage(document, { markdown, theme: telltale });
  return rendered.appHtml;
}

describe('the telltale overview and the topology graph', () => {
  it('should draw the graph the document declares', async () => {
    // Given a document that declares edges, and the same theme on a document that declares none
    const withGraph = await overview(topologyDocument());
    const withoutGraph = await overview(runtimeDocument());

    // Then, and the pair is what makes this a reading of the document rather than of the theme
    expect(topologyDocument().relationships.length).toBeGreaterThan(0);
    expect(runtimeDocument().relationships).toEqual([]);
    expect(withGraph).toContain('TOPOLOGY');
    expect(withGraph).toContain('tt-topology-list');
    expect(withoutGraph).not.toContain('tt-topology-list');
  });

  it('should say a dead end in words rather than in a colour', async () => {
    // Given the fixture's one event that nothing consumes, beside two that are consumed
    const markup = await overview(topologyDocument());

    // When
    const rows = markup.split('tt-topology-row').length - 1;
    const dead = markup.split('tt-topology-dead').length - 1;

    // Then every declared edge is drawn, which says nothing was dropped, and only the ends with
    // nothing leaving them carry the words
    expect(rows).toBe(topologyDocument().relationships.length);
    expect(dead).toBe(2);
    expect(markup).toContain('DEAD END');
  });

  it('should tell a declared edge and an inferred one apart with no colour', async () => {
    // Given one edge of each level on the same page
    const markup = await overview(topologyDocument());

    // Then both marks are drawn, by this theme's own component, with the three letter codes in
    // the markup rather than in generated content
    expect(markup).toContain('tt-prov-declared');
    expect(markup).toContain('tt-prov-inferred');
    expect(markup).toContain('DCL');
    expect(markup).toContain('INF');
    expect(markup).toContain('title="inferred, topology"');
  });

  it('should say in words which ends lead out of what the document knows', async () => {
    // Given the fixture, whose two planted edges name event addresses no channel of it answers,
    // beside the AsyncAPI edges whose ends are all channels it holds and its own service name
    const document = topologyDocument();
    const markup = await overview(document);

    // When
    const outside = markup.split('tt-topology-outside').length - 1;
    const rows = markup.split('tt-topology-row').length - 1;

    // Then the mark is on the two ends the document has nothing under, and on no other row. The
    // count is read against the fixture's own edges rather than written down, so an edge added to
    // the fixture is read here rather than absorbed.
    const unknown = document.relationships.filter(
      (edge) =>
        edge.toKind === 'event' &&
        ![...document.nodes.values()].some(
          (node) => node.kind === 'channel' && node.address === edge.to,
        ),
    );

    expect(unknown.length).toBeGreaterThan(0);
    expect(rows).toBe(document.relationships.length);
    expect(outside).toBe(unknown.length);
    expect(markup).toContain('OUTSIDE');
  });

  it('should draw no outside mark on a document whose every end it holds', async () => {
    // Given the falsification pair: the same theme, the same section, and a graph with nothing
    // outside it, so the mark reports a fact rather than decorating every row
    const events = eventsDocument();
    const markup = await overview(events);

    // Then, with the section asserted present first
    expect(events.relationships.length).toBeGreaterThan(0);
    expect(markup).toContain('tt-topology-list');
    expect(markup).not.toContain('tt-topology-outside');
  });

  it('should name the federation fact on an end no document of it declares', async () => {
    // Given a merged document, which is the only producer of the fourth end kind, carrying one
    // undeclared event end beside the fixture's ordinary outside ends
    const base = topologyDocument();
    const document = {
      ...base,
      services: [
        {
          id: 'web',
          documentId: 'web-api',
          documentHash: '',
          kind: 'events' as const,
          info: { title: 'Web', version: '1.0.0' },
          servers: [],
        },
      ],
      relationships: [
        ...base.relationships,
        {
          from: base.id,
          fromKind: 'service' as const,
          to: 'a/created',
          toKind: 'undeclared-event' as const,
          type: 'publishes' as const,
          confidence: 'declared' as const,
        },
      ],
    };

    // When
    const markup = await overview(document);

    // Then this theme draws the phrase too, under its own class and its own three letter code,
    // beside the DCL and INF this file already pins. A theme that drew a third state in colour
    // alone would lose it in print and in a screen reader, which is what the other two marks of
    // this section were built to avoid.
    expect(markup).toContain(
      '<abbr class="tt-topology-undeclared" ' +
        'title="No document in this federation declares this event">UND</abbr>',
    );
    expect(markup.split('tt-topology-undeclared').length - 1).toBe(1);

    // AND NO PART OF THE PAGE NAMES THE MECHANISM, in this theme as in the reference. Reader
    // visible text is the text nodes plus every `title`, since a title is what a pointer and a
    // screen reader are both handed, and a reader of an estate page is owed the estate rather than
    // an account of what we did to build it. The subject is asserted present before the absence.
    const readable = markup
      .replace(/<[^>]*\btitle="([^"]*)"[^>]*>/g, ' $1 ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    expect(readable).toContain('No document in this federation declares this event');
    expect(readable).not.toMatch(/merg|join|address/i);

    // And the row it sits on is the row for that end, with the bare word replaced rather than
    // joined, while the fixture's own outside ends keep theirs
    expect(markup).toContain('<span class="tt-topology-name">a/created</span><abbr');
    expect(markup).toContain('OUTSIDE');
  });

  it('should link an end that resolved to a node and leave an unresolved one as text', async () => {
    // Given the events fixture, whose edges name two channels this document holds and one service
    // it does not, so both branches are on one page
    const markup = await overview(topologyDocument());
    const [templated] = [...eventsDocument().nodes.keys()];

    // Then, with the node asserted present first
    expect(templated).toBeDefined();
    expect(markup).toContain(`class="tt-topology-name" href="/${templated ?? ''}"`);
    expect(markup).toContain('<span class="tt-topology-name">orders.archived</span>');
  });
});

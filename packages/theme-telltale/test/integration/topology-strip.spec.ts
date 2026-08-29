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

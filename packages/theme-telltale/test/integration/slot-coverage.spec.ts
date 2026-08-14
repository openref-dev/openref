import { SLOT_NAMES, type SlotName } from '@openref/vue';
import { describe, expect, it } from 'vitest';
import telltale from '../../src/theme';
import type { PageKind } from '@openref/vue';
import { apiDocument, nodeId, postNodeId, runtimeDocument } from '../mocks/documents';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import { renderPage } from '../../../render/src/render/application/services/render.service';
import type { IRDocument } from '@openref/core';

/**
 * Every position of the frozen registry, drawn by this theme, through the renderer a reader loads.
 *
 * IT GOES THROUGH `renderPage` AND NOT THROUGH A HARNESS. `@openref/theme-kit` can render a
 * theme's components against props a caller supplies, and that answers a different question: it
 * proves the component works when handed the right thing. This file proves the reference hands it
 * the right thing, on the page a reader opens, which is the only question T032 was scheduled to
 * settle. It is the one place this package reaches for `@openref/render`, and it is a test.
 *
 * EVERY CASE ASSERTS THE PROOF ORDER THE STANDING RULE REQUIRES, in both directions: the
 * reference's own marker is on the un-themed page first, then this theme's marker is on the themed
 * page and the reference's is gone. Without the first half, "the override worked" and "the position
 * never existed" are the same green, and twenty one cases would inherit that as a habit.
 */

const markdown = await createMarkdownRenderer();

interface Where {
  readonly page?: PageKind;
  readonly nodeId?: string | null;
  readonly schemaId?: string | null;
}

async function themed(document: IRDocument, where: Where = {}): Promise<string> {
  return (await renderPage(document, { ...where, markdown, theme: telltale })).appHtml;
}

async function plain(document: IRDocument, where: Where = {}): Promise<string> {
  return (await renderPage(document, { ...where, markdown })).appHtml;
}

/**
 * Drives one position and refuses to pass vacuously.
 *
 * @param document - The document to render
 * @param referenceMarker - Something the reference writes at that position and this theme does not
 * @param themeMarker - Something this theme writes there
 * @param where - Which page draws the position
 * @returns The themed page, for a case that wants to say more about it
 */
async function drive(
  document: IRDocument,
  referenceMarker: string,
  themeMarker: string,
  where: Where = {},
): Promise<string> {
  const before = await plain(document, where);
  expect(
    before,
    `the reference draws no ${referenceMarker} on this page, so the case proves nothing`,
  ).toContain(referenceMarker);

  const after = await themed(document, where);

  expect(after, `telltale draws no ${themeMarker} where the reference drew`).toContain(themeMarker);
  expect(after).not.toContain(referenceMarker);

  return after;
}

describe('every position of the registry, drawn by telltale', () => {
  it('should draw the telltale frame instead of the reference frame', async () => {
    // Given, this is `AppShell` and it is also what `defineTheme.layout` resolves into, so one
    // case is the proof for both mechanisms.
    const document = apiDocument();

    // When
    const html = await drive(document, 'oref-sidebar', 'tt-shell');

    // Then the reference's brand and skip link are gone with the rest of its frame
    expect(html).not.toContain('oref-brand');
    expect(html).toContain('tt-status');
  });

  it('should draw the telltale tree instead of the windowed one', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-nav-scroll', 'tt-nav-row');
  });

  it('should draw the telltale palette instead of the reference search button', async () => {
    // Given, the palette renders closed on the server, which is a button and not an absence.
    // When, Then
    await drive(apiDocument(), 'oref-palette-open', 'tt-palette-open');
  });

  it('should draw the telltale overview instead of the document article', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-overview', 'tt-overview');
  });

  it('should draw the telltale schema page instead of the reference one', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-schema-page', 'tt-schema-page', { schemaId: 'Order' });
  });

  it('should draw the telltale operation head instead of the reference header', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-operation-title', 'tt-op-head', { nodeId: nodeId() });
  });

  it('should draw the telltale runtime cells instead of the parity scale', async () => {
    // Given, the block is drawn only for a node with facts, per SPEC 6.3, and since TX-GUTTER
    // the reference's default there is the parity scale.
    // When, Then
    await drive(runtimeDocument(), 'oref-parity-grid', 'tt-cell-label', { nodeId: nodeId() });
  });

  it('should draw the telltale provenance code instead of the reference mark', async () => {
    // Given
    // When
    const html = await drive(runtimeDocument(), 'oref-prov-derived', 'tt-prov-derived', {
      nodeId: nodeId(),
    });

    // Then the three letter code is in the markup and not in a stylesheet, so it survives a
    // monochrome print and reaches a screen reader as text
    expect(html).toContain('DRV');
  });

  it('should draw the telltale finding rows instead of the reference drift rows', async () => {
    // Given, a document whose runtime facts disagree with what it declares
    const document = runtimeDocument();
    const before = await plain(document, { nodeId: nodeId() });
    expect(before, 'this fixture produces no finding, so the case proves nothing').toContain(
      'oref-drift-rule',
    );

    // When, Then
    await drive(document, 'oref-drift-rule', 'tt-drift-rule', { nodeId: nodeId() });
  });

  it('should draw the telltale parameter table instead of the reference one', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-param-row', 'tt-col-name', { nodeId: nodeId() });
  });

  it('should draw the telltale response strips instead of the status rows', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-response-head', 'tt-response-line', { nodeId: nodeId() });
  });

  it('should draw the telltale call samples instead of the reference tab strip', async () => {
    // Given, the samples come from `x-codeSamples`, per SPEC 18
    const document = apiDocument();
    expect(await plain(document, { nodeId: nodeId() })).toContain('cURL');

    // When, Then
    await drive(document, 'oref-sample-tab', 'tt-sample-tab', { nodeId: nodeId() });
  });

  it('should draw the telltale schema tree instead of the expandable rows', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-schema-tree', 'tt-tree-row', { nodeId: nodeId() });
  });

  it('should draw the telltale body editor instead of the reference fields', async () => {
    // Given, the editor is drawn for the operation that declares a body
    // When, Then
    await drive(apiDocument(), 'oref-field-body', 'tt-body', {
      page: 'bench',
      nodeId: postNodeId(),
    });
  });

  it('should draw the telltale credentials block instead of the reference scheme fields', async () => {
    // Given
    // When
    const html = await drive(apiDocument(), 'oref-field-auth-apiKey', 'tt-auth', {
      page: 'bench',
      nodeId: postNodeId(),
    });

    // Then nothing typed is in the markup, because `mounted` is false in a server render and the
    // page is cached by document hash
    expect(html).toContain('disabled');
  });

  it('should draw the telltale server chooser instead of the reference url field', async () => {
    // Given
    // When, Then
    await drive(apiDocument(), 'oref-field-server-url', 'tt-server', {
      page: 'bench',
      nodeId: nodeId(),
    });
  });

  it('should draw the telltale send control instead of the reference button and notice', async () => {
    // Given, the marker is the reference's own markup and not the sentence beside it. The sentence
    // arrives as the `notice` prop, so both themes print the same words and a case that keyed on
    // them would be asserting that this theme dropped its data.
    // When
    const html = await drive(apiDocument(), 'oref-tryit-actions', 'tt-send', {
      page: 'bench',
      nodeId: nodeId(),
    });

    // Then the sentence is associated with the button rather than merely beside it, per SPEC 11
    expect(html).toContain('aria-describedby="tt-send-notice"');
    expect(html).toContain('The console loads when you press Send.');
  });

  it('should resolve the result position before anything has been sent', async () => {
    // Given, the reference draws nothing there until a response arrives, so this case asserts the
    // position is resolved rather than that markup was replaced: a position that only existed once
    // it had content is a position a theme cannot fill with an empty state.
    // When
    const html = await themed(apiDocument(), { page: 'bench', nodeId: nodeId() });

    // Then
    expect(html).toContain('tt-result-idle');
    expect(html).toContain('nothing sent yet');
  });

  it('should draw the telltale stream log instead of the two reference controls', async () => {
    // Given, the log is drawn for an operation a collector said streams, per SPEC 14.6
    const document = runtimeDocument();
    const id = nodeId(document);
    const node = document.nodes.get(id);
    if (node?.kind !== 'operation') throw new Error('the fixture lost its operation');

    const nodes = new Map(document.nodes);
    nodes.set(id, {
      ...node,
      runtime: {
        ...node.runtime,
        streaming: {
          value: { transport: 'sse' },
          confidence: 'declared',
          collector: 'streamCollector',
        },
      },
    });

    // When, Then
    await drive({ ...document, nodes }, 'oref-stream-start', 'tt-stream-start', {
      page: 'bench',
      nodeId: id,
    });
  });

  it('should draw the telltale health panel, on the server, where the browser adopts it', async () => {
    // Given, this is the one server side slot: the browser fills the position with an element that
    // adopts the markup rather than drawing it, per SPEC 7.2 and 12.
    const document = runtimeDocument();

    // When
    const html = await drive(document, 'oref-health-score', 'tt-health-score', {
      page: 'health',
    });

    // Then the root element is the section the client adopts, carrying that class and no other.
    // A root that also carried `tt-health` would have it patched away on hydration, silently and
    // only in a browser, which is why this theme's own class is on the element inside.
    expect(html).toContain('<section class="oref-section-health">');
    expect(html).not.toContain('oref-section-health tt-');
  });

  it('should draw the telltale notice instead of the reference sentence', async () => {
    // Given, a link to a schema this document does not declare, which is one of the eight notices
    const document = apiDocument();
    expect(await plain(document, { schemaId: 'Gone' })).toContain(
      'This document declares no such schema.',
    );

    // When, Then
    await drive(document, 'oref-schema-empty', 'tt-notice', { schemaId: 'Gone' });
  });

  it('should have a case for every name in the registry, so the coverage rests on evidence', () => {
    // Given, a count is not evidence and a case per name is, so the list is checked from the other
    // end: a name added to the registry with no case here fails rather than shipping as a promise.
    const cases = new Set<SlotName>([
      'AppShell',
      'NavTree',
      'CommandPalette',
      'DocumentOverview',
      'SchemaPage',
      'OperationHeader',
      'RuntimePanel',
      'ProvenanceTag',
      'DriftCard',
      'ParamTable',
      'ResponseList',
      'CodeSample',
      'SchemaTree',
      'ShapeForm',
      'AuthPanel',
      'ServerSelect',
      'SendButton',
      'ResponseView',
      'StreamLog',
      'HealthScore',
      'StateNotice',
    ]);

    // When
    const uncovered = SLOT_NAMES.filter((name) => !cases.has(name));

    // Then
    expect(uncovered).toEqual([]);
    expect(cases.size).toBe(SLOT_NAMES.length);
  });
});

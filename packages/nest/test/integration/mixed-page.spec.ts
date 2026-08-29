import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
  parseSpecification,
  type IRDocument,
} from '@openref/core';
import { mergeDocuments } from '@openref/federation';
import {
  buildNavigation,
  buildPageModel,
  createMarkdownRenderer,
  renderPage,
} from '@openref/render';
import { describe, expect, it } from 'vitest';
import type { NavEntryModel } from '@openref/render';

/**
 * One page over a document that carries HTTP operations and event channels at once, per `T050`.
 *
 * WHY THIS FILE IS IN `@openref/nest`. The renderer may reach `core` and `vue` and nothing else,
 * per STANDARDS 3.5, and a mixed document has exactly one producer, `mergeKind` in
 * `@openref/federation`, per SPEC 15.1: no specification format writes `paths` and `channels`
 * together, so each normalizer answers with one kind by construction. `nest` is the first package
 * allowed to see both the merge and the renderer, so it is the only honest home for a case that
 * renders a merged page.
 *
 * WHAT IT ASSERTS IS THE TWO CLAUSES `T050` OWNS OVER SUCH A DOCUMENT. That the navigation mixes
 * operations and channels coherently rather than splitting into two trees, which is the build
 * item's own wording; and that the SPEC 20 budgets hold on it, which is the test item's. The
 * inputs are two documents this repository did not write, one from each corpus, for the reason
 * `packages/federation/test/integration/mixed-corpus.spec.ts` gives.
 */

const CORE_TEST = join(import.meta.dirname, '..', '..', '..', 'core', 'test');
const HTTP_DOCUMENT = join(CORE_TEST, 'corpus', 'documents', 'oai-petstore.yaml');
const EVENT_DOCUMENT = join(CORE_TEST, 'events-corpus', 'documents', 'aai-streetlights-kafka.yml');

/** SPEC 20: the schemas one page ships, which the renderer bounds and this asserts is bounded. */
const SCHEMA_PAYLOAD_LIMIT = 128 * 1024;

/**
 * SPEC 20: a page of the 1000 node document hands the main thread at most 203 KB.
 *
 * THE DOCUMENT HALF OF IT IS WHAT CAN BE MEASURED HERE, and it is the half a channel page could
 * move: the CSS and the JS are the same files whatever page is served, and the served document
 * row of SPEC 20 caps that half at 72 KB on its own. The two corpus documents together are far
 * smaller than a thousand nodes, so a channel page over them landing anywhere near the served
 * document cap would mean the page grew with something other than the document.
 */
const SERVED_DOCUMENT = 72 * 1024;

const markdown = await createMarkdownRenderer();

function mixedDocument(): IRDocument {
  const petstore = normalizeOpenApiDocument(
    parseSpecification(readFileSync(HTTP_DOCUMENT, 'utf8')),
  );
  const streetlights = normalizeAsyncApiDocument(
    parseSpecification(readFileSync(EVENT_DOCUMENT, 'utf8')),
  );

  // ASSERTED BEFORE THE MERGE, not after it: a corpus file quietly replaced by one of the other
  // family would make `mixed` unreachable, and every case below would then fail for a reason
  // nobody could read off the failure.
  expect(petstore.kind).toBe('http');
  expect(streetlights.kind).toBe('events');

  const { document } = mergeDocuments(
    [
      { id: 'petstore', document: petstore },
      { id: 'streetlights', document: streetlights },
    ],
    { id: 'platform', info: { title: 'Platform', version: '2026.8' } },
  );

  return document;
}

/** Every navigation row of a page model, flattened the way the rail draws them. */
function rowsOf(entries: readonly NavEntryModel[]): NavEntryModel[] {
  return entries.flatMap((entry) => [entry, ...rowsOf(entry.children)]);
}

describe('a page over a mixed HTTP and events document', () => {
  it('should put operations and channels in one navigation tree rather than two', () => {
    // Given the merged document, which really does carry both kinds of node
    const document = mixedDocument();
    const kinds = new Set([...document.nodes.values()].map((node) => node.kind));
    expect(document.kind).toBe('mixed');
    expect(kinds).toEqual(new Set(['operation', 'channel']));

    // When the navigation the rail is built from is derived
    const rows = rowsOf(buildNavigation(document));

    // Then it is one tree with both kinds of row in it, and each row says which it is through
    // `method` alone, which is what the rail draws the event badge off
    const linked = rows.filter((row) => row.nodeId !== null);
    const operations = linked.filter((row) => row.method !== '');
    const channels = linked.filter((row) => row.method === '');

    expect(operations.length).toBeGreaterThan(0);
    expect(channels.length).toBeGreaterThan(0);

    for (const row of channels) {
      expect(document.nodes.get(row.nodeId ?? '')?.kind).toBe('channel');
    }
    for (const row of operations) {
      expect(document.nodes.get(row.nodeId ?? '')?.kind).toBe('operation');
    }
  });

  it('should reach every node of the merged document from the one navigation', () => {
    // Given the merged document
    const document = mixedDocument();

    // When the navigation is derived
    const rows = rowsOf(buildNavigation(document));

    // Then the tree names every node there is, of either kind, exactly once: a channel living in
    // a second structure beside the operations would leave this set short
    const named = rows.map((row) => row.nodeId).filter((id): id is string => id !== null);

    expect(new Set(named)).toEqual(new Set(document.nodes.keys()));
    expect(named).toHaveLength(document.nodes.size);
  });

  it('should serve a slice of that one tree, with the row count of the whole', () => {
    // Given a channel page of the merged document
    const document = mixedDocument();
    const channelId = [...document.nodes.entries()].find(
      ([, node]) => node.kind === 'channel',
    )?.[0];

    // When the page model is built
    const model = buildPageModel(document, { nodeId: channelId ?? '', markdown });

    // Then the rail says how many rows the whole tree has, and the served slice holds the
    // channel the reader is on, so the rest arrives from the same one tree rather than a second
    expect(model.navigationRows).toBe(rowsOf(buildNavigation(document)).length);
    expect(rowsOf(model.navigation).some((row) => row.nodeId === channelId)).toBe(true);
  });

  it('should keep the SPEC 20 page budgets on a channel page of the merged document', async () => {
    // Given the merged document and its first channel
    const document = mixedDocument();
    const channelId = [...document.nodes.entries()].find(
      ([, node]) => node.kind === 'channel',
    )?.[0];
    expect(channelId).toBeDefined();

    // When the channel page is rendered
    const model = buildPageModel(document, { nodeId: channelId ?? '', markdown });
    const rendered = await renderPage(document, { nodeId: channelId ?? '', markdown });

    // Then the page really is the channel page, which is what makes the sizes below the sizes of
    // the thing this task built
    expect(model.node?.channel).not.toBeNull();
    expect(model.node?.drawn).toContain('messages');

    // And the schema payload is inside the bound the renderer states, and the document the
    // browser parses is inside the served document row of SPEC 20
    const payload = Buffer.byteLength(JSON.stringify(model.schemas));
    expect(payload).toBeLessThan(SCHEMA_PAYLOAD_LIMIT);
    expect(
      Buffer.byteLength(rendered.appHtml) + Buffer.byteLength(rendered.stateJson),
    ).toBeLessThan(SERVED_DOCUMENT);
  });

  it('should carry no channel into the state block, on a mixed document as on an events one', async () => {
    // Given the merged document's channel page
    const document = mixedDocument();
    const channelId = [...document.nodes.entries()].find(
      ([, node]) => node.kind === 'channel',
    )?.[0];
    const model = buildPageModel(document, { nodeId: channelId ?? '', markdown });
    const rendered = await renderPage(document, { nodeId: channelId ?? '', markdown });
    expect(model.node?.channel).not.toBeNull();

    // When the state block the browser receives is read
    const state = JSON.parse(rendered.stateJson) as {
      node: { channel: unknown; drawn: readonly string[] } | null;
    };

    // Then the channel is gone and the walk survives, per SPEC 12's redaction rule
    expect(state.node?.channel).toBeNull();
    expect(state.node?.drawn).toEqual(model.node?.drawn);
  });
});

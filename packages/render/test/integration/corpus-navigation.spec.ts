import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeOpenApiDocument, parseSpecification, type IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { flattenNavigation } from '../../src/page/domain/nav-rows';
import { buildPageModel } from '../../src/page/domain/page-model';
import { renderPage } from '../../src/render/application/services/render.service';

/**
 * The definition of done of BUILD T012: every corpus document is navigable.
 *
 * TWO CHECKS, AND THE SPLIT IS DELIBERATE. Every navigation entry of every document is resolved
 * against the document, which is cheap and therefore exhaustive: an entry that links to a node
 * or a schema that is not there is a broken link, and a reference with broken links is not
 * navigable however well any one page renders.
 *
 * Then three pages per document are rendered end to end. THAT IS A CAP AND IT IS STATED RATHER
 * THAN HIDDEN: rendering all 589 pages of `stripe.yaml` plus its 1440 schema pages takes minutes
 * and would make this suite something nobody runs. The three are the first node, a node from the
 * middle, and the first named schema, so an operation page and a schema page are both exercised
 * on every document that has them. Rendering every page of every document is the static build,
 * which SPEC 20 budgets separately and T039 owns.
 */

const CORPUS = join(import.meta.dirname, '..', '..', '..', 'core', 'test', 'corpus');
const markdown = await createMarkdownRenderer();

interface ManifestEntry {
  readonly file: string;
}

function corpusFiles(): string[] {
  const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as {
    documents: ManifestEntry[];
  };
  return manifest.documents.map((entry) => entry.file).sort((a, b) => a.localeCompare(b));
}

function normalize(file: string): IRDocument {
  return normalizeOpenApiDocument(
    parseSpecification(readFileSync(join(CORPUS, 'documents', file), 'utf8')),
  );
}

describe('every corpus document is navigable', () => {
  const files = corpusFiles();

  it('should carry at least fifteen documents, so this is a corpus and not an example', () => {
    // Given, SPEC 21. Stated here because every assertion below is per document and a corpus
    // that shrank to one would still pass all of them.
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('%s: every navigation entry points at something that exists', (file) => {
    // Given
    const document = normalize(file);
    const page = buildPageModel(document, { markdown });

    // When
    const rows = flattenNavigation(page.navigation);
    const dangling = rows.filter(
      (row) =>
        (row.nodeId !== null && !document.nodes.has(row.nodeId)) ||
        (row.schemaId !== null && !document.schemas.has(row.schemaId)),
    );

    // Then
    expect(dangling.map((row) => row.id)).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
  });

  it.each(files)(
    '%s: renders an operation page and a schema page',
    async (file) => {
      // Given
      const document = normalize(file);
      const nodeIds = [...document.nodes.keys()];
      const schemaIds = [...document.schemas.keys()];
      const wanted = [nodeIds[0], nodeIds[Math.floor(nodeIds.length / 2)], schemaIds[0]];

      // When
      const overview = await renderPage(document, { markdown });
      const node =
        wanted[0] === undefined
          ? null
          : await renderPage(document, { nodeId: wanted[0], markdown });
      const middle =
        wanted[1] === undefined
          ? null
          : await renderPage(document, { nodeId: wanted[1], markdown });
      const schema =
        wanted[2] === undefined
          ? null
          : await renderPage(document, { schemaId: wanted[2], markdown });

      // Then
      expect(overview.appHtml).toContain('oref-nav');
      if (node !== null) expect(node.appHtml).toContain('oref-operation');
      if (middle !== null) expect(middle.appHtml).toContain('oref-operation');
      if (schema !== null) {
        expect(schema.appHtml).toContain('oref-schema-page');
        expect(schema.schemaId).toBe(wanted[2]);
      }
    },
    180_000,
  );

  it.each(files)(
    '%s: shows no identity suffix anywhere it renders',
    async (file) => {
      // Given, an external target is registered as `<name>__<8 hex>` per SPEC 5.1.1, and the
      // suffix is identity rather than display. The failure is cosmetic, which is exactly why it
      // would ship unnoticed.
      const document = normalize(file);
      const schemaId = [...document.schemas.keys()].find((id) => /__[0-9a-f]{8}$/.test(id));

      // When
      const page =
        schemaId === undefined ? null : await renderPage(document, { schemaId, markdown });

      // Then, a document with no external target proves nothing here, and says so by skipping.
      if (page === null) {
        expect(schemaId).toBeUndefined();
        return;
      }

      const shown = page.appHtml.replace(/href="[^"]*"/g, '');
      expect(shown).not.toMatch(/__[0-9a-f]{8}/);
    },
    180_000,
  );
});

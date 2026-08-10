import { describe, expect, it } from 'vitest';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { schemaHref, SCHEMA_SEGMENT } from '../../src/page/domain/links';
import { buildPageModel } from '../../src/page/domain/page-model';
import { cyclicDocument, smallDocument } from '../mocks/documents';

const markdown = await createMarkdownRenderer();

/**
 * The page model additions T012 needs: schema pages, use site slots, and the bounded payload.
 *
 * The viewer expands on the client, so a page has to carry the bodies it might open. What is
 * asserted here is that it carries them, that it says what it could not carry, and that a
 * schema is reachable as a page in its own right.
 */
describe('buildPageModel, schema pages', () => {
  it('should build a page for a named schema', () => {
    // Given
    const document = cyclicDocument();

    // When
    const page = buildPageModel(document, { schemaId: 'Node', markdown });

    // Then
    expect(page.schema?.id).toBe('Node');
    expect(page.schema?.name).toBe('Node');
    expect(page.schema?.missing).toBe(false);
    expect(page.activeSchemaId).toBe('Node');
    expect(page.node).toBeNull();
  });

  it('should carry the schema and everything it reaches', () => {
    // Given
    const document = cyclicDocument();

    // When
    const page = buildPageModel(document, { schemaId: 'Node', markdown });

    // Then
    expect(Object.keys(page.schemas).sort()).toEqual(['Node', 'Person']);
  });

  it('should say so rather than blanking when the id names nothing', () => {
    // Given, a stale link is a normal event on a document that changed.
    const document = cyclicDocument();

    // When
    const page = buildPageModel(document, { schemaId: 'Gone', markdown });

    // Then
    expect(page.schema?.missing).toBe(true);
    expect(page.schemas).toEqual({});
  });

  it('should prefer the node when both a node and a schema are asked for', () => {
    // Given, one page shows one thing.
    const document = cyclicDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = buildPageModel(document, { nodeId, schemaId: 'Node', markdown });

    // Then
    expect(page.node?.id).toBe(nodeId);
    expect(page.schema).toBeNull();
    expect(page.activeSchemaId).toBeNull();
  });

  it('should keep the identity suffix out of the name and in the link', () => {
    // Given, an external target is registered as `<name>__<8 hex>` per SPEC 5.1.1: the suffix is
    // identity, which a URL needs and a reader never sees.
    const id = 'Order__0a1b2c3d';

    // When
    const href = schemaHref(id, '/docs');

    // Then
    expect(href).toBe(`/docs/${SCHEMA_SEGMENT}/${encodeURIComponent(id)}`);
    expect(href).toContain('__0a1b2c3d');
  });
});

describe('buildPageModel, the schema payload of a node page', () => {
  it('should carry every schema the use sites of the node reach', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = buildPageModel(document, { nodeId, markdown });

    // Then
    expect(Object.keys(page.schemas)).toContain('Order');
    expect(page.truncatedSchemas).toEqual([]);
  });

  it('should give every use site the slot the viewer starts from', () => {
    // Given, a type label alone cannot be expanded.
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = buildPageModel(document, { nodeId, markdown });
    const media = page.node?.responses.flatMap((response) => response.content) ?? [];

    // Then
    expect(media.length).toBeGreaterThan(0);
    expect(media.every((entry) => entry.schema !== null || entry.typeLabel === '')).toBe(true);
    expect(media[0]?.view).toBe('response');
  });

  it('should name what the bound left behind, so the viewer links instead of blanking', () => {
    // Given, a limit that cannot hold the closure.
    const document = cyclicDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const page = buildPageModel(document, { nodeId, markdown, schemaPayloadLimit: 120 });

    // Then
    expect(page.truncatedSchemas.length).toBeGreaterThan(0);
  });

  it('should carry the METHOD and path of an operation as its navigation hint', () => {
    // Given, the label is the summary when there is one, so the path lives here or nowhere.
    const document = smallDocument();

    // When
    const page = buildPageModel(document, { markdown });
    const hints = page.navigation
      .flatMap((entry) => entry.children)
      .filter((entry) => entry.nodeId !== null)
      .map((entry) => entry.hint);

    // Then
    expect(hints.length).toBeGreaterThan(0);
    expect(hints.every((hint) => /^[A-Z]+ \//.test(hint))).toBe(true);
  });
});

import type { IRSchema, IRSchemaSlot } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildNavigation, buildPageModel, typeLabel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { hostileDocument, smallDocument } from '../mocks/documents';

const markdown = await createMarkdownRenderer();

function namedSchema(id: string, name: string): IRSchema {
  return { id, name, dialect: 'json-schema-2020-12', normalized: { type: 'object' } };
}

describe('typeLabel', () => {
  it('should name a named schema without its identity marker', () => {
    // Given
    const schemas = new Map([
      ['~x1a2b3c4d~Order', namedSchema('~x1a2b3c4d~Order', '~x1a2b3c4d~Order')],
    ]);
    const slot: IRSchemaSlot = { kind: 'named', schemaId: '~x1a2b3c4d~Order' };

    // When
    const result = typeLabel(slot, schemas);

    // Then
    expect(result).toBe('Order');
  });

  it('should follow a reference written inline to the schema it names', () => {
    // Given
    const schemas = new Map([['Order', namedSchema('Order', 'Order')]]);
    const slot: IRSchemaSlot = {
      kind: 'inline',
      schema: { id: 'x', dialect: 'json-schema-2020-12', normalized: { $ref: 'Order' } },
    };

    // When
    const result = typeLabel(slot, schemas);

    // Then
    expect(result).toBe('Order');
  });

  it('should fall back to the json schema type for an anonymous schema', () => {
    // Given
    const slot: IRSchemaSlot = {
      kind: 'inline',
      schema: { id: 'x', dialect: 'json-schema-2020-12', normalized: { type: 'string' } },
    };

    // When
    const result = typeLabel(slot, new Map());

    // Then
    expect(result).toBe('string');
  });

  it('should join a union of types', () => {
    // Given
    const slot: IRSchemaSlot = {
      kind: 'inline',
      schema: {
        id: 'x',
        dialect: 'json-schema-2020-12',
        normalized: { type: ['string', 'null'] },
      },
    };

    // When
    const result = typeLabel(slot, new Map());

    // Then
    expect(result).toBe('string | null');
  });

  it('should say nothing when the position declares no schema', () => {
    // Given
    const slot = undefined;

    // When
    const result = typeLabel(slot, new Map());

    // Then
    expect(result).toBe('');
  });
});

describe('buildPageModel', () => {
  it('should build the overview when no node is asked for', () => {
    // Given
    const document = smallDocument();

    // When
    const model = buildPageModel(document, { markdown });

    // Then
    expect(model.node).toBeNull();
    expect(model.title).toBe('Orders API');
    expect(model.servers).toEqual(['https://api.example.com']);
    expect(model.descriptionHtml).toContain('Order management');
  });

  it('should carry the navigation as a tree rather than a flat list', () => {
    // Given
    const document = smallDocument();

    // When
    const navigation = buildNavigation(document);

    // Then
    const withChildren = navigation.filter((entry) => entry.children.length > 0);
    expect(withChildren.length).toBeGreaterThan(0);
  });

  it('should ship a closed group as a header with a count and no children', () => {
    // Given a page about nothing in the navigation, so no group is open
    const document = smallDocument();

    // When
    const model = buildPageModel(document, { markdown });

    // Then, the count is what tells a closed group from an empty one
    const groups = model.navigation.filter((entry) => entry.childCount > 0);
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((entry) => entry.children.length === 0)).toBe(true);
    expect(model.navigationComplete).toBe(false);
    expect(model.navigationRows).toBeGreaterThan(model.navigation.length);
  });

  it('should open the groups that hold the page and no others', () => {
    // Given an operation somewhere inside a group
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then the entry the page is about is in what shipped
    const shipped = model.navigation.flatMap((entry) => entry.children);
    expect(shipped.some((entry) => entry.nodeId === nodeId)).toBe(true);
  });

  it('should build an operation with its method, path, parameters and responses', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('get')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    expect(model.node?.method).toBe('GET');
    expect(model.node?.path).toBe('/orders');
    // Grouped by location in PARAMETER_LOCATIONS order, so query comes before header.
    expect(model.node?.parameters.map((parameter) => parameter.name)).toEqual(['limit', 'X-Trace']);
    expect(model.node?.responses.map((response) => response.statusCode)).toEqual(['200', '404']);
  });

  it('should generate a highlighted json example for a json response', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('get')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    const example = model.node?.responses[0]?.content[0]?.exampleHtml ?? '';
    expect(example).toContain('<pre class="oref-code"');
    expect(example).toContain('data-oref-lang="json"');
  });

  it('should generate no example for a media type it cannot generate one for', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('get')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    const notFound = model.node?.responses.find((response) => response.statusCode === '404');
    expect(notFound?.content).toEqual([]);
  });

  it('should resolve a security requirement against the declared schemes', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('post')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    expect(model.node?.security).toEqual([{ schemeId: 'apiKey', type: 'apiKey', scopes: [] }]);
  });

  it('should produce the overview for a node id the document does not hold', () => {
    // Given
    const document = smallDocument();

    // When
    const model = buildPageModel(document, { markdown, nodeId: 'no-such-node' });

    // Then
    expect(model.node).toBeNull();
    expect(model.activeNodeId).toBeNull();
  });

  it('should render a hostile description inert everywhere it appears', () => {
    // Given
    const document = hostileDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    const html = [
      model.descriptionHtml,
      model.node?.descriptionHtml ?? '',
      ...(model.node?.responses.map((response) => response.descriptionHtml) ?? []),
    ].join('');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
    expect(/[\s'"`;{(]style\s*=/.test(html)).toBe(false);
  });

  it('should be a pure function of the document, producing equal models twice', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const first = buildPageModel(document, { markdown, nodeId });
    const second = buildPageModel(document, { markdown, nodeId });

    // Then
    expect(first).toEqual(second);
  });
});

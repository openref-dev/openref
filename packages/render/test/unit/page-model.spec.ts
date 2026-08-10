import type { IRSchema, IRSchemaSlot } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildPageModel, typeLabel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { hostileDocument, smallDocument } from '../mocks/documents';

const markdown = await createMarkdownRenderer();

function namedSchema(id: string, name: string): IRSchema {
  return { id, name, dialect: 'json-schema-2020-12', normalized: { type: 'object' } };
}

describe('typeLabel', () => {
  it('should name a named schema without its identity suffix', () => {
    // Given
    const schemas = new Map([
      ['Order__1a2b3c4d', namedSchema('Order__1a2b3c4d', 'Order__1a2b3c4d')],
    ]);
    const slot: IRSchemaSlot = { kind: 'named', schemaId: 'Order__1a2b3c4d' };

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
    const model = buildPageModel(document, { markdown });

    // Then
    const withChildren = model.navigation.filter((entry) => entry.children.length > 0);
    expect(withChildren.length).toBeGreaterThan(0);
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

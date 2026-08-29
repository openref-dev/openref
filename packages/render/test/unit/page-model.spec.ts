import { normalizeOpenApiDocument, type IRSchema, type IRSchemaSlot } from '@openref/core';
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

  it('should build the response example empty and link the schema instead, per TX-PARITY-UI', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('get')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then the compact row: no inline expansion, the phrase, and the schema on its own page,
    // with the array of a named schema said as such
    const ok = model.node?.responses.find((response) => response.statusCode === '200');
    expect(ok?.content[0]?.exampleHtml).toBe('');
    expect(ok?.phrase).toBe('OK');
    expect(ok?.schemaLabel).toBe('Order[]');
    expect(ok?.schemaHref).toBe('/schema/Order');
  });

  it('should still generate the highlighted example for a request body', () => {
    // Given the example machinery serves the request section, which kept its inline block
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('post')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then
    const example = model.node?.requestBody[0]?.exampleHtml ?? '';
    expect(example).toContain('<pre class="oref-code"');
    expect(example).toContain('data-oref-lang="json"');
  });

  it('should land the schema tab of a list operation on the item schema, per item 28', () => {
    // Given GET /orders answers an inline array of Order references and documents no other
    // named schema before it
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('get')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then the schema tab descends into the array items rather than passing the response by
    const schemaTab = model.frame.tabs.find((tab) => tab.kind === 'schema');
    expect(schemaTab?.href).toBe('/schema/Order');
    const shapesTab = model.frame.tabs.find((tab) => tab.kind === 'shapes');
    expect(shapesTab?.href).toBe('/shapes/Order');
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

  it('should print the declared media type example instead of the generated one', () => {
    // Given two request bodies sharing one schema, one declaring its own example. SPEC 5.5
    // makes the declared example win over the generated one, and the declared `examples` map
    // contributes its first member by code point when no plain `example` is written. The
    // responses stopped drawing examples with TX-PARITY-UI, so the precedence is asserted on
    // the section that kept its inline block.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Problems', version: '1.0.0' },
      paths: {
        '/declared': {
          post: {
            operationId: 'declaredBody',
            requestBody: {
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Problem' },
                  examples: { chosen: { value: { status: 400, title: 'invalid_parameter' } } },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
        '/generated': {
          post: {
            operationId: 'generatedBody',
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Problem' } },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
      components: {
        schemas: {
          Problem: {
            type: 'object',
            properties: { status: { type: 'integer', example: 409 }, title: { type: 'string' } },
          },
        },
      },
    });
    const bodyOf = (needle: string): string => {
      const nodeId = [...document.nodes.keys()].find((id) => id.includes(needle)) ?? '';
      const model = buildPageModel(document, { markdown, nodeId });
      return model.node?.requestBody[0]?.exampleHtml ?? '';
    };

    // Then the declared example wins where one was written
    expect(bodyOf('declared')).toContain('invalid_parameter');
    expect(bodyOf('declared')).not.toContain('409');

    // And the body that declared nothing keeps the generated example, which is where the
    // schema's own property example is still the document speaking
    expect(bodyOf('generated')).toContain('409');
  });

  it('should render a declared string example under a non json media type as the text it is', () => {
    // Given the receipt's shape carried by a request: a text media type whose example is the
    // payload itself
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Receipts', version: '1.0.0' },
      paths: {
        '/receipt': {
          post: {
            operationId: 'writeReceipt',
            requestBody: {
              content: {
                'text/csv': {
                  schema: { type: 'string' },
                  example: 'sku,quantity\nsku_flute_c,2\n',
                },
              },
            },
            responses: { '204': { description: 'Stored.' } },
          },
        },
      },
    });
    const nodeId = [...document.nodes.keys()][0] ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });
    const example = model.node?.requestBody[0]?.exampleHtml ?? '';

    // Then the text is the example, not a JSON string literal with escaped line feeds
    expect(example).toContain('sku,quantity');
    expect(example).not.toContain('\\n');
  });

  it('should resolve a security requirement against the declared schemes', () => {
    // Given
    const document = smallDocument();
    const nodeId = [...document.nodes.keys()].find((id) => id.includes('post')) ?? '';

    // When
    const model = buildPageModel(document, { markdown, nodeId });

    // Then, with where the key travels beside the type since 2026-08-29: a requirement that said
    // only `apiKey` said nothing about where the key goes, which is the gap `IRSecurityScheme.in`
    // was grown to five values to close one level down
    expect(model.node?.security).toEqual([
      { schemeId: 'apiKey', type: 'apiKey', in: 'header', name: 'X-Key', scopes: [] },
    ]);
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

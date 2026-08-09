import { describe, expect, it } from 'vitest';
import type { IRDocument, IRNavNode, IROperation } from '../../src/index';
import {
  canonicalize,
  ErrorCode,
  hashDocument,
  NormalizeError,
  normalizeOpenApiDocument,
  UnsupportedDialectError,
} from '../../src/index';
import { createRandom, shuffleKeys } from '../mocks/document.mock';
import { createOpenApi30, createOpenApi31, createOpenApi32 } from '../mocks/openapi.mock';

function operationsOf(document: IRDocument): IROperation[] {
  return [...document.nodes.values()].filter(
    (node): node is IROperation => node.kind === 'operation',
  );
}

describe('normalizeOpenApiDocument version handling', () => {
  it('should produce one IR from a 3.0 document and its hand written 3.1 equivalent', () => {
    // Given
    const thirty = createOpenApi30();
    const thirtyOne = createOpenApi31();

    // When
    const documents = [normalizeOpenApiDocument(thirty), normalizeOpenApiDocument(thirtyOne)];

    // Then
    expect(canonicalize(documents[0])).toBe(canonicalize(documents[1]));
    expect(hashDocument(documents[0]!)).toBe(hashDocument(documents[1]!));
  });

  it('should uplift nullable into a type union with null', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const identifier = document.schemas.get('Order')?.normalized?.properties?.id;

    // Then
    expect(identifier?.type).toEqual(['string', 'null']);
  });

  it('should uplift a single example into examples', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const identifier = document.schemas.get('Order')?.normalized?.properties?.id;

    // Then
    expect(identifier?.examples).toEqual(['abc']);
  });

  it('should reject Swagger 2.0 with a dialect error rather than a parse error', () => {
    // Given
    const document = { swagger: '2.0', info: { title: 'Old', version: '1' } };

    // When
    let error: unknown;
    try {
      normalizeOpenApiDocument(document);
    } catch (caught) {
      error = caught;
    }

    // Then
    expect(error).toBeInstanceOf(UnsupportedDialectError);
    expect(error).toMatchObject({ code: ErrorCode.NORM_UNSUPPORTED_DIALECT });
  });

  it('should reject an OpenAPI version outside the supported range', () => {
    // Given
    const document = { openapi: '4.0.0', info: { title: 'Future', version: '1' } };

    // When
    const act = (): IRDocument => normalizeOpenApiDocument(document);

    // Then
    expect(act).toThrow(UnsupportedDialectError);
  });

  it('should reject a document with no version and no info', () => {
    // Given
    const documents: readonly unknown[] = [{}, { openapi: '3.1.0' }, 'not a document'];

    // When
    const outcomes = documents.map((document) => {
      try {
        normalizeOpenApiDocument(document);
        return 'accepted';
      } catch (error) {
        return error instanceof NormalizeError ? 'rejected' : 'wrong-type';
      }
    });

    // Then
    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected']);
  });
});

describe('normalizeOpenApiDocument 3.2 intake', () => {
  it('should carry itemSchema through', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi32());

    // When
    const streaming = operationsOf(document).find((operation) => operation.method === 'get');

    // Then
    expect(streaming?.responses[0]?.itemSchema).toEqual({ kind: 'named', schemaId: 'Event' });
  });

  it('should read the query method', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi32());

    // When
    const methods = operationsOf(document).map((operation) => operation.method);

    // Then
    expect(methods).toContain('query');
  });

  it('should read an operation from additionalOperations under its own method name', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi32());

    // When
    const purge = operationsOf(document).find((operation) => operation.method === 'purge');

    // Then
    expect(purge?.summary).toBe('Purge the stream');
    expect(purge?.id).toBe('purge-events');
  });

  it('should nest a tag under its declared parent', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi32());

    // When
    const platform = document.navigation.find((entry) => entry.id === 'group-platform');

    // Then
    expect(platform?.children.map((child) => child.id)).toEqual(['group-events']);
  });

  it('should not break a 3.0 document that has none of those fields', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const operations = operationsOf(document);

    // Then
    expect(operations.map((operation) => operation.method)).toEqual(['get', 'get']);
    expect(operations.every((operation) => operation.responses.length > 0)).toBe(true);
  });
});

describe('normalizeOpenApiDocument operation identity', () => {
  it('should rewrite a generated operationId and keep the original', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const operation = document.nodes.get('get-orders');

    // Then
    expect(operation?.kind).toBe('operation');
    if (operation?.kind !== 'operation') return;
    expect(operation.operationId).toBe('get-orders');
    expect(operation.rawOperationId).toBe('OrdersController_findAll');
  });

  it('should keep a hand written operationId as the public name', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: { '/orders': { get: { operationId: 'listOrders', responses: {} } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const operation = document.nodes.get('get-orders');

    // Then
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(operation.operationId).toBe('listOrders');
    expect(operation.rawOperationId).toBe('listOrders');
  });

  it('should stay stable across two runs of the same document', () => {
    // Given
    const source = createOpenApi30();

    // When
    const runs = [normalizeOpenApiDocument(source), normalizeOpenApiDocument(source)];

    // Then
    expect([...runs[0]!.nodes.keys()]).toEqual([...runs[1]!.nodes.keys()]);
  });

  it('should disambiguate duplicate operation ids rather than losing an operation', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: { operationId: 'duplicate', responses: {} },
          post: { operationId: 'duplicate', responses: {} },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const operations = operationsOf(document);

    // Then
    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.operationId)).toEqual([
      'duplicate',
      'duplicate-2',
    ]);
  });

  it('should give distinct node ids to paths that differ only in the template name', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders/{id}': { get: { responses: {} } },
        '/orders/{code}': { get: { responses: {} } },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect([...document.nodes.keys()].sort()).toEqual(['get-orders-code', 'get-orders-id']);
  });
});

describe('normalizeOpenApiDocument ordering', () => {
  function labels(navigation: readonly IRNavNode[]): string[] {
    return navigation.flatMap((entry) => [entry.id, ...labels(entry.children)]);
  }

  it('should build identical navigation across 100 shuffled input orderings', () => {
    // Given
    const source = createOpenApi30();
    const random = createRandom(4242);
    const expected = labels(normalizeOpenApiDocument(source).navigation);

    // When
    const shapes = new Set<string>();
    for (let variant = 0; variant < 100; variant += 1) {
      const shuffled = shuffleKeys(source, random);
      shapes.add(labels(normalizeOpenApiDocument(shuffled).navigation).join('|'));
    }

    // Then
    expect(shapes.size).toBe(1);
    expect([...shapes]).toEqual([expected.join('|')]);
  });

  it('should produce one hash across 100 shuffled input orderings', () => {
    // Given
    const source = createOpenApi31();
    const random = createRandom(99);

    // When
    const hashes = new Set<string>();
    for (let variant = 0; variant < 100; variant += 1) {
      hashes.add(normalizeOpenApiDocument(shuffleKeys(source, random)).hash);
    }

    // Then
    expect(hashes.size).toBe(1);
  });

  it('should order responses numerically with default last', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            responses: {
              default: { description: 'other' },
              '404': { description: 'gone' },
              '200': { description: 'ok' },
            },
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const operation = document.nodes.get('get-orders');

    // Then
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(operation.responses.map((response) => response.statusCode)).toEqual([
      '200',
      '404',
      'default',
    ]);
  });

  it('should order operations by path and then by method', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/zulu': { post: { responses: {} }, get: { responses: {} } },
        '/alpha': { get: { responses: {} } },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect([...document.nodes.keys()]).toEqual(['get-alpha', 'get-zulu', 'post-zulu']);
  });
});

describe('normalizeOpenApiDocument document shape', () => {
  it('should store a referenced schema once and refer to it by name', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const operation = document.nodes.get('get-orders');

    // Then
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(operation.responses[0]?.content[0]?.schema).toEqual({
      kind: 'named',
      schemaId: 'Order',
    });
  });

  it('should inline a schema that is not a component reference', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const operation = document.nodes.get('get-orders');

    // Then
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(operation.parameters[0]?.schema).toMatchObject({ kind: 'inline' });
  });

  it('should resolve style and explode to their defaults', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders/{id}': {
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true },
              { name: 'filter', in: 'query' },
              { name: 'x-trace', in: 'header' },
              { name: 'session', in: 'cookie' },
            ],
            responses: {},
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const operation = document.nodes.get('get-orders-id');

    // Then
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(
      operation.parameters.map((parameter) => [parameter.in, parameter.style, parameter.explode]),
    ).toEqual([
      ['path', 'simple', false],
      ['query', 'form', true],
      ['header', 'simple', false],
      ['cookie', 'form', true],
    ]);
  });

  it('should inherit path level parameters and let an operation override one', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders/{id}': {
          parameters: [
            { name: 'id', in: 'path', required: true, description: 'from the path item' },
            { name: 'trace', in: 'header' },
          ],
          get: {
            parameters: [
              { name: 'id', in: 'path', required: true, description: 'from the operation' },
            ],
            responses: {},
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const operation = document.nodes.get('get-orders-id');

    // Then
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(
      operation.parameters.map((parameter) => [parameter.name, parameter.description]),
    ).toEqual([
      ['trace', undefined],
      ['id', 'from the operation'],
    ]);
  });

  it('should read security schemes and inherit the document requirement', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      security: [{ bearer: [] }],
      paths: {
        '/open': { get: { security: [], responses: {} } },
        '/closed': { get: { responses: {} } },
      },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const closed = document.nodes.get('get-closed');
    const open = document.nodes.get('get-open');

    // Then
    expect(document.security).toEqual([
      { id: 'bearer', type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    ]);
    if (closed?.kind !== 'operation' || open?.kind !== 'operation') {
      throw new Error('expected operations');
    }
    expect(closed.security).toEqual([{ schemeId: 'bearer', scopes: [] }]);
    expect(open.security).toEqual([]);
  });

  it('should read servers with their variables', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      servers: [
        {
          url: 'https://{region}.example.com',
          variables: { region: { default: 'eu', enum: ['eu', 'us'] } },
        },
      ],
      paths: {},
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.servers[0]?.variables?.region).toEqual({ default: 'eu', enum: ['eu', 'us'] });
  });

  it('should read webhooks into their own map', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {},
      webhooks: { 'order.created': { post: { responses: { '200': { description: 'ok' } } } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect([...document.webhooks.keys()]).toEqual(['webhook-post-order-created']);
  });

  it('should leave the event and runtime fields declared but unpopulated', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const declared = {
      kind: document.kind,
      relationships: document.relationships,
      runtime: document.runtime,
      health: document.health,
    };

    // Then
    expect(declared).toEqual({
      kind: 'http',
      relationships: [],
      runtime: undefined,
      health: undefined,
    });
  });

  it('should carry document and operation extensions through', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      'x-openref-audience': 'public',
      info: { title: 'API', version: '1' },
      paths: { '/orders': { get: { 'x-internal': true, responses: {} } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const operation = document.nodes.get('get-orders');

    // Then
    expect(document.extensions).toEqual({ 'x-openref-audience': 'public' });
    if (operation?.kind !== 'operation') throw new Error('expected an operation');
    expect(operation.extensions).toEqual({ 'x-internal': true });
  });

  it('should derive the document id from the title and accept an override', () => {
    // Given
    const source = createOpenApi30();

    // When
    const ids = [
      normalizeOpenApiDocument(source).id,
      normalizeOpenApiDocument(source, { documentId: 'orders' }).id,
    ];

    // Then
    expect(ids).toEqual(['orders-api', 'orders']);
  });

  it('should stamp a hash that matches hashing the document with a blank hash', () => {
    // Given
    const document = normalizeOpenApiDocument(createOpenApi30());

    // When
    const recomputed = hashDocument(document);

    // Then
    expect(document.hash).toBe(recomputed);
  });
});

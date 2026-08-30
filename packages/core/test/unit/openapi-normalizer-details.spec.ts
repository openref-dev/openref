import { describe, expect, it } from 'vitest';
import type { IRDocument, IROperation } from '../../src/index';
import { DEFAULT_SERVER_URL, normalizeOpenApiDocument } from '../../src/index';

/**
 * The parts of a document that are optional, and the parts that a real document gets wrong.
 *
 * A malformed member is skipped rather than raising, because one broken example object is not a
 * reason to refuse a whole document. A malformed document, on the other hand, does raise, which
 * `openapi-normalizer.spec.ts` covers.
 */

function richDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Rich API',
      version: '3.2.1',
      summary: 'Everything optional, filled in',
      description: 'A long description.',
      termsOfService: 'https://example.com/terms',
      contact: { name: 'Team', url: 'https://example.com', email: 'team@example.com' },
      license: { name: 'MIT', identifier: 'MIT', url: 'https://opensource.org/license/mit' },
    },
    servers: [
      {
        url: 'https://{region}.example.com/{stage}',
        description: 'regional',
        protocol: 'https',
        protocolVersion: '1.1',
        variables: {
          region: { default: 'eu', enum: ['eu', 'us'], description: 'data region' },
          stage: { default: 'v1' },
          broken: { enum: ['x'] },
          alsoBroken: 'not an object',
        },
      },
      { description: 'no url, skipped' },
      'not an object',
    ],
    tags: [{ name: 'orders', summary: 'Orders' }, { description: 'no name, skipped' }, 42],
    paths: {
      '/orders': {
        summary: 'Orders collection',
        description: 'From the path item',
        servers: [{ url: 'https://path-item.example.com' }],
        post: {
          tags: ['orders'],
          requestBody: {
            description: 'the order to create',
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
                example: { id: 'a' },
                examples: {
                  minimal: { summary: 'Minimal', description: 'The least', value: { id: 'a' } },
                  broken: 'not an object',
                },
              },
            },
          },
          responses: {
            '201': {
              description: 'created',
              headers: {
                Location: {
                  description: 'where it went',
                  required: true,
                  schema: { type: 'string' },
                },
                'X-Broken': 'not an object',
              },
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '400': 'not an object',
            'x-vendor': { description: 'not a response' },
          },
        },
      },
      '/broken': 'not a path item',
    },
    components: {
      schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } },
      securitySchemes: {
        apiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header', description: 'a key' },
        cookieKey: { type: 'apiKey', name: 'session', in: 'cookie' },
        queryKey: { type: 'apiKey', name: 'token', in: 'query' },
        oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://example.com/.well-known' },
        mtls: { type: 'mutualTLS' },
        oauth: {
          type: 'oauth2',
          flows: {
            implicit: { authorizationUrl: 'https://a.example.com', scopes: { read: 'Read' } },
            password: { tokenUrl: 'https://t.example.com', scopes: {} },
            clientCredentials: { tokenUrl: 'https://t.example.com' },
            authorizationCode: {
              authorizationUrl: 'https://a.example.com',
              tokenUrl: 'https://t.example.com',
              refreshUrl: 'https://r.example.com',
              scopes: { write: 'Write', broken: 42 },
            },
          },
        },
        // A scheme of a type OpenAPI does not declare used to live here and be skipped. Since
        // SPEC 5.4's disposition table it is a refusal, so it has its own case rather than a seat
        // in a fixture every other case reuses. A member that is not an object is still skipped.
        alsoNonsense: 'not an object',
      },
    },
  };
}

function operationOf(document: IRDocument, id: string): IROperation {
  const node = document.nodes.get(id);
  if (node?.kind !== 'operation') throw new Error(`expected an operation at ${id}`);
  return node;
}

describe('normalizeOpenApiDocument optional members', () => {
  it('should read every optional member of info', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const info = document.info;

    // Then
    expect(info).toEqual({
      title: 'Rich API',
      version: '3.2.1',
      summary: 'Everything optional, filled in',
      description: 'A long description.',
      termsOfService: 'https://example.com/terms',
      contact: { name: 'Team', url: 'https://example.com', email: 'team@example.com' },
      license: { name: 'MIT', identifier: 'MIT', url: 'https://opensource.org/license/mit' },
    });
  });

  it('should read server variables and drop one with no default', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const server = document.servers[0];

    // Then
    expect(server?.protocol).toBe('https');
    expect(server?.protocolVersion).toBe('1.1');
    expect(Object.keys(server?.variables ?? {})).toEqual(['region', 'stage']);
    expect(server?.variables?.region).toEqual({
      default: 'eu',
      enum: ['eu', 'us'],
      description: 'data region',
    });
  });

  it('should skip a server with no url and one that is not an object', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const urls = document.servers.map((server) => server.url);

    // Then
    expect(urls).toEqual(['https://{region}.example.com/{stage}']);
  });

  it('should read a request body with its description and examples', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const operation = operationOf(document, 'post-orders');

    // Then
    expect(operation.requestBody?.description).toBe('the order to create');
    expect(operation.requestBody?.required).toBe(true);
    expect(operation.requestBody?.content[0]?.example).toEqual({ id: 'a' });
    expect(operation.requestBody?.content[0]?.examples).toEqual({
      minimal: { summary: 'Minimal', description: 'The least', value: { id: 'a' } },
    });
  });

  it('should read response headers and skip one that is not an object', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const created = operationOf(document, 'post-orders').responses[0];

    // Then
    expect(created?.headers).toEqual([
      {
        name: 'Location',
        description: 'where it went',
        required: true,
        schema: { kind: 'inline', schema: expect.anything() },
      },
    ]);
  });

  it('should skip a response that is not an object and an extension key', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const codes = operationOf(document, 'post-orders').responses.map(
      (response) => response.statusCode,
    );

    // Then
    expect(codes).toEqual(['201']);
  });

  it('should inherit summary, description and servers from the path item', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const operation = operationOf(document, 'post-orders');

    // Then
    expect(operation.summary).toBe('Orders collection');
    expect(operation.description).toBe('From the path item');
    expect(operation.servers).toEqual([{ url: 'https://path-item.example.com' }]);
  });

  it('should skip a path item that is not an object', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const ids = [...document.nodes.keys()];

    // Then
    expect(ids).toEqual(['post-orders']);
  });

  it('should read every kind of security scheme and skip a member that is not an object', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const schemes = document.security;

    // Then
    expect(schemes.map((scheme) => scheme.id)).toEqual([
      'apiKey',
      'cookieKey',
      'mtls',
      'oauth',
      'oidc',
      'queryKey',
    ]);
    expect(schemes.find((scheme) => scheme.id === 'apiKey')).toEqual({
      id: 'apiKey',
      type: 'apiKey',
      name: 'X-Api-Key',
      in: 'header',
      description: 'a key',
    });
    expect(schemes.find((scheme) => scheme.id === 'oidc')?.openIdConnectUrl).toBe(
      'https://example.com/.well-known',
    );
  });

  it('should read all four oauth2 flows, defaulting a missing scope description to empty', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const oauth = document.security.find((scheme) => scheme.id === 'oauth');

    // Then
    expect(Object.keys(oauth?.flows ?? {})).toEqual([
      'implicit',
      'password',
      'clientCredentials',
      'authorizationCode',
    ]);
    expect(oauth?.flows?.authorizationCode).toEqual({
      authorizationUrl: 'https://a.example.com',
      tokenUrl: 'https://t.example.com',
      refreshUrl: 'https://r.example.com',
      scopes: { broken: '', write: 'Write' },
    });
    expect(oauth?.flows?.clientCredentials?.scopes).toEqual({});
  });

  it('should skip a tag with no name and one that is not an object', () => {
    // Given
    const document = normalizeOpenApiDocument(richDocument());

    // When
    const groups = document.navigation.map((entry) => entry.label);

    // Then
    expect(groups).toEqual(['Orders', 'Schemas']);
  });

  it('should read a document that declares nothing beyond info', () => {
    // Given
    const source = { openapi: '3.1.0', info: { title: 'Bare', version: '1' } };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document).toMatchObject({
      id: 'bare',
      // Not empty. A document that declares no server has one, at `/`, which the
      // specification states outright and which `readDocumentServers` applies.
      servers: [{ url: DEFAULT_SERVER_URL }],
      navigation: [],
      security: [],
      relationships: [],
    });
    expect(document.nodes.size).toBe(0);
    expect(document.schemas.size).toBe(0);
  });

  it('should ignore an additionalOperations entry that repeats an enumerated method', () => {
    // Given
    const source = {
      openapi: '3.2.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: { summary: 'the real one', responses: {} },
          additionalOperations: { GET: { summary: 'a duplicate', responses: {} } },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect([...document.nodes.keys()]).toEqual(['get-orders']);
    expect(operationOf(document, 'get-orders').summary).toBe('the real one');
  });

  it('should skip an additionalOperations entry that is not an object', () => {
    // Given
    const source = {
      openapi: '3.2.0',
      info: { title: 'API', version: '1' },
      paths: { '/orders': { additionalOperations: { PURGE: 'not an object' } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.nodes.size).toBe(0);
  });

  it('should skip a parameter with no name or no location', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            parameters: [
              { in: 'query' },
              { name: 'nowhere' },
              { name: 'ok', in: 'query' },
              'not an object',
            ],
            responses: {},
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(operationOf(document, 'get-orders').parameters.map((p) => p.name)).toEqual(['ok']);
  });

  it('should read every optional member of a parameter', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            parameters: [
              {
                name: 'filter',
                in: 'query',
                description: 'a filter',
                required: true,
                deprecated: true,
                allowReserved: true,
                allowEmptyValue: false,
                style: 'pipeDelimited',
                explode: false,
                example: 'a',
                examples: { one: { value: 'a' } },
                schema: { type: 'string' },
              },
            ],
            responses: {},
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(operationOf(document, 'get-orders').parameters[0]).toMatchObject({
      name: 'filter',
      in: 'query',
      description: 'a filter',
      required: true,
      deprecated: true,
      allowReserved: true,
      allowEmptyValue: false,
      style: 'pipeDelimited',
      explode: false,
      example: 'a',
      examples: { one: { value: 'a' } },
    });
  });

  it('should inline a reference that carries sibling keywords rather than naming it', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Order', description: 'narrowed' },
                  },
                },
              },
            },
          },
        },
      },
      components: { schemas: { Order: { type: 'object' } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(operationOf(document, 'get-orders').responses[0]?.content[0]?.schema).toMatchObject({
      kind: 'inline',
    });
  });

  it('should inline a reference that points outside components schemas', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            parameters: [{ name: 'p', in: 'query', schema: { $ref: '#/definitions/Legacy' } }],
            responses: {},
          },
        },
      },
      definitions: { Legacy: { type: 'string' } },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(operationOf(document, 'get-orders').parameters[0]?.schema).toMatchObject({
      kind: 'inline',
    });
  });

  it('should skip a content entry and an examples entry that are not objects', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'text/plain': 'not an object', 'application/json': {} },
              },
            },
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(
      operationOf(document, 'get-orders').responses[0]?.content.map((entry) => entry.mediaType),
    ).toEqual(['application/json']);
  });

  it('should treat a content object that is not an object as no content at all', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: { '/orders': { get: { responses: { '200': { content: 'nonsense' } } } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(operationOf(document, 'get-orders').responses[0]?.content).toEqual([]);
  });

  it('should ignore a security requirement entry that is not an object', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      security: ['not an object', { bearer: ['read'] }],
      paths: { '/orders': { get: { responses: {} } } },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(operationOf(document, 'get-orders').security).toEqual([
      { schemeId: 'bearer', scopes: ['read'] },
    ]);
  });

  it('should resolve an external reference supplied by the caller', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      paths: {
        '/orders': {
          get: {
            parameters: [
              { name: 'p', in: 'query', schema: { $ref: 'shared.yaml#/components/schemas/Money' } },
            ],
            responses: {},
          },
        },
      },
    };
    const shared = { components: { schemas: { Money: { type: 'string', format: 'decimal' } } } };

    // When
    const document = normalizeOpenApiDocument(source, {
      externalDocuments: { 'shared.yaml': shared },
      cycleDepth: 4,
    });

    // Then, an external target is registered as a named schema of the document and the use
    // site refers to it, per SPEC 5.1.1
    const slot = operationOf(document, 'get-orders').parameters[0]?.schema;
    expect(slot?.kind).toBe('inline');
    if (slot?.kind !== 'inline') return;

    const id = slot.schema.normalized?.$ref;
    expect(id).toMatch(/^~x[0-9a-f]{8}~Money$/);
    expect(document.schemas.get(id ?? '')?.normalized).toMatchObject({ format: 'decimal' });
  });

  it('should fall back to the method when a document has a title of only punctuation', () => {
    // Given
    const source = { openapi: '3.1.0', info: { title: '---', version: '1' } };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.id).toBe('document');
  });
});

describe('the default server', () => {
  it('should give a document that declares no servers the one the specification says it has', () => {
    // Given
    const source = { openapi: '3.1.0', info: { title: 'Bare', version: '1' } };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.servers).toEqual([{ url: DEFAULT_SERVER_URL }]);
  });

  it('should treat an empty array exactly as an absent member, as the specification does', () => {
    // Given
    const source = { openapi: '3.1.0', info: { title: 'Bare', version: '1' }, servers: [] };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.servers).toEqual([{ url: DEFAULT_SERVER_URL }]);
  });

  it('should apply the default when every declared server was unusable', () => {
    // Given, entries with no url are skipped like any other malformed member, so what the
    // document effectively declares is nothing.
    const source = {
      openapi: '3.1.0',
      info: { title: 'Bare', version: '1' },
      servers: [{ description: 'no url here' }, 'not an object'],
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.servers).toEqual([{ url: DEFAULT_SERVER_URL }]);
  });

  it('should never override a server the document did declare', () => {
    // Given
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      servers: [{ url: 'https://api.example.test' }],
    };

    // When
    const document = normalizeOpenApiDocument(source);

    // Then
    expect(document.servers).toEqual([{ url: 'https://api.example.test' }]);
  });

  it('should leave an operation with no override inheriting rather than defaulting', () => {
    // Given, an empty override list means "use the document's", and the document now always
    // has one. Defaulting here as well would turn inheritance into a per operation `/`.
    const source = {
      openapi: '3.1.0',
      info: { title: 'API', version: '1' },
      servers: [{ url: 'https://api.example.test' }],
      paths: {
        '/orders': {
          get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(source);
    const node = document.nodes.get('list-orders') ?? [...document.nodes.values()][0];

    // Then
    expect(node?.kind === 'operation' ? node.servers : null).toEqual([]);
  });

  it('should contribute no host, so an allowlist derived from servers stays empty', () => {
    // Given, SPEC 14.5 turns the proxy off on an empty allowlist and derives that allowlist
    // from `servers`. A relative reference names no host, so the default cannot switch a
    // proxy on that was off before.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Bare', version: '1' },
    });

    // When
    const hosts = document.servers
      .map((server) => URL.parse(server.url)?.host ?? '')
      .filter((host) => host !== '');

    // Then
    expect(hosts).toEqual([]);
  });
});

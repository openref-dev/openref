import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument, proxyServers } from '../../src/index';

/**
 * The server set of SPEC 14.5, which both proxies of this project are pinned to.
 *
 * It lives here because two packages ask the question and they used to answer it differently:
 * `@openref/nest` unioned document level and node level servers, `@openref/static` read only the
 * document level, and the rule was written down nowhere for either of them to be wrong against.
 */

function documentWith(
  servers: readonly { readonly url: string }[] | undefined,
  pongServers?: readonly { readonly url: string }[],
): ReturnType<typeof normalizeOpenApiDocument> {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Servers', version: '1.0.0' },
    ...(servers === undefined ? {} : { servers }),
    paths: {
      '/ping': { get: { operationId: 'ping', responses: { 200: { description: 'ok' } } } },
      '/pong': {
        get: {
          operationId: 'pong',
          ...(pongServers === undefined ? {} : { servers: pongServers }),
          responses: { 200: { description: 'ok' } },
        },
      },
    },
  });
}

describe('proxyServers', () => {
  it('should carry a server an operation declares for itself', () => {
    // Given
    const document = documentWith(
      [{ url: 'https://api.example.com/v1' }],
      [{ url: 'https://events.example.com' }],
    );

    // When
    const servers = proxyServers(document).map((server) => server.url);

    // Then document level first, then node level, both in document order
    expect(servers).toEqual(['https://api.example.com/v1', 'https://events.example.com']);
  });

  it('should collapse one address declared at both levels to one upstream', () => {
    // Given
    const shared = [{ url: 'https://api.example.com/v1' }];
    const document = documentWith(shared, shared);

    // When
    const servers = proxyServers(document).map((server) => server.url);

    // Then
    expect(servers).toEqual(['https://api.example.com/v1']);
  });

  it('should keep the variables of a document server, which the static side expands', () => {
    // Given a templated server, the shape SPEC 16.2 expands into one rule per enum value
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Servers', version: '1.0.0' },
      servers: [
        {
          url: 'https://{region}.example.com',
          variables: { region: { default: 'eu', enum: ['eu', 'us'] } },
        },
      ],
      paths: {
        '/ping': { get: { operationId: 'ping', responses: { 200: { description: 'ok' } } } },
      },
    });

    // When
    const servers = proxyServers(document);

    // Then
    expect(servers[0]?.variables?.region?.enum).toEqual(['eu', 'us']);
  });

  it('should return the document servers unchanged when no node overrides any', () => {
    // Given
    const document = documentWith([{ url: 'https://api.example.com/v1' }]);

    // When
    const servers = proxyServers(document);

    // Then
    expect(servers).toEqual(document.servers);
  });
});

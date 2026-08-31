import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { generateProxyFiles, PROXY_GATEWAY_COMMENT } from '@openref/static';
import { nitroProxyFile, nitroProxyRoute, nitroProxySource } from '../../src/index';

/**
 * The task's own wording: the proxy route is wired through the generator from `T040` rather than
 * reimplemented. This is what holds that true.
 *
 * THE COMPARISON IS AGAINST THE GENERATOR AND NOT AGAINST A STRING WRITTEN HERE. A copy of the
 * expected route in this file would pass on the day somebody wrote a second generator, which is
 * the only failure worth catching: the artefact is the one place in this project where being
 * permissive by accident is a standing gateway to somebody's API.
 */

/** A document with one absolute server, which is what pins an upstream. */
function documentWithServer(url: string): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Parcels', version: '1.0.0' },
    servers: [{ url }],
    paths: {
      '/parcels': {
        get: { operationId: 'listParcels', responses: { 200: { description: 'ok' } } },
      },
    },
  });
}

describe('nitroProxySource', () => {
  it('should be the generator output for the Nitro row of SPEC 16.2, byte for byte', () => {
    // Given
    const document = documentWithServer('https://api.parcels.example.com/v1');
    const generated = generateProxyFiles('nitro', {
      upstreams: ['https://api.parcels.example.com/v1'],
      basePath: '/docs',
      forwardCookies: false,
    });

    // Then: the generator produced the artefact this comparison is about.
    expect(generated.map((file) => file.file)).toEqual([nitroProxyFile('/docs')]);

    // When
    const source = nitroProxySource(document, '/docs', false);

    // Then
    expect(source).toBe(generated[0]?.content);
    expect(source).toContain(PROXY_GATEWAY_COMMENT.slice(0, 40));
  });

  it('should carry the forwardCookies decision into the same generator, not around it', () => {
    // Given
    const document = documentWithServer('https://api.parcels.example.com/v1');

    // When
    const withoutCookies = nitroProxySource(document, '/docs', false);
    const withCookies = nitroProxySource(document, '/docs', true);

    // Then
    expect(withoutCookies).toContain("cookie: ''");
    expect(withCookies).not.toContain("cookie: ''");
    expect(withCookies).toBe(
      generateProxyFiles('nitro', {
        upstreams: ['https://api.parcels.example.com/v1'],
        basePath: '/docs',
        forwardCookies: true,
      })[0]?.content,
    );
  });

  it('should produce nothing for a document that pins no upstream, which is a state and not a failure', () => {
    // Given: the normalizer's own default server is the page's own origin, which needs no rule.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Parcels', version: '1.0.0' },
      paths: {
        '/parcels': {
          get: { operationId: 'listParcels', responses: { 200: { description: 'ok' } } },
        },
      },
    });

    // Then: the same call does produce a route when a server is there, so absence means absence.
    expect(
      nitroProxySource(documentWithServer('https://api.example.com'), '/docs', false),
    ).not.toBeNull();

    // When
    const source = nitroProxySource(document, '/docs', false);

    // Then
    expect(source).toBeNull();
  });

  it('should skip an upstream at an infrastructure address, as the generator does', () => {
    // Given
    const document = documentWithServer('http://169.254.169.254');

    // When
    const source = nitroProxySource(document, '/docs', false);

    // Then
    expect(source).toBeNull();
  });
});

describe('the addresses the route lives at', () => {
  it('should spell the file the CLI writes and the route Nitro matches from one base', () => {
    // Given
    const basePath = '/reference';

    // When
    const file = nitroProxyFile(basePath);
    const route = nitroProxyRoute(basePath);

    // Then
    expect(file).toBe('server/routes/reference/_proxy/[...].ts');
    expect(route).toBe('/reference/_proxy/**');
  });
});

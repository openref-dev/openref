import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { NormalizeError } from '@openref/core';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import { assetPlan, specification } from '../mocks/fixtures';
import type { ReferenceRequest } from '../../src/http/application/ports/reference-http.port';

/**
 * A service over the fixture document.
 *
 * Highlighting is off, because the unit suite must not load a grammar set to answer a
 * question about routing.
 *
 * @returns The service
 */
function service(): ReferenceService {
  return new ReferenceService({
    document: specification(),
    basePath: '/docs',
    assets: assetPlan(),
    highlight: false,
  });
}

/**
 * A request with nothing in it.
 *
 * @param params - Route parameters
 * @param headers - Request headers
 * @returns The request
 */
function request(
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
): ReferenceRequest {
  return { params, headers };
}

/** The single node id the fixture document produces. */
const NODE_ID = 'get-orders-id';

describe('ReferenceService, setup', () => {
  it('should refuse a document it cannot normalize, at setup rather than at request time', () => {
    // Given
    const broken = { openapi: '3.1.0', paths: {} };

    // When
    const act = (): unknown =>
      new ReferenceService({ document: broken, basePath: '/docs', assets: assetPlan() });

    // Then
    expect(act).toThrow(NormalizeError);
  });

  it('should accept the document as text as well as as an object', () => {
    // Given
    const text = JSON.stringify(specification());

    // When
    const built = new ReferenceService({
      document: text,
      basePath: '/docs',
      assets: assetPlan(),
      highlight: false,
    });

    // Then
    expect(built.document.hash).toBe(service().document.hash);
  });
});

describe('ReferenceService, pages', () => {
  it('should render the overview as a complete document carrying the state block', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('overview', request());

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('text/html; charset=utf-8');
    expect(String(reply.body)).toContain('<!DOCTYPE html>');
    expect(String(reply.body)).toContain('id="oref-state"');
  });

  it('should link every stylesheet and the client bundle under their hashed names', async () => {
    // Given
    const reference = service();
    const themeName = reference.assets.byName.get('theme.css')?.servedName ?? '';
    const bundleName = reference.assets.byName.get('openref.js')?.servedName ?? '';

    // When
    const body = String((await reference.handle('overview', request())).body);

    // Then
    expect(body).toContain(`/docs/_assets/${themeName}`);
    expect(body).toContain(`/docs/_assets/${bundleName}`);
  });

  it('should write the nonce the host generated onto every script element', async () => {
    // Given
    const reference = service();

    // When
    const body = String(
      (await reference.handle('overview', { params: {}, headers: {}, nonce: 'abcd1234' })).body,
    );

    // Then
    expect(body).toContain('nonce="abcd1234"');
    expect(body).not.toContain('nonce=""');
  });

  it('should render one operation', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('node', request({ nodeId: NODE_ID }));

    // Then
    expect(reply.status).toBe(200);
    expect(String(reply.body)).toContain('Read one order');
  });

  it('should answer a node that is not documented with a 404 rather than an empty page', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('node', request({ nodeId: 'no-such-node' }));

    // Then
    expect(reply.status).toBe(404);
  });

  it('should render a named schema on a page of its own', async () => {
    // Given
    const reference = service();
    const schemaId = [...reference.document.schemas.keys()][0] ?? '';

    // When
    const reply = await reference.handle('schema', request({ schemaId }));

    // Then
    expect(reply.status).toBe(200);
    expect(String(reply.body)).toContain('Order');
  });

  it('should answer a repeat visit holding the same validator with a 304', async () => {
    // Given
    const reference = service();
    const first = await reference.handle('overview', request());
    const tag = first.headers.etag ?? '';

    // When
    const second = await reference.handle('overview', request({}, { 'if-none-match': tag }));

    // Then
    expect(second.status).toBe(304);
    expect(second.body).toBe('');
  });

  it('should ignore a validator from a different page', async () => {
    // Given
    const reference = service();
    const overview = await reference.handle('overview', request());

    // When
    const node = await reference.handle(
      'node',
      request({ nodeId: NODE_ID }, { 'if-none-match': overview.headers.etag ?? '' }),
    );

    // Then
    expect(node.status).toBe(200);
  });
});

describe('ReferenceService, specification', () => {
  it('should serve the source document rather than the IR', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('openapi-json', request());
    const parsed = JSON.parse(String(reply.body)) as Record<string, unknown>;

    // Then
    expect(parsed.openapi).toBe('3.1.0');
    expect(reply.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('should serve the same document as YAML', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('openapi-yaml', request());

    // Then
    expect(reply.headers['content-type']).toBe('application/yaml; charset=utf-8');
    expect(String(reply.body)).toContain('openapi: 3.1.0');
  });

  it('should serve the keys in the order the author wrote them rather than sorted', async () => {
    // Given the fixture's `Order`, whose properties are written `id` then `amount`, which is
    // not the order a sort by code point produces. SPEC 12: canonical form is the hash's tool,
    // and this route exists to hand back what the author wrote. Serialized canonically, every
    // schema in the document an SDK generator reads came out alphabetical.
    const reference = service();

    // When
    const json = String((await reference.handle('openapi-json', request())).body);
    const yaml = String((await reference.handle('openapi-yaml', request())).body);
    const parsed = JSON.parse(json) as {
      components: { schemas: { Order: { properties: Record<string, unknown> } } };
    };

    // Then, in both serializations, because the YAML is written from the same parse
    expect(Object.keys(parsed.components.schemas.Order.properties)).toEqual(['id', 'amount']);
    expect(yaml.indexOf('id:')).toBeLessThan(yaml.indexOf('amount:'));
  });

  it('should produce the same bytes twice, so a CI job can diff two runs', async () => {
    // Given
    const reference = service();

    // When
    const bodies = [
      String((await reference.handle('openapi-json', request())).body),
      String(
        (
          await new ReferenceService({
            document: specification(),
            basePath: '/docs',
            assets: assetPlan(),
            highlight: false,
          }).handle('openapi-json', request())
        ).body,
      ),
    ];

    // Then
    expect(bodies[0]).toBe(bodies[1]);
  });
});

describe('ReferenceService, search index and health', () => {
  it('should serve an index that names the document it was built from', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('search-index', request());
    const parsed = JSON.parse(String(reply.body)) as { documentHash: string };

    // Then
    expect(parsed.documentHash).toBe(reference.document.hash);
  });

  it('should report what is mounted and what it was built from, and claim no health score', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('health', request());
    const parsed = JSON.parse(String(reply.body)) as Record<string, unknown>;

    // Then
    expect(parsed.status).toBe('ok');
    expect(parsed).not.toHaveProperty('score');
    expect(reply.headers['cache-control']).toBe('no-store');
  });
});

describe('ReferenceService, assets', () => {
  it('should serve a known asset as immutable for a year', async () => {
    // Given
    const reference = service();
    const served = reference.assets.byName.get('openref.js')?.servedName ?? '';

    // When
    const reply = await reference.handle('asset', request({ asset: served }));

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('should answer an unknown asset from the catalog and never from the file system', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('asset', request({ asset: '../../etc/passwd' }));

    // Then
    expect(reply.status).toBe(404);
  });

  it('should serve the font the stylesheet points at, under the name it was rewritten to', async () => {
    // Given
    const reference = service();
    const served = await reference.handle('asset', {
      params: { asset: reference.assets.byName.get('theme.css')?.servedName ?? '' },
      headers: {},
    });
    // The body of an asset is bytes, not text. Reading it as a string without decoding is
    // how a stylesheet turns into a comma separated list of character codes.
    const css = new TextDecoder().decode(served.body as Uint8Array);
    const referenced = /url\('\.\/([^']+)'\)/.exec(css)?.[1] ?? '';

    // When
    const reply = await reference.handle('asset', request({ asset: referenced }));

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toBe('font/woff2');
  });
});

describe('ReferenceService, the theme option of T033', () => {
  it('should refuse a theme with component overrides and no bundle built with them', () => {
    // Given, the pair rule: overrides are code, code reaches a reader only inside an entry
    // built with the definition, and a definition alone would render pages the shipped entry
    // hydrates into a silent mismatch
    const act = (): unknown =>
      new ReferenceService({
        document: specification(),
        basePath: '/docs',
        assets: assetPlan(),
        theme: {
          definition: {
            name: 'half-a-theme',
            components: { DocumentOverview: () => null },
          },
        },
      });

    // Then
    expect(act).toThrow(/names no browser bundle/);
  });

  it('should accept the pair, and an L0 definition alone', () => {
    // Given
    const paired = (): unknown =>
      new ReferenceService({
        document: specification(),
        basePath: '/docs',
        assets: assetPlan(),
        theme: {
          definition: { name: 'paired', components: { DocumentOverview: () => null } },
          bundle: '@openref/theme-telltale/entry',
        },
      });
    const tokensOnly = (): unknown =>
      new ReferenceService({
        document: specification(),
        basePath: '/docs',
        assets: assetPlan(),
        theme: { definition: { name: 'l0', tokens: { '--oref-color-accent': '#0088ff' } } },
      });

    // Then
    expect(paired).not.toThrow();
    expect(tokensOnly).not.toThrow();
  });

  it('should write the L0 tokens into the page as the nonce carrying style element', async () => {
    // Given
    const themed = new ReferenceService({
      document: specification(),
      basePath: '/docs',
      assets: assetPlan(),
      highlight: false,
      theme: { definition: { name: 'l0', tokens: { '--oref-color-accent': '#0088ff' } } },
    });

    // When
    const reply = await themed.handle('overview', request());

    // Then
    expect(reply.body).toContain(':root{--oref-color-accent:#0088ff}');
  });

  it('should render the server half with the theme, so an override reaches the served page', async () => {
    // Given, a definition whose override marks the overview position
    const themed = new ReferenceService({
      document: specification(),
      basePath: '/docs',
      assets: assetPlan(),
      highlight: false,
      theme: {
        definition: {
          name: 'marked',
          components: { DocumentOverview: () => h('div', { class: 'theme-proof-mark' }) },
        },
        bundle: '@openref/theme-telltale/entry',
      },
    });

    // When
    const reply = await themed.handle('overview', request());

    // Then
    expect(reply.body).toContain('theme-proof-mark');
  });
});

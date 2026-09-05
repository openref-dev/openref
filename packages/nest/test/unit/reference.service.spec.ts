import { describe, expect, it } from 'vitest';
import { replyText } from '../../src/http/domain/reply';
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
    expect(replyText(reply)).toContain('<!DOCTYPE html>');
    expect(replyText(reply)).toContain('id="oref-state"');
  });

  it('should link every stylesheet and the client bundle under their hashed names', async () => {
    // Given
    const reference = service();
    const themeName = reference.assets.byName.get('theme.css')?.servedName ?? '';
    const bundleName = reference.assets.byName.get('openref.js')?.servedName ?? '';

    // When
    const body = replyText(await reference.handle('overview', request()));

    // Then
    expect(body).toContain(`/docs/_assets/${themeName}`);
    expect(body).toContain(`/docs/_assets/${bundleName}`);
  });

  it('should write the nonce the host generated onto every script element', async () => {
    // Given
    const reference = service();

    // When
    const body = replyText(
      await reference.handle('overview', { params: {}, headers: {}, nonce: 'abcd1234' }),
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
    expect(replyText(reply)).toContain('Read one order');
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
    expect(replyText(reply)).toContain('Order');
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
    const parsed = JSON.parse(replyText(reply)) as Record<string, unknown>;

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
    expect(replyText(reply)).toContain('openapi: 3.1.0');
  });

  it('should serve the keys in the order the author wrote them rather than sorted', async () => {
    // Given the fixture's `Order`, whose properties are written `id` then `amount`, which is
    // not the order a sort by code point produces. SPEC 12: canonical form is the hash's tool,
    // and this route exists to hand back what the author wrote. Serialized canonically, every
    // schema in the document an SDK generator reads came out alphabetical.
    const reference = service();

    // When
    const json = replyText(await reference.handle('openapi-json', request()));
    const yaml = replyText(await reference.handle('openapi-yaml', request()));
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
      replyText(await reference.handle('openapi-json', request())),
      replyText(
        await new ReferenceService({
          document: specification(),
          basePath: '/docs',
          assets: assetPlan(),
          highlight: false,
        }).handle('openapi-json', request()),
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
    const parsed = JSON.parse(replyText(reply)) as { documentHash: string };

    // Then
    expect(parsed.documentHash).toBe(reference.document.hash);
  });

  it('should report what is mounted and what it was built from, and claim no health score', async () => {
    // Given
    const reference = service();

    // When, on the status route: the liveness JSON lives at `_health` since TX-FRAME, and
    // `health` is the Documentation Health page, per SPEC 13.3.
    const reply = await reference.handle('status', request());
    const parsed = JSON.parse(replyText(reply)) as Record<string, unknown>;

    // Then
    expect(parsed.status).toBe('ok');
    expect(parsed).not.toHaveProperty('score');
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('should say how many nodes any collector reached, so the page saying none has a reason', async () => {
    // Given a document normalized outside any application, which is what every page that draws
    // the `runtime-missing` sentence is drawn from
    const reference = service();

    // When
    const reply = await reference.handle('status', request());
    const parsed = JSON.parse(replyText(reply)) as {
      runtime?: { measured?: number; of?: number };
    };

    // Then the count is there and it is a count rather than a verdict. The page holds one node
    // and cannot tell a host who registered no collector from a collector that found nothing;
    // this holds the document, so it answers with both numbers.
    expect(parsed.runtime?.of).toBe(reference.document.nodes.size);
    expect(parsed.runtime?.of).toBeGreaterThan(0);
    expect(parsed.runtime?.measured).toBe(0);
  });

  it('should serve the health page at the address the liveness JSON left', async () => {
    // Given
    const reference = service();

    // When
    const reply = await reference.handle('health', request());

    // Then, a page and not JSON: one address never answers two ways by request header.
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('text/html');
  });

  it('should say the mount is not a federation at the reserved service address', async () => {
    // Given a mount over a single document, whose IR carries no `services`
    const reference = service();

    // When
    const reply = await reference.handle('service', request({ serviceId: 'billing' }));

    // Then the 404 names the first of SPEC 13.3's two facts, the setup and not the name: a
    // reader who expected a federation learns their mount is not one, which is tellable from
    // the node 404 and from the wrong name sentence a merged mount answers with.
    expect(reply.status).toBe(404);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(replyText(reply)).toBe(
      'This mount is not a federation. It serves a single service, so there are no service ' +
        'pages here; if you expected a federation, this reference is not mounted as one.',
    );
  });

  it('should say the mount is not a federation at the live snapshot address too', async () => {
    // Given the same single document mount, where `_federation` is registered by the `_proxy`
    // precedent so that "not a federation" is tellable from "no such route"
    const reference = service();

    // When, on a route that takes no parameter at all
    const reply = await reference.handle('federation', request());

    // Then it states the fact the mount has, and not one about a name the request never
    // carried: the generic 404 said "no federation of that name" here, which named nothing.
    expect(reply.status).toBe(404);
    expect(reply.headers['cache-control']).toBe('no-store');
    expect(reply.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(replyText(reply)).toBe(
      'This mount is not a federation. It serves a single service, so there is no federation ' +
        'snapshot here; if you expected a federation, this reference is not mounted as one.',
    );
    expect(replyText(reply)).not.toContain('of that name');
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

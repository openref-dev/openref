import { createApp, toWebHandler } from 'h3';
import { describe, expect, it } from 'vitest';
import { createReferenceHandler } from '../../src/runtime/handler';
import type { EmbeddedSite } from '../../src/index';

/**
 * The route itself, driven through h3 rather than through Nuxt.
 *
 * WHY IN PROCESS WHEN `nuxt-parity.spec.ts` ALREADY DRIVES A REAL SERVER. Two different questions.
 * That suite proves the deployment works and that the bytes match the build, which needs a real
 * Nuxt build and a real socket; this one proves what the handler does with an address, which needs
 * neither and can therefore cover the branches a real deployment reaches once each: the nonce path
 * and the path with no nonce, the answer and the refusal. A branch exercised only in a spawned
 * process is a branch this repository's coverage cannot see.
 *
 * THE ASSETS ARE NAMES AND NOT BYTES, which is what a Nitro deployment hands the runtime, so this
 * suite needs nothing built: the pages link the names, and the deployment publishes the files.
 */

const SPECIFICATION = `
openapi: 3.1.0
info:
  title: Parcels
  version: 1.0.0
paths:
  /parcels:
    get:
      operationId: listParcels
      summary: List parcels
      responses:
        '200':
          description: ok
`;

const EMBEDDED: EmbeddedSite = {
  specification: SPECIFICATION,
  source: 'openapi.yaml',
  base: '/docs',
  target: null,
  forwardCookies: false,
  lang: null,
  colorScheme: null,
  assets: {
    servedNames: {
      'theme.css': 'theme.0123456789abcdef.css',
      'openref.js': 'openref.fedcba9876543210.js',
    },
    stylesheetNames: ['theme.css'],
    moduleName: 'openref.js',
  },
};

/** The handler behind an h3 application, which is what Nitro puts it behind. */
function fetchFrom(site: EmbeddedSite, nonce?: string): (path: string) => Promise<Response> {
  const reference = createReferenceHandler(site);
  const app = createApp();
  app.use('/docs', async (event): Promise<unknown> => {
    if (nonce !== undefined) event.context.cspNonce = nonce;

    return (await reference(event)) as unknown;
  });

  const handler = toWebHandler(app);

  return (path: string) => handler(new Request(`http://reference.test${path}`));
}

describe('createReferenceHandler', () => {
  it('should answer the overview at the mount, as html the deployment may revalidate', async () => {
    // Given
    const request = fetchFrom(EMBEDDED);

    // When
    const response = await request('/docs');

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('Parcels');
  });

  it('should link the asset names the deployment publishes, not names of its own', async () => {
    // Given
    const request = fetchFrom(EMBEDDED);

    // When
    const page = await (await request('/docs')).text();

    // Then
    expect(page).toContain('/docs/_assets/theme.0123456789abcdef.css');
    expect(page).toContain('/docs/_assets/openref.fedcba9876543210.js');
  });

  it('should answer the search index as json', async () => {
    // Given
    const request = fetchFrom(EMBEDDED);

    // When
    const response = await request('/docs/_search-index');

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(await response.text())).toBeTypeOf('object');
  });

  it('should answer nothing for an asset, because the deployment publishes those', async () => {
    // Given
    const request = fetchFrom(EMBEDDED);

    // Then: the same mount does answer a page, so the refusal is about the address.
    expect((await request('/docs')).status).toBe(200);

    // When
    const response = await request('/docs/_assets/theme.0123456789abcdef.css');

    // Then
    expect(response.status).toBe(404);
  });

  it('should refuse an address the site does not hold, in words and with no store', async () => {
    // Given
    const request = fetchFrom(EMBEDDED);

    // When
    const response = await request('/docs/no-such-operation');

    // Then
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('No page of that address is documented here.');
  });

  it('should write the host nonce onto every element that needs one, and none when there is none', async () => {
    // Given
    const nonce = 'dGVzdC1ub25jZS0xMjM0';

    // When
    const withNonce = await (await fetchFrom(EMBEDDED, nonce)('/docs')).text();
    const withoutNonce = await (await fetchFrom(EMBEDDED)('/docs')).text();

    // Then
    expect(withNonce).toContain(`nonce="${nonce}"`);
    expect(withoutNonce).not.toContain('nonce=');
    expect(withNonce.replaceAll(` nonce="${nonce}"`, '')).toBe(withoutNonce);
  });

  it('should build the site once and answer the second request from the same one', async () => {
    // Given
    const request = fetchFrom(EMBEDDED);

    // When
    const first = await (await request('/docs/get-parcels')).text();
    const second = await (await request('/docs/get-parcels')).text();

    // Then
    expect(first).toBe(second);
    expect(first).toContain('List parcels');
  });

  it('should carry the proxy rules of SPEC 16.2 into the served page when a target was named', async () => {
    // Given
    const withProxy: EmbeddedSite = {
      ...EMBEDDED,
      specification: SPECIFICATION.replace(
        'paths:',
        'servers:\n  - url: https://api.parcels.example.com\npaths:',
      ),
      target: 'nitro',
    };

    // When
    const page = await (await fetchFrom(withProxy)('/docs/get-parcels')).text();

    // Then
    expect(page).toContain('/docs/_proxy');
  });
});

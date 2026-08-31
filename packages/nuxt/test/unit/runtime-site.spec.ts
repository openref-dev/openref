import { describe, expect, it } from 'vitest';
import { createMemoryRenderCache } from '@openref/render';
import { createSite } from '../../src/runtime/site';
import type { EmbeddedSite } from '../../src/index';

/**
 * The third build clause of `T061`: SSR under Nuxt goes through the same hash keyed cache.
 *
 * WHY THIS FILE EXISTS, STATED AS THE HOLE IT CLOSES. The cache was constructed inline inside
 * `build`, so deleting the option left all thirty two cases in this package green and the whole
 * suite of `served-equals-built.spec.ts` green with them: nothing anywhere asserted that a second
 * request for one address does not render the page again. A clause with no runner is a claim, and
 * the review found it by deleting the line.
 *
 * WHAT IS ASSERTED IS THE CACHE'S OWN COUNTER, which is the seam this one honestly supports.
 * `createMemoryRenderCache` returns an observable cache, so a hit is a fact it reports rather than
 * a duration this suite would have to interpret. Removing `cache` from the `createSiteServer`
 * call in `site.ts` takes `hits` to zero and reddens the first case below.
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
  /crates:
    get:
      operationId: listCrates
      summary: List crates
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
    servedNames: { 'theme.css': 'theme.abc.css', 'openref.js': 'openref.def.js' },
    stylesheetNames: ['theme.css'],
    moduleName: 'openref.js',
  },
};

describe('createSite, against the cache it is given', () => {
  it('should answer a second request for one address out of the cache rather than rendering again', async () => {
    // Given
    const cache = createMemoryRenderCache();
    const site = await createSite(EMBEDDED, cache)();

    // Then: nothing has been asked for yet, so a hit later means a hit rather than a default.
    expect(cache.stats().hits).toBe(0);

    // When
    const first = await site.answer('/docs/get-parcels');
    const afterFirst = cache.stats();
    const second = await site.answer('/docs/get-parcels');
    const afterSecond = cache.stats();

    // Then
    expect(first?.body).toBe(second?.body);
    expect(afterFirst).toMatchObject({ hits: 0, misses: 1, entries: 1 });
    expect(afterSecond).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  });

  it('should key by address, so a second page is a miss and not somebody else s page', async () => {
    // Given
    const cache = createMemoryRenderCache();
    const site = await createSite(EMBEDDED, cache)();

    // When
    const parcels = await site.answer('/docs/get-parcels');
    const crates = await site.answer('/docs/get-crates');

    // Then
    expect(cache.stats()).toMatchObject({ hits: 0, misses: 2, entries: 2 });
    expect(parcels?.body).not.toBe(crates?.body);
  });

  it('should build the site once for a handler, whatever the second caller asks for', async () => {
    // Given
    const cache = createMemoryRenderCache();
    const siteOf = createSite(EMBEDDED, cache);

    // When
    const first = await siteOf();
    const second = await siteOf();

    // Then
    expect(second).toBe(first);
  });

  it('should keep two mounts apart, which a module level cache could not', async () => {
    // Given
    const other: EmbeddedSite = { ...EMBEDDED, base: '/reference' };
    const docs = await createSite(EMBEDDED, createMemoryRenderCache())();
    const reference = await createSite(other, createMemoryRenderCache())();

    // When
    const fromDocs = await docs.answer('/docs/get-parcels');
    const fromReference = await reference.answer('/reference/get-parcels');

    // Then
    expect(fromDocs?.body).toContain('/docs/_assets/theme.abc.css');
    expect(fromReference?.body).toContain('/reference/_assets/theme.abc.css');
    expect(await docs.answer('/reference/get-parcels')).toBeNull();
  });
});

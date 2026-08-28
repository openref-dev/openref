import { normalizeOpenApiDocument, type IRDocument } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  buildSite,
  BUILD_MANIFEST_FILE,
  MAX_SEGMENT_BYTES,
  readManifest,
  resolveSiteBase,
} from '../../src/index';
import { fixtureAssets, MemoryOutputStore, miniDocument } from '../mocks/documents';

/**
 * The regressions of the `T043` adversarial pass over the static build.
 *
 * EACH CASE IS THE SHORTEST INPUT THAT BROKE SOMETHING, and each was measured failing against the
 * tree as it stood before the fix beside it. Nothing here is a variation on a passing case.
 */

/** A document with two schema ids that differ only where a filesystem does not look. */
function collidingSchemas(first: string, second: string): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Collide', version: '1.0.0' },
    paths: {
      '/a': {
        get: {
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${first}` } },
              },
            },
          },
        },
      },
      '/b': {
        get: {
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: `#/components/schemas/${second}` } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        [first]: { type: 'object', properties: { upper: { type: 'string' } } },
        [second]: { type: 'object', properties: { lower: { type: 'integer' } } },
      },
    },
  });
}

describe('buildSite, two page addresses that a filesystem folds into one', () => {
  it('should refuse a document whose schema ids differ only by case, naming both files', async () => {
    // Given: on APFS and on NTFS these are one directory, so the second page written wins and
    // the link to the first reaches the second's contents.
    const document = collidingSchemas('User', 'user');

    // When
    const attempt = buildSite({
      document,
      store: new MemoryOutputStore(),
      assets: fixtureAssets(),
    });

    // Then
    await expect(attempt).rejects.toThrow(/schema\/User\/index\.html.*schema\/user\/index\.html/s);
    await expect(attempt).rejects.toThrow(/one of the two would be lost/);
  });

  it.each([
    ['the long s, which toLowerCase leaves apart and APFS folds', 'sample', '\u017Fample'],
    ['the sharp s', 'ss', '\u00DF'],
    ['a ligature', 'fi', '\uFB01'],
  ])('should refuse a pair a filesystem folds through %s', async (_reason, left, right) => {
    // Given: measured on this filesystem, both spellings land in one directory entry, and the
    // first cut of this guard used toLowerCase and let all three through to the disk.
    expect(left.toLowerCase() === right.toLowerCase()).toBe(false);

    // When
    const attempt = buildSite({
      document: collidingSchemas(left, right),
      store: new MemoryOutputStore(),
      assets: fixtureAssets(),
    });

    // Then
    await expect(attempt).rejects.toThrow(/one of the two would be lost/);
  });

  it.each([
    ['a dotted capital I', 'i', '\u0130'],
    ['a diaeresis', 'a', '\u00E4'],
    ['a Greek letter', 'omega', '\u03A9'],
    ['a final sigma', 'sigma', '\u03C2'],
  ])('should build a pair this filesystem keeps apart, %s', async (_reason, left, right) => {
    // Given: the other direction, so the fold is not simply refusing everything unfamiliar.

    // When
    const report = await buildSite({
      document: collidingSchemas(left, right),
      store: new MemoryOutputStore(),
      assets: fixtureAssets(),
    });

    // Then
    expect(report.rendered).toContain(`schema/${left}/index.html`);
    expect(report.rendered).toContain(`schema/${right}/index.html`);
  });

  it('should build a document whose schema ids differ by more than case', async () => {
    // Given
    const document = collidingSchemas('User', 'Account');

    // When
    const report = await buildSite({
      document,
      store: new MemoryOutputStore(),
      assets: fixtureAssets(),
    });

    // Then: the refusal is about folding, not about two schemas.
    expect(report.rendered.length).toBeGreaterThan(0);
  });
});

describe('buildSite, a page carried forward after an interrupted build', () => {
  it('should render rather than carry a page whose bytes are not the ones it recorded', async () => {
    // Given: one complete build, then the bytes of a different build at the same path, which is
    // what a build killed part way leaves behind. The manifest still describes the first build.
    const store = new MemoryOutputStore();
    await buildSite({ document: miniDocument(), store, assets: fixtureAssets() });

    const page = 'get-pong/index.html';
    const original = store.files.get(page);
    expect(typeof original).toBe('string');
    store.files.set(page, String(original).replace('Pong', 'INTERRUPTED BUILD MARKER'));

    // When
    const report = await buildSite({ document: miniDocument(), store, assets: fixtureAssets() });

    // Then
    expect(report.carried).not.toContain(page);
    expect(report.rendered).toContain(page);
    expect(String(store.files.get(page))).not.toContain('INTERRUPTED BUILD MARKER');
  });

  it('should still carry a page nothing disturbed, so the incremental claim survives the check', async () => {
    // Given
    const store = new MemoryOutputStore();
    await buildSite({ document: miniDocument(), store, assets: fixtureAssets() });

    // When
    const report = await buildSite({ document: miniDocument(), store, assets: fixtureAssets() });

    // Then
    expect(report.rendered).toEqual([]);
    expect(report.carried.length).toBeGreaterThan(0);
  });

  it('should record the digest of what it wrote for every page in the manifest', async () => {
    // Given
    const store = new MemoryOutputStore();
    await buildSite({ document: miniDocument(), store, assets: fixtureAssets() });

    // When
    const manifest = readManifest(String(store.files.get(BUILD_MANIFEST_FILE)));

    // Then
    expect(manifest).not.toBeNull();
    expect(manifest?.pages.length).toBeGreaterThan(0);
    for (const page of manifest?.pages ?? []) expect(page.bytes).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('planPages, an id longer than a path component may be', () => {
  it('should refuse a schema id above the byte limit instead of aborting on ENAMETOOLONG', async () => {
    // Given: 300 characters, which the build wrote five pages of before mkdir refused and left
    // a directory with no manifest behind.
    const long = 'A'.repeat(300);
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Long', version: '1.0.0' },
      paths: {
        '/a': {
          get: {
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: `#/components/schemas/${long}` } },
                },
              },
            },
          },
        },
      },
      components: { schemas: { [long]: { type: 'object' } } },
    });
    const store = new MemoryOutputStore();

    // When
    const attempt = buildSite({ document, store, assets: fixtureAssets() });

    // Then: refused before anything was written, naming the limit.
    await expect(attempt).rejects.toThrow(/above the 255 byte limit/);
    expect(store.files.size).toBe(0);
  });

  it('should build an id at the limit, so the refusal is about the limit and not about length', async () => {
    // Given
    const atLimit = 'A'.repeat(MAX_SEGMENT_BYTES);
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'AtLimit', version: '1.0.0' },
      paths: { '/a': { get: { responses: { 200: { description: 'ok' } } } } },
      components: { schemas: { [atLimit]: { type: 'object' } } },
    });

    // When
    const report = await buildSite({
      document,
      store: new MemoryOutputStore(),
      assets: fixtureAssets(),
    });

    // Then
    expect(report.rendered).toContain(`schema/${atLimit}/index.html`);
  });
});

describe('resolveSiteBase, a base that is not a path a url can carry', () => {
  it.each([
    ['a newline, which wrote directives into the generated nginx snippet', '/docs\n}\nlocation /'],
    ['a double quote', '/a"b'],
    ['a space', '/a b'],
    ['a fragment', '/docs#x'],
    ['a query', '/docs?x=1'],
    ['a backslash', '/docs\\x'],
  ])('should refuse a base carrying %s', (_reason, base) => {
    // Given the value above

    // When
    const attempt = (): unknown => resolveSiteBase(base);

    // Then
    expect(attempt).toThrow(/--base must be a path a url can carry as written/);
  });

  it.each([
    ['a semicolon, which nginx reads as the end of a directive', '/docs;x'],
    ['a colon, which Netlify and Vercel read as a route placeholder', '/docs:x'],
    ['a dollar, which nginx expands as a variable', '/docs$x'],
    ['a single quote, which breaks a generated string literal', "/docs'x"],
    ['a star, which Caddy and Netlify allow only at an end', '/docs*'],
    ['a pipe', '/docs|x'],
    ['a bracket', '/docs[x]'],
    ['an exclamation mark', '/docs!x'],
    ['a comma', '/docs,x'],
    ['an equals sign', '/docs=x'],
  ])('should refuse a base carrying %s, which a url would carry happily', (_reason, base) => {
    // Given: every one of these survives the url parser, so the rule above cannot see them. The
    // semicolon was driven to a generated `location /docs;x/...` that nginx refuses to load.
    expect(new URL(base, 'http://openref.invalid').pathname).toBe(base);

    // When
    const attempt = (): unknown => resolveSiteBase(base);

    // Then
    expect(attempt).toThrow(/--base may not carry/);
  });

  it.each([
    ['a newline', '/docs%0Ax'],
    ['a star', '/docs%2Ax'],
    ['a space', '/a%20b'],
    ['a malformed escape', '/docs%zz'],
  ])(
    'should refuse the percent escape for %s, which the character class alone let through',
    (_reason, base) => {
      // Given: the class sees only `%`, `0` and `A`, so an escape smuggles the character past it
      // into any platform that decodes before it routes.
      expect(new URL(base, 'http://openref.invalid').pathname).toBe(base);

      // When
      const attempt = (): unknown => resolveSiteBase(base);

      // Then
      expect(attempt).toThrow(/--base/);
    },
  );

  it.each(['/docs', '/docs/v1', '/docs/v1.2', '/a_b-c~d', '/'])(
    'should accept the ordinary base %s unchanged',
    (base) => {
      // Given the value above

      // When
      const resolved = resolveSiteBase(base);

      // Then
      expect(resolved.basePath).toBe(base === '/' ? '' : base);
    },
  );
});

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSite, BUILD_MANIFEST_FILE, FsOutputStore } from '../../src/index';
import { fixtureAssets, miniDocument } from '../mocks/documents';

/**
 * The build against a real directory.
 *
 * WHAT ONLY A DISK CAN SHOW is here and nothing else is: that a page lands in a directory of its
 * own with an `index.html` in it, that a path built from an id cannot leave the output
 * directory, and that a carried file comes out of a rebuild byte identical. Nothing here claims
 * a preserved modification time: every file is rewritten on every build, so what is provable is
 * the bytes. The claims about which pages were rendered are asserted in the unit suite against
 * the report, for the same reason.
 */

let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openref-static-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

/** One build into the temporary directory. */
async function build(
  options: { readonly document?: ReturnType<typeof miniDocument>; readonly base?: string } = {},
) {
  return buildSite({
    document: options.document ?? miniDocument(),
    store: new FsOutputStore(directory),
    assets: fixtureAssets(),
    ...(options.base === undefined ? {} : { base: options.base }),
  });
}

describe('the built directory', () => {
  it('should give every page a directory of its own with an index.html in it', async () => {
    // Given
    await build({ base: 'https://docs.example.com' });

    // When
    const page = await readFile(join(directory, 'get-ping', 'index.html'), 'utf8');

    // Then: SPEC 16.1's layout, which is what makes the link `/get-ping` answer with HTML on a
    // host that rewrites nothing.
    expect(page.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(page).toContain('<link rel="canonical" href="https://docs.example.com/get-ping">');
  });

  it('should write pages that carry no nonce attribute on any element', async () => {
    // Given a build, which is the mode with no nonce to give: a file on disk is one response
    // reused, and a nonce that is reused is not a nonce, so an empty `nonce=""` would be
    // decoration reading as machinery. The presence half is proved in the shell's own suite,
    // where a served response carries the nonce it was given; that is what establishes the
    // attribute machinery works, so this absence cannot pass by the machinery missing.
    await build();

    // When
    const page = await readFile(join(directory, 'get-ping', 'index.html'), 'utf8');

    // Then the elements the nonce would ride on are present, and no nonce is
    expect(page).toContain('<script type="application/json"');
    expect(page).toContain('<script type="module"');
    expect(page).not.toContain('nonce');
  });

  it('should write the two site files at the root', async () => {
    // Given
    await build({ base: 'https://docs.example.com' });

    // When
    const sitemap = await readFile(join(directory, 'sitemap.xml'), 'utf8');
    const llms = await readFile(join(directory, 'llms.txt'), 'utf8');

    // Then
    expect(sitemap).toContain('<loc>https://docs.example.com/get-ping</loc>');
    expect(llms).toContain('# Mini');
  });

  it('should write the same bytes for a carried file when one node changes', async () => {
    // Given: the sitemap, a pure function of inputs the changed node does not move, unlike a
    // page, whose state block names the document hash and so is rewritten with new bytes.
    await build({ base: 'https://docs.example.com' });
    const sitemapPath = join(directory, 'sitemap.xml');
    const before = await readFile(sitemapPath, 'utf8');

    // When
    await build({
      document: miniDocument({ pongResponse: 'described differently' }),
      base: 'https://docs.example.com',
    });

    // Then: rewritten with the same bytes is still a rewrite, so this asserts byte identity
    // rather than a preserved modification time, which the build does not promise.
    const after = await readFile(sitemapPath, 'utf8');
    expect(after).toContain('<loc>https://docs.example.com/get-ping</loc>');
    expect(after).toBe(before);
  });

  it('should refuse to write outside the output directory', async () => {
    // Given
    const store = new FsOutputStore(directory);

    // When
    const act = async (): Promise<void> => {
      await store.write('../escaped.html', 'no');
    };

    // Then
    await expect(act()).rejects.toThrow(/outside the output directory/);
  });

  it('should remove a page the previous build wrote and leave a file it never wrote', async () => {
    // Given
    await buildSite({
      document: miniDocument({ withThird: true }),
      store: new FsOutputStore(directory),
      assets: fixtureAssets(),
    });
    await writeFile(join(directory, 'CNAME'), 'docs.example.com', 'utf8');

    // When
    const report = await build();

    // Then
    expect(report.removed).toContain('get-pang/index.html');
    await expect(readFile(join(directory, 'get-pang', 'index.html'), 'utf8')).rejects.toThrow();
    expect(await readFile(join(directory, 'CNAME'), 'utf8')).toBe('docs.example.com');
  });

  it('should read back its own manifest on the next run', async () => {
    // Given
    await build();

    // When
    const manifest = await readFile(join(directory, BUILD_MANIFEST_FILE), 'utf8');
    const report = await build({ document: miniDocument({ pongResponse: 'moved' }) });

    // Then
    expect(JSON.parse(manifest)).toHaveProperty('pages');
    expect(report.carried.length).toBeGreaterThan(0);
  });
});

describe('a schema whose id carries a directional control', () => {
  it('should build, be reachable from the page that links to it, and be readable on disk', async () => {
    // Given: the id is written with an escape so the source file carries no invisible character.
    const override = '\u202e';
    const { normalizeOpenApiDocument } = await import('@openref/core');
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Bidi', version: '1.0.0' },
      paths: {
        '/thing': {
          get: {
            operationId: 'thing',
            responses: {
              200: {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/Order${override}Dto` },
                  },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          [`Order${override}Dto`]: { type: 'object', properties: { id: { type: 'string' } } },
        },
      },
    });
    expect([...document.schemas.keys()][0]).toContain(override);

    // When
    await buildSite({ document, store: new FsOutputStore(directory), assets: fixtureAssets() });
    const onDisk = join(directory, 'schema', 'Order_u202e_Dto', 'index.html');
    const page = await readFile(onDisk, 'utf8');
    const linkingPage = await readFile(join(directory, 'get-thing', 'index.html'), 'utf8');

    // Then: the name on disk is readable, the link points at it, and the document's own
    // spelling of the id still reaches the page it is drawn on.
    expect(page).toContain('<!DOCTYPE html>');
    expect(linkingPage).toContain('/schema/Order_u202e_Dto');
    expect(page).toContain(override);
  });
});

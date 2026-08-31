import { describe, expect, it } from 'vitest';
import { createMemoryRenderCache } from '@openref/render';
import {
  buildSite,
  BUILD_MANIFEST_FILE,
  createSiteServer,
  type BuildReport,
  type ISiteServer,
} from '../../src/index';
import { fixtureAssets, MemoryOutputStore, miniDocument } from '../mocks/documents';

/**
 * SPEC 16.4's own property: what the live site answers is what the build writes.
 *
 * WHY THIS SUITE IS THE GUARANTEE RATHER THAN THE SHARED CODE. `site-artefacts.ts` gives the two
 * surfaces one producer per artefact, which stops the two from drifting inside a page. What it
 * cannot stop is a build that starts writing a file the server never learned to answer, which is
 * how a mount ends up serving a 404 at an address the built site holds. So the walk below is over
 * the files a REAL build wrote, not over a list this file keeps.
 *
 * BOTH DIRECTIONS. Every file the build wrote is asked for by its address, and every address the
 * server declares is looked for among the files. One direction alone passes on a server that
 * answers nothing but the pages, and on a build that writes nothing but them.
 *
 * THE NONCE IS THE ONE LEGITIMATE DIFFERENCE AND IT IS STATED HERE. A built page carries no nonce
 * attribute at all, because a file on disk is one response reused; a served page carries the one
 * the host generated. The equality is therefore asserted with no nonce, and the last case asserts
 * that passing one is the only thing that moves the bytes.
 */

/** The manifest is the build's record of itself, not an artefact a reader fetches. */
const NOT_FETCHED = [BUILD_MANIFEST_FILE];

/** One build and one server over the same document and the same options. */
async function pair(base?: string): Promise<{
  readonly store: MemoryOutputStore;
  readonly report: BuildReport;
  readonly server: ISiteServer;
}> {
  const document = miniDocument({ withThird: true });
  const store = new MemoryOutputStore();

  const report = await buildSite({
    document,
    store,
    assets: fixtureAssets(),
    ...(base === undefined ? {} : { base }),
  });

  const server = createSiteServer({
    document,
    assets: fixtureAssets(),
    ...(base === undefined ? {} : { base }),
  });

  return { store, report, server };
}

/** The bytes of one file as text, whichever way the store holds them. */
function textOf(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value);
}

/** The bytes of one answer as text. */
function answerText(body: string | Uint8Array): string {
  return typeof body === 'string' ? body : new TextDecoder().decode(body);
}

describe('createSiteServer, against what buildSite wrote', () => {
  it('should answer every file the build wrote with the same bytes, at the address that file is read from', async () => {
    // Given
    const { store, server } = await pair('/docs');
    const written = [...store.files.keys()].filter((file) => !NOT_FETCHED.includes(file));

    // Then: the subject is present before anything is proved about it.
    expect(written.length).toBeGreaterThan(10);

    // When
    const mismatched: string[] = [];
    for (const file of written) {
      const address = server.addressOf(file);
      if (address === null) {
        mismatched.push(`${file}: the server has no address for it`);
        continue;
      }

      const answer = await server.answer(address);
      if (answer === null) {
        mismatched.push(`${file}: the server answered nothing at ${address}`);
        continue;
      }

      if (answer.file !== file) {
        mismatched.push(`${file}: ${address} answered with ${answer.file}`);
        continue;
      }

      if (answerText(answer.body) !== textOf(store.files.get(file) ?? '')) {
        mismatched.push(`${file}: the bytes differ`);
      }
    }

    // Then
    expect(mismatched).toEqual([]);
  });

  it('should declare exactly the files the build wrote, the manifest excepted', async () => {
    // Given
    const { store, server } = await pair('/docs');

    // When
    const written = [...store.files.keys()].filter((file) => !NOT_FETCHED.includes(file)).sort();

    // Then
    expect([...server.files].sort()).toEqual(written);
  });

  it('should write a sitemap and answer it only when the base carries an origin', async () => {
    // Given
    const withOrigin = await pair('https://docs.example.com/api');
    const withoutOrigin = await pair('/api');

    // When
    const served = await withOrigin.server.answer('/api/sitemap.xml');
    const unserved = await withoutOrigin.server.answer('/api/sitemap.xml');

    // Then
    expect(withOrigin.report.sitemap).toBe(true);
    expect(served?.body).toBe(withOrigin.store.files.get('sitemap.xml'));
    expect(withoutOrigin.report.sitemap).toBe(false);
    expect(unserved).toBeNull();
  });

  it('should answer nothing outside its own base', async () => {
    // Given
    const { server } = await pair('/docs');

    // When
    const outside = await server.answer('/other/llms.txt');
    const inside = await server.answer('/docs/llms.txt');

    // Then: the negative is only meaningful because the same file answers inside the mount.
    expect(inside).not.toBeNull();
    expect(outside).toBeNull();
  });

  it('should answer the overview at the bare base, which is where every link points, and at the trailing slash a reader types', async () => {
    // Given
    const { store, server } = await pair('/docs');

    // When
    const bare = await server.answer('/docs');
    const slash = await server.answer('/docs/');

    // Then
    expect(server.addressOf('index.html')).toBe('/docs');
    expect(bare?.body).toBe(store.files.get('index.html'));
    expect(slash?.file).toBe('index.html');
  });

  it('should put the host nonce in the served page and nowhere else, which is the one difference from the built file', async () => {
    // Given
    const { store, server } = await pair('/docs');
    const nonce = 'dGVzdC1ub25jZS0xMjM0';

    // When
    const withoutNonce = await server.answer('/docs');
    const withNonce = await server.answer('/docs', nonce);
    const built = textOf(store.files.get('index.html') ?? '');

    // Then
    expect(answerText(withoutNonce?.body ?? '')).toBe(built);
    expect(answerText(withNonce?.body ?? '')).toContain(`nonce="${nonce}"`);
    expect(built).not.toContain('nonce=');
  });

  it('should render one page once, which is what the SPEC 12 cache is for', async () => {
    // Given
    const document = miniDocument({ withThird: true });
    const cache = createMemoryRenderCache();
    const server = createSiteServer({ document, assets: fixtureAssets(), base: '/docs', cache });

    // Then: nothing has been asked for, so a hit later is a hit rather than a default.
    expect(cache.stats().hits).toBe(0);

    // When
    const first = await server.answer('/docs/get-ping');
    const second = await server.answer('/docs/get-ping');

    // Then
    expect(first?.body).toBe(second?.body);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1 });
  });

  it('should mark only hashed assets immutable, since every other address outlives its contents', async () => {
    // Given
    const { store, server } = await pair('/docs');
    const asset = [...store.files.keys()].find((file) => file.startsWith('_assets/'));

    // Then: the subject exists before its property is asserted.
    expect(asset).toBeDefined();

    // When
    const assetAnswer = await server.answer(`/docs/${asset ?? ''}`);
    const indexAnswer = await server.answer('/docs/_search-index');

    // Then
    expect(assetAnswer?.immutable).toBe(true);
    expect(indexAnswer?.immutable).toBe(false);
  });
});

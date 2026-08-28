import { describe, expect, it } from 'vitest';
import type { IRDocument } from '@openref/core';
import { APP_ROOT_ID, searchIndexHref, SEARCH_INDEX_SEGMENT } from '@openref/render';
import {
  buildSite,
  BUILD_MANIFEST_FILE,
  readManifest,
  SEARCH_INDEX_FILE,
  type BuildReport,
} from '../../src/index';
import { fixtureAssets, MemoryOutputStore, miniDocument } from '../mocks/documents';

/**
 * The build, end to end, over an output store in memory.
 *
 * IN MEMORY BECAUSE THE TWO CLAIMS ARE ABOUT BYTES AND ABOUT WORK, and a disk answers neither
 * well: a modification time has a resolution problem on some filesystems and says nothing about
 * why a file was written, while the store records exactly which pages were rendered and which
 * were carried. The filesystem adapter has its own cases, and the integration suite runs the
 * whole thing against a real directory.
 */

/** What one call to the helper below takes. */
interface BuildCase {
  readonly document: IRDocument;
  /** An existing store, for a rebuild. A fresh one when absent. */
  readonly store?: MemoryOutputStore;
  readonly base?: string;
}

/** One build over a store. */
async function build(options: BuildCase): Promise<{
  readonly store: MemoryOutputStore;
  readonly report: BuildReport;
}> {
  const store = options.store ?? new MemoryOutputStore();
  const report = await buildSite({
    document: options.document,
    store,
    assets: fixtureAssets(),
    ...(options.base === undefined ? {} : { base: options.base }),
  });

  return { store, report };
}

describe('buildSite, determinism', () => {
  it('should write byte identical output for two builds of one document, generated files included', async () => {
    // Given
    const first = await build({ document: miniDocument(), base: 'https://docs.example.com/api' });
    const second = await build({ document: miniDocument(), base: 'https://docs.example.com/api' });

    // When
    const a = first.store.snapshot();
    const b = second.store.snapshot();

    // Then: two independently built outputs, not one output compared with itself.
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(a).toEqual(b);
    expect(Object.keys(a).length).toBeGreaterThan(10);
  });

  it('should write a page per node under its own address, not one application', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });

    // When
    const pages = [...store.files.keys()].filter((file) => file.endsWith('index.html'));

    // Then
    expect(pages).toEqual([
      'index.html',
      'health/index.html',
      'states/index.html',
      'get-ping/index.html',
      'bench/get-ping/index.html',
      'get-pong/index.html',
      'bench/get-pong/index.html',
      'schema/Pong/index.html',
      'shapes/Pong/index.html',
    ]);
  });

  it('should write the navigation payload where a page fetches it from', async () => {
    // Given
    const document = miniDocument();

    // When
    const { store } = await build({ document });
    const payload = store.files.get(`_navigation/${document.hash}`);

    // Then: the amendment's own requirement, at the path `navigationHref` produces.
    expect(typeof payload).toBe('string');
    expect(JSON.parse(String(payload))).toMatchObject({ documentHash: document.hash });
  });

  it('should write the search index as one file, at the address the page fetches', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });

    // When
    const index = store.files.get('_search-index');

    // Then
    expect(typeof index).toBe('string');
    expect(JSON.parse(String(index))).toHaveProperty('version');

    // AND THE NAME IS THE ONE CONSTANT AND NOT A COPY THAT MATCHES TODAY, per T042. The file a
    // build writes, the route `@openref/nest` registers and the href the palette fetches were
    // three unconnected literals; a drift in any of them serves a 404 to a palette that fails
    // open, so the page goes on working with no full text search and nothing goes red.
    expect(SEARCH_INDEX_FILE).toBe(SEARCH_INDEX_SEGMENT);
    expect(`/${SEARCH_INDEX_FILE}`).toBe(searchIndexHref());
  });

  it('should name every asset by the digest of its bytes', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });

    // When
    const assets = [...store.files.keys()].filter((file) => file.startsWith('_assets/'));

    // Then
    expect(assets).toHaveLength(2);
    for (const asset of assets) {
      expect(asset).toMatch(/^_assets\/[a-z]+\.[0-9a-f]{16}\.(css|js)$/);
    }
  });
});

describe('buildSite, the head of one page', () => {
  it('should carry a canonical link, og tags and json-ld when the base has an origin', async () => {
    // Given
    const { store } = await build({
      document: miniDocument(),
      base: 'https://docs.example.com/api',
    });

    // When
    const page = String(store.files.get('get-ping/index.html'));

    // Then
    expect(page).toContain('<link rel="canonical" href="https://docs.example.com/api/get-ping">');
    expect(page).toContain(
      '<meta property="og:url" content="https://docs.example.com/api/get-ping">',
    );
    expect(page).toContain('<meta property="og:title"');
    expect(page).toContain('<script type="application/ld+json"');
    expect(page).toContain('"@type":"TechArticle"');
  });

  it('should omit the two that need an origin, and say so, when the base is a path', async () => {
    // Given: the same page WITH the tags, so the absence below is a proved absence.
    const withOrigin = await build({
      document: miniDocument(),
      base: 'https://docs.example.com/api',
    });
    expect(String(withOrigin.store.files.get('get-ping/index.html'))).toContain('rel="canonical"');

    // When
    const { store, report } = await build({ document: miniDocument(), base: '/api' });
    const page = String(store.files.get('get-ping/index.html'));

    // Then
    expect(page).not.toContain('rel="canonical"');
    expect(page).not.toContain('og:url');
    expect(page).toContain('<meta property="og:title"');
    expect(store.files.has('sitemap.xml')).toBe(false);
    expect(report.sitemap).toBe(false);
    expect(report.notices[0]).toContain('no absolute --base was given');
  });

  it('should write no inline style attribute and no inline script anywhere', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });

    // When
    const pages = [...store.files.entries()].filter(([file]) => file.endsWith('index.html'));

    // Then
    expect(pages.length).toBeGreaterThan(0);
    for (const [file, contents] of pages) {
      expect(String(contents), file).not.toMatch(/<[a-z][^>]*\sstyle="/i);
      // The two script elements a page carries are both data, never code: the state block and
      // the JSON-LD. Anything else with a body would be an inline script.
      const scripts = [...String(contents).matchAll(/<script([^>]*)>/g)].map((match) => match[1]);
      for (const attributes of scripts) {
        expect(attributes, file).toMatch(/type="(application\/json|application\/ld\+json|module)"/);
      }
    }
  });
});

describe('buildSite, incremental rebuild', () => {
  it('should re-render only the pages a changed operation affects', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });
    const firstPages = store.writes.filter((file) => file.endsWith('index.html')).length;
    expect(firstPages).toBe(9);

    // When: a change no navigation entry carries, so only that operation's pages move.
    const { report } = await build({
      document: miniDocument({ pongResponse: 'ok, described differently' }),
      store,
    });

    // Then
    expect(report.rendered).toEqual(['get-pong/index.html', 'bench/get-pong/index.html']);
    expect(report.carried).toHaveLength(7);
  });

  it('should produce a carried page byte identical to a rendered one', async () => {
    // Given
    const changed = miniDocument({ pongResponse: 'ok, described differently' });

    const incremental = new MemoryOutputStore();
    await build({ document: miniDocument(), store: incremental });
    const { report } = await build({ document: changed, store: incremental });
    expect(report.carried).toContain('get-ping/index.html');

    // When: the same document built from nothing, which renders every page.
    const full = await build({ document: changed });

    // Then: a carried page is not merely present, it is the same bytes.
    for (const file of report.carried) {
      expect(String(incremental.files.get(file)), file).toBe(String(full.store.files.get(file)));
    }
  });

  it('should re-render everything when a change reaches the navigation every page draws', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });

    // When: a summary, which the navigation entry carries, so every page's rail differs.
    const { report } = await build({
      document: miniDocument({ pongSummary: 'Pong, moved' }),
      store,
    });

    // Then: honest rather than convenient. The pages really do differ, measured by rendering
    // both and diffing, so carrying one would ship a page that disagrees with its own document.
    expect(report.carried).toEqual([]);
    expect(report.rendered).toHaveLength(9);
  });

  it('should remove a page the previous build wrote and this one does not', async () => {
    // Given
    const { store } = await build({ document: miniDocument({ withThird: true }) });
    expect(store.files.has('get-pang/index.html')).toBe(true);

    // When
    const { report } = await build({ document: miniDocument(), store });

    // Then
    expect(report.removed).toContain('get-pang/index.html');
    expect(store.files.has('get-pang/index.html')).toBe(false);
  });

  it('should touch nothing it did not write, because the manifest and not the directory says what is its', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });
    await store.write('CNAME', 'docs.example.com');

    // When
    const { report } = await build({ document: miniDocument(), store });

    // Then
    expect(report.removed).toEqual([]);
    expect(store.removals).not.toContain('CNAME');
    expect(store.files.get('CNAME')).toBe('docs.example.com');
  });

  it('should render everything when the manifest is from another base', async () => {
    // Given
    const { store } = await build({ document: miniDocument(), base: '/one' });

    // When
    const { report } = await build({ document: miniDocument(), store, base: '/two' });

    // Then: every link on every page carries the base, so nothing is comparable.
    expect(report.carried).toEqual([]);
  });

  it('should render everything when the manifest cannot be read', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });
    await store.write(BUILD_MANIFEST_FILE, '{ not json');

    // When
    const { report } = await build({ document: miniDocument(), store });

    // Then: unreadable means nothing is known, and nothing known means render.
    expect(report.carried).toEqual([]);
  });

  it('should render a page whose previous file was edited by hand', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });
    await store.write('get-ping/index.html', '<!DOCTYPE html><html><body>edited</body></html>');

    // When
    const { report } = await build({
      document: miniDocument({ pongResponse: 'ok, described differently' }),
      store,
    });

    // Then: a file this build cannot take apart is rendered rather than half reused.
    expect(report.rendered).toContain('get-ping/index.html');
    expect(String(store.files.get('get-ping/index.html'))).toContain(APP_ROOT_ID);
  });
});

describe('buildSite, the manifest', () => {
  it('should record the document, the base and a key per page', async () => {
    // Given
    const document = miniDocument();

    // When
    const { store } = await build({ document, base: 'https://docs.example.com/api' });
    const manifest = readManifest(String(store.files.get(BUILD_MANIFEST_FILE)));

    // Then
    expect(manifest).not.toBeNull();
    expect(manifest?.documentHash).toBe(document.hash);
    expect(manifest?.basePath).toBe('/api');
    expect(manifest?.siteUrl).toBe('https://docs.example.com/api');
    expect(manifest?.pages).toHaveLength(9);
    for (const page of manifest?.pages ?? []) expect(page.key).not.toBe('');
  });

  it('should be refused when it is of a version this build does not know', async () => {
    // Given
    const { store } = await build({ document: miniDocument() });
    const manifest = JSON.parse(String(store.files.get(BUILD_MANIFEST_FILE))) as Record<
      string,
      unknown
    >;
    // 3 SINCE `T042`, when the manifest gained `staticProxy`. The literal is pinned rather than
    // read from the constant so that a bump has to be noticed here, which is the whole point of
    // a version a reader can refuse.
    expect(manifest.version).toBe(3);
    manifest.version = 99;

    // When
    const result = readManifest(JSON.stringify(manifest));

    // Then
    expect(result).toBeNull();
  });
});

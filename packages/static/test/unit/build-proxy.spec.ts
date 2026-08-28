import { describe, expect, it } from 'vitest';
import type { IRDocument } from '@openref/core';
import {
  buildSite,
  BUILD_MANIFEST_FILE,
  readManifest,
  type BuildReport,
  type BuildSiteOptions,
} from '../../src/index';
import { fixtureAssets, MemoryOutputStore, miniDocument } from '../mocks/documents';

/**
 * The proxy half of `buildSite`, per SPEC 16.2: what a target writes, what a target warns, and
 * what a rebuild for another target removes.
 */

const SERVED = [{ url: 'https://api.example.com/v1' }];

async function build(options: {
  readonly document: IRDocument;
  readonly store?: MemoryOutputStore;
  readonly base?: string;
  readonly proxy?: BuildSiteOptions['proxy'];
}): Promise<{ readonly store: MemoryOutputStore; readonly report: BuildReport }> {
  const store = options.store ?? new MemoryOutputStore();
  const report = await buildSite({
    document: options.document,
    store,
    assets: fixtureAssets(),
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
  });

  return { store, report };
}

describe('buildSite, proxy generation', () => {
  it('should write the netlify rules into the output, tracked as build files', async () => {
    // Given
    const { store, report } = await build({
      document: miniDocument({ servers: SERVED }),
      proxy: { target: 'netlify' },
    });

    // Then
    const redirects = store.files.get('_redirects');
    expect(typeof redirects).toBe('string');
    expect(redirects).toContain('/_proxy/u0/* https://api.example.com/v1/:splat 200');
    expect(report.files).toContain('_redirects');
    expect(report.proxy).toEqual({
      target: 'netlify',
      upstreams: ['https://api.example.com/v1'],
      files: ['_redirects'],
      directTarget: null,
    });

    const manifest = readManifest(String(store.files.get(BUILD_MANIFEST_FILE)));
    expect(manifest?.files).toContain('_redirects');
  });

  it('should write nothing and report null when no target was given, as before T040', async () => {
    // Given
    const { store, report } = await build({ document: miniDocument({ servers: SERVED }) });

    // Then
    expect(store.files.has('_redirects')).toBe(false);
    expect(report.proxy).toBeNull();
  });

  it('should be deterministic with a target: two builds write identical bytes', async () => {
    // Given: two independently built outputs, not one compared with itself.
    const first = await build({
      document: miniDocument({ servers: SERVED }),
      proxy: { target: 'vercel' },
    });
    const second = await build({
      document: miniDocument({ servers: SERVED }),
      proxy: { target: 'vercel' },
    });

    // Then
    expect(second.store.snapshot()).toEqual(first.store.snapshot());
    expect(first.store.files.has('vercel.json')).toBe(true);
  });

  it("should remove the previous target's files when the target changes", async () => {
    // Given: a netlify build whose rules are then rebuilt for vercel.
    const document = miniDocument({ servers: SERVED });
    const first = await build({ document, proxy: { target: 'netlify' } });
    expect(first.store.files.has('_redirects')).toBe(true);

    // When
    const second = await build({
      document,
      store: first.store,
      proxy: { target: 'vercel' },
    });

    // Then: no stale gateway beside the new one.
    expect(second.store.files.has('_redirects')).toBe(false);
    expect(second.store.files.has('vercel.json')).toBe(true);
    expect(second.report.removed).toContain('_redirects');
  });

  it('should report the skipped server and still write rules for the resolvable one', async () => {
    // Given
    const { store, report } = await build({
      document: miniDocument({
        servers: [{ url: 'https://api.example.com' }, { url: 'https://{tenant}.example.com' }],
      }),
      proxy: { target: 'netlify' },
    });

    // Then: no broken rule, and the warning names the unresolvable server.
    const redirects = String(store.files.get('_redirects'));
    expect(redirects).toContain('https://api.example.com/:splat');
    expect(redirects).not.toContain('tenant');
    expect(report.notices.some((notice) => notice.includes('{tenant}'))).toBe(true);
  });

  it('should write no config and say so for a document with no absolute server', async () => {
    // Given: the T004-R1 default document, whose one server is `/`.
    const { store, report } = await build({
      document: miniDocument(),
      proxy: { target: 'netlify' },
    });

    // Then
    expect(store.files.has('_redirects')).toBe(false);
    expect(report.notices.some((notice) => notice.includes('no absolute http(s) server'))).toBe(
      true,
    );
    expect(report.proxy?.upstreams).toEqual([]);
  });
});

describe('buildSite, the direct mode warning of SPEC 16.2', () => {
  it('should put the warning into every bench page for a target with no rewrite', async () => {
    // Given
    const { store, report } = await build({
      document: miniDocument({ servers: SERVED }),
      proxy: { target: 'github-pages' },
    });

    // Then: the page bytes carry the sentence and the model carries the platform name.
    const bench = String(store.files.get('bench/get-ping/index.html'));
    expect(bench).toContain('published on GitHub Pages');
    expect(bench).toContain('straight from your browser to the API');
    expect(bench).toContain('"directTarget":"GitHub Pages"');
    expect(report.proxy?.directTarget).toBe('GitHub Pages');
    expect(report.notices.some((notice) => notice.includes('cannot rewrite routes'))).toBe(true);
  });

  it('should carry no warning without a target, proven against the page that shows it', async () => {
    // Given: the same document warned under github-pages, so the absence below is absence of
    // a thing this suite has already seen present.
    const warned = await build({
      document: miniDocument({ servers: SERVED }),
      proxy: { target: 'github-pages' },
    });
    expect(String(warned.store.files.get('bench/get-ping/index.html'))).toContain(
      'published on GitHub Pages',
    );

    // When
    const { store } = await build({ document: miniDocument({ servers: SERVED }) });

    // Then
    const bench = String(store.files.get('bench/get-ping/index.html'));
    expect(bench).not.toContain('published on GitHub Pages');
    expect(bench).not.toContain('directTarget');
  });

  it('should carry no warning when the document pins no upstream, and say why', async () => {
    // Given: direct mode to the page's own origin is not a degradation.
    const { store, report } = await build({
      document: miniDocument(),
      proxy: { target: 'github-pages' },
    });

    // Then
    const bench = String(store.files.get('bench/get-ping/index.html'));
    expect(bench).not.toContain('directTarget');
    expect(report.proxy?.directTarget).toBeNull();
    expect(report.notices.some((notice) => notice.includes('pages carry no warning'))).toBe(true);
  });

  it('should render everything anew when the warning changes, never carry a stale page', async () => {
    // Given: a warned build, rebuilt with no target over the same store.
    const document = miniDocument({ servers: SERVED });
    const first = await build({ document, proxy: { target: 'github-pages' } });

    // When
    const second = await build({ document, store: first.store });

    // Then: the manifest does not apply across the warning boundary, so nothing is carried,
    // and the pages no longer carry the sentence.
    expect(second.report.carried).toEqual([]);
    expect(second.report.rendered.length).toBeGreaterThan(0);
    expect(String(second.store.files.get('bench/get-ping/index.html'))).not.toContain(
      'published on GitHub Pages',
    );
  });

  it('should carry pages again when the warning is unchanged between builds', async () => {
    // Given
    const document = miniDocument({ servers: SERVED });
    const proxy = { target: 'github-pages' } as const;
    const first = await build({ document, proxy });

    // When
    const second = await build({ document, store: first.store, proxy });

    // Then: the incremental path survives the feature it was extended for.
    expect(second.report.rendered).toEqual([]);
    expect(second.report.carried.length).toBeGreaterThan(0);
  });
});

describe('buildSite, the manifest across a renderer upgrade', () => {
  it('should refuse to carry pages written by another renderer version', async () => {
    // Given: a finished build whose manifest is then doctored to an older renderer, which is
    // exactly what a pre upgrade output directory looks like to a post upgrade build.
    const document = miniDocument({ servers: SERVED });
    const first = await build({ document });
    const manifest = String(first.store.files.get(BUILD_MANIFEST_FILE));
    expect(manifest).toContain('rendererVersion');

    const doctored = manifest.replace(/"rendererVersion":"[^"]+"/, '"rendererVersion":"1.1.1"');
    expect(doctored).not.toBe(manifest);
    await first.store.write(BUILD_MANIFEST_FILE, doctored);

    // When
    const second = await build({ document, store: first.store });

    // Then: everything renders, nothing is carried forward from bytes another renderer wrote.
    expect(second.report.carried).toEqual([]);
    expect(second.report.rendered.length).toBeGreaterThan(0);
  });
});

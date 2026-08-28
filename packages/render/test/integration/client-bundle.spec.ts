import { gzipSync } from 'node:zlib';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanClientBundle } from '../mocks/bundle-scan';
import { chunkReferences } from '../../src/index';

/**
 * What the browser actually receives.
 *
 * Every assertion here reads the built file. The build configuration says the highlighter
 * is server only; this checks that it is, because a configuration that is supposed to keep
 * 300 KB out of a bundle is worth weighing rather than reading.
 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY_FILE = 'openref.js';
const bundlePath = join(packageRoot, 'dist', 'browser', ENTRY_FILE);

function readBundle(): string {
  if (!existsSync(bundlePath)) {
    throw new Error(
      `client bundle not found at ${bundlePath}. Run pnpm build before the integration suite; a missing bundle is not a pass`,
    );
  }

  const bundle = readFileSync(bundlePath, 'utf8');

  // THE SUBJECT IS ASSERTED PRESENT BEFORE ANYTHING IS ASSERTED ABSENT, per SPEC 0. Three of
  // the cases below say a marker is not in this file, and a truncated or stubbed build answers
  // every one of them by containing nothing. Existing is not the same as being the bundle, so
  // the file is required to carry the renderer's own entry before it is searched for what it
  // must not carry.
  if (!bundle.includes('oref-app')) {
    throw new Error(
      `the file at ${bundlePath} does not carry the renderer entry, so an absence found in it means nothing`,
    );
  }

  return bundle;
}

/**
 * The counter check to `JS_SPECIFIER`, added by the pre-M4 review.
 *
 * The catalog rewrites a sibling specifier to the hashed name its chunk is served under, and it
 * finds those specifiers with a regular expression over minified text. The review counted eight
 * spellings a bundler can emit and measured that expression seeing three; backticks and `.mjs`
 * were then added to it, and the next release of a bundler can invent a ninth. A regular
 * expression chasing bundler output is not a thing that stays complete, so what is asserted here
 * is the property instead: a chunk exists to be imported, so a built chunk that no other built
 * file names is either dead weight or a specifier written in a form the rewriter cannot see, and
 * the second one ships a 404 on the click that reaches for it.
 */
describe('the built chunk graph', () => {
  it('should have every chunk but the entry named by another built file', () => {
    // Given every built module, read with the same function the catalog rewrites with
    const directory = join(packageRoot, 'dist', 'browser');
    if (!existsSync(directory)) throw new Error(`${directory} is not built; run pnpm build first`);

    const files = readdirSync(directory).filter((name) => /\.m?js$/.test(name));
    expect(files.length).toBeGreaterThan(1);

    const named = new Set<string>();
    for (const file of files) {
      for (const reference of chunkReferences(readFileSync(join(directory, file), 'utf8'))) {
        named.add(reference);
      }
    }

    // When
    const unreferenced = files.filter((name) => name !== ENTRY_FILE && !named.has(name));

    // Then
    expect(unreferenced).toEqual([]);
  });

  it('should name only chunks that exist, so no rewrite can point at nothing', () => {
    // Given
    const directory = join(packageRoot, 'dist', 'browser');
    const files = readdirSync(directory).filter((name) => /\.m?js$/.test(name));
    const present = new Set(files);

    // When
    const dangling = files.flatMap((file) =>
      chunkReferences(readFileSync(join(directory, file), 'utf8')).filter(
        (reference) => !present.has(reference),
      ),
    );

    // Then
    expect([...new Set(dangling)]).toEqual([]);
  });
});

describe('client bundle', () => {
  it('should contain none of the server only libraries', () => {
    // Given
    const bundle = readBundle();

    // When
    const found = scanClientBundle(bundle);

    // Then
    expect(found.forbidden).toEqual([]);
  });

  it('should not carry a syntax grammar or a theme, which is what makes shiki large', () => {
    // Given
    const bundle = readBundle();

    // When
    const markers = ['tmLanguage', 'textmate', 'onigasm', 'oniguruma', 'createHighlighter'];

    // Then
    expect(markers.filter((marker) => bundle.includes(marker))).toEqual([]);
  });

  /**
   * The adopted positions of `TX-ADOPT` ride no chunk, per SPEC 12: the browser fills each
   * with a childless element, so the component that draws it lives in `eager.ts` and the
   * server render alone. One marker per adopted component, each a string only that component
   * emits, so the case names the position that leaked rather than saying "the bundle grew".
   */
  it('should carry none of the components the browser adopts instead of drawing', () => {
    // Given
    const bundle = readBundle();

    // When
    const markers = [
      'oref-driftbox', // OperationHeader
      'oref-parity-grid', // RuntimePanel
      'oref-param-name', // ParamTable
      'Error contracts', // ResponseList
      'oref-prov-glyph', // ProvenanceTag
      'oref-drift-rule', // DriftCard
      'Empty and degraded states', // StatesPanel
      'oref-server-list', // DocumentOverview
      'oref-security-item', // NodeSections
    ];

    // Then
    expect(markers.filter((marker) => bundle.includes(marker))).toEqual([]);
  });

  it('should hydrate on load rather than needing an inline script to call it', () => {
    // Given
    const bundle = readBundle();

    // When
    const hydrates = bundle.includes('oref-app') && bundle.includes('oref-state');

    // Then
    expect(hydrates).toBe(true);
  });

  it('should carry no construct a strict policy would block', () => {
    // Given
    const bundle = readBundle();

    // When
    const found = scanClientBundle(bundle);

    // Then
    expect(found.cspViolations).toEqual([]);
  });

  it('should stay well inside the client javascript budget on its own', () => {
    // Given
    const bundle = readBundle();

    // When
    const gzipBytes = gzipSync(Buffer.from(bundle, 'utf8')).length;

    // Then
    // SPEC 20 budgets core plus the default theme at 100 KB gzip. The budgets gate measures
    // the whole of dist/browser; this asserts the renderer's own share is a fraction of it,
    // so a regression shows up here before it eats the theme's headroom.
    expect(gzipBytes).toBeLessThan(50 * 1024);
  });
});

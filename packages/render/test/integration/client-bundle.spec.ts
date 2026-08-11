import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanClientBundle } from '../mocks/bundle-scan';

/**
 * What the browser actually receives.
 *
 * Every assertion here reads the built file. The build configuration says the highlighter
 * is server only; this checks that it is, because a configuration that is supposed to keep
 * 300 KB out of a bundle is worth weighing rather than reading.
 */
const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundlePath = join(packageRoot, 'dist', 'browser', 'openref.js');

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

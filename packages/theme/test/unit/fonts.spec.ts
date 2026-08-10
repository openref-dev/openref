import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_STYLESHEETS, LIGHT_TOKEN_VALUES } from '../../src/index';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');
const FONTS = join(PACKAGE_ROOT, 'fonts');

interface AssetEntry {
  readonly file: string;
  readonly family: string;
  readonly licenseTextFile: string;
  readonly modified: boolean;
  readonly modifications: string;
}

function manifest(): AssetEntry[] {
  const parsed = JSON.parse(readFileSync(join(FONTS, 'manifest.json'), 'utf8')) as {
    assets: AssetEntry[];
  };
  return parsed.assets;
}

/**
 * The faces this package ships, per SPEC 0 zone 4 and SPEC 20.
 *
 * The licence checks live in the gate, which is where the whole policy lives. What is asserted
 * here is the thing only this package knows: that the stylesheet, the token stacks and the
 * files on disk are talking about the same faces. Any two of those three agreeing while the
 * third does not is a page that renders in a fallback and says nothing about it.
 */
describe('the fonts the default theme ships', () => {
  it('should declare a face for every file, and a file for every face', () => {
    // Given
    const css = readFileSync(join(FONTS, 'fonts.css'), 'utf8');
    const onDisk = readdirSync(FONTS)
      .filter((file) => file.endsWith('.woff2'))
      .sort();

    // When
    const referenced = [...css.matchAll(/url\('\.\/([^']+)'\)/g)]
      .map((match) => match[1] ?? '')
      .sort();

    // Then
    expect(referenced).toEqual(onDisk);
    expect(onDisk).toHaveLength(5);
  });

  it('should name only families the token stacks actually ask for', () => {
    // Given, a face nobody asks for is bytes the reader downloads for nothing.
    const css = readFileSync(join(FONTS, 'fonts.css'), 'utf8');
    const stacks = [
      LIGHT_TOKEN_VALUES['--oref-font-family-sans'] ?? '',
      LIGHT_TOKEN_VALUES['--oref-font-family-mono'] ?? '',
      LIGHT_TOKEN_VALUES['--oref-font-family-display'] ?? '',
    ].join(' ');

    // When
    const declared = [...new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]))];

    // Then
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((family) => !stacks.includes(family ?? ''))).toEqual([]);
  });

  it('should put every family first in the stack that asks for it', () => {
    // Given, a self hosted face that is not first is a face that never gets used.
    const sans = LIGHT_TOKEN_VALUES['--oref-font-family-sans'] ?? '';
    const mono = LIGHT_TOKEN_VALUES['--oref-font-family-mono'] ?? '';

    // When
    const first = [sans, mono].map((stack) => stack.split(',')[0]?.trim());

    // Then
    expect(first).toEqual(["'Space Grotesk'", "'JetBrains Mono'"]);
  });

  it('should load every face with font-display swap', () => {
    // Given, text in a fallback face beats text that is not there.
    const css = readFileSync(join(FONTS, 'fonts.css'), 'utf8');

    // When
    const faces = css.match(/@font-face/g)?.length ?? 0;
    const swaps = css.match(/font-display:\s*swap/g)?.length ?? 0;

    // Then
    expect(faces).toBe(5);
    expect(swaps).toBe(faces);
  });

  it('should fetch nothing from another origin', () => {
    // Given, SPEC 19 puts outgoing requests from the client at zero, and a font served from
    // someone else's origin also tells them who is reading the documentation.
    const css = readFileSync(join(FONTS, 'fonts.css'), 'utf8');

    // When
    const remote = [...css.matchAll(/url\(\s*'?(?:https?:)?\/\//g)];

    // Then
    expect(remote).toEqual([]);
  });

  it('should record every shipped file as a subset in the manifest', () => {
    // Given, a subset is a derivative work and OFL asks for that to be said.
    const entries = manifest();

    // When
    const silent = entries.filter(
      (entry) => !entry.modified || !entry.modifications.includes('subset'),
    );

    // Then
    expect(entries).toHaveLength(5);
    expect(silent).toEqual([]);
  });

  it('should keep the licence text of every family beside the files', () => {
    // Given
    const entries = manifest();
    const present = new Set(readdirSync(FONTS));

    // When
    const missing = [...new Set(entries.map((entry) => entry.licenseTextFile))].filter(
      (file) => !present.has(file),
    );

    // Then
    expect(missing).toEqual([]);
  });

  it('should bring the faces before the stylesheets that ask for them', () => {
    // Given
    const stylesheets = [...DEFAULT_THEME_STYLESHEETS];

    // When
    const fontsAt = stylesheets.indexOf('@openref/theme/fonts.css');

    // Then
    expect(fontsAt).toBe(0);
  });

  it('should resolve the font stylesheet through the package exports', () => {
    // Given
    const exports = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, unknown>;
      files: string[];
    };

    // When
    const target = exports.exports['./fonts.css'];

    // Then
    expect(target).toBe('./fonts/fonts.css');
    // That the fonts and their licences actually arrive is asserted against the packed tarball
    // in `test/integration/packaged-attribution.spec.ts`, not here: this file reads the working
    // tree, and the failure worth catching is one the working tree cannot show.
    expect(exports.files.some((entry) => entry.startsWith('fonts'))).toBe(true);
  });
});

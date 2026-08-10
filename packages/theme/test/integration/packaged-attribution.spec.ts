import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Attribution has to survive `npm pack`, per SPEC 0 zone 4.
 *
 * THIS IS TESTED AGAINST THE TARBALL AND NOT AGAINST THE WORKING TREE, and that is the whole
 * point. npm drops anything outside the `files` field silently. A font whose licence text was
 * left out ships with no licence, the working tree looks exactly right, and a test that reads
 * the working tree stays green through precisely that failure. The only way to see it is to
 * pack, unpack, and look at what came out.
 *
 * The obligation is per published package. A package cannot lean on a file sitting in a
 * sibling, and attribution that lives only at the repository root detaches the moment someone
 * installs one theme on its own. `THIRD-PARTY-NOTICES.md` at the root is a convenience for a
 * single read and does not count as delivered attribution.
 *
 * The duplication this forces, one full OFL text per family in every theme package that uses
 * it, is correct rather than waste.
 */

let packed = '';

interface AssetEntry {
  readonly file: string;
  readonly family: string;
  readonly licenseTextFile: string;
}

function manifestOf(root: string): AssetEntry[] {
  const parsed = JSON.parse(readFileSync(join(root, 'fonts', 'manifest.json'), 'utf8')) as {
    assets: AssetEntry[];
  };
  return parsed.assets;
}

beforeAll(() => {
  packed = mkdtempSync(join(tmpdir(), 'openref-pack-'));

  // `npm pack` honours `files`, `.npmignore` and the package defaults exactly as publishing
  // does, which is what makes this a test of the published artifact rather than of a copy.
  const output = execFileSync('npm', ['pack', '--pack-destination', packed, '--silent'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });

  const tarball = output.trim().split('\n').at(-1) ?? '';
  execFileSync('tar', ['-xzf', join(packed, tarball), '-C', packed]);
}, 120_000);

afterAll(() => {
  if (packed !== '') rmSync(packed, { recursive: true, force: true });
});

describe('the published tarball', () => {
  it('should carry every font file', () => {
    // Given
    const root = join(packed, 'package');

    // When
    const shipped = readdirSync(join(root, 'fonts'))
      .filter((file) => file.endsWith('.woff2'))
      .sort();

    // Then
    expect(shipped).toEqual(
      manifestOf(root)
        .map((asset) => asset.file)
        .sort(),
    );
    expect(shipped.length).toBeGreaterThan(0);
  });

  it('should put the complete licence text of every family beside its fonts', () => {
    // Given
    const root = join(packed, 'package');
    const present = new Set(readdirSync(join(root, 'fonts')));

    // When
    const unlicensed = manifestOf(root).filter((asset) => !present.has(asset.licenseTextFile));

    // Then
    expect(unlicensed.map((asset) => asset.file)).toEqual([]);
  });

  it('should ship the licence text in full rather than a pointer to the repository', () => {
    // Given, a pointer detaches the moment someone installs this package on its own.
    const root = join(packed, 'package');
    const texts = readdirSync(join(root, 'fonts')).filter((file) => file.endsWith('-OFL.txt'));

    // When
    const short = texts.filter(
      (file) => readFileSync(join(root, 'fonts', file), 'utf8').length < 4000,
    );

    // Then
    expect(texts.length).toBeGreaterThan(0);
    expect(short).toEqual([]);
  });

  it('should carry this package own NOTICE beside the fonts', () => {
    // Given
    const root = join(packed, 'package');

    // When
    const notice = readFileSync(join(root, 'fonts', 'NOTICE.md'), 'utf8');

    // Then
    expect(notice).toContain('subset');
    for (const family of new Set(manifestOf(root).map((asset) => asset.family))) {
      expect(notice).toContain(family);
    }
  });

  it('should name every shipped font in its own NOTICE', () => {
    // Given
    const root = join(packed, 'package');
    const notice = readFileSync(join(root, 'fonts', 'NOTICE.md'), 'utf8');

    // When
    const unmentioned = readdirSync(join(root, 'fonts'))
      .filter((file) => file.endsWith('.woff2'))
      .filter((file) => !notice.includes(file));

    // Then
    expect(unmentioned).toEqual([]);
  });

  it('should carry the stylesheet that declares the faces', () => {
    // Given, fonts with no @font-face are bytes nothing can reach.
    const root = join(packed, 'package');

    // When
    const css = readFileSync(join(root, 'fonts', 'fonts.css'), 'utf8');

    // Then
    for (const asset of manifestOf(root)) expect(css).toContain(asset.file);
  });

  it('should not lean on the repository root notice, which does not travel', () => {
    // Given, the root file is a convenience summary for someone reading the repository.
    const root = join(packed, 'package');

    // When
    const shipped = readdirSync(root);

    // Then
    expect(shipped).not.toContain('THIRD-PARTY-NOTICES.md');
    expect(readdirSync(join(root, 'fonts'))).toContain('NOTICE.md');
  });
});

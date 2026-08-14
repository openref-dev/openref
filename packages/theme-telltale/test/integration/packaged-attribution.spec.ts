import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

/**
 * Attribution has to survive `npm pack`, per SPEC 0 zone 4.
 *
 * THIS IS TESTED AGAINST THE TARBALL AND NOT AGAINST THE WORKING TREE. npm drops anything outside
 * the `files` field silently: a font whose licence text was left out ships with no licence, the
 * working tree looks exactly right, and a test that reads the working tree stays green through
 * precisely that failure. The only way to see it is to pack, unpack, and look at what came out.
 *
 * IT IS THIS PACKAGE'S OWN FILE RATHER THAN AN EXTENSION OF `@openref/theme`'s, and the deviation
 * from the T032 amendment is deliberate. That amendment says the check in
 * `packages/theme/test/integration/packaged-attribution.spec.ts` is extended to cover this package,
 * and doing that would have written into a core package during the task whose definition of done is
 * an empty diff to every core package. The obligation the amendment describes is per published
 * package anyway: a package cannot lean on a file in a sibling, which is the same reason the
 * JetBrains Mono files here are a copy. So the check lives with the tarball it checks.
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
  packed = mkdtempSync(join(tmpdir(), 'openref-pack-telltale-'));

  // `npm pack` honours `files`, `.npmignore` and the package defaults exactly as publishing does,
  // which is what makes this a test of the published artifact rather than of a copy.
  const output = execFileSync('npm', ['pack', '--pack-destination', packed, '--silent'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });

  const tarball = output.trim().split('\n').at(-1) ?? '';
  execFileSync('tar', ['-xzf', join(packed, tarball), '-C', packed]);
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(() => {
  if (packed !== '') rmSync(packed, { recursive: true, force: true });
});

describe('the published tarball of the second theme', () => {
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
    expect(shipped).toHaveLength(6);
  });

  it('should put the complete licence text of both families beside its fonts', () => {
    // Given
    const root = join(packed, 'package');
    const present = new Set(readdirSync(join(root, 'fonts')));

    // When
    const assets = manifestOf(root);
    const unlicensed = assets.filter((asset) => !present.has(asset.licenseTextFile));

    // Then, an empty manifest has no unlicensed asset in it, per SPEC 0
    expect(assets.length).toBeGreaterThan(0);
    expect(unlicensed.map((asset) => asset.file)).toEqual([]);
    expect(present.has('JetBrainsMono-OFL.txt')).toBe(true);
    expect(present.has('MartianMono-OFL.txt')).toBe(true);
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
    expect(texts).toHaveLength(2);
    expect(short).toEqual([]);
  });

  it('should carry this package own NOTICE beside the fonts', () => {
    // Given, attribution that lives one package away stops travelling with the bytes it attributes.
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
    const shipped = readdirSync(join(root, 'fonts')).filter((file) => file.endsWith('.woff2'));
    const unmentioned = shipped.filter((file) => !notice.includes(file));

    // Then, a tarball with no font in it names every font it ships, per SPEC 0
    expect(shipped.length).toBeGreaterThan(0);
    expect(unmentioned).toEqual([]);
  });

  it('should say in its NOTICE that four of the six files are a copy, and why', () => {
    // Given, the four JetBrains Mono files are byte identical to the four in `@openref/theme`.
    // Byte deduplication holds in this repository and in `node_modules` and does not hold in a
    // tarball, which is the reason the duplication is correct rather than waste, and a reader who
    // notices the duplication should find the reason where the duplication is.
    const root = join(packed, 'package');

    // When
    const notice = readFileSync(join(root, 'fonts', 'NOTICE.md'), 'utf8');

    // Then
    expect(notice).toContain('byte identical');
    expect(notice).toContain('tarball');
  });

  it('should carry the stylesheet that declares the faces', () => {
    // Given, fonts with no @font-face are bytes nothing can reach.
    const root = join(packed, 'package');

    // When
    const css = readFileSync(join(root, 'fonts', 'fonts.css'), 'utf8');
    const assets = manifestOf(root);

    // Then, a loop over an empty manifest asserts nothing and reads as a pass, per SPEC 0
    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) expect(css).toContain(asset.file);
  });

  it('should carry the two stylesheets and the entry point its exports map names', () => {
    // Given, `exports` pointing at a file `files` drops is a package that installs and cannot be
    // used, and npm reports neither.
    const root = join(packed, 'package');
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      exports: Readonly<Record<string, unknown>>;
    };

    // When
    const targets = Object.values(manifest.exports).flatMap((entry) =>
      typeof entry === 'string'
        ? [entry]
        : Object.values(entry as Record<string, string>).filter(
            (value) => typeof value === 'string',
          ),
    );

    // Then every target that is not a wildcard and not the source condition is in the tarball
    const missing = targets
      .filter((target) => !target.includes('*') && !target.startsWith('./src/'))
      .filter((target) => {
        try {
          readFileSync(join(root, target));
          return false;
        } catch {
          return true;
        }
      });

    expect(targets.length).toBeGreaterThan(5);
    expect(missing).toEqual([]);
  });

  it('should carry the finding this package was written to produce', () => {
    // Given, `THEME-BOUNDARY.md` is what a theme author reads before writing one of their own, so
    // it is in `files` rather than being a document that stayed in the repository.
    const root = join(packed, 'package');

    // When
    const boundary = readFileSync(join(root, 'THEME-BOUNDARY.md'), 'utf8');

    // Then
    expect(boundary).toContain('Twenty five class names the theme did not write');
    expect(readdirSync(root)).toContain('README.md');
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

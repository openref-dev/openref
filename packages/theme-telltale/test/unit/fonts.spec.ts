import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TELLTALE_FIRST_PAINT_FACES } from '../../src/index';

/**
 * The faces this theme ships, per SPEC 0 zone 4 and SPEC 20.
 *
 * THE MANIFEST IS COMPARED WITH THE DISK IN BOTH DIRECTIONS. A file with no entry is a font with
 * no attribution in a published tarball; an entry with no file is a record that cannot fail and
 * therefore reads as coverage. The `fixture-licenses` gate asks the same question of this
 * directory from outside; this file asks it where a theme author works.
 *
 * THE THREE BUDGETS ARE MEASURED HERE PER THEME, and the caps are SPEC 20's, which are three
 * numbers however many themes ship. They are transcribed rather than imported, because
 * `tools/gates` is not a package a theme may depend on, and the `budgets` gate is what compares
 * the two: this file failing and that gate passing would mean the numbers had drifted, which is
 * the class of defect T034 owns.
 */

const FONTS = join(import.meta.dirname, '..', '..', 'fonts');
const MANIFEST = JSON.parse(readFileSync(join(FONTS, 'manifest.json'), 'utf8')) as {
  readonly assets: readonly {
    readonly file: string;
    readonly family: string;
    readonly shipsAs: string;
    readonly license: string;
    readonly licenseTextFile: string;
    readonly reservedFontName: string | null;
    readonly modified: boolean;
    readonly modifications: string;
    readonly sourceUrl: string;
    readonly retrievedAt: string;
    readonly copyrightHolder: string;
    readonly unicodeRange: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
};

const STYLESHEET = readFileSync(join(FONTS, 'fonts.css'), 'utf8');

/** SPEC 20's three font caps, which are per theme measurements against one set of limits. */
const FIRST_PAINT_LIMIT = 60 * 1024;
const LATIN_LIMIT = 120 * 1024;
const TOTAL_LIMIT = 195 * 1024;

function bytesOf(file: string): number {
  return statSync(join(FONTS, file)).size;
}

describe('the manifest against the disk', () => {
  it('should record every font file that is there, and no file that is not', () => {
    // Given
    const onDisk = readdirSync(FONTS)
      .filter((name) => name.endsWith('.woff2'))
      .sort();

    // When
    const recorded = MANIFEST.assets.map((asset) => asset.file).sort();

    // Then
    expect(recorded).toEqual(onDisk);
    expect(onDisk.length).toBeGreaterThan(0);
  });

  it('should record the size and the digest of the bytes as they are', () => {
    // Given, When
    const wrong = MANIFEST.assets.filter((asset) => {
      const bytes = readFileSync(join(FONTS, asset.file));
      const digest = createHash('sha256').update(bytes).digest('hex');
      return bytes.length !== asset.bytes || digest !== asset.sha256;
    });

    // Then
    expect(wrong.map((asset) => asset.file)).toEqual([]);
  });

  it('should name a source, a date and a copyright holder for every file', () => {
    // Given, attribution with no source is not attribution.
    // When
    const incomplete = MANIFEST.assets.filter(
      (asset) => asset.sourceUrl === '' || asset.retrievedAt === '' || asset.copyrightHolder === '',
    );

    // Then
    expect(incomplete.map((asset) => asset.file)).toEqual([]);
  });

  it('should say what was done to every file, because every file is a modified work', () => {
    // Given, a subset is a derivative work under OFL, so each one carries the same licence as the
    // family it came from and says what was changed.
    // When, Then
    for (const asset of MANIFEST.assets) {
      expect(asset.modified, asset.file).toBe(true);
      expect(asset.modifications.length, asset.file).toBeGreaterThan(20);
      expect(asset.license, asset.file).toBe('OFL-1.1');
    }
  });

  it('should ship every family under a name no licence reserves, read rather than assumed', () => {
    // Given, OFL forbids a Modified Version carrying a Reserved Font Name, and subsetting is a
    // modification. IBM Plex was swapped out of the forge design for exactly this. Both families
    // here were read out of their own licence text.
    // When
    for (const asset of MANIFEST.assets) {
      const licence = readFileSync(join(FONTS, asset.licenseTextFile), 'utf8');
      const reserved = /with Reserved Font Name\s+"?([^"\n]+)"?/i.exec(licence);

      // Then the licence declares no reserved name, and the file ships under its own family name
      expect(reserved, `${asset.licenseTextFile} declares a reserved name`).toBeNull();
      expect(asset.reservedFontName, asset.file).toBeNull();
      expect(asset.shipsAs, asset.file).toBe(asset.family);
    }
  });

  it('should carry the complete licence text of both families beside the bytes', () => {
    // Given, a reader who installs this theme on its own has this directory and nothing else, so
    // a pointer to a licence elsewhere in the repository would stop travelling with the bytes.
    // When
    const texts = new Set(MANIFEST.assets.map((asset) => asset.licenseTextFile));

    // Then
    expect([...texts].sort()).toEqual(['JetBrainsMono-OFL.txt', 'MartianMono-OFL.txt']);
    for (const text of texts) {
      expect(readFileSync(join(FONTS, text), 'utf8').length).toBeGreaterThan(1000);
    }
  });
});

describe('the stylesheet against the manifest', () => {
  it('should declare a face for every file, with the range the manifest names', () => {
    // Given, a declared range narrower than the subset is a quiet failure: the glyph is in the
    // file, the reader sees a system fallback, and nothing reports it.
    const faces = [...STYLESHEET.matchAll(/src: url\('\.\/([^']+)'\)/g)].map((match) => match[1]);

    // When
    const declared = new Set(faces);

    // Then
    expect([...declared].sort()).toEqual(MANIFEST.assets.map((asset) => asset.file).sort());
  });

  it('should declare the latin-ext half before the latin half of every face', () => {
    // Given, the two ranges overlap on a handful of code points and the last declaration wins, so
    // declaring latin second means the overlap is served by the file a reader already has.
    const order = [...STYLESHEET.matchAll(/src: url\('\.\/([^']+)'\)/g)].map(
      (match) => match[1] ?? '',
    );

    // When, Then each pair appears extended first
    for (let at = 0; at < order.length; at += 2) {
      expect(order[at], `${order[at] ?? ''} should be the extended half`).toContain('latin-ext');
      expect(order[at + 1] ?? '').not.toContain('latin-ext');
    }
  });

  it('should ask the browser to swap rather than to wait', () => {
    // Given, text readable in a fallback face beats text that is not there, and the reference is a
    // document before it is a design.
    // When
    const faces = STYLESHEET.match(/@font-face/g) ?? [];
    const swaps = STYLESHEET.match(/font-display: swap;/g) ?? [];

    // Then
    expect(faces).toHaveLength(MANIFEST.assets.length);
    expect(swaps).toHaveLength(faces.length);
  });

  it('should name no origin but its own, which is a security claim and not a preference', () => {
    // Given, SPEC 19 puts the number of outgoing requests from the client at zero, and a font from
    // someone else's origin is a request that also says who is reading your documentation.
    // When, Then
    expect(STYLESHEET).not.toContain('http://');
    expect(STYLESHEET).not.toContain('https://');
    expect(STYLESHEET).not.toContain('//fonts.');
  });
});

describe('the three budgets of SPEC 20, measured for this theme alone', () => {
  it('should keep the first paint pair under its cap', () => {
    // Given, the pair is one face from each family, because the interface is JetBrains Mono and
    // every strip heading is Martian Mono, and both are on screen before a reader touches anything.
    // When
    const total = TELLTALE_FIRST_PAINT_FACES.reduce((sum, file) => sum + bytesOf(file), 0);

    // Then
    expect(TELLTALE_FIRST_PAINT_FACES).toHaveLength(2);
    expect(total, `first paint is ${String(total)} bytes`).toBeLessThanOrEqual(FIRST_PAINT_LIMIT);
  });

  it('should keep a latin reader whole session under its cap', () => {
    // Given, the latin halves are what a reader of an English interface fetches across a session.
    // When
    const total = MANIFEST.assets
      .filter((asset) => asset.unicodeRange === 'latin')
      .reduce((sum, asset) => sum + asset.bytes, 0);

    // Then
    expect(total, `latin is ${String(total)} bytes`).toBeLessThanOrEqual(LATIN_LIMIT);
  });

  it('should keep the whole directory under its cap', () => {
    // Given, what the package weighs is the third number, and it is the one that grows when a face
    // is split rather than shrinks.
    // When
    const total = MANIFEST.assets.reduce((sum, asset) => sum + asset.bytes, 0);

    // Then
    expect(total, `the directory is ${String(total)} bytes`).toBeLessThanOrEqual(TOTAL_LIMIT);
  });

  it('should ship no variable font, since the rule is measured against the first paint', () => {
    // Given, SPEC 20 permits a variable file only when the whole file fits `fonts-first-paint`,
    // because a variable file is fetched whole in one request before the first paint: it makes the
    // total smaller and the one number a reader waits on larger. This theme ships statics.
    // When, Then
    for (const asset of MANIFEST.assets) {
      expect(
        asset.file,
        'a variable file has to be measured against the first paint',
      ).not.toContain('VF');
      expect(asset.file).toMatch(/-(400|700)-latin(-ext)?\.woff2$/);
    }
  });

  it('should say in the package what the first paint waits for, so a budget can read it', () => {
    // Given, `FONT_BUDGETS` in the gate configuration names the pair per theme rather than
    // deriving it, because which faces a first paint waits on is a fact about a design. This is
    // the same statement inside the package, so the two can be compared rather than assumed.
    // When, Then
    expect([...TELLTALE_FIRST_PAINT_FACES].sort()).toEqual([
      'JetBrainsMono-400-latin.woff2',
      'MartianMono-700-latin.woff2',
    ]);
  });
});

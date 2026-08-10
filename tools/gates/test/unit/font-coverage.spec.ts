import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  auditFontCoverage,
  type CodePointRange,
  FontReadError,
  parseUnicodeRange,
  readCmapCodePoints,
  readFontFaces,
  readWoff2Table,
} from '../../src/lib/font-coverage.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FONTS = join(REPO_ROOT, 'packages', 'theme', 'fonts');

function shippedFont(name: string): Uint8Array {
  return readFileSync(join(FONTS, name));
}

function shippedStylesheet(): string {
  return readFileSync(join(FONTS, 'fonts.css'), 'utf8');
}

/**
 * The six code points the stylesheet used to omit, found on 2026-08-10 by reproducing a
 * committed font byte for byte. Space Grotesk carries all six; JetBrains Mono carries five of
 * them and has no U+02BB, which is why the replay below uses Space Grotesk.
 */
const HISTORICALLY_UNDECLARED = [0x02bb, 0x02bc, 0x02c6, 0x02da, 0x02dc, 0x2074];

/** The declared latin range of the shipped stylesheet, as it is today. */
const LATIN_TODAY =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** The same range with the six removed, which is what shipped before the fix. */
const LATIN_BEFORE_THE_FIX =
  'U+0000-00FF, U+0131, U+0152-0153, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

/** Writes a base 128 varint the way a WOFF2 table directory does. */
function uintBase128(value: number): number[] {
  if (value === 0) return [0];
  const groups: number[] = [];
  let rest = value;
  while (rest > 0) {
    groups.unshift(rest % 128);
    rest = Math.floor(rest / 128);
  }
  return groups.map((group, index) => (index === groups.length - 1 ? group : group | 0x80));
}

/**
 * Builds a minimal WOFF2 carrying one `cmap` and nothing else.
 *
 * Synthetic on purpose. The real fonts prove the reader works on real bytes; these prove it
 * reports the failures, which no shipped file can be made to demonstrate without breaking it.
 */
function woff2WithCmap(cmap: Uint8Array): Uint8Array {
  const directory = Uint8Array.from([0x00, ...uintBase128(cmap.byteLength)]);
  const compressed = brotliCompressSync(cmap);
  const header = new Uint8Array(48);
  const view = new DataView(header.buffer);
  header.set([0x77, 0x4f, 0x46, 0x32], 0);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, 48 + directory.byteLength + compressed.byteLength);
  view.setUint16(12, 1);
  view.setUint32(16, 12 + cmap.byteLength);
  view.setUint32(20, compressed.byteLength);
  view.setUint16(24, 1);

  const out = new Uint8Array(48 + directory.byteLength + compressed.byteLength);
  out.set(header, 0);
  out.set(directory, 48);
  out.set(compressed, 48 + directory.byteLength);
  return out;
}

/**
 * Builds a format 4 `cmap` covering the given segments.
 *
 * `idRangeOffset` is zero throughout and `idDelta` is chosen so the first character of a segment
 * maps to glyph 1, which keeps every glyph id in the segment non zero. The mandatory 0xFFFF
 * terminator is appended and maps to glyph 0, which is what a real subset writes.
 */
function cmapFormat4(segments: readonly CodePointRange[]): Uint8Array {
  const all = [...segments, { from: 0xffff, to: 0xffff }];
  const segCount = all.length;
  const subtableLength = 16 + segCount * 8;
  const bytes = new Uint8Array(12 + subtableLength);
  const view = new DataView(bytes.buffer);

  view.setUint16(0, 0);
  view.setUint16(2, 1);
  view.setUint16(4, 3);
  view.setUint16(6, 1);
  view.setUint32(8, 12);

  view.setUint16(12, 4);
  view.setUint16(14, subtableLength);
  view.setUint16(16, 0);
  view.setUint16(18, segCount * 2);

  const endCodes = 12 + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const deltas = startCodes + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;

  all.forEach((segment, index) => {
    view.setUint16(endCodes + index * 2, segment.to);
    view.setUint16(startCodes + index * 2, segment.from);
    const delta = segment.from === 0xffff ? 1 : (1 - segment.from) & 0xffff;
    view.setUint16(deltas + index * 2, delta);
    view.setUint16(rangeOffsets + index * 2, 0);
  });

  return bytes;
}

describe('reading a subset out of a shipped font', () => {
  it('should map code points out of a real woff2, so the reader is proved on real bytes', () => {
    // Given, a parser that quietly returned nothing would make every check below pass.
    const bytes = shippedFont('SpaceGrotesk-400-latin.woff2');

    // When
    const points = readCmapCodePoints(readWoff2Table(bytes, 'cmap'));

    // Then
    expect(points.size).toBeGreaterThan(100);
    expect(points.has(0x0041)).toBe(true);
    expect(points.has(0x0100)).toBe(false);
  });

  it('should carry the six code points the stylesheet once failed to declare', () => {
    // Given, the incident this whole check exists for.
    const points = readCmapCodePoints(
      readWoff2Table(shippedFont('SpaceGrotesk-400-latin.woff2'), 'cmap'),
    );

    // When
    const missing = HISTORICALLY_UNDECLARED.filter((point) => !points.has(point));

    // Then
    expect(missing).toEqual([]);
  });

  it('should refuse bytes that are not woff2 rather than reporting an empty subset', () => {
    // Given
    const notAFont = new TextEncoder().encode('x'.repeat(64));

    // When, Then
    expect(() => readWoff2Table(notAFont, 'cmap')).toThrow(FontReadError);
  });

  it('should refuse a woff2 with no cmap table', () => {
    // Given, a directory naming head instead of cmap.
    const font = woff2WithCmap(cmapFormat4([{ from: 0x41, to: 0x5a }]));
    font[48] = 0x01;

    // When, Then
    expect(() => readWoff2Table(font, 'cmap')).toThrow(FontReadError);
  });
});

describe('reading the font faces of a stylesheet', () => {
  it('should read one declaration per face, in declaration order', () => {
    // Given
    const css = shippedStylesheet();

    // When
    const faces = readFontFaces(css);

    // Then
    expect(faces).toHaveLength(10);
    expect(faces[0]?.file).toBe('SpaceGrotesk-400-latin-ext.woff2');
    expect(faces[0]?.ranges.length).toBeGreaterThan(0);
  });

  it('should return a face with no ranges rather than dropping it', () => {
    // Given, a face with no unicode-range matches everything, which is a defect of its own.
    const css = "@font-face { src: url('./Face.woff2') format('woff2'); }";

    // When
    const faces = readFontFaces(css);

    // Then
    expect(faces).toEqual([{ file: 'Face.woff2', ranges: [] }]);
  });
});

describe('parsing a unicode-range value', () => {
  it('should read a single code point and a span', () => {
    // Given, When
    const ranges = parseUnicodeRange('U+2074, U+0000-00FF');

    // Then
    expect(ranges).toEqual([
      { from: 0x2074, to: 0x2074 },
      { from: 0x0000, to: 0x00ff },
    ]);
  });

  it('should refuse the wildcard form rather than expanding it', () => {
    // Given, nothing here writes one, and a silent expansion is a place for a defect to hide.
    // When
    const ranges = parseUnicodeRange('U+04??, U+0041');

    // Then
    expect(ranges).toEqual([{ from: 0x41, to: 0x41 }]);
  });
});

describe('auditing what a stylesheet declares against what it ships', () => {
  it('should find nothing on the shipped stylesheet', () => {
    // Given, the state the fix of 2026-08-10 left behind.
    const declarations = readFontFaces(shippedStylesheet());
    const files = new Map(declarations.map((face) => [face.file, shippedFont(face.file)]));

    // When
    const findings = auditFontCoverage({ declarations, files });

    // Then
    expect(findings).toEqual([]);
    expect(declarations).toHaveLength(10);
  });

  it('should replay the real defect: the range before the fix, against the file as shipped', () => {
    // Given, the declaration exactly as it was when six code points shipped unreachable.
    const file = 'SpaceGrotesk-400-latin.woff2';
    const declarations = [{ file, ranges: parseUnicodeRange(LATIN_BEFORE_THE_FIX) }];
    const files = new Map([[file, shippedFont(file)]]);

    // When
    const findings = auditFontCoverage({ declarations, files });

    // Then
    expect(findings).toHaveLength(1);
    for (const point of HISTORICALLY_UNDECLARED) {
      expect(findings[0]?.reason).toContain(
        `U+${point.toString(16).toUpperCase().padStart(4, '0')}`,
      );
    }
    expect(findings[0]?.reason).toContain('6 code point(s)');
  });

  it('should find nothing on the same file with the range as it is today', () => {
    // Given, the same plant with the fix applied, so the finding above is the range and not
    // something else about the file.
    const file = 'SpaceGrotesk-400-latin.woff2';
    const declarations = [{ file, ranges: parseUnicodeRange(LATIN_TODAY) }];

    // When
    const findings = auditFontCoverage({
      declarations,
      files: new Map([[file, shippedFont(file)]]),
    });

    // Then
    expect(findings).toEqual([]);
  });

  it('should report a face whose file was not handed over', () => {
    // Given
    const declarations = readFontFaces(
      "@font-face { src: url('./Gone.woff2'); unicode-range: U+41; }",
    );

    // When
    const findings = auditFontCoverage({ declarations, files: new Map() });

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('is not there');
  });

  it('should report a face that declares no unicode-range at all', () => {
    // Given
    const file = 'SpaceGrotesk-400-latin.woff2';
    const declarations = [{ file, ranges: [] }];

    // When
    const findings = auditFontCoverage({
      declarations,
      files: new Map([[file, shippedFont(file)]]),
    });

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('declares no unicode-range');
  });

  it('should report a file that maps no code point rather than passing on an empty read', () => {
    // Given, a cmap holding only the mandatory terminator. This is the failure that would make
    // every other check in this file pass while checking nothing.
    const file = 'Empty.woff2';
    const declarations = [{ file, ranges: parseUnicodeRange('U+0000-00FF') }];
    const files = new Map([[file, woff2WithCmap(cmapFormat4([]))]]);

    // When
    const findings = auditFontCoverage({ declarations, files });

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('maps no code point');
  });

  it('should report a file it cannot read as woff2', () => {
    // Given
    const file = 'Broken.woff2';
    const declarations = [{ file, ranges: parseUnicodeRange('U+0041') }];
    const files = new Map([[file, new TextEncoder().encode('y'.repeat(80))]]);

    // When
    const findings = auditFontCoverage({ declarations, files });

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('cannot be read');
  });

  it('should name at most twelve code points and count the rest', () => {
    // Given, a synthetic face covering more code points than a finding names.
    const file = 'Wide.woff2';
    const declarations = [{ file, ranges: parseUnicodeRange('U+0041') }];
    const files = new Map([[file, woff2WithCmap(cmapFormat4([{ from: 0x41, to: 0x60 }]))]]);

    // When
    const findings = auditFontCoverage({ declarations, files });

    // Then
    expect(findings).toHaveLength(1);
    expect(findings[0]?.reason).toContain('31 code point(s)');
    expect(findings[0]?.reason).toContain('and 19 more');
  });
});

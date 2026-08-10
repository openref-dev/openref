import { brotliDecompressSync } from 'node:zlib';

/**
 * Holds a `unicode-range` declaration to the code points the file behind it actually contains.
 *
 * THIS EXISTS BECAUSE THE TWO DRIFTED APART ONCE AND NOTHING NOTICED. Reproducing
 * `SpaceGrotesk-400.woff2` byte for byte on 2026-08-10 found six code points in every shipped
 * face that the stylesheet did not declare: U+02BB, U+02BC, U+02C6, U+02DA, U+02DC and U+2074.
 * They were paid for, subset in, shipped, and unreachable: a browser does not fetch a face for a
 * character the declared range excludes, so the reader saw a system fallback for a glyph that
 * was in the file. Nothing failed. Nothing looked wrong.
 *
 * The ranges were then rewritten by hand to match. Written by hand is exactly the state that
 * produced the defect, so this reads the shipped bytes instead. The declaration is checked
 * against the `cmap` of the file it names, which is the one description of a subset that cannot
 * be edited without changing the subset.
 *
 * THE ASYMMETRY IS DELIBERATE. A code point in the file and not in the declaration is an error:
 * those are the bytes nobody can reach. A code point in the declaration and not in the file is
 * not, because Google's published ranges, which the subset recipe takes verbatim, name code
 * points that no font in the world carries. Requiring equality would mean maintaining a range
 * per face by hand, which is the practice being removed.
 */

/** A half open span of code points, both ends inclusive, as `unicode-range` writes them. */
export interface CodePointRange {
  readonly from: number;
  readonly to: number;
}

/** One `@font-face` block, reduced to what this check needs. */
export interface FontFaceDeclaration {
  /** File the block's `src` names, relative to the stylesheet. */
  readonly file: string;
  /** Ranges the block declares, in declaration order. */
  readonly ranges: readonly CodePointRange[];
}

/** A problem found in a stylesheet or in the files it names. */
export interface FontCoverageFinding {
  readonly level: 'error' | 'warning';
  readonly file: string;
  readonly reason: string;
}

/** What the check was given: the declarations, and the bytes of each file they name. */
export interface FontCoverageAudit {
  readonly declarations: readonly FontFaceDeclaration[];
  /** Raw bytes of each font file, keyed by the name the declaration uses. */
  readonly files: ReadonlyMap<string, Uint8Array>;
}

/**
 * The 63 table tags a WOFF2 directory addresses by index, in the order the specification fixes.
 *
 * Index 63 means the tag is written out in full instead. Transcribed from the WOFF2
 * specification, appendix B, and not derived from anything, so it is data rather than logic.
 */
const KNOWN_TABLE_TAGS: readonly string[] = [
  'cmap',
  'head',
  'hhea',
  'hmtx',
  'maxp',
  'name',
  'OS/2',
  'post',
  'cvt ',
  'fpgm',
  'glyf',
  'loca',
  'prep',
  'CFF ',
  'VORG',
  'EBDT',
  'EBLC',
  'gasp',
  'hdmx',
  'kern',
  'LTSH',
  'PCLT',
  'VDMX',
  'vhea',
  'vmtx',
  'BASE',
  'GDEF',
  'GPOS',
  'GSUB',
  'EBSC',
  'JSTF',
  'MATH',
  'CBDT',
  'CBLC',
  'COLR',
  'CPAL',
  'SVG ',
  'sbix',
  'acnt',
  'avar',
  'bdat',
  'bloc',
  'bsln',
  'cvar',
  'fdsc',
  'feat',
  'fmtx',
  'fvar',
  'gvar',
  'hsty',
  'just',
  'lcar',
  'mort',
  'morx',
  'opbd',
  'prop',
  'trak',
  'Zapf',
  'Silf',
  'Glat',
  'Gloc',
  'Feat',
  'Sill',
];

/** Raised when a font file cannot be read as WOFF2. Never swallowed: an unreadable font is a finding. */
export class FontReadError extends Error {}

interface Cursor {
  offset: number;
}

/** WOFF2 writes table lengths as a base 128 varint, most significant group first. */
function readUIntBase128(bytes: Uint8Array, cursor: Cursor): number {
  let value = 0;

  for (let i = 0; i < 5; i += 1) {
    const byte = bytes[cursor.offset];
    if (byte === undefined) throw new FontReadError('table directory ends inside a length');
    cursor.offset += 1;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return value;
  }

  throw new FontReadError('a table length runs past five bytes');
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Pulls one table out of a WOFF2 file.
 *
 * The compressed stream is the concatenation of every table in directory order, so a table is
 * located by summing the lengths before it. `glyf` and `loca` may be stored transformed, and
 * then their stored length differs from their original length; `cmap` never is, which is why
 * this reads a subset rather than implementing the reverse transform.
 */
export function readWoff2Table(bytes: Uint8Array, tag: string): Uint8Array {
  if (bytes.byteLength < 48) throw new FontReadError('shorter than a WOFF2 header');

  const header = view(bytes);
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  if (signature !== 'wOF2') throw new FontReadError(`signature is ${signature}, not wOF2`);

  const tableCount = header.getUint16(12);
  const cursor: Cursor = { offset: 48 };
  const directory: { tag: string; storedLength: number }[] = [];

  for (let i = 0; i < tableCount; i += 1) {
    const flags = bytes[cursor.offset];
    if (flags === undefined) throw new FontReadError('table directory ends early');
    cursor.offset += 1;

    const index = flags & 0x3f;
    let tableTag: string;

    if (index === 63) {
      tableTag = String.fromCharCode(...bytes.subarray(cursor.offset, cursor.offset + 4));
      cursor.offset += 4;
    } else {
      const known = KNOWN_TABLE_TAGS[index];
      if (known === undefined) throw new FontReadError(`unknown table index ${String(index)}`);
      tableTag = known;
    }

    const originalLength = readUIntBase128(bytes, cursor);
    const transformVersion = (flags >> 6) & 0x03;
    const transformed =
      tableTag === 'glyf' || tableTag === 'loca' ? transformVersion !== 3 : transformVersion !== 0;
    const storedLength = transformed ? readUIntBase128(bytes, cursor) : originalLength;

    directory.push({ tag: tableTag, storedLength });
  }

  let data: Uint8Array;
  try {
    data = brotliDecompressSync(bytes.subarray(cursor.offset));
  } catch {
    throw new FontReadError('the compressed font data is not brotli');
  }

  let offset = 0;
  for (const table of directory) {
    if (table.tag === tag) {
      const end = offset + table.storedLength;
      if (end > data.byteLength) throw new FontReadError(`the ${tag} table runs past the data`);
      return data.subarray(offset, end);
    }
    offset += table.storedLength;
  }

  throw new FontReadError(`there is no ${tag} table`);
}

interface SubtableChoice {
  readonly format: number;
  readonly offset: number;
  readonly rank: number;
}

/**
 * Every code point the `cmap` maps to a glyph other than `.notdef`.
 *
 * Formats 4 and 12 only, which is what a subsetter emits for a Unicode font. A mapping to glyph
 * 0 is not coverage: `.notdef` is what a font says when it has nothing, and counting it would
 * report a face as covering a character it draws as a box.
 */
export function readCmapCodePoints(cmap: Uint8Array): ReadonlySet<number> {
  if (cmap.byteLength < 4) throw new FontReadError('the cmap table is shorter than its header');

  const table = view(cmap);
  const subtableCount = table.getUint16(2);
  let chosen: SubtableChoice | null = null;

  for (let i = 0; i < subtableCount; i += 1) {
    const record = 4 + i * 8;
    if (record + 8 > cmap.byteLength) throw new FontReadError('cmap records run past the table');

    const platform = table.getUint16(record);
    const encoding = table.getUint16(record + 2);
    const offset = table.getUint32(record + 4);
    if (offset + 2 > cmap.byteLength)
      throw new FontReadError('a cmap subtable runs past the table');

    const format = table.getUint16(offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;

    // Format 12 reaches past the basic plane, so it wins wherever both are present.
    const rank = format === 12 ? 2 : format === 4 ? 1 : 0;
    if (rank > 0 && (chosen === null || rank > chosen.rank)) chosen = { format, offset, rank };
  }

  if (chosen === null) throw new FontReadError('the cmap carries no Unicode subtable');

  return chosen.format === 12
    ? readFormat12(cmap, table, chosen.offset)
    : readFormat4(cmap, table, chosen.offset);
}

function readFormat4(cmap: Uint8Array, table: DataView, base: number): ReadonlySet<number> {
  const segCount = table.getUint16(base + 6) / 2;
  const endCodes = base + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const deltas = startCodes + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  if (rangeOffsets + segCount * 2 > cmap.byteLength) {
    throw new FontReadError('a format 4 subtable runs past the table');
  }

  const points = new Set<number>();

  for (let segment = 0; segment < segCount; segment += 1) {
    const end = table.getUint16(endCodes + segment * 2);
    const start = table.getUint16(startCodes + segment * 2);
    const delta = table.getInt16(deltas + segment * 2);
    const rangeOffset = table.getUint16(rangeOffsets + segment * 2);

    // The final segment is the mandatory 0xffff terminator and maps nothing.
    if (start === 0xffff) continue;

    for (let point = start; point <= end; point += 1) {
      let glyph: number;

      if (rangeOffset === 0) {
        glyph = (point + delta) & 0xffff;
      } else {
        const at = rangeOffsets + segment * 2 + rangeOffset + (point - start) * 2;
        if (at + 2 > cmap.byteLength) continue;
        glyph = table.getUint16(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }

      if (glyph !== 0) points.add(point);
    }
  }

  return points;
}

function readFormat12(cmap: Uint8Array, table: DataView, base: number): ReadonlySet<number> {
  const groups = table.getUint32(base + 12);
  if (base + 16 + groups * 12 > cmap.byteLength) {
    throw new FontReadError('a format 12 subtable runs past the table');
  }

  const points = new Set<number>();

  for (let group = 0; group < groups; group += 1) {
    const at = base + 16 + group * 12;
    const start = table.getUint32(at);
    const end = table.getUint32(at + 4);
    const startGlyph = table.getUint32(at + 8);
    if (startGlyph === 0) continue;

    for (let point = start; point <= end; point += 1) points.add(point);
  }

  return points;
}

/**
 * Reads the `@font-face` blocks of a stylesheet.
 *
 * Deliberately shallow: it takes the first `src` url and the `unicode-range` of each block and
 * ignores everything else, because everything else is checked where it belongs. A block with no
 * `unicode-range` is not silently skipped, it is returned with no ranges, and the audit reports
 * it. A face with no declared range matches every character, which is a different defect and
 * still one worth naming.
 */
export function readFontFaces(css: string): readonly FontFaceDeclaration[] {
  const declarations: FontFaceDeclaration[] = [];

  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1] ?? '';
    const file = /url\(\s*'?\.\/([^')\s]+)'?\s*\)/.exec(body)?.[1];
    if (file === undefined) continue;

    const declared = /unicode-range:([^;]*);/.exec(body)?.[1] ?? '';
    declarations.push({ file, ranges: parseUnicodeRange(declared) });
  }

  return declarations;
}

/**
 * Parses a `unicode-range` value.
 *
 * The wildcard form, `U+04??`, is refused rather than expanded. Nothing in this repository
 * writes one, and a silent expansion of a form nobody uses is a place for a defect to hide.
 */
export function parseUnicodeRange(value: string): readonly CodePointRange[] {
  const ranges: CodePointRange[] = [];

  for (const part of value.split(',')) {
    const token = part.trim();
    if (token === '') continue;

    const match = /^U\+([0-9A-Fa-f]{1,6})(?:-([0-9A-Fa-f]{1,6}))?$/.exec(token);
    if (match === null) continue;

    const from = Number.parseInt(match[1] ?? '', 16);
    const to = match[2] === undefined ? from : Number.parseInt(match[2], 16);
    ranges.push({ from, to: Math.max(from, to) });
  }

  return ranges;
}

function covers(ranges: readonly CodePointRange[], point: number): boolean {
  return ranges.some((range) => point >= range.from && point <= range.to);
}

function formatPoint(point: number): string {
  return `U+${point.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** How many code points to name in a finding before saying how many more there are. */
const NAMED_IN_A_FINDING = 12;

/**
 * Checks every declaration against the file it names.
 *
 * Four things fail, and the third is the one that keeps the other three honest:
 *
 * 1. a code point in the file that the declaration does not cover. The original defect.
 * 2. a declaration with no `unicode-range` at all, which matches everything and therefore
 *    cannot be wrong in the sense above while still being wrong.
 * 3. a file whose `cmap` yields nothing. A parser that quietly returned an empty set would make
 *    every other check pass, and a gate that passes because it read nothing is worse than none.
 * 4. a file named by the stylesheet that was not handed over, or that cannot be read as WOFF2.
 */
export function auditFontCoverage(audit: FontCoverageAudit): readonly FontCoverageFinding[] {
  const findings: FontCoverageFinding[] = [];

  for (const declaration of audit.declarations) {
    const bytes = audit.files.get(declaration.file);

    if (bytes === undefined) {
      findings.push({
        level: 'error',
        file: declaration.file,
        reason: 'the stylesheet names this file and it is not there',
      });
      continue;
    }

    if (declaration.ranges.length === 0) {
      findings.push({
        level: 'error',
        file: declaration.file,
        reason:
          'declares no unicode-range, so it matches every character and the split into latin and latin-ext means nothing',
      });
      continue;
    }

    let points: ReadonlySet<number>;
    try {
      points = readCmapCodePoints(readWoff2Table(bytes, 'cmap'));
    } catch (error) {
      findings.push({
        level: 'error',
        file: declaration.file,
        reason: `cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    if (points.size === 0) {
      findings.push({
        level: 'error',
        file: declaration.file,
        reason: 'maps no code point to a glyph, so nothing about its declared range was checked',
      });
      continue;
    }

    const undeclared = [...points]
      .filter((point) => !covers(declaration.ranges, point))
      .sort((a, b) => a - b);

    if (undeclared.length > 0) {
      const named = undeclared.slice(0, NAMED_IN_A_FINDING).map(formatPoint).join(', ');
      const rest = undeclared.length - Math.min(undeclared.length, NAMED_IN_A_FINDING);
      findings.push({
        level: 'error',
        file: declaration.file,
        reason: `ships ${String(undeclared.length)} code point(s) its unicode-range does not declare, so a browser will not fetch it for them: ${named}${rest > 0 ? `, and ${String(rest)} more` : ''}`,
      });
    }
  }

  return findings;
}

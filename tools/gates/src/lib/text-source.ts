/**
 * Whether a source file is one a text tool will read, byte for byte rather than by extension.
 *
 * WHY THIS EXISTS. `packages/render/src/components/TryItPanel.ts` carried a literal NUL byte in a
 * string constant from T027 until 2026-08-13. Every tool that classifies a file by its bytes,
 * `grep` first among them, calls such a file binary and prints one line about it or nothing at all.
 * The file is 1,305 lines long. For the length of five tasks, every text search over this
 * repository silently returned results from every file except that one, and a search that skipped
 * it looks exactly like a search that found nothing in it.
 *
 * Nothing else would ever have said so. The compiler reads the byte as a perfectly ordinary
 * character in a string literal, the bundler emits it, the tests pass, and the console works. There
 * is no build output, no type and no assertion anywhere in this repository that changes when a
 * source file becomes unreadable to the tools people search it with.
 *
 * IT HAS HAPPENED FOUR TIMES, AND THE COUNT IS KEPT HERE SO NOBODY HAS TO RECONSTRUCT IT. The
 * argument for a gate is not the first occurrence, which is a story, but the rate, which is a
 * measurement, and until the pre-M4 review the rate lived only in `ai-docs/PROJECT_STATE.md`
 * across four sessions that each wrote down their own instance without a running total. In order:
 * `TryItPanel.ts`, found by a file refusing a tool rather than by any check, five tasks after it
 * was written; a second before this gate existed; `BINARY_FIELD` in the extracted `ShapeForm`,
 * written through a shell heredoc and caught the same hour, on the first source file written after
 * the gate existed; and the fake authorization server of the runner suite, caught the hour it was
 * written and named by byte offset. Every one of the last two was the author of the session the
 * gate was protecting, which is the point: it is not a check against a careless contributor, it is
 * a check against a heredoc.
 *
 * WHAT IS CHECKED IS THE CLASSIFICATION AND NOT THE ENCODING IN GENERAL. Two conditions make a
 * tool refuse: a NUL byte, which is the marker every such heuristic starts from, and a byte
 * sequence that is not valid UTF-8, which is the other half of what GNU grep decides on. Both are
 * found in one pass and the first offending byte wins, so the message names one place to look
 * rather than a count.
 *
 * The validator is written out rather than delegated to `TextDecoder` for one reason: a decoder in
 * fatal mode reports that a file is invalid and not where, and an offset is the whole difference
 * between a finding a reader can act on and one they have to bisect by hand.
 *
 * AND SINCE T042 IT LOOKS FOR THE CHARACTER SPEC 19.1 NAMES, which is the third thing a text tool
 * cannot be trusted about. T035 measured the hole: this scan rejected a NUL byte and a malformed
 * sequence and passed every well formed one, U+202E included, while SPEC 19.1 calls a bidirectional
 * override a live threat that survives escaping and survives the sanitizer. What it does to a
 * rendered document the renderer answers with `unicode-bidi: isolate`; what it does to a source
 * file nothing answered at all, and a source file is where a reviewer decides whether code says
 * what it appears to say. An override in a comment reorders the line it sits on, so the diff a
 * reviewer approves and the program the compiler reads are two different things with no markup
 * anywhere. The whole Unicode bidirectional control set is reported rather than the override alone:
 * an embedding left unterminated reorders exactly as an override does, and the isolates and the
 * marks are the same class of invisible character in the same position.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Why a text tool refuses a file. */
export type UnreadableReason = 'nul-byte' | 'invalid-utf8';

/** One file a text tool will not read, and the byte that decides it. */
export interface UnreadableFile {
  readonly path: string;
  readonly reason: UnreadableReason;
  /** Byte offset of the first offending byte, from zero. */
  readonly offset: number;
  /** Line the offending byte is on, from one. */
  readonly line: number;
  /** Byte column within that line, from one. */
  readonly column: number;
}

/** What was found in one file, or nothing when a tool reads it whole. */
export interface ByteFault {
  readonly reason: UnreadableReason;
  readonly offset: number;
}

/** One bidirectional control character found in a source file. */
export interface BidiControl {
  readonly path: string;
  /** The code point, so a finding can print `U+202E` rather than a byte triple. */
  readonly codePoint: number;
  /** Its Unicode name, because the code point alone tells a reader nothing. */
  readonly name: string;
  /** Byte offset of the first byte of its encoding, from zero. */
  readonly offset: number;
  readonly line: number;
  readonly column: number;
  /** How many controls the file carries in total, of which this is the first. */
  readonly occurrences: number;
}

/**
 * The Unicode bidirectional controls, by code point, with the name a finding prints.
 *
 * ALL TWELVE RATHER THAN THE ONE SPEC 19.1 NAMES. The override is the character the finding was
 * written about, and the embeddings reorder identically while an unterminated isolate does the
 * same to everything after it. Splitting them would leave eleven spellings of one defect passing
 * a check written for the twelfth.
 */
export const BIDI_CONTROLS: ReadonlyMap<number, string> = new Map([
  [0x061c, 'ARABIC LETTER MARK'],
  [0x200e, 'LEFT-TO-RIGHT MARK'],
  [0x200f, 'RIGHT-TO-LEFT MARK'],
  [0x202a, 'LEFT-TO-RIGHT EMBEDDING'],
  [0x202b, 'RIGHT-TO-LEFT EMBEDDING'],
  [0x202c, 'POP DIRECTIONAL FORMATTING'],
  [0x202d, 'LEFT-TO-RIGHT OVERRIDE'],
  [0x202e, 'RIGHT-TO-LEFT OVERRIDE'],
  [0x2066, 'LEFT-TO-RIGHT ISOLATE'],
  [0x2067, 'RIGHT-TO-LEFT ISOLATE'],
  [0x2068, 'FIRST STRONG ISOLATE'],
  [0x2069, 'POP DIRECTIONAL ISOLATE'],
]);

/**
 * Finds every bidirectional control in a file, by its UTF-8 encoding.
 *
 * The bytes are searched rather than the decoded text so that the offset is the same byte offset
 * `positionOfByte` turns into a line and a column, and so that the search needs no decode of a
 * file this module may already have called unreadable.
 *
 * @param bytes - The whole file
 * @returns Every control with its code point and byte offset, in file order
 */
export function bidiControlsIn(
  bytes: Uint8Array,
): readonly { readonly codePoint: number; readonly offset: number }[] {
  const found: { codePoint: number; offset: number }[] = [];

  for (let index = 0; index + 1 < bytes.length; index += 1) {
    const first = bytes[index] ?? 0;

    // U+061C is the only two byte control in the set: 0xD8 0x9C.
    if (first === 0xd8 && bytes[index + 1] === 0x9c) {
      found.push({ codePoint: 0x061c, offset: index });
      continue;
    }

    if (first !== 0xe2 || index + 2 >= bytes.length) continue;

    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    if (second !== 0x80 && second !== 0x81) continue;

    const codePoint = 0x2000 + (second === 0x80 ? 0 : 0x40) + (third - 0x80);
    if (third < 0x80 || third > 0xbf) continue;
    if (!BIDI_CONTROLS.has(codePoint)) continue;

    found.push({ codePoint, offset: index });
  }

  return found;
}

/**
 * Directory names never descended into.
 *
 * Build output and dependencies are not source. `ai-docs` is not here because it is not source
 * either: it is absent from a clone, so a scan that counted it would report two different totals
 * for the same tree depending on who checked it out, and the documents are read by people rather
 * than swept by tools.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.turbo',
  'ai-docs',
]);

/**
 * Finds the first byte that makes a text tool refuse the file.
 *
 * The UTF-8 table is the one the standard defines after the overlong and surrogate forms are
 * removed: `C0` and `C1` never begin a sequence, `E0` may not be followed by `80` to `9F`, `ED`
 * may not be followed by `A0` to `BF`, `F0` may not be followed by `80` to `8F`, `F4` may not go
 * past `8F`, and `F5` upwards encodes nothing.
 *
 * @param bytes - The whole file
 * @returns The first fault, or undefined when every byte reads
 */
export function firstByteFault(bytes: Uint8Array): ByteFault | undefined {
  let index = 0;

  while (index < bytes.length) {
    const byte = bytes[index] ?? 0;

    if (byte === 0x00) return { reason: 'nul-byte', offset: index };

    if (byte < 0x80) {
      index += 1;
      continue;
    }

    let length = 0;
    let lowSecond = 0x80;
    let highSecond = 0xbf;

    if (byte >= 0xc2 && byte <= 0xdf) {
      length = 2;
    } else if (byte >= 0xe0 && byte <= 0xef) {
      length = 3;
      if (byte === 0xe0) lowSecond = 0xa0;
      if (byte === 0xed) highSecond = 0x9f;
    } else if (byte >= 0xf0 && byte <= 0xf4) {
      length = 4;
      if (byte === 0xf0) lowSecond = 0x90;
      if (byte === 0xf4) highSecond = 0x8f;
    } else {
      return { reason: 'invalid-utf8', offset: index };
    }

    if (index + length > bytes.length) return { reason: 'invalid-utf8', offset: index };

    const second = bytes[index + 1] ?? 0;
    if (second < lowSecond || second > highSecond) return { reason: 'invalid-utf8', offset: index };

    for (let step = 2; step < length; step += 1) {
      const continuation = bytes[index + step] ?? 0;
      if (continuation < 0x80 || continuation > 0xbf) {
        return { reason: 'invalid-utf8', offset: index };
      }
    }

    index += length;
  }

  return undefined;
}

/**
 * Turns a byte offset into a line and a column, counting bytes rather than characters.
 *
 * A column in characters would need the file to decode, and the file this runs on is one that
 * does not. Bytes are what an editor's go-to-byte takes and what the fault is measured in.
 *
 * @param bytes - The whole file
 * @param offset - Byte offset, from zero
 * @returns Line and column, both from one
 */
export function positionOfByte(
  bytes: Uint8Array,
  offset: number,
): { readonly line: number; readonly column: number } {
  let line = 1;
  let lineStart = 0;

  for (let index = 0; index < offset && index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { line, column: offset - lineStart + 1 };
}

/**
 * Collects the files under a root that a text tool is expected to read whole.
 *
 * Selection is by extension, so a font or an image is out of scope by never being named rather
 * than by an exception a later reader has to trust. Build output and dependencies are skipped:
 * a minified bundle is not source, and a NUL in one is a fact about a dependency.
 *
 * @param root - Absolute directory to walk; a missing directory yields an empty list
 * @param extensions - Lowercase extensions to keep, including the dot
 * @param repoRoot - Absolute repository root, used to build relative paths
 * @returns Repository relative file paths, sorted
 */
export function collectSourceFiles(
  root: string,
  extensions: readonly string[],
  repoRoot: string,
): string[] {
  const found: string[] = [];

  const visit = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }

    for (const entry of entries.sort()) {
      if (SKIPPED_DIRECTORIES.has(entry)) continue;

      const absolute = join(directory, entry);
      const stats = statSync(absolute, { throwIfNoEntry: false });
      if (stats === undefined) continue;

      if (stats.isDirectory()) {
        visit(absolute);
        continue;
      }

      const lower = entry.toLowerCase();
      if (extensions.some((extension) => lower.endsWith(extension))) {
        found.push(relative(repoRoot, absolute).replace(/\\/g, '/'));
      }
    }
  };

  visit(root);
  return found.sort();
}

/** How many files one top level tree of the repository yielded. */
export interface TreeCount {
  /** Top level entry name, or `<root file>` for a file sitting directly in the repository root. */
  readonly tree: string;
  readonly scanned: number;
}

/** What one scan looked at and what it refused. */
export interface TextScan {
  readonly scanned: number;
  /** One entry per top level tree that yielded a file, sorted, printed on every run. */
  readonly trees: readonly TreeCount[];
  readonly unreadable: readonly UnreadableFile[];
  /** Files carrying a bidirectional control, one entry per file. */
  readonly bidi: readonly BidiControl[];
}

/** The label a file sitting directly in the repository root is counted under. */
export const ROOT_FILE_TREE = '<root file>';

/**
 * Scans the repository and reports every file a text tool would refuse or misread.
 *
 * THE MATERIAL IS THE WHOLE CHECKOUT AND NOT A LIST OF ROOTS, since T042, and that is the fix
 * rather than a widening. The list was `packages` and `tools`, so `examples/`, `compat/`,
 * `.github/`, `.changeset/` and every file in the repository root were scanned by nothing: a
 * reader can run all of them, and the one thing a reader cannot do is know that half the tree was
 * never looked at. A list of roots also has a failure mode of its own, which T035 named: a root
 * dropped from it takes its whole tree out of the scan and the gate goes on passing. Walking from
 * the root removes the list, so there is nothing left to drop.
 *
 * The count of files scanned is returned beside the faults, and the per tree counts beside that,
 * because a scan that reached nothing and a repository with nothing wrong in it produce the same
 * empty list, and only one of them is a pass.
 *
 * @param repoRoot - Absolute repository root
 * @param extensions - Lowercase extensions to keep, including the dot
 * @returns How many files were read and where, the ones that would not read, and the controls
 */
export function scanSourceText(repoRoot: string, extensions: readonly string[]): TextScan {
  const unreadable: UnreadableFile[] = [];
  const bidi: BidiControl[] = [];
  const trees = new Map<string, number>();
  let scanned = 0;

  for (const path of collectSourceFiles(repoRoot, extensions, repoRoot)) {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(repoRoot, path));
    } catch {
      continue;
    }

    scanned += 1;
    const segments = path.split('/');
    const tree = segments.length > 1 ? (segments[0] ?? ROOT_FILE_TREE) : ROOT_FILE_TREE;
    trees.set(tree, (trees.get(tree) ?? 0) + 1);

    const controls = bidiControlsIn(bytes);
    const first = controls[0];
    if (first !== undefined) {
      const position = positionOfByte(bytes, first.offset);
      bidi.push({
        path,
        codePoint: first.codePoint,
        name: BIDI_CONTROLS.get(first.codePoint) ?? 'BIDIRECTIONAL CONTROL',
        offset: first.offset,
        line: position.line,
        column: position.column,
        occurrences: controls.length,
      });
    }

    const fault = firstByteFault(bytes);
    if (fault === undefined) continue;

    const { line, column } = positionOfByte(bytes, fault.offset);
    unreadable.push({ path, reason: fault.reason, offset: fault.offset, line, column });
  }

  return {
    scanned,
    trees: [...trees]
      .map(([tree, count]) => ({ tree, scanned: count }))
      .sort((a, b) => a.tree.localeCompare(b.tree)),
    unreadable: unreadable.sort((a, b) => a.path.localeCompare(b.path)),
    bidi: bidi.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/** What a reader is told to do about a bidirectional control, one sentence and no diff. */
export const BIDI_REMEDY =
  'a bidirectional control reorders the line it sits on for every reader and every diff, and it ' +
  'carries no markup, so nothing else in this repository would ever report it. SPEC 19.1 answers ' +
  'the same character in a rendered document with unicode-bidi: isolate; a source file has no ' +
  'such answer, so it does not carry one. Write it as the escape \\u202E in a string literal ' +
  'where the value is needed, and delete it everywhere else';

/** What a reader is told to do about each reason, one sentence and no diff. */
export const REASON_REMEDY: Readonly<Record<UnreadableReason, string>> = {
  'nul-byte':
    'a NUL byte makes every text tool call this file binary and skip it whole. Write it as the ' +
    'escape \\u0000 in a string literal, which compiles to the same value and leaves the file ' +
    'readable',
  'invalid-utf8':
    'a byte sequence that is not valid UTF-8 makes a text tool call this file binary and skip it ' +
    'whole. Re-save the file as UTF-8, or write the character as an escape',
};

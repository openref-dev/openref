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
 * WHAT IS CHECKED IS THE CLASSIFICATION AND NOT THE ENCODING IN GENERAL. Two conditions make a
 * tool refuse: a NUL byte, which is the marker every such heuristic starts from, and a byte
 * sequence that is not valid UTF-8, which is the other half of what GNU grep decides on. Both are
 * found in one pass and the first offending byte wins, so the message names one place to look
 * rather than a count.
 *
 * The validator is written out rather than delegated to `TextDecoder` for one reason: a decoder in
 * fatal mode reports that a file is invalid and not where, and an offset is the whole difference
 * between a finding a reader can act on and one they have to bisect by hand.
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

/** Directory names never descended into: build output and dependencies are not source. */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.git',
  '.turbo',
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

/** What one scan looked at and what it refused. */
export interface TextScan {
  readonly scanned: number;
  readonly unreadable: readonly UnreadableFile[];
}

/**
 * Scans the source roots and reports every file a text tool would refuse.
 *
 * The count of files scanned is returned beside the faults, because a scan that reached nothing
 * and a repository with nothing wrong in it produce the same empty list, and only one of them is
 * a pass.
 *
 * @param repoRoot - Absolute repository root
 * @param roots - Repository relative directories to walk
 * @param extensions - Lowercase extensions to keep, including the dot
 * @returns How many files were read, and the ones that would not
 */
export function scanSourceText(
  repoRoot: string,
  roots: readonly string[],
  extensions: readonly string[],
): TextScan {
  const unreadable: UnreadableFile[] = [];
  let scanned = 0;

  for (const root of roots) {
    for (const path of collectSourceFiles(join(repoRoot, root), extensions, repoRoot)) {
      let bytes: Uint8Array;
      try {
        bytes = readFileSync(join(repoRoot, path));
      } catch {
        continue;
      }

      scanned += 1;
      const fault = firstByteFault(bytes);
      if (fault === undefined) continue;

      const { line, column } = positionOfByte(bytes, fault.offset);
      unreadable.push({ path, reason: fault.reason, offset: fault.offset, line, column });
    }
  }

  return { scanned, unreadable: unreadable.sort((a, b) => a.path.localeCompare(b.path)) };
}

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

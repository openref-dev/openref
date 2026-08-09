/**
 * SHA-256 over the canonical serialization, per SPEC 5.3.
 *
 * The compression function comes from `@noble/hashes`, a single MIT dependency with no
 * dependencies of its own, whose `sha256` export is synchronous and resolves to a browser
 * safe module under the `browser` condition. `crypto.subtle` is not an option here because
 * it is asynchronous and `hash(ir)` is not; writing the compression function out by hand
 * was the other way to keep it synchronous, and it is not worth defending.
 *
 * UTF-8 encoding stays in this module rather than going through the dependency. The two
 * disagree on exactly one class of input, a lone surrogate. `TextEncoder`, which the
 * dependency uses when it is handed a string, replaces it with U+FFFD, while this encoder
 * emits it as its own three byte sequence. Handing over bytes rather than a string is what
 * keeps the digests identical to the ones this package produced before the dependency.
 *
 * Nothing on the hashing path calls `JSON.stringify` or `JSON.parse`.
 */

import { sha256 } from '@noble/hashes/sha2';

/**
 * Encodes a string as UTF-8.
 *
 * Written out rather than using `TextEncoder` so that this module depends on no global beyond
 * the language itself. A lone surrogate is encoded as its own three byte sequence; canonical
 * serialization escapes lone surrogates before they reach this function.
 *
 * @param text - Input string
 * @returns UTF-8 bytes
 */
export function utf8Encode(text: string): Uint8Array {
  const bytes: number[] = [];

  for (let index = 0; index < text.length; index += 1) {
    let code = text.charCodeAt(index);

    if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const low = text.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >>> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >>> 12), 0x80 | ((code >>> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >>> 18),
        0x80 | ((code >>> 12) & 0x3f),
        0x80 | ((code >>> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Renders bytes as lowercase hexadecimal.
 *
 * @param bytes - Digest bytes
 * @returns Two hexadecimal characters per byte
 */
function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes the SHA-256 digest of a string, encoded as UTF-8.
 *
 * @param text - Input string, normally the output of `canonicalize`
 * @returns Lowercase hexadecimal digest, 64 characters
 *
 * @example
 * sha256Hex('abc'); // 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
 */
export function sha256Hex(text: string): string {
  return toHex(sha256(utf8Encode(text)));
}

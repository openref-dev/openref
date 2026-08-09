/**
 * SHA-256, FIPS 180-4, implemented in place rather than taken from a dependency.
 *
 * Two reasons, both deliberate:
 *
 * - `core` must run unchanged in Node and in the browser. `node:crypto` does not, and a
 *   bundler shim for it would put a Node polyfill inside the client budget.
 * - this hash is a cache key, not a security primitive, and it is pinned by the NIST test
 *   vectors plus a cross check against `node:crypto` in the test suite.
 *
 * Nothing in this module or anywhere else on the hashing path calls `JSON.stringify`.
 */

/** Round constants: the first 32 bits of the fractional parts of the cube roots of the first 64 primes. */
const K: readonly number[] = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Initial hash values: the first 32 bits of the fractional parts of the square roots of the first 8 primes. */
const H0: readonly number[] = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

/**
 * Reads a word from a typed array.
 *
 * `noUncheckedIndexedAccess` widens every indexed read to `number | undefined`. Every index
 * used here is in range by construction, and non null assertions are forbidden, so the read
 * goes through this helper.
 */
function at(words: Uint32Array | readonly number[], index: number): number {
  return words[index] ?? 0;
}

/** Rotates a 32 bit word right. */
function rotr(word: number, bits: number): number {
  return ((word >>> bits) | (word << (32 - bits))) >>> 0;
}

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
 * Computes the SHA-256 digest of a string, encoded as UTF-8.
 *
 * @param text - Input string, normally the output of `canonicalize`
 * @returns Lowercase hexadecimal digest, 64 characters
 *
 * @example
 * sha256Hex('abc'); // 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
 */
export function sha256Hex(text: string): string {
  const message = utf8Encode(text);
  const bitLength = message.length * 8;

  // One 0x80 byte, then zeros, then a 64 bit big endian length, padded to a multiple of 64.
  const blockCount = Math.floor((message.length + 8) / 64) + 1;
  const padded = new Uint8Array(blockCount * 64);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const state = Uint32Array.from(H0);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4, false);
    }

    for (let index = 16; index < 64; index += 1) {
      const previous = at(schedule, index - 15);
      const sigma0 = (rotr(previous, 7) ^ rotr(previous, 18) ^ (previous >>> 3)) >>> 0;
      const recent = at(schedule, index - 2);
      const sigma1 = (rotr(recent, 17) ^ rotr(recent, 19) ^ (recent >>> 10)) >>> 0;
      schedule[index] =
        (at(schedule, index - 16) + sigma0 + at(schedule, index - 7) + sigma1) >>> 0;
    }

    let a = at(state, 0);
    let b = at(state, 1);
    let c = at(state, 2);
    let d = at(state, 3);
    let e = at(state, 4);
    let f = at(state, 5);
    let g = at(state, 6);
    let h = at(state, 7);

    for (let index = 0; index < 64; index += 1) {
      const sum1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + sum1 + choose + at(K, index) + at(schedule, index)) >>> 0;
      const sum0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    state[0] = (at(state, 0) + a) >>> 0;
    state[1] = (at(state, 1) + b) >>> 0;
    state[2] = (at(state, 2) + c) >>> 0;
    state[3] = (at(state, 3) + d) >>> 0;
    state[4] = (at(state, 4) + e) >>> 0;
    state[5] = (at(state, 5) + f) >>> 0;
    state[6] = (at(state, 6) + g) >>> 0;
    state[7] = (at(state, 7) + h) >>> 0;
  }

  let digest = '';
  for (let index = 0; index < 8; index += 1) {
    digest += at(state, index).toString(16).padStart(8, '0');
  }

  return digest;
}

/**
 * Base64 and base64url, written out rather than taken from a global.
 *
 * `btoa` exists in a browser and in current Node, and it is still not what this uses. It takes a
 * string of code points below 256 and throws on anything else, so a password with a non Latin-1
 * character in it would take down `http basic` at the moment a reader typed it. Encoding UTF-8
 * bytes first and mapping bytes to the alphabet second is the whole of the fix, and it makes the
 * same function serve PKCE, which starts from bytes and never has a string at all.
 *
 * THE ENCODER IS `TextEncoder` AND NOT `utf8Encode` FROM `@openref/core`, and the reason is a
 * defect that was measured rather than a preference. `utf8Encode` lives in the module that owns
 * this project's SHA-256, so importing it kept `import '@noble/hashes/sha2'` alive in the core
 * chunk the page's first paint already loads, where the browser cannot resolve a bare specifier
 * at all: the entry stopped evaluating and the console and the palette went dead. The two
 * encoders differ on exactly one input, a lone surrogate, which no credential and no verifier
 * contains. `body.ts` beside this already uses `TextEncoder` for the same reason.
 */

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function encode(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const triple = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);

    out += alphabet[(triple >> 18) & 0x3f] ?? '';
    out += alphabet[(triple >> 12) & 0x3f] ?? '';
    out += second === undefined ? (pad ? '=' : '') : (alphabet[(triple >> 6) & 0x3f] ?? '');
    out += third === undefined ? (pad ? '=' : '') : (alphabet[triple & 0x3f] ?? '');
  }

  return out;
}

/**
 * Encodes text as base64, through its UTF-8 bytes.
 *
 * @param text - The text to encode
 * @returns Base64 with padding, as `Authorization: Basic` requires
 *
 * @example
 * base64Text('user:pass');
 */
export function base64Text(text: string): string {
  return encode(new TextEncoder().encode(text), STANDARD, true);
}

/**
 * Encodes bytes as base64url without padding, which is the form RFC 7636 requires.
 *
 * @param bytes - The bytes to encode
 * @returns Base64url, unpadded
 *
 * @example
 * base64UrlBytes(new Uint8Array([1, 2, 3]));
 */
export function base64UrlBytes(bytes: Uint8Array): string {
  return encode(bytes, URL_SAFE, false);
}

/**
 * Encodes text as base64url without padding, through its UTF-8 bytes.
 *
 * @param text - The text to encode
 * @returns Base64url, unpadded, which is safe in a query parameter unencoded
 *
 * @example
 * base64UrlText('/docs/get-orders');
 */
export function base64UrlText(text: string): string {
  return encode(new TextEncoder().encode(text), URL_SAFE, false);
}

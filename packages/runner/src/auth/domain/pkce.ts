/**
 * PKCE, per RFC 7636 and SPEC 14.4, where S256 is mandatory rather than negotiated.
 *
 * THE METHOD IS NOT AN ARGUMENT AND THAT IS THE WHOLE DESIGN. RFC 7636 defines `plain` as well,
 * and every real attack on the authorization code flow that PKCE exists to stop works when
 * `plain` is in play, because the challenge and the verifier are then the same string and an
 * intercepted authorization request carries both. There is no parameter here to set to `plain`,
 * no field in the IR that a document could ask for it with, and no branch that reads one back off
 * the authorization server's response. That is what makes the rule unbypassable rather than
 * merely default: a crafted response has nothing to select.
 *
 * THE DIGEST IS THE PLATFORM'S AND NOT THIS PROJECT'S, WHICH IS A SIZE DECISION WITH A DEFECT
 * BEHIND IT. The first version derived the challenge with `sha256Hex` from `@openref/core`, which
 * is the one digest this repository owns and is right for a document hash. In a browser it is
 * wrong twice over: it carries a compression function nobody needs there, and it made the core
 * chunk the page's first paint already loads import `@noble/hashes` by name, which the browser
 * cannot resolve, so the entry failed to evaluate and the console and the palette went dead. The
 * browser has SHA-256 built in, it is asynchronous, and everything on this path already is.
 *
 * THE VERIFIER IS REQUIRED TO BE RANDOM, AND A RUNTIME WITH NO RANDOM SOURCE IS REFUSED. The
 * multipart boundary beside this falls back to a counter, and it is right to: a boundary has to
 * be absent from the payload rather than unguessable. A verifier that can be predicted is a
 * verifier that proves nothing, so this one has no fallback and says why.
 */

import { AuthError, ErrorCode } from '@openref/core';
import { base64UrlBytes } from './base64';

/** The one code challenge method this runner will use, per SPEC 14.4. */
export const PKCE_METHOD = 'S256';

/** How many random bytes a verifier is built from, giving 43 base64url characters. */
const VERIFIER_BYTES = 32;

/** A source of random bytes, so a test can pin one and a runtime without one is refused. */
export type RandomBytes = (length: number) => Uint8Array;

/** A verifier, the challenge derived from it, and the method that derivation used. */
export interface PkceChallenge {
  readonly verifier: string;
  readonly challenge: string;
  readonly method: typeof PKCE_METHOD;
}

function platformRandom(): RandomBytes | null {
  const source = (
    globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }
  ).crypto;

  if (source?.getRandomValues === undefined) return null;

  const fill = source.getRandomValues.bind(source);

  return (length: number): Uint8Array => fill(new Uint8Array(length));
}

/**
 * Random bytes, or a refusal naming what is missing.
 *
 * @param random - The source to use, defaulting to the platform's
 * @param length - How many bytes
 * @returns The bytes
 * @throws {AuthError} When the runtime has no random source
 */
export function randomBytes(random: RandomBytes | undefined, length: number): Uint8Array {
  const source = random ?? platformRandom();

  if (source === null) {
    throw new AuthError(
      'this runtime has no random source, and an authorization flow with a guessable verifier ' +
        'or state proves nothing; sign in from a browser that provides crypto.getRandomValues',
      ErrorCode.RUN_AUTH_FAILED,
    );
  }

  return source(length);
}

/**
 * An opaque value nothing else will be carrying, for `state` and for a nonce.
 *
 * @param random - The source to use, defaulting to the platform's
 * @returns 32 bytes as base64url
 * @throws {AuthError} When the runtime has no random source
 *
 * @example
 * const state = randomToken();
 */
export function randomToken(random?: RandomBytes): string {
  return base64UrlBytes(randomBytes(random, VERIFIER_BYTES));
}

/**
 * The challenge for a verifier, which is the base64url of its SHA-256.
 *
 * @param verifier - The code verifier, as it will be sent to the token endpoint
 * @returns The code challenge, as it is sent to the authorization endpoint
 * @throws {AuthError} When the runtime exposes no SHA-256
 *
 * @example
 * const challenge = await pkceChallengeFor('a'.repeat(43));
 */
export async function pkceChallengeFor(verifier: string): Promise<string> {
  const subtle = (
    globalThis as {
      crypto?: { subtle?: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
    }
  ).crypto?.subtle;

  if (subtle === undefined) {
    throw new AuthError(
      'this runtime exposes no SHA-256, so the mandatory PKCE challenge cannot be derived; a ' +
        'secure context is what provides it, and an authorization flow needs one anyway',
      ErrorCode.RUN_AUTH_FAILED,
    );
  }

  return base64UrlBytes(
    new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
}

/**
 * Creates a verifier and its challenge.
 *
 * @param random - The source to use, defaulting to the platform's
 * @returns The pair, and the method that derived it
 * @throws {AuthError} When the runtime has no random source or no SHA-256
 *
 * @example
 * const { challenge, verifier } = await createPkceChallenge();
 */
export async function createPkceChallenge(random?: RandomBytes): Promise<PkceChallenge> {
  const verifier = base64UrlBytes(randomBytes(random, VERIFIER_BYTES));

  return { verifier, challenge: await pkceChallengeFor(verifier), method: PKCE_METHOD };
}

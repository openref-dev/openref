/**
 * Which security schemes a browser cannot send, and the sentence that says why.
 *
 * IN `core` FOR THE REASON THE SOURCE LINK EXPANSION IS, and it is the same shape of decision. The
 * rule has two consumers on opposite sides of the dependency graph: `@openref/runner` asks it when
 * there is a value to send, so that a value which cannot travel is refused rather than dropped on
 * the way out, and `@openref/vue` asks it while projecting an operation, so that the console draws
 * a row with a sentence in it instead of nothing at all. `runner` and `vue` cannot see each other,
 * so a copy in each would be two policies that disagree the first time one is edited, silently,
 * because each would have its own green tests.
 *
 * AN UNSUPPORTED SCHEME RENDERING AS ABSENT IS THE FAILURE THIS EXISTS TO PREVENT. A reader who
 * sees no field for `mutualTLS` learns nothing; a reader who sees the scheme named with the reason
 * beside it knows the console is complete and the API needs a client certificate.
 */

/** The part of a security scheme this question is answered from. */
export interface SecuritySchemeShape {
  readonly type: string;
  /** Where an `apiKey` travels. */
  readonly in?: string;
  /** HTTP authentication scheme, for `http`. */
  readonly scheme?: string;
}

/**
 * Why a browser cannot send a scheme, as a cause rather than as a sentence.
 *
 * `mutual-tls` needs a client certificate chosen during the TLS handshake, which no code on the
 * page takes part in, and nothing later changes that. `cookie-api-key` and `http-challenge` are
 * unsendable in direct mode: `Cookie` is a forbidden header name, and digest and negotiate are a
 * challenge and response the browser performs itself. The same origin proxy of SPEC 14.5 removes
 * the first of those two.
 */
export type UnsendableCause = 'mutual-tls' | 'cookie-api-key' | 'http-challenge';

/**
 * Why a browser cannot send this scheme, or undefined when it can.
 *
 * A CAUSE AND NOT THE SENTENCE, and the reason is where each of the two belongs. The rule is a
 * fact about the platform and lives here, where both `@openref/runner` and `@openref/vue` can ask
 * it; the words a reader sees are the interface's, so they live with the interface and a theme can
 * say them differently. Carrying the prose here also put three English sentences into the first
 * chunk of every page, because this is reachable from the projection.
 *
 * @param scheme - The scheme as the document declares it
 * @returns The cause, or undefined when the scheme can be sent
 *
 * @example
 * unsendableSchemeCause({ type: 'mutualTLS' });
 */
export function unsendableSchemeCause(scheme: SecuritySchemeShape): UnsendableCause | undefined {
  if (scheme.type === 'mutualTLS') return 'mutual-tls';
  if (scheme.type === 'apiKey' && scheme.in === 'cookie') return 'cookie-api-key';

  if (scheme.type === 'http') {
    const named = (scheme.scheme ?? '').toLowerCase();
    if (named !== 'basic' && named !== 'bearer') return 'http-challenge';
  }

  return undefined;
}

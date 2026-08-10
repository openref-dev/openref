/**
 * What a client bundle is not allowed to contain.
 *
 * Kept apart from the test that reads the built file so that the scanner itself can be
 * tested against planted content. A scan that silently matches nothing looks exactly like
 * a clean bundle, and that is the failure mode this file exists to rule out.
 */

/**
 * Markers of the libraries SPEC 12 keeps on the server.
 *
 * `jsdom` is matched by a path rather than by its bare name on purpose: Vue's devtools
 * hook sniffs the user agent for the string `jsdom`, so the bare name matches a clean
 * bundle and would have made this check fail for a reason that has nothing to do with the
 * library being present.
 */
export const SERVER_ONLY_MARKERS: readonly string[] = [
  'shiki',
  'marked',
  'dompurify',
  'DOMPurify',
  'jsdom/living',
];

/** Constructs a strict Content Security Policy cannot authorize. */
const CSP_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'inline-style-attribute', pattern: /[\s'"`;{(]style\s*=\s*(?:["'][^"']*["']|\{)/ },
  { name: 'dynamic-code-evaluation', pattern: /\beval\s*\(|\bnew\s+Function\s*\(/ },
];

/** Result of scanning one bundle. */
export interface BundleScan {
  /** Server only markers found, in the order they are declared. */
  readonly forbidden: readonly string[];
  /** Names of the policy rules the bundle trips. */
  readonly cspViolations: readonly string[];
}

/**
 * Scans a built client bundle.
 *
 * @param bundle - Contents of the built file
 * @returns Which forbidden markers and which policy violations it holds
 */
export function scanClientBundle(bundle: string): BundleScan {
  return {
    forbidden: SERVER_ONLY_MARKERS.filter((marker) => bundle.includes(marker)),
    cspViolations: CSP_PATTERNS.filter(({ pattern }) => pattern.test(bundle)).map(
      ({ name }) => name,
    ),
  };
}

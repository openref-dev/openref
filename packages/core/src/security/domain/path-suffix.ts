/**
 * The refusal every proxy of this project owes a client contributed path suffix.
 *
 * ONE HOME, TWO FORMS, AND THE SECOND FORM IS WHY IT LIVES IN `core`. Four things concatenate a
 * suffix a reader can influence onto a base this project pinned: the Nitro route, the Cloudflare
 * Pages Function and the CloudFront viewer-request function that `@openref/static` generates, and
 * the same origin proxy of SPEC 14.5 that `@openref/nest` mounts. The first three are emitted as
 * source text into somebody else's runtime and cannot import anything, so what they carry is the
 * same rule spelled as lines, in `@openref/static` beside the generator that emits them, with a
 * case there compiling those lines and holding them to this function over every spelling. The text
 * is not exported from here because this module reaches the browser through the package barrel and
 * the emitted lines are build time material: measured, carrying them cost the first paint 316 bytes
 * against a budget with none to give.
 *
 * THE FOURTH WAS THE ONE WITHOUT IT, WHICH IS WHY THIS MOVED. `T040` wrote the guard for the three
 * generated artefacts after measuring 23 leaks across them, and the runtime proxy, which asks the
 * identical question about the identical kind of input, never received it. Measured before this
 * module existed: of eight spellings driven through `decideTarget`, seven were admitted and
 * forwarded, and the one refusal was a side effect of `new URL` collapsing a literal `../` rather
 * than of any policy. A fifth copy, in the runner's rewriting transport, was written by hand and
 * compared to nothing.
 *
 * WHAT IT REFUSES AND WHY IT REFUSES RATHER THAN REPAIRS. A dot segment in the suffix climbs above
 * the pinned base path while staying inside the pinned origin, so the address property of SPEC 19
 * item 9 stays true while the request reaches a path nobody pinned. Repairing it would mean
 * deciding for an upstream nobody asked, so the answer is a refusal.
 */

/**
 * The four spellings of `..` the URL standard admits, across one separator class.
 *
 * Slash, backslash and their encodings are read as one class because a receiving server may
 * normalize any of them, and a `;` path parameter is in the class because it terminates a segment
 * for the servers that implement it.
 */
const DOT_SEGMENT = /(^|[/\\;]|%2f|%5c|%3b)(\.\.|\.%2e|%2e\.|%2e%2e)([/\\;]|%2f|%5c|%3b|$)/i;

/** An encoding that would still spell a separator or a dot to whoever decodes next. */
const AMBIGUOUS = /%(2e|2f|5c|3b)/i;

/**
 * Whether a client contributed path suffix must not be formed into a request.
 *
 * Checked on the suffix as received and again after exactly one decode. A suffix whose one decode
 * still spells an encoded dot, separator or path parameter stays ambiguous to whoever decodes
 * next, and a suffix that one decode cannot resolve at all is refused for the same reason.
 *
 * @param rest - The path below the pinned base, with no leading slash
 * @returns True when the request must not be formed
 *
 * @example
 * refusesPathSuffix('orders/42');        // false
 * refusesPathSuffix('..%2fsecret');      // true
 * refusesPathSuffix('%252e%252e/x');     // true
 */
export function refusesPathSuffix(rest: string): boolean {
  let decoded: string | null;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    decoded = null;
  }

  return (
    DOT_SEGMENT.test(rest) ||
    decoded === null ||
    AMBIGUOUS.test(decoded) ||
    DOT_SEGMENT.test(decoded)
  );
}

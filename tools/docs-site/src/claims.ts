/**
 * Every statement the documentation makes about what a reader will see, in one place.
 *
 * WHY THIS FILE EXISTS. Six review rounds found six instances of one class: a sentence saying a
 * reader will see something, and a mount that does not produce it. The fifth round answered it
 * with a checker that read fenced blocks, and the sixth found five spellings that routed around
 * the checker: a table row, a heading, a paragraph, a bullet, a sentence. A checker verifies one
 * way of writing a claim. This file removes the writing.
 *
 * SO A CLAIM IS NOT WRITTEN IN PROSE AT ALL. It is written here once, emitted into every surface
 * that makes it by `generate.ts`, and asserted against a booted application by
 * `packages/nest/test/integration/documentation-promises.spec.ts`, which reads this same array.
 * A writer cannot word a claim wrongly because a writer does not word it; a claim with no
 * evidence does not compile, because `evidence` is required.
 *
 * EVERYTHING ELSE IN THE DOCUMENTATION STAYS PROSE AND STAYS FREE. This is nine sentences about a
 * bare mount and four about what a collector adds, measured across every surface before the file
 * was written. It is not a general mechanism for documenting the product.
 *
 * SO THE PERIMETER IS WHERE THIS FILE STOPS, AND A WRITER MEETS IT HERE
 * (DEFER POST-1.0, `TX-DOCS-PERIMETER`). Measured rather than assumed, twice. Inside the twelve
 * entries below, ten are unreachable by a writer because the statement is generated: each was
 * reworded by hand where the documentation states it and each turned one case red. Two stay
 * reachable, and they are the two contexts no region emits, `errors-collector` and
 * `throttler-package`, so the remainder inside the twelve is a region that was never placed rather
 * than a hole. Outside them the perimeter is real and open: nine claims about what a reader sees
 * were written into the documentation by hand and eight reached a reader with 51 of 51 cases green
 * and every gate green, because `expandGenerated` copies text outside a region through untouched
 * and nothing else in the tree reads documentation prose for meaning. `generatedSurfaces()` owns 18
 * surfaces, 12 carry a region and 6 carry none at all, and 32 regions hold 2,857 bytes of 67,626.
 *
 * A THIRTEENTH CLAIM WRITTEN BY HAND IS CAUGHT BY REVIEW AND BY NOTHING ELSE, and no mechanism
 * proposed so far makes that impossible. The three paths and the maintainer's ruling that the box
 * stays shut are in `ai-docs/BUILD-AMENDMENTS.md` under the entry the marker above names. If you
 * are about to write a sentence saying a reader will see something, and it is not in the array
 * below, nothing in this repository will check it for you.
 */

/** Which mount a claim is about, and therefore what has to be true for it to hold. */
export type ClaimContext =
  'bare-mount' | 'printed-block' | 'errors-collector' | 'throttler-package';

/** One statement about what a reader sees, with the structural evidence for it. */
export interface Claim {
  /** Stable id, used by the prose to refer to the claim and by the suite to name a failure. */
  readonly id: string;
  /** The mount the claim is about. */
  readonly context: ClaimContext;
  /** The sentence, as every surface emits it. */
  readonly sentence: string;
  /**
   * What on a rendered page makes it true, in words, so the probe and the claim cannot drift.
   *
   * The probe itself lives with the suite, because it needs a page; this is the description a
   * failure prints, and the reason a claim cannot be added without somebody deciding what would
   * show it to be true.
   */
  readonly evidence: string;
}

/**
 * The claims, in the order a reader meets them.
 *
 * THE CSP CLAIM SAYS WHAT WE GUARANTEE AND WHAT THE HOST MUST DO, and it says the second half
 * plainly rather than in a footnote. Until 2026-09-01 six places said "strict CSP with no
 * unsafe-inline" as though the reference set the policy. It does not: SPEC 16.4 records that the
 * module never writes a `Content-Security-Policy` header, and nothing in `packages/nest` or
 * `packages/static` writes one. What is ours is the output, which carries no inline style and no
 * inline script and takes a nonce; what is the host's is the header. A reader who believes the
 * policy is set for them will not set it, which is a security claim that is false in the shipped
 * configuration.
 */
export const CLAIMS: readonly Claim[] = [
  {
    id: 'reference-search-schemas',
    context: 'bare-mount',
    sentence: 'A reference with search, and a page per named schema',
    evidence: 'the command palette control, and an address under schema/',
  },
  {
    id: 'try-it',
    context: 'bare-mount',
    sentence: 'Try it, on every operation',
    evidence: 'the send control on the operation console',
  },
  {
    id: 'sse-marked',
    context: 'bare-mount',
    sentence: 'SSE endpoints, marked from the document',
    evidence: 'the streaming method badge, absent from a document that declares no stream',
  },
  {
    id: 'no-external-requests',
    context: 'bare-mount',
    sentence: 'No CDN and no outgoing request of any kind',
    evidence: 'every asset address is local, and no address names another origin',
  },
  {
    id: 'digest-assets',
    context: 'bare-mount',
    sentence: 'Every asset served by your own application, under a name carrying its own digest',
    evidence: 'asset addresses under _assets/ carrying a hex digest before the extension',
  },
  {
    id: 'csp',
    context: 'bare-mount',
    sentence:
      'Output a strict CSP accepts: no inline style, no inline script, and a nonce on what needs one. Setting the header is yours to do, because this module never writes one',
    evidence: 'no inline style attribute and no executable inline script in the served markup',
  },
  {
    id: 'no-telemetry',
    context: 'bare-mount',
    sentence: 'No telemetry, no version check, and no install time call home',
    evidence: 'the install script refusals in the workspace, and zero requests off the origin',
  },
  {
    id: 'sanitized',
    context: 'bare-mount',
    sentence: 'Descriptions rendered as markdown and then sanitized, rather than escaped',
    evidence: 'markup from a description survives, and a script in one does not',
  },
  {
    id: 'guards-scopes',
    context: 'printed-block',
    sentence: 'Guards and the scopes a route requires',
    evidence: 'the authentication and scopes rows of the parity scale, naming the guard class',
  },
  {
    id: 'source-link',
    context: 'printed-block',
    sentence: 'A link to the line the handler is written on',
    evidence: 'the source link, with the line in its address',
  },
  {
    id: 'error-contracts',
    context: 'errors-collector',
    sentence: 'Error contracts, in three groups that are never one list',
    evidence: 'the contracts the collector was given, drawn on the operation page',
  },
  {
    id: 'rate-limits',
    context: 'throttler-package',
    sentence: 'Rate limits, read off the handler',
    evidence:
      'a figure per unit on the runtime side of the rate limit row, carried by the demo and held to the served page by readme-reproduction.spec.ts, because the producer is a separate package this one cannot depend on',
  },
];

/**
 * The claims of one context, in order.
 *
 * @param context - Which mount
 * @returns Its claims
 */
export function claimsFor(context: ClaimContext): readonly Claim[] {
  return CLAIMS.filter((claim) => claim.context === context);
}

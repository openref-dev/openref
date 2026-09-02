/**
 * The strict policy of SPEC 19.2, and the nonce the reference writes into its own page.
 *
 * THE CONVENTION IS `event.context.cspNonce`, which is what `@openref/nuxt`'s handler reads. A
 * module cannot generate a nonce for a policy it did not write, so the host writes both: one
 * random value per response, into the header and into the context, and the page carries it on
 * every element a strict policy would otherwise refuse.
 *
 * THE POLICY TEXT IS NOT WRITTEN HERE, AND THAT IS THE POINT. `buildContentSecurityPolicy` comes from
 * `@openref/nuxt/runtime`, which re-exports it from `@openref/render`, where it lives beside the
 * shell whose elements the nonce is written onto. Three surfaces speak this policy, this one, the
 * browser fixture that enforces it in a real Chrome, and the suite that compares the served
 * header with it; a transcribed copy here would be a deployment serving a rule nothing ever
 * proved. `nuxt-parity.spec.ts` compares the header this plugin sets with what the same function
 * returns for the nonce in the page, so a desynced spelling is a red case rather than a shrug.
 *
 * IT IS APPLIED TO THE MOUNT AND NOT TO THE WHOLE APPLICATION, and that is a measured fact rather
 * than a convenience. Under `script-src 'self' 'nonce-...'` with no `unsafe-inline`, Nuxt's own
 * pages lose their hydration payload, which it writes as an inline script with no nonce on it;
 * the reference has been written to run under exactly this policy since M0 and does. Widening the
 * policy to cover the application's own pages is the host's decision and is not made here.
 */

import { randomBytes } from 'node:crypto';
import { buildContentSecurityPolicy, servesReference } from '@openref/nuxt/runtime';

/** Where the reference is mounted, matching `openref.base` in `nuxt.config.ts`. */
const MOUNT = '/docs';

/**
 * THE SCOPE TEST IS THE MODULE'S AND NOT THIS FILE'S, FOR THE REASON THE POLICY TEXT IS.
 *
 * `path.startsWith(MOUNT)` was the first spelling and `T062` measured what it costs: a host page at
 * `/docs-legacy` was served under the reference's strict policy, and under
 * `script-src 'self' 'nonce-...'` with no `unsafe-inline` a Nuxt page loses the hydration payload it
 * writes as an unnonced inline script. The corrected spelling then lived here, in `examples/`, where
 * no suite and no gate reads it, so a fix with no runner replaced a defect with no runner.
 * `servesReference` is in `@openref/nuxt/runtime` beside the policy, `reference-handler.spec.ts`
 * drives it, and this file is one of its callers rather than its owner.
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (!servesReference(event.path, MOUNT)) return;

    // A HOST THAT ALREADY SET A POLICY IS NOT OVERWRITTEN IN SILENCE. Nitro plugins run in order,
    // and an application that serves its own `Content-Security-Policy` on every response would
    // otherwise have it replaced for this subtree by a stricter one it never chose. The reference
    // needs a nonce policy to run under, so the two cannot both hold: the existing value is left
    // where it is and the mount is served with no nonce at all, which is the same page the static
    // build writes, and the reason is said out loud rather than left for a reader to find in a
    // response header.
    if (event.node.res.getHeader('Content-Security-Policy') !== undefined) {
      process.stderr.write(
        `openref: this deployment already sets Content-Security-Policy on ${event.path}, so the reference is served under the host policy and without a nonce. Remove that header for ${MOUNT} to serve the reference under the strict policy of SPEC 19.2\n`,
      );

      return;
    }

    const nonce = randomBytes(16).toString('base64');
    event.context.cspNonce = nonce;
    event.node.res.setHeader('Content-Security-Policy', buildContentSecurityPolicy(nonce));
  });
});

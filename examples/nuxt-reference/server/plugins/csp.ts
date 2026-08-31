/**
 * The strict policy of SPEC 19.2, and the nonce the reference writes into its own page.
 *
 * THE CONVENTION IS `event.context.cspNonce`, which is what `@openref/nuxt`'s handler reads. A
 * module cannot generate a nonce for a policy it did not write, so the host writes both: one
 * random value per response, into the header and into the context, and the page carries it on
 * every element a strict policy would otherwise refuse.
 *
 * THE POLICY TEXT IS NOT WRITTEN HERE, AND THAT IS THE POINT. `contentSecurityPolicy` comes from
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
import { contentSecurityPolicy } from '@openref/nuxt/runtime';

/** Where the reference is mounted, matching `openref.base` in `nuxt.config.ts`. */
const MOUNT = '/docs';

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    if (!event.path.startsWith(MOUNT)) return;

    const nonce = randomBytes(16).toString('base64');
    event.context.cspNonce = nonce;
    event.node.res.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce));
  });
});

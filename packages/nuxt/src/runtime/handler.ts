/**
 * The Nitro route that answers the reference, and the only file here that speaks h3.
 *
 * IT IS THIN ON PURPOSE. Everything about what a site holds is `@openref/static`'s; everything
 * about what a page looks like is `@openref/render`'s. What is left, and what could not be
 * anywhere else, is turning one framework's request into an address and one answer into that
 * framework's response, which is the same shape `express-reference.adapter.ts` and
 * `fastify-reference.adapter.ts` have on the Nest side.
 *
 * A FACTORY RATHER THAN A HANDLER READING A VIRTUAL MODULE. The generated entry in the Nuxt build
 * directory calls this with the embedded site, so this file has no import that exists only inside
 * somebody else's build and is typechecked by this repository like every other file. What is
 * generated is three lines and a JSON literal.
 *
 * THE NONCE IS READ FROM THE EVENT CONTEXT AND NEVER INVENTED HERE. A nonce is worth exactly the
 * policy that names it, and this module sets no `Content-Security-Policy`: a header written by a
 * module the host did not ask for a policy from would either be too narrow for the host's own
 * pages or too wide to be worth writing. A host that serves a nonce policy puts the value on
 * `event.context.cspNonce`, which is the convention the example application follows, and the page
 * carries it. A host that serves none gets a page with no nonce attribute, which is the same page
 * the static build writes.
 */

import { defineEventHandler, getRequestURL, setResponseHeader, setResponseStatus } from 'h3';
import type { EventHandler, H3Event } from 'h3';
import { createSite, type EmbeddedSite } from './site';

/**
 * Builds the policy of SPEC 19.2, for a host to set. This module sets no header.
 *
 * PUBLIC API FROM T064, WHICH IS WHEN THIS PACKAGE WAS PUBLISHED, and frozen from that day. Both
 * halves of the surface were settled before the publish rather than after it: the name became a
 * verb, and this sentence says what the verb does. THE HOST SETS THE POLICY AND THE REFERENCE MAKES
 * ITS OUTPUT COMPATIBLE WITH ONE. Nothing in this package writes a `Content-Security-Policy`
 * header; `createReferenceHandler` below sets content type and cache control and nothing else. A
 * host that wants the reference under a nonce policy calls this, adds whatever its own pages need,
 * and sets the header itself, which is what `examples/nuxt-reference/server/plugins/csp.ts` does.
 *
 * RE-EXPORTED RATHER THAN RESTATED, per the standing rule about a vocabulary spoken by more than
 * one surface. `@openref/render` owns it, beside the shell whose elements the nonce is written
 * onto; the browser fixture enforces it in a real Chrome; the Nuxt example serves the reference
 * under it; and `nuxt-parity.spec.ts` compares the served header with it. A host that transcribed
 * the policy instead would be serving a rule nothing in this repository ever proved.
 */
export { buildContentSecurityPolicy } from '@openref/render';

/**
 * What a hashed asset may be cached for: it is addressed by its own digest.
 *
 * THE THREE VALUES BELOW ARE THE ONES `@openref/nest` SERVES, and `runtime-handler.spec.ts`
 * holds the two surfaces equal by importing both. Two mounts of one reference answering with
 * different cache directives would be one document behaving two ways, which is the class of
 * difference SPEC 16.4 exists to keep at zero.
 */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** What everything else may be cached for: the address outlives the bytes at it. */
export const REVALIDATE = 'no-cache';

/** What a refusal may be cached for. */
export const NO_STORE = 'no-store';

/** What the reference answers when the site holds nothing at an address. */
export const NOT_FOUND_BODY = 'No page of that address is documented here.';

/**
 * Whether one request path is the mounted reference rather than a page of the host's own.
 *
 * IT IS HERE SO THAT A SUITE CAN DRIVE IT, WHICH IS THE HALF THAT WAS MISSING. The example's Nitro
 * plugin decided this with `path.startsWith(base)`, and `T062` measured what that costs: a host
 * page at `/docs-legacy` was served under the reference's strict policy, and under
 * `script-src 'self' 'nonce-...'` with no `unsafe-inline` a Nuxt page loses the hydration payload it
 * writes as an unnonced inline script. The corrected predicate then lived in `examples/`, where no
 * suite and no gate reads it, so the fix had no runner: this is the same one-home move the policy
 * string itself already made, for the same reason.
 *
 * THE QUERY IS PART OF WHAT h3 HANDS IN, and the pattern admits it. `event.path` carries the query
 * string, so the mount asked for with `?a=1` is still the mount, and dropping the policy there
 * would be the same defect in the other direction.
 *
 * @param path - The request path as h3's `event.path` gives it, query included
 * @param basePath - The mount, with a leading slash and no trailing one
 * @returns True for the mount itself and everything under it, false for a sibling route
 *
 * @example
 * servesReference('/docs/get-parcels', '/docs'); // true
 * @example
 * servesReference('/docs-legacy', '/docs'); // false
 */
export function servesReference(path: string, basePath: string): boolean {
  return new RegExp(`^${basePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[/?#]|$)`).test(path);
}

/**
 * The CSP nonce a host generated for this response, per SPEC 19.2.
 *
 * @param context - The event context
 * @returns The nonce, or undefined when the host serves no policy
 */
export function nonceOf(context: Record<string, unknown>): string | undefined {
  const value = context.cspNonce;

  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * Builds the route handler for one embedded reference.
 *
 * @param embedded - What the module put into the server build
 * @returns The h3 event handler Nitro registers
 */
export function createReferenceHandler(embedded: EmbeddedSite): EventHandler {
  const siteOf = createSite(embedded);

  return defineEventHandler(async (event: H3Event) => {
    const site = await siteOf();
    const answer = await site.answer(getRequestURL(event).pathname, nonceOf(event.context));

    if (answer === null) {
      setResponseStatus(event, 404);
      setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8');
      setResponseHeader(event, 'cache-control', NO_STORE);

      return NOT_FOUND_BODY;
    }

    setResponseHeader(event, 'content-type', answer.contentType);
    setResponseHeader(event, 'cache-control', answer.immutable ? IMMUTABLE : REVALIDATE);

    return typeof answer.body === 'string' ? answer.body : Buffer.from(answer.body);
  });
}

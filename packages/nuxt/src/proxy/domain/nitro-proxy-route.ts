/**
 * The Nitro proxy route of SPEC 16.2, taken from the generator rather than written again.
 *
 * THE TASK'S OWN WORDING IS "WIRED THROUGH THE GENERATOR FROM `T040` RATHER THAN REIMPLEMENTED",
 * and this file is the whole of the wiring. `generateProxyFiles` already produces the file the
 * table names for the Nitro row, with the upstreams pinned as literals, the `u<N>` indexing, the
 * 403 for anything else and the gateway comment SPEC 16.2 requires. A route written here would be
 * a second implementation of the one thing in this project that must never be permissive by
 * accident, and it would be the one the CLI's own suites do not cover.
 *
 * IT BECOMES A ROUTE AND NOT A PUBLISHED FILE, which is the one difference from the built output
 * and is enumerated in SPEC 16.4. The generated artefact is server source: published into the
 * public directory it would be readable by anyone, and registered as a handler it is what it was
 * written to be. The bytes are identical either way, which `nitro-proxy.spec.ts` asserts against
 * the generator's own output, and which `nuxt-parity.spec.ts` asserts against a real build.
 */

import { proxyServers, type IRDocument } from '@openref/core';
import { PROXY_SEGMENT } from '@openref/render';
import { planProxy } from '@openref/static';

/**
 * The path the CLI writes the Nitro artefact to, relative to the build output.
 *
 * Spelled from the generator's own inputs rather than copied, so a change to the layout of the
 * artefact moves this with it.
 *
 * @param basePath - The resolved mount, with a leading slash
 * @returns The path, forward slashes
 */
export function nitroProxyFile(basePath: string): string {
  return `server/routes${basePath}/${PROXY_SEGMENT}/[...].ts`;
}

/** The route pattern Nitro matches the generated handler on. */
export function nitroProxyRoute(basePath: string): string {
  return `${basePath}/${PROXY_SEGMENT}/**`;
}

/**
 * The generated route for one document, or null when there is nothing to pin.
 *
 * NULL IS A REAL ANSWER AND NOT A FAILURE. A document with no absolute http server pins no
 * upstream, so SPEC 16.2 writes no rule for it and there is no route to register; a mount with
 * no target asked for nothing at all. Both are states a deployment can be in and neither is an
 * error.
 *
 * @param document - The normalized document
 * @param basePath - The resolved mount, with a leading slash
 * @param forwardCookies - SPEC 16.2's `forwardCookies`
 * @returns The source of the route, or null
 */
export function nitroProxySource(
  document: IRDocument,
  basePath: string,
  forwardCookies: boolean,
): string | null {
  const plan = planProxy({
    target: 'nitro',
    servers: proxyServers(document),
    basePath,
    forwardCookies,
  });

  if (plan.upstreams.length === 0) return null;

  const file = nitroProxyFile(basePath);
  const generated = plan.files.find((entry) => entry.file === file);

  return generated?.content ?? null;
}

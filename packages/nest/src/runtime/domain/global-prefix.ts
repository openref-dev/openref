/**
 * Reading the global prefix, which is the difference between the paths a document writes and the
 * paths a controller declares.
 *
 * WHY IT IS READ AT ALL, MEASURED RATHER THAN ARGUED. `setGlobalPrefix('api/v1')` puts
 * `/api/v1/dashboards` in the document while the controller still declares `/dashboards`, so
 * pairing rule two, which compares method and path for equality, matches nothing at all in such an
 * application. Simulated against the maintainer's served document on 2026-09-06: rule two paired 0
 * of 58, and had been paired 0 of 58 for as long as the rule has existed, masked by rule one rather
 * than by the suffix rule below it.
 *
 * THE CONTAINER IS ASKED, WHICH IS THE `readGlobalGuards` WALK AND NOT A NEW COUPLING.
 * `ApplicationConfig` is one of the providers `DiscoveryService.getProviders` already returns, so
 * this needs no token from `@nestjs/core`, no sixth injection and no change to how a host wires the
 * module. It is matched by class name and then by the accessor being callable, which is the same
 * two step `guardName` does, so a container that no longer holds it is reported rather than assumed
 * empty.
 *
 * WHY THIS IS NOT THE REFUSAL `guards.ts` RECORDS. That refusal is about `app.useGlobalGuards`,
 * whose list is still mutable when `setup` runs, so reading it would put a guard on a page because
 * two lines of `main.ts` are in one order rather than the other. Nothing here is written into the
 * document. The prefix is used to build one more exact lookup key, and a host that sets it after
 * `setup` reads back the empty prefix and gets the pairing it got before, so the worst outcome is a
 * route that does not pair and never a fact attributed to the wrong endpoint.
 *
 * IT IS NOT A GUESS AND THE ALTERNATIVE WAS. The rule underneath asks whether a document path ends
 * in a route path, which is a suffix test with no anchor: on the same application `/dashboards`
 * ends both `/api/v1/dashboards` and `/api/v1/admin/dashboards`, so it matched two operations and
 * attributed the route to neither. One prefix read once, applied at the front of the string, cannot
 * do that.
 */

import {
  NEST_APPLICATION_CONFIG_NAME,
  type ApplicationConfigLike,
  type DiscoveryServiceLike,
  type InstanceWrapperLike,
} from '../../shared/types/nest-surface';

/** What the container answered when it was asked for the application's prefix. */
export interface GlobalPrefixReading {
  /**
   * The prefix with a leading slash and no trailing one, or `undefined` when it could not be read.
   *
   * THE EMPTY STRING AND `undefined` ARE DIFFERENT ANSWERS. An application with no prefix reads
   * back the empty string, which is a fact; a container holding no `ApplicationConfig` reads back
   * `undefined`, which is the instrument failing, and only the second of those is worth a reader's
   * attention.
   */
  readonly prefix: string | undefined;
}

/**
 * Reads the prefix `setGlobalPrefix` put on the application.
 *
 * READ ONCE FOR THE APPLICATION AND NOT ONCE PER ROUTE, the rule `readGlobalGuards` sets: it is one
 * registration, and it cannot differ between two nodes.
 *
 * @param discovery - Nest's `DiscoveryService`
 * @returns The prefix in the document's spelling, or `undefined` when the container had none to give
 */
export function readGlobalPrefix(discovery: DiscoveryServiceLike): GlobalPrefixReading {
  for (const wrapper of discovery.getProviders()) {
    const config = applicationConfig(wrapper);
    if (config === undefined) continue;

    return { prefix: normalizePrefix(config.getGlobalPrefix()) };
  }

  return { prefix: undefined };
}

/**
 * Narrows one provider to the application configuration, when that is what it is.
 *
 * THE NAME IS CHECKED AND THEN THE ACCESSOR IS, in that order and both of them. The name alone
 * would call whatever a host happened to register under a class of the same name; the accessor
 * alone would call any provider with a method of that shape. Nothing here reads a function as a
 * fact: `getGlobalPrefix` is public API on both supported majors and returns the string a host
 * passed to `setGlobalPrefix`.
 *
 * @param wrapper - One provider as `DiscoveryService` reported it
 * @returns The configuration, or undefined when this provider is not it
 */
function applicationConfig(wrapper: InstanceWrapperLike): ApplicationConfigLike | undefined {
  const instance: unknown = wrapper.instance;
  if (typeof instance !== 'object' || instance === null) return undefined;

  const constructor: unknown = (instance as { constructor?: unknown }).constructor;
  if (typeof constructor !== 'function' || constructor.name !== NEST_APPLICATION_CONFIG_NAME) {
    return undefined;
  }

  const read: unknown = (instance as { getGlobalPrefix?: unknown }).getGlobalPrefix;

  return typeof read === 'function' ? (instance as ApplicationConfigLike) : undefined;
}

/**
 * Rewrites a prefix into the spelling a document path is written in.
 *
 * NESTJS ACCEPTS IT WITH OR WITHOUT THE SLASHES and `@nestjs/swagger` writes one form, so
 * `api/v1`, `/api/v1` and `/api/v1/` are the same prefix and become the same string here. The empty
 * prefix stays empty rather than becoming `/`, because it is prepended to a path that already
 * carries its own leading slash.
 *
 * @param prefix - Whatever `getGlobalPrefix` returned
 * @returns A leading slash and no trailing one, or the empty string
 */
function normalizePrefix(prefix: string): string {
  const segments = prefix.split('/').filter((segment) => segment !== '');

  return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

/**
 * Which adapter answers for the application that was handed over.
 *
 * REFUSED RATHER THAN GUESSED AT. A third platform adapter would very likely accept the route
 * registrations and then write replies through an object neither of these two understands,
 * which is a documentation route that answers with nothing while the application looks
 * healthy. Naming the platform in the error is what turns that into a five second diagnosis.
 */

import { ConfigError, ErrorCode } from '@openref/core';
import { ExpressReferenceAdapter, type ReferenceAdapterOptions } from './express-reference.adapter';
import { FastifyReferenceAdapter } from './fastify-reference.adapter';
import type { RouteAdmission } from '../../../visibility/domain/admission';
import type { IReferenceHttpAdapter } from '../../application/ports/reference-http.port';
import type { HttpAdapterLike } from '../../../shared/types/nest-surface';

/** Platforms this package can write a reply to. */
export const SUPPORTED_PLATFORMS: readonly string[] = ['express', 'fastify'];

/**
 * Builds the adapter for one NestJS http adapter.
 *
 * THE ADMISSION IS POSITIONAL AND HAS NO DEFAULT, which is where SPEC 19.6's promise is kept. Both
 * platform adapters run it in front of every route they register, and neither can be constructed
 * without one, so a route added to the table in a later milestone is behind the host's guard by
 * construction. `RouteAdmission` has a private constructor and two named factories, so "no guard"
 * is `RouteAdmission.open()`, written out, rather than an argument somebody left off.
 *
 * @param adapter - The NestJS http adapter
 * @param admission - The decision of SPEC 19.6 for this mount
 * @param options - Nonce lookup and error reporting
 * @returns An adapter that can register the route table
 * @throws {ConfigError} When the platform is neither Express nor Fastify
 */
export function createReferenceAdapter(
  adapter: HttpAdapterLike,
  admission: RouteAdmission,
  options: ReferenceAdapterOptions = {},
): IReferenceHttpAdapter {
  const platform = adapter.getType();

  if (platform === 'express') return new ExpressReferenceAdapter(adapter, admission, options);
  if (platform === 'fastify') return new FastifyReferenceAdapter(adapter, admission, options);

  throw new ConfigError(
    `OPENREF supports the ${SUPPORTED_PLATFORMS.join(' and ')} adapters; this application runs on "${platform}"`,
    ErrorCode.CONFIG_INVALID_OPTIONS,
    undefined,
    { platform },
  );
}

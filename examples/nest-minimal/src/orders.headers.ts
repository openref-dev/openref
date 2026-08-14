import { Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CanActivate, CustomDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The application side of the required headers fact: a key, the decorator, and the guard that
 * enforces it.
 *
 * THE REFERENCE WILL SHOW THE NAMES AT `inferred`, NOT `derived`, and this file is arranged so
 * the reason is visible: the list below is metadata under a known key, but "the route refuses
 * a request without these headers" is a conclusion about what {@link HeaderGuard} decides, and
 * guard logic is never read, per SPEC 6.1. The metadata and the enforcement sit three lines
 * apart here and agree; in an application where they do not, the reference has no way to know,
 * which is exactly what `inferred` is for.
 *
 * THE GUARD CHECKS PRESENCE AND NOT VALUE, the `GRANTED` shape of `orders.security.ts`: a real
 * application would verify the token, and inventing a token scheme to make the example look
 * serious would be inventing application surface. Absence answers 401, which is also the
 * contract SPEC 6.4 already derives from a guard standing on the route.
 */

/** The key this application writes its required header names under. */
export const REQUIRED_HEADERS_KEY = 'openref.example.requiredHeaders';

/**
 * Declares the headers a route refuses to run without.
 *
 * @param names - Header names, as the document spells them
 * @returns The decorator, which writes the list under {@link REQUIRED_HEADERS_KEY}
 */
export function RequiresHeaders(...names: string[]): CustomDecorator {
  return SetMetadata(REQUIRED_HEADERS_KEY, names);
}

/**
 * Refuses a request that is missing a declared header.
 *
 * A METHOD'S LIST REPLACES A CLASS'S, which is why this is `getAllAndOverride`, the scopes
 * rule: a route restating its required headers restates them. `headersCollector` reads the
 * same key the same way.
 */
@Injectable()
export class HeaderGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Decides whether the request may proceed.
   *
   * @param context - The execution context NestJS hands every guard
   * @returns True when every declared header is present
   */
  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(REQUIRED_HEADERS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;

    const headers = context.switchToHttp().getRequest<{
      headers?: Record<string, unknown>;
    }>().headers;

    const missing = required.filter((name) => typeof headers?.[name.toLowerCase()] !== 'string');
    if (missing.length === 0) return true;

    throw new UnauthorizedException(
      `the request is missing the required header(s): ${missing.join(', ')}`,
    );
  }
}

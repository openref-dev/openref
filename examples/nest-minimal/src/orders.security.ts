import { Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { CanActivate, CustomDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The application side of SPEC 6: a guard, a metadata key, and the decorator that writes it.
 *
 * IT IS THE APPLICATION'S KEY AND NOT THE PACKAGE'S, which is the whole reason this file exists
 * in the example rather than in `@openref/nest`. SPEC 6.1 forbids guessing a key, so a consumer
 * hands one over, and the only way to show that the handing over works is to have an application
 * that has one of its own. `scopesCollector({ metadataKey: SCOPES_KEY })` in `app.module.ts` is
 * the other half of the pair.
 *
 * WHAT THE REFERENCE WILL SHOW, AND WHAT IT WILL NEVER SHOW. It shows `ScopesGuard` by name, at
 * `derived`, because the class standing in front of a route is a property of the route. It shows
 * `['orders:read']`, at `derived`, because that is a declarative value under a key somebody named.
 * It will never show `GRANTED` below, because deciding what a guard decides means running it
 * against a request, and a route does not have one. That is SPEC 6.1's first prohibition, and this
 * file is deliberately arranged so the difference is visible: the list the collector reads and the
 * set the guard checks it against are two different things, three lines apart.
 */

/** The key this application writes its scopes under. There is no default and none is guessed. */
export const SCOPES_KEY = 'openref.example.scopes';

/**
 * Declares which scopes a route needs.
 *
 * @param scopes - Scope names, as the guard and the reference both spell them
 * @returns The decorator, which writes the list under {@link SCOPES_KEY}
 */
export function Scopes(...scopes: string[]): CustomDecorator {
  return SetMetadata(SCOPES_KEY, scopes);
}

/**
 * What this example's caller is allowed to do.
 *
 * EVERY SCOPE, BECAUSE A DEMO WHOSE SEND BUTTON RETURNS 403 IS WORSE THAN NO DEMO. A real
 * application reads a token here. This one does not have one, and inventing an authentication
 * scheme to make the example look serious would be inventing application surface.
 */
const GRANTED: ReadonlySet<string> = new Set(['orders:read', 'orders:write']);

/**
 * Enforces the scopes a route declared.
 *
 * A METHOD'S SCOPES REPLACE A CLASS'S, which is why this is `getAllAndOverride` and not two reads:
 * a route needing `orders:write` inside a controller marked `orders:read` needs `orders:write`, not
 * both. `scopesCollector` reads the same key the same way, so what the reference reports is what
 * this guard receives rather than an approximation of it.
 */
@Injectable()
export class ScopesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  /**
   * Decides whether the request may proceed.
   *
   * @param context - The execution context NestJS hands every guard
   * @returns True when every declared scope has been granted
   */
  canActivate(context: ExecutionContext): boolean {
    // `string[] | undefined` RATHER THAN `string[]`, WHICH IS THE TYPE `Reflector` DECLARES. A
    // route that declared nothing has nothing under the key, so the honest type is the optional
    // one, and taking the declared type at face value would put an unchecked `.every` on it.
    const required =
      this.reflector.getAllAndOverride<string[] | undefined>(SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    return required.every((scope) => GRANTED.has(scope));
  }
}

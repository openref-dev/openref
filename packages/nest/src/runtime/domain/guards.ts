/**
 * Reading the guards on a route, which is the whole of what a guard is willing to tell anyone.
 *
 * ONLY THE CLASS NAME, AND THAT IS THE CEILING RATHER THAN A FIRST VERSION. SPEC 6.1 forbids
 * understanding a guard's code without qualification, and the reason is not that it is hard: a
 * guard is a function of the request, so what it will decide is not a property of the route at all.
 * The name is a fact about the route and the decision is not, so the name is what is read.
 *
 * BOTH LEVELS ARE READ AND NEITHER OVERRIDES THE OTHER. NestJS applies a controller's guards and
 * then a handler's, so a route with `@UseGuards(AuthGuard)` on the class and `@UseGuards(AdminGuard)`
 * on the method is protected by both. `getAllAndOverride` would report one of them and would be the
 * natural reach, since that is what the metadata collectors use; it is wrong here for the same
 * reason it is right there. A decorator that shadows another is an override; a decorator that adds
 * to another is not.
 *
 * AND A THIRD SCOPE ARRIVED IN TX-GLOBALGUARD: a provider under `APP_GUARD` protects every route
 * of the application and is declared on none of them, so it is read from the container rather than
 * off a target. {@link readGlobalGuards} is that reading, and SPEC 6.2.1 is where it is decided.
 *
 * SHARED BECAUSE THREE COLLECTORS NEED IT AND ONE OF THEM IS NOT ABOUT GUARDS.
 * `scopesCollector` and `rolesCollector` ask whether a route is guarded so that they can tell
 * "there is no policy here" from "there is a policy here and it is not readable", which is the
 * distinction SPEC 6.2.1 requires them to report.
 */

import {
  isEnhancerToken,
  NEST_ENHANCER_TOKENS,
  NEST_GUARD_ENHANCER_SUBTYPE,
  NEST_GUARD_METADATA,
  type DiscoveryServiceLike,
  type InstanceWrapperLike,
  type ReflectorLike,
} from '../../shared/types/nest-surface';

/** What was found at one scope, and what could not be named. */
export interface GuardReading {
  /** Class names in the order NestJS runs them, controller before handler, without duplicates. */
  readonly names: readonly string[];
  /**
   * How many guards were present and could not be named.
   *
   * AN ANONYMOUS GUARD IS A GUARD, and dropping it silently would make a protected route look
   * unprotected. It is counted rather than named, so a reader is told that something is there.
   */
  readonly anonymous: number;
}

/**
 * Reads the guards declared on a controller and on its handler.
 *
 * @param reflector - Nest's reflector, narrowed
 * @param controller - The controller class the route was registered as
 * @param handler - The route handler
 * @returns The class names in execution order, and the count of unnameable ones
 */
export function readGuards(
  reflector: ReflectorLike,
  controller: unknown,
  handler: unknown,
): GuardReading {
  const names: string[] = [];
  const seen = new Set<string>();
  let anonymous = 0;

  for (const target of [controller, handler]) {
    for (const entry of asArray(reflector.get(NEST_GUARD_METADATA, target))) {
      const name = guardName(entry);

      if (name === undefined) {
        anonymous += 1;
        continue;
      }

      // A GUARD DECLARED AT BOTH LEVELS IS ONE GUARD, not two. NestJS instantiates it once per
      // level, but a reader of the reference is being told what protects the route, and the same
      // name twice reads as two protections.
      if (seen.has(name)) continue;
      seen.add(name);
      names.push(name);
    }
  }

  return { names, anonymous };
}

/**
 * Reads the guards registered for the whole application, per SPEC 6.2.1.
 *
 * READ ONCE FOR THE APPLICATION AND NOT ONCE PER ROUTE. A global guard is one registration, and
 * walking every provider of every module for each of a thousand nodes would put the container on
 * the hot path of the pass for an answer that cannot change between two nodes.
 *
 * THE CONTAINER IS ASKED, NOT `ApplicationConfig`, AND THAT IS THE DETERMINISM RULE RATHER THAN A
 * PREFERENCE. `ApplicationConfig` holds the same guards plus whatever `app.useGlobalGuards`
 * appended, and that list is still mutable when `setup` runs: a host calling `useGlobalGuards`
 * after `setup` would document one thing and a host calling it before would document another,
 * from the same application. Documentation that changes when two lines of `main.ts` swap places
 * is not a fact about the application, so `app.useGlobalGuards` stays unread and SPEC 6.2.1 says
 * so out loud rather than leaving the gap to be met.
 *
 * WHAT THIS STILL DOES NOT SEE, NAMED RATHER THAN LEFT TO BE DISCOVERED: a provider under
 * `APP_GUARD` declared `REQUEST` or `TRANSIENT` scoped goes into the module's `injectables`, and
 * `DiscoveryService` enumerates providers only. Measured on NestJS 11, 2026-08-12, and pinned by
 * a case in `nest-value-surface.spec.ts` so the day it changes is the day SPEC is corrected.
 *
 * @param discovery - Nest's `DiscoveryService`
 * @returns The class names in registration order, and the count of unnameable ones
 */
export function readGlobalGuards(discovery: DiscoveryServiceLike): GuardReading {
  const names: string[] = [];
  const seen = new Set<string>();
  let anonymous = 0;

  for (const wrapper of discovery.getProviders()) {
    if (!isGlobalGuard(wrapper)) continue;

    // THE INSTANCE NAMES THE GUARD AND `metatype` IS THE FALLBACK, in that order, and the other
    // order was written first and was wrong. Under `useFactory` the `metatype` is the factory,
    // whose `name` is whatever property the function was written on, so reading it first named a
    // guard `useFactory` on every route of the application. The instance is the guard itself under
    // all three of `useClass`, `useFactory` and `useValue`, and it is always there by the time the
    // container can be walked, because the scanner had to have it to register the guard at all.
    const name = guardName(wrapper.instance) ?? guardName(wrapper.metatype);

    if (name === undefined) {
      anonymous += 1;
      continue;
    }

    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }

  return { names, anonymous };
}

/**
 * Reports whether one provider was registered as an application wide guard.
 *
 * EITHER SIGNAL IS ENOUGH, per the note on `NEST_GUARD_ENHANCER_SUBTYPE`. `subtype` is the
 * framework's own answer and the token prefix is the shape a host wrote, and a reading that
 * required both would go quiet on a globally guarded application the first time one of them moved.
 *
 * @param wrapper - One provider as `DiscoveryService` reported it
 * @returns True when it is a guard registered under `APP_GUARD`
 */
function isGlobalGuard(wrapper: InstanceWrapperLike): boolean {
  return (
    wrapper.subtype === NEST_GUARD_ENHANCER_SUBTYPE ||
    isEnhancerToken(wrapper.token, NEST_ENHANCER_TOKENS.guard)
  );
}

/**
 * Narrows whatever was under the metadata key to a list.
 *
 * The key holds an array in every NestJS version this package supports, and it is still checked:
 * the value is whatever somebody put there, per the note on `ReflectorLike`.
 *
 * @param value - Whatever the reflector returned
 * @returns The entries, or an empty list
 */
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Names one guard, whether it was registered as a class or as an instance.
 *
 * `@UseGuards(AuthGuard)` stores the class and `@UseGuards(new AuthGuard())` stores the instance,
 * and both are ordinary usage, so both are read.
 *
 * A PLAIN OBJECT IS UNNAMEABLE AND IS NOT CALLED `Object`. `{ canActivate: () => true }` is a
 * legal guard and its constructor is `Object`, so reading the constructor's name would put a row
 * saying `Object` in front of a reader and count it as a named guard. It is refused by identity
 * rather than by comparing the name, so a class a host happened to call `Object` is still read.
 *
 * @param entry - One entry from the metadata, or a provider's class or instance
 * @returns The class name, or undefined when it has none to give
 */
function guardName(entry: unknown): string | undefined {
  if (typeof entry === 'function') return entry.name === '' ? undefined : entry.name;

  if (typeof entry === 'object' && entry !== null) {
    const constructor: unknown = (entry as { constructor?: unknown }).constructor;

    if (constructor === Object) return undefined;
    if (typeof constructor === 'function' && constructor.name !== '') return constructor.name;
  }

  return undefined;
}

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
 * SHARED BECAUSE THREE COLLECTORS NEED IT AND ONE OF THEM IS NOT ABOUT GUARDS.
 * `scopesCollector` and `rolesCollector` ask whether a route is guarded so that they can tell
 * "there is no policy here" from "there is a policy here and it is not readable", which is the
 * distinction SPEC 6.2.1 requires them to report.
 */

import { NEST_GUARD_METADATA, type ReflectorLike } from '../../shared/types/nest-surface';

/** What was found on a route, and what could not be named. */
export interface GuardReading {
  /** Class names, controller level first, in the order NestJS runs them, without duplicates. */
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
 * @param entry - One entry from the metadata
 * @returns The class name, or undefined when it has none to give
 */
function guardName(entry: unknown): string | undefined {
  if (typeof entry === 'function') return entry.name === '' ? undefined : entry.name;

  if (typeof entry === 'object' && entry !== null) {
    const constructor: unknown = (entry as { constructor?: unknown }).constructor;

    if (typeof constructor === 'function' && constructor.name !== '') return constructor.name;
  }

  return undefined;
}

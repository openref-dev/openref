/**
 * Turning what a host wrote into the admission a mount runs, and refusing what cannot be honoured.
 *
 * EVERYTHING HERE HAPPENS ONCE, AT MOUNT, AND NEVER PER REQUEST. Resolving a guard out of the
 * container on every hit would be the same denial of service the runtime pass is forbidden to be,
 * and it would move a misconfiguration from the boot log to the first reader. So the container is
 * asked while the application is still starting, and a guard that cannot be resolved stops the
 * boot with a sentence naming it.
 *
 * FAIL CLOSED IS THE POLICY ON EVERY BRANCH, per STANDARDS 8 and SPEC 19.6. A visibility other than
 * `public` with no guard is refused; a guard the container does not know is refused; a value that
 * is neither an instance nor a class is refused. None of these is a warning, because the state each
 * one describes is a host that believes the reference is closed while it is open, and a warning is
 * something a boot log carries past.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import { RouteAdmission } from '../../domain/admission';
import { DEFAULT_VISIBILITY, VISIBILITIES } from '../../domain/visibility';
import { isCanActivateLike } from '../../../shared/types/nest-surface';
import type { OpenRefVisibilityOptions } from '../../domain/visibility';
import type { CanActivateLike, GuardLike } from '../../../shared/types/nest-surface';
import type { ErrorReporter } from '../../../http/domain/reply';

/**
 * How a guard class is turned into the instance that runs.
 *
 * TAKEN AS A FUNCTION BECAUSE THE TWO ENTRY POINTS ASK DIFFERENT OBJECTS. `forRoot` holds a
 * `ModuleRef`, `setup` holds the application, and both answer the same question; a resolver that
 * throws or returns nothing is the same "not registered" either way.
 */
export type GuardResolver = (token: unknown) => unknown;

/**
 * Reads the guards a host declared, as a list.
 *
 * @param guard - One guard, several, or none
 * @returns The list, empty when the host declared none
 * @throws {InvalidOptionsError} When an empty list was passed, which reads as guarded
 */
function guardList(guard: OpenRefVisibilityOptions['guard']): readonly GuardLike[] {
  if (guard === undefined) return [];
  if (!Array.isArray(guard)) return [guard as GuardLike];

  const list = guard as readonly GuardLike[];
  if (list.length === 0) {
    throw invalid(
      'guard was given as an empty list, which reads as protected and protects nothing. Leave ' +
        'the option out to say there is no guard',
    );
  }

  return list;
}

/**
 * Checks the visibility and guard pair before anything is mounted from it.
 *
 * @param subject - How this mount is named in an error, such as the document id or the route
 * @param options - Whatever the host wrote
 * @throws {InvalidOptionsError} When the pair cannot be honoured as written
 */
export function assertVisibility(subject: string, options: OpenRefVisibilityOptions): void {
  const visibility = options.visibility ?? DEFAULT_VISIBILITY;

  if (!VISIBILITIES.includes(visibility)) {
    throw invalid(
      `${subject} asks for visibility "${visibility}", which is not one of ` +
        `${VISIBILITIES.join(', ')}. It is refused rather than read as non public, because a ` +
        'misspelled audience must not decide who may read the reference',
    );
  }

  const guards = guardList(options.guard);

  if (visibility !== 'public' && guards.length === 0) {
    throw invalid(
      `${subject} asks for visibility "${visibility}" and supplies no guard, so every route of ` +
        'SPEC 13.3 would be served to anyone who asks while the host believed the reference was ' +
        'private. Pass guard, per SPEC 13.2 and 19.6',
    );
  }
}

/**
 * Builds the admission one mount runs, resolving the host's guards.
 *
 * A GUARD IS RUN WHENEVER ONE IS SUPPLIED, WHATEVER THE VISIBILITY SAYS. A host that writes a guard
 * on a reference it also called public has asked for the guard, and quietly dropping it would be a
 * security option accepted and ignored, which is the defect the refusal of a bare `internal` exists
 * to prevent, written the other way round.
 *
 * @param subject - How this mount is named in an error
 * @param options - Whatever the host wrote
 * @param resolve - How a guard class is resolved out of the container
 * @param onError - Where a guard's own failure is reported
 * @returns The admission every route of this mount runs
 * @throws {InvalidOptionsError} When the pair cannot be honoured, or a guard cannot be resolved
 */
export function admissionFor(
  subject: string,
  options: OpenRefVisibilityOptions,
  resolve: GuardResolver,
  onError?: ErrorReporter,
): RouteAdmission {
  assertVisibility(subject, options);

  const declared = guardList(options.guard);
  if (declared.length === 0) return RouteAdmission.open();

  return RouteAdmission.behind(
    declared.map((guard) => resolveGuard(subject, guard, resolve)),
    onError,
  );
}

/**
 * One guard, as the instance that will run.
 *
 * @param subject - How this mount is named in an error
 * @param guard - The class or instance the host wrote
 * @param resolve - How a class is resolved out of the container
 * @returns The instance
 * @throws {InvalidOptionsError} When it is neither, or the container does not know the class
 */
function resolveGuard(subject: string, guard: GuardLike, resolve: GuardResolver): CanActivateLike {
  if (isCanActivateLike(guard)) return guard;

  if (typeof guard !== 'function') {
    throw invalid(
      `${subject} was given a guard that is neither a class nor an object with canActivate. ` +
        'SPEC 13.2 writes the class, and an instance is accepted for a guard that needs no ' +
        'container',
    );
  }

  const name = guard.name === '' ? 'an anonymous class' : guard.name;
  let resolved: unknown;

  try {
    resolved = resolve(guard);
  } catch (cause: unknown) {
    throw invalid(
      `${subject} names the guard ${name}, and the container could not resolve it. Register it ` +
        'as a provider of a module the reference can see, or pass an instance. It is not ' +
        'constructed here, because a guard built with unresolved dependencies decides nothing ' +
        'reliable and an unreliable decision on this question means open',
      cause instanceof Error ? cause : undefined,
    );
  }

  if (!isCanActivateLike(resolved)) {
    throw invalid(
      `${subject} names the guard ${name}, and what the container resolved has no canActivate ` +
        'method, so nothing would run in front of the routes',
    );
  }

  return resolved;
}

/**
 * The error every refusal above raises.
 *
 * @param message - What is wrong, phrased for whoever wrote the options
 * @param cause - What the container threw, when that is what happened
 * @returns The error to throw
 */
function invalid(message: string, cause?: Error): InvalidOptionsError {
  return new InvalidOptionsError(message, ErrorCode.CONFIG_INVALID_OPTIONS, cause);
}

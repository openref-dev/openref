/**
 * The decision SPEC 19.6 puts in front of every reference route, as a type nobody can forge.
 *
 * THE CLASS IS NOMINAL ON PURPOSE, AND THAT IS THE WHOLE MECHANISM. The constructor is private, so
 * the only two values of this type that can exist anywhere are the ones {@link RouteAdmission.open}
 * and {@link RouteAdmission.behind} return. Both platform adapters take one positionally and
 * neither can be built without it, so every route those adapters register passes through a
 * decision, and a route added to the table in a later milestone is behind the host's guard by
 * construction rather than because whoever added it remembered. That is the standing rule about
 * encoding a separation in the type: the wrong version does not compile.
 *
 * WHAT IT IS NOT. It is not a policy of this package. `open()` admits everything and is what a
 * public reference mounts with, which is SPEC 13.1's one line unchanged; `behind()` runs guards the
 * host wrote and this package neither reads nor second guesses them, per CLAUDE.md's rule that
 * arbitrary guard logic is unreadable. The only opinion here is what an answer other than `true`
 * means, and SPEC 19.6 fixes that as a refusal.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import { failureReply, NO_STORE, textReply, type ErrorReporter } from '../../http/domain/reply';
import { referenceRouteHandler, synthesizeExecutionContext } from './execution-context';
import { isHttpExceptionLike, type CanActivateLike } from '../../shared/types/nest-surface';
import type { ReferenceReply } from '../../http/application/ports/reference-http.port';

/** Status of a refusal a guard did not give a status of its own. */
export const REFUSED_STATUS = 403;

/**
 * What a refused request is told.
 *
 * IT SAYS NOTHING ABOUT WHY, for the reason {@link failureReply} says nothing about its cause: the
 * refusal is read by whoever was refused, and "no bearer token" and "not in the admin group" are
 * two facts about the deployment that a reader who is not entitled to the reference is not
 * entitled to either.
 */
export const REFUSED_BODY = 'This API reference is not available to this request.';

/** The gate one registered route runs before it answers. */
export type RouteGate = (request: unknown, reply: unknown) => Promise<ReferenceReply | undefined>;

/** What a guard's `canActivate` may hand back besides a value or a promise. */
interface ObservableLike {
  subscribe(observer: {
    next: (value: unknown) => void;
    error: (cause: unknown) => void;
    complete: () => void;
  }): unknown;
}

/**
 * Reports whether a value is an observable rather than a value or a promise.
 *
 * @param value - Whatever `canActivate` returned
 * @returns True when it can be subscribed to
 */
function isObservableLike(value: unknown): value is ObservableLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'subscribe' in value &&
    typeof value.subscribe === 'function'
  );
}

/**
 * The last value an observable emits, as a promise.
 *
 * AN OBSERVABLE THAT COMPLETES WITHOUT EMITTING RESOLVES TO `undefined` RATHER THAN REJECTING, and
 * the difference is which failure the caller sees. Rejecting would present a guard that decided
 * nothing as a server fault; resolving hands `undefined` to the one place that already knows what
 * "not exactly true" means, which refuses and reports the out of contract answer.
 *
 * @param source - The observable a guard returned
 * @returns Its last value, or undefined when it emitted none
 */
async function lastValueOf(source: ObservableLike): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    let last: unknown;

    source.subscribe({
      next: (value: unknown) => {
        last = value;
      },
      error: (cause: unknown) => {
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
      complete: () => {
        resolve(last);
      },
    });
  });
}

/**
 * Settles whatever `canActivate` returned into one value.
 *
 * @param returned - The value, promise or observable a guard handed back
 * @returns What it decided
 */
async function settle(returned: unknown): Promise<unknown> {
  if (isObservableLike(returned)) return lastValueOf(returned);

  return returned;
}

/** The decision that runs before a reference route answers, per SPEC 19.6. */
export class RouteAdmission {
  /**
   * @param guards - The host's guards, in the order they run. Empty means everything is admitted
   * @param onError - Where a guard's own failure is reported
   */
  private constructor(
    private readonly guards: readonly CanActivateLike[],
    private readonly onError: ErrorReporter | undefined,
  ) {}

  /**
   * The admission a public reference mounts with.
   *
   * NAMED RATHER THAN DEFAULTED. Serving a documentation route to everyone is the ordinary case and
   * has to stay one call away, and it is still a sentence somebody wrote: an adapter built with no
   * admission at all does not compile, so "public" is a decision at every mount rather than the
   * state a mount arrives in when nobody thought about it.
   *
   * @returns An admission that refuses nothing
   */
  static open(): RouteAdmission {
    return new RouteAdmission([], undefined);
  }

  /**
   * The admission a reference behind the host's guards mounts with.
   *
   * @param guards - Resolved guard instances, run in order, all of which must admit
   * @param onError - Where a guard's own failure is reported
   * @returns An admission that runs them
   * @throws {InvalidOptionsError} When the list is empty, which reads as guarded and is not
   */
  static behind(guards: readonly CanActivateLike[], onError?: ErrorReporter): RouteAdmission {
    if (guards.length === 0) {
      throw new InvalidOptionsError(
        'a guarded reference was asked for with no guards to run, which would serve the ' +
          'reference to everyone while reading as protected. Use RouteAdmission.open() to say ' +
          'that out loud instead',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    return new RouteAdmission(guards, onError);
  }

  /** Whether anything is actually run, which is what a mount reports about itself. */
  get guarded(): boolean {
    return this.guards.length > 0;
  }

  /**
   * The gate for one registered route.
   *
   * CALLED ONCE PER REGISTRATION AND NOT PER REQUEST, because the synthetic handler it closes over
   * is identity: a guard that reads metadata off `context.getHandler()`, or caches by it, has to
   * meet the same object on every request to the same route.
   *
   * @param method - How the route is reached, for the name a guard sees
   * @param pattern - The registered path pattern
   * @returns The gate to run before that route answers
   */
  at(method: string, pattern: string): RouteGate {
    const handler = referenceRouteHandler({ id: `${method} ${pattern}`, pattern });

    return async (request: unknown, reply: unknown): Promise<ReferenceReply | undefined> =>
      this.decide(handler, request, reply);
  }

  /**
   * Runs the guards for one request.
   *
   * @param handler - The synthetic handler this route reports
   * @param request - The framework's own request
   * @param reply - The framework's own reply
   * @returns The refusal to send instead, or undefined when the route may answer
   */
  private async decide(
    handler: () => void,
    request: unknown,
    reply: unknown,
  ): Promise<ReferenceReply | undefined> {
    if (this.guards.length === 0) return undefined;

    const context = synthesizeExecutionContext(request, reply, handler);

    for (const guard of this.guards) {
      let decided: unknown;

      try {
        decided = await settle(guard.canActivate(context));
      } catch (cause: unknown) {
        return this.refusal(cause);
      }

      if (decided === true) continue;

      // `false` is the contract's own refusal and says everything. Anything else is a guard that
      // did not answer the question it was asked, and it is refused AND reported: a guard whose
      // return value nobody can read is indistinguishable, from outside, from one that works.
      if (decided !== false) {
        this.onError?.(
          new Error(
            'a guard on the API reference returned something other than true or false, so the ' +
              'request was refused. SPEC 19.6 admits exactly true',
          ),
        );
      }

      return textReply(REFUSED_STATUS, REFUSED_BODY, NO_STORE);
    }

    return undefined;
  }

  /**
   * The reply for a guard that threw.
   *
   * THE STATUS COMES FROM THE EXCEPTION WHERE THE EXCEPTION HAS ONE, which is how a guard throwing
   * `UnauthorizedException` still produces a 401 on a route NestJS never saw and no exception
   * filter ever reaches. Anything else is a fault rather than a refusal: it goes to `onError` and
   * answers 500, because a guard that crashed decided nothing and must not read as a decision.
   *
   * @param cause - What the guard threw
   * @returns The reply to send
   */
  private refusal(cause: unknown): ReferenceReply {
    if (isHttpExceptionLike(cause)) {
      const status = cause.getStatus();

      if (Number.isInteger(status) && status >= 400 && status <= 599) {
        return textReply(status, REFUSED_BODY, NO_STORE);
      }
    }

    this.onError?.(cause);

    return failureReply();
  }
}

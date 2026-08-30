import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { replyText } from '../../src/http/domain/reply';
import { InvalidOptionsError } from '@openref/core';
import {
  REFUSED_BODY,
  REFUSED_STATUS,
  RouteAdmission,
} from '../../src/visibility/domain/admission';
import {
  OpenRefReferenceRoute,
  referenceRouteHandler,
  synthesizeExecutionContext,
} from '../../src/visibility/domain/execution-context';
import type { CanActivateLike, ExecutionContextLike } from '../../src/shared/types/nest-surface';
import type { ReferenceReply } from '../../src/http/application/ports/reference-http.port';

/**
 * The admission of SPEC 19.6, which is the whole of what stands between a reader and a reference
 * whose visibility is not public.
 *
 * WHY IT IS TESTED AWAY FROM A SERVER AS WELL AS ON ONE. The integration suite beside this one
 * boots real NestJS applications on both adapters and drives every route of the table, which is
 * the only place the wiring can be proved. What it cannot reach is the shape of a guard's answer:
 * an observable that completes without emitting, an exception carrying a status of 302, a guard
 * that returns the string "yes". Those are decisions this file pins one at a time, and every one of
 * them is a refusal.
 */

/** A guard that answers with whatever it was built with. */
function guardAnswering(answer: unknown): CanActivateLike {
  return { canActivate: () => answer };
}

/** A guard that throws whatever it was built with. */
function guardThrowing(cause: unknown): CanActivateLike {
  return {
    canActivate: () => {
      throw cause;
    },
  };
}

/** The minimum of an rxjs observable a guard may hand back. */
function observableOf(values: readonly unknown[], failure?: unknown): { subscribe: unknown } {
  return {
    subscribe: (observer: {
      next: (value: unknown) => void;
      error: (cause: unknown) => void;
      complete: () => void;
    }): void => {
      for (const value of values) observer.next(value);
      if (failure === undefined) observer.complete();
      else observer.error(failure);
    },
  };
}

/**
 * Runs one admission for one request.
 *
 * @param admission - What to run
 * @param request - The request object a guard will be shown
 * @returns The refusal, or undefined when the route may answer
 */
async function run(
  admission: RouteAdmission,
  request: unknown = { headers: {} },
): Promise<ReferenceReply | undefined> {
  return admission.at('get', '/docs')(request, {});
}

describe('RouteAdmission.open', () => {
  it('should admit, and say of itself that it guards nothing', async () => {
    // Given, SPEC 13.1's one line: a public reference is the ordinary case and refuses nobody
    const admission = RouteAdmission.open();

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal).toBeUndefined();
    expect(admission.guarded).toBe(false);
  });
});

describe('RouteAdmission.behind', () => {
  it('should refuse to be built with no guards at all, since that reads as protected', () => {
    // Given
    const act = (): RouteAdmission => RouteAdmission.behind([]);

    // Then
    expect(act).toThrow(InvalidOptionsError);
    expect(act).toThrow(/no guards to run/);
  });

  it('should admit a request the guard answered true for', async () => {
    // Given
    const admission = RouteAdmission.behind([guardAnswering(true)]);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal).toBeUndefined();
    expect(admission.guarded).toBe(true);
  });

  it('should refuse a request the guard answered false for, saying nothing about why', async () => {
    // Given
    const admission = RouteAdmission.behind([guardAnswering(false)]);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal?.status).toBe(REFUSED_STATUS);
    expect(refusal?.body).toBe(REFUSED_BODY);
    expect(refusal?.headers['cache-control']).toBe('no-store');
  });

  it('should await a promise the guard returned', async () => {
    // Given
    const admitted = RouteAdmission.behind([guardAnswering(Promise.resolve(true))]);
    const refused = RouteAdmission.behind([guardAnswering(Promise.resolve(false))]);

    // When
    const results = [await run(admitted), await run(refused)];

    // Then
    expect(results[0]).toBeUndefined();
    expect(results[1]?.status).toBe(REFUSED_STATUS);
  });

  it('should read the last value of an observable the guard returned', async () => {
    // Given, rxjs is what NestJS declares and what this package must never depend on, so the
    // observable is read through `subscribe` alone
    const admitted = RouteAdmission.behind([guardAnswering(observableOf([true]))]);
    const refused = RouteAdmission.behind([guardAnswering(observableOf([true, false]))]);

    // When
    const results = [await run(admitted), await run(refused)];

    // Then
    expect(results[0]).toBeUndefined();
    expect(results[1]?.status).toBe(REFUSED_STATUS);
  });

  it('should refuse and report an observable that completed without deciding', async () => {
    // Given
    const onError = vi.fn();
    const admission = RouteAdmission.behind([guardAnswering(observableOf([]))], onError);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal?.status).toBe(REFUSED_STATUS);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('should treat an observable that errored as a guard that threw', async () => {
    // Given
    const onError = vi.fn();
    const admission = RouteAdmission.behind(
      [guardAnswering(observableOf([], new Error('the token service is down')))],
      onError,
    );

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal).toBeDefined();
    expect(refusal?.status).toBe(500);
    expect(refusal === undefined ? '' : replyText(refusal)).not.toContain('token service');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('should refuse and report anything that is not exactly true or false', async () => {
    // Given, NestJS admits any truthy value and SPEC 19.6 admits one: a guard whose answer nobody
    // can read is indistinguishable from a working guard, and the readable direction is closed
    const onError = vi.fn();
    const answers: readonly unknown[] = ['yes', 1, {}, undefined, null];

    // When
    const statuses = await Promise.all(
      answers.map(
        async (answer) =>
          (await run(RouteAdmission.behind([guardAnswering(answer)], onError)))?.status,
      ),
    );

    // Then
    expect(statuses).toEqual(answers.map(() => REFUSED_STATUS));
    expect(onError).toHaveBeenCalledTimes(answers.length);
  });

  it('should not report a plain false, which is the contract answering the question', async () => {
    // Given
    const onError = vi.fn();
    const admission = RouteAdmission.behind([guardAnswering(false)], onError);

    // When
    await run(admission);

    // Then
    expect(onError).not.toHaveBeenCalled();
  });

  it('should take the status off an exception that carries one, so 401 stays 401', async () => {
    // Given, no exception filter reaches these routes: NestJS never sees them, so the mapping
    // `UnauthorizedException` normally gets has to happen here or not at all
    const unauthorized = { getStatus: (): number => 401 };
    const admission = RouteAdmission.behind([guardThrowing(unauthorized)]);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal?.status).toBe(401);
    expect(refusal?.body).toBe(REFUSED_BODY);
  });

  it('should refuse to read a status outside the failure range as a refusal', async () => {
    // Given, a guard throwing a redirect decided nothing this route can honour
    const onError = vi.fn();
    const admission = RouteAdmission.behind([guardThrowing({ getStatus: () => 302 })], onError);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal?.status).toBe(500);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('should answer 500 for a guard that crashed, and leak nothing about the cause', async () => {
    // Given
    const onError = vi.fn();
    const admission = RouteAdmission.behind(
      [guardThrowing(new Error('connect ECONNREFUSED 10.0.0.7:5432'))],
      onError,
    );

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal).toBeDefined();
    expect(refusal?.status).toBe(500);
    expect(refusal === undefined ? '' : replyText(refusal)).not.toContain('10.0.0.7');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('should run guards in order and stop at the first refusal', async () => {
    // Given, a list is a conjunction, exactly as `@UseGuards` is
    const second = vi.fn(() => true);
    const admission = RouteAdmission.behind([guardAnswering(false), { canActivate: second }]);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal?.status).toBe(REFUSED_STATUS);
    expect(second).not.toHaveBeenCalled();
  });

  it('should require every guard of a list to admit', async () => {
    // Given
    const admission = RouteAdmission.behind([guardAnswering(true), guardAnswering(false)]);

    // When
    const refusal = await run(admission);

    // Then
    expect(refusal?.status).toBe(REFUSED_STATUS);
  });
});

describe('the execution context a reference route synthesizes', () => {
  it('should hand the guard the framework request and reply it was given', async () => {
    // Given
    const request = { headers: { authorization: 'Bearer abc' } };
    const reply = { locals: {} };
    const seen: ExecutionContextLike[] = [];
    const admission = RouteAdmission.behind([
      {
        canActivate: (context) => {
          seen.push(context);
          return true;
        },
      },
    ]);

    // When
    await admission.at('get', '/docs')(request, reply);

    // Then
    expect(seen[0]?.getType()).toBe('http');
    expect(seen[0]?.switchToHttp().getRequest()).toBe(request);
    expect(seen[0]?.switchToHttp().getResponse()).toBe(reply);
    expect(seen[0]?.getArgs()).toEqual([request, reply, undefined]);
    expect(seen[0]?.getArgByIndex(0)).toBe(request);
  });

  it('should carry a class and a handler that exist and hold no metadata', () => {
    // Given, the commonest guard in the NestJS world reads an `@Public()` key off these two and
    // returns true when it finds one, so what is asserted here is presence first and emptiness
    // second: a synthetic target carrying anything would be an exemption granted by this package
    const handler = referenceRouteHandler({ id: 'get /docs', pattern: '/docs' });
    const context = synthesizeExecutionContext({}, {}, handler);

    // When
    const found = [
      Reflect.getMetadataKeys(context.getClass() as object),
      Reflect.getMetadataKeys(context.getHandler() as object),
    ];

    // Then
    expect(context.getClass()).toBe(OpenRefReferenceRoute);
    expect(typeof context.getHandler()).toBe('function');
    expect(found).toEqual([[], []]);
  });

  it('should show one route the same handler on every request, and two routes two', async () => {
    // Given, a guard that caches by handler identity has to meet the same object every time
    const seen: unknown[] = [];
    const admission = RouteAdmission.behind([
      {
        canActivate: (context) => {
          seen.push(context.getHandler());
          return true;
        },
      },
    ]);
    const overview = admission.at('get', '/docs');
    const proxy = admission.at('post', '/docs/_proxy');

    // When
    await overview({}, {});
    await overview({}, {});
    await proxy({}, {});

    // Then
    expect(seen[0]).toBe(seen[1]);
    expect(seen[2]).not.toBe(seen[0]);
  });

  it('should name the handler after the route, so a log says which one was refused', () => {
    // Given
    const handler = referenceRouteHandler({ id: 'get /docs/health', pattern: '/docs/health' });

    // Then
    expect(handler.name).toBe('openref:get /docs/health');
  });

  it('should answer the other two transports the way the framework answers them', () => {
    // Given, `ExecutionContextHost` does not refuse `switchToRpc` on an http request, it wraps
    // the same argument list, and a guard was written against the framework rather than this
    const request = { id: 'request' };
    const reply = { id: 'reply' };

    // When
    const context = synthesizeExecutionContext(request, reply, () => undefined);

    // Then
    expect([context.switchToRpc().getData(), context.switchToRpc().getContext()]).toEqual([
      request,
      reply,
    ]);
    expect([context.switchToWs().getClient(), context.switchToWs().getData()]).toEqual([
      request,
      reply,
    ]);
    expect(context.switchToHttp().getNext()).toBeUndefined();
  });
});

/**
 * The `ExecutionContext` a reference route hands a guard, built rather than received.
 *
 * WHY IT HAS TO BE BUILT. The seventeen routes of SPEC 13.3 are registered on the http adapter
 * directly, which is the decision that keeps a documentation page out from behind whatever the
 * application applies globally, and its consequence is that NestJS never sees these routes at all:
 * no controller, no `@UseGuards`, no `APP_GUARD`, and therefore no context object. SPEC 19.6 says
 * the guard runs anyway, so the context is synthesized from the two things the router does hand
 * over, the request and the reply.
 *
 * THE CLASS AND THE HANDLER ARE REAL AND CARRY NO METADATA, and both halves of that matter. Real,
 * because `context.getClass()` and `context.getHandler()` are what a guard passes to `Reflector`,
 * and a guard handed `undefined` there throws rather than deciding. Free of metadata, because the
 * commonest guard in the NestJS world reads an `@Public()` key off those two targets and returns
 * true when it finds one: a synthetic target that carried anything would be this package granting
 * an exemption on the host's behalf. Nothing is found, so the guard enforces, which is the closed
 * direction.
 *
 * THE OTHER TWO TRANSPORTS ANSWER THE WAY NEST'S OWN CONTEXT ANSWERS THEM. `ExecutionContextHost`
 * does not refuse `switchToRpc` on an http request; it wraps the same argument list in a different
 * reader. A guard that touches one on a documentation route is asking a question with no answer
 * either way, and matching the framework is the behaviour a guard was written against.
 */

import type {
  ExecutionContextLike,
  HttpArgumentsHostLike,
  RpcArgumentsHostLike,
  WsArgumentsHostLike,
} from '../../shared/types/nest-surface';

/**
 * The class a reference route reports as its controller.
 *
 * ONE CLASS FOR THE WHOLE PACKAGE, named so that a guard logging `context.getClass().name` prints
 * something a reader can act on rather than an anonymous function. It is never instantiated.
 */
/*
 * An empty class, which the linter is right to flag in general and wrong to flag here. What it is
 * for is being an object with a name and no metadata on it, which is precisely a class with no
 * members: anything added to it would be something a guard reading `context.getClass()` could find.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OpenRefReferenceRoute {}

/** What one route contributes to the context: which route it is, in a name a guard can read. */
export interface ReferenceRouteIdentity {
  /** The route id of SPEC 13.3, such as `openapi-json`. */
  readonly id: string;
  /** The registered path pattern, such as `/docs/openapi.json`. */
  readonly pattern: string;
}

/**
 * The handler function a guard receives for one route.
 *
 * Built once per registered route rather than once per request, because it is identity: a guard
 * reading metadata off it must see the same object on every request to that route, and a fresh
 * function per request would defeat any cache a guard keeps keyed by handler.
 *
 * @param identity - Which route this stands for
 * @returns A function named after the route, carrying nothing else
 */
export function referenceRouteHandler(identity: ReferenceRouteIdentity): () => void {
  const handler = (): void => undefined;
  Object.defineProperty(handler, 'name', { value: `openref:${identity.id}` });

  return handler;
}

/**
 * Builds the context for one request to one reference route.
 *
 * @param request - The framework's own request object
 * @param reply - The framework's own reply object
 * @param handler - The per route function from {@link referenceRouteHandler}
 * @returns The context to hand a guard
 */
export function synthesizeExecutionContext(
  request: unknown,
  reply: unknown,
  handler: () => void,
): ExecutionContextLike {
  const args: readonly unknown[] = [request, reply, undefined];

  const http: HttpArgumentsHostLike = {
    getRequest: () => request,
    getResponse: () => reply,
    // NestJS passes `next` on an http context and there is none here: these routes are terminal,
    // and nothing follows a documentation route. Undefined is what the absence is, and inventing a
    // no-op would tell a guard that continuing is available when it is not.
    getNext: () => undefined,
  };

  const rpc: RpcArgumentsHostLike = {
    getData: () => request,
    getContext: () => reply,
  };

  const ws: WsArgumentsHostLike = {
    getClient: () => request,
    getData: () => reply,
  };

  return {
    getType: () => 'http',
    getArgs: () => args,
    getArgByIndex: (index) => args[index],
    getClass: () => OpenRefReferenceRoute,
    getHandler: () => handler,
    switchToHttp: () => http,
    switchToRpc: () => rpc,
    switchToWs: () => ws,
  };
}

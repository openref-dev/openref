/**
 * Everything this package needs from NestJS, declared in one file.
 *
 * DECLARED STRUCTURALLY RATHER THAN IMPORTED, and that is what makes SPEC 23's support for
 * NestJS 10 and 11 a checkable claim instead of a hope. A framework type imported from one
 * installed version says nothing about the other, while this file names the whole coupling:
 * three methods and one accessor. A compatibility test reads it and asks each supported
 * version whether it still offers them, and anything this package starts to use has to be
 * added here first, where it is visible.
 *
 * The same choice keeps the peer dependency honest. `@nestjs/common` and `@nestjs/core` are
 * peers, never bundled, so a consumer's copy is the only one that runs. Type-only imports of
 * a peer are safe; value imports of one are not, and there are none.
 */

/**
 * The NestJS http adapter, narrowed to what the route table needs.
 *
 * `get` is the registration surface both platform adapters expose, with the same `:name`
 * parameter dialect. `getType` is how the platform is told apart, and it has returned
 * `'express'` and `'fastify'` since NestJS 8.
 */
export interface HttpAdapterLike {
  /** `'express'` or `'fastify'`, and anything else is refused rather than guessed at. */
  getType(): string;
  /** Registers a GET route. Both platform adapters accept a path and a handler. */
  get(path: string, handler: (request: unknown, reply: unknown) => void): unknown;
}

/** The application object a host hands to `setup`, narrowed to the one accessor used. */
export interface NestApplicationLike {
  getHttpAdapter(): HttpAdapterLike;
}

/**
 * A controller class, as a collector receives it.
 *
 * A constructor and nothing else. Nest sets metadata on the class object itself, so what a
 * collector needs from it is identity and a name, and `Function` already carries both.
 */
export type ControllerLike = new (...args: never[]) => unknown;

/** A route handler, which is the target most Nest metadata is set on. */
export type HandlerLike = (...args: never[]) => unknown;

/**
 * Nest's `Reflector`, narrowed to the two reads a collector actually performs.
 *
 * TWO AND NOT FOUR, for the reason the whole of this file exists. `Reflector` also offers
 * `getAll` and `getAllAndMerge`, and nothing in SPEC 6.2's collector list needs either: a
 * collector reads one key off one target, or it reads the same key off the handler and the
 * controller and takes the nearer one, which is what a decorator on a method overriding one on
 * a class means. A third collector needing a third method adds it here, where the coupling to
 * two major versions of NestJS is visible, rather than reaching for the real class.
 *
 * BOTH RETURN `unknown` WHERE NEST RETURNS A TYPE PARAMETER, and that is a narrowing of the
 * real class rather than a widening. Nest's own signature defaults its parameter to `any`, so
 * the caller names the type and nothing checks the claim: metadata is whatever somebody put
 * under the key, possibly from a package the collector has never seen. `unknown` forces the
 * collector to look before it believes, which is the same rule as SPEC 6.1's, one layer down.
 */
export interface ReflectorLike {
  /** Reads one metadata key off one target. */
  get(key: unknown, target: unknown): unknown;
  /** Reads one key across targets in order, taking the first that is set. */
  getAllAndOverride(key: unknown, targets: readonly unknown[]): unknown;
}

/**
 * Nest's `ModuleRef`, narrowed to the one resolution a collector performs.
 *
 * It exists for the collector that has to read a provider's configuration rather than a
 * decorator's metadata, which is how a throttler's declared limits are reachable at all.
 */
export interface ModuleRefLike {
  get(token: unknown, options?: { readonly strict?: boolean }): unknown;
}

/**
 * Reports whether a value can serve as the application.
 *
 * @param value - Whatever the host passed
 * @returns True when it exposes `getHttpAdapter`
 */
export function isNestApplication(value: unknown): value is NestApplicationLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getHttpAdapter' in value &&
    typeof value.getHttpAdapter === 'function'
  );
}

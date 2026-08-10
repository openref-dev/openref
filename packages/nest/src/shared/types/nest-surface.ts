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

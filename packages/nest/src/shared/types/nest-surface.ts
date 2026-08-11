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
 * peers, never bundled, so a consumer's copy is the only one that runs.
 *
 * THE RULE ABOUT VALUE IMPORTS, AMENDED IN TX-FORROOT ON 2026-08-11. It used to read "type-only
 * imports of a peer are safe; value imports of one are not, and there are none", and `forRoot`
 * made the last clause false. A rule the code contradicts is worse than no rule, so the rule now
 * says what it was always protecting:
 *
 * - the structural types below stay the way this package talks about NestJS. Nothing here is
 *   imported from the framework, and a new type this package starts to need is added here first
 * - there is exactly ONE value load, of the names in {@link NEST_CORE_VALUE_NAMES}, and it is
 *   declared here beside everything else. `runtime/infrastructure/adapters/nest-core.adapter.ts`
 *   performs it and nothing else may
 * - THE LOAD IS LAZY, ON THE `forRoot` PATH ONLY, and that is measured rather than stylistic.
 *   `tools/browser-budget` imports `@openref/nest` and boots Express with no NestJS installed,
 *   which is how the budgets prove this package puts no framework on the wire, and
 *   `@nestjs/core` is not resolvable from there. A static import at the entry would take the
 *   browser baseline, the CSP proofs and `first-minute` down with it
 *
 * Reaching into `app.container` instead would need no import at all and is refused: it is not
 * public API on either supported major, so it buys a coupling that stays invisible until a minor
 * release moves it, which is the thing this file exists to prevent.
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

/**
 * The application object a host hands to `setup`.
 *
 * `get` is optional because the check that a value is an application must not depend on it: a
 * host may hand over anything, and `setup` works perfectly well without it. It is how `setup`
 * asks whether `forRoot` was imported, and therefore whether there is a runtime pass to run.
 */
export interface NestApplicationLike {
  getHttpAdapter(): HttpAdapterLike;
  get?(token: unknown, options?: { readonly strict?: boolean }): unknown;
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
 * One controller as `DiscoveryService` reports it.
 *
 * `metatype` is optional in Nest's own type because a provider registered with `useValue` has
 * no class behind it. A controller always does, but the optionality is kept here rather than
 * asserted away, so the discovery pass has to decide what to do about a wrapper without one.
 */
export interface InstanceWrapperLike {
  readonly instance?: unknown;
  readonly metatype?: unknown;
  readonly name?: string | symbol;
}

/**
 * Nest's `DiscoveryService`, narrowed to the one enumeration the runtime pass performs.
 *
 * ONE METHOD, AND IT IS THE REASON THE VALUE LOAD EXISTS AT ALL. There is no route from a
 * structural type to the list of controller classes: the list lives in the container, and
 * `DiscoveryService` is the only public way to ask for it. `getProviders` is deliberately absent,
 * because a collector that needs a provider resolves it through {@link ModuleRefLike} by token.
 */
export interface DiscoveryServiceLike {
  getControllers(): readonly InstanceWrapperLike[];
}

/** Nest's `HttpAdapterHost`, narrowed to the accessor the route table needs. */
export interface HttpAdapterHostLike {
  readonly httpAdapter?: HttpAdapterLike;
}

/**
 * What `forRoot` builds, which NestJS reads as plain data.
 *
 * IT IS NOT WHAT `forRoot` RETURNS, and the difference is measured. A structural description of a
 * `DynamicModule` cannot be assigned to the framework's own type, so a host could not put it in an
 * `imports` array: NestJS types `imports` as a mutable array of module types, which a readonly
 * array of `unknown` is not, and `module` as a class, which `unknown` is not. The NestJS 10 arm of
 * the compatibility matrix found that by failing to compile. So this type is what the module file
 * checks its object against, and the return type is the framework's, reached by one cast named at
 * its own definition. A type-only import is erased and changes nothing about loading the package.
 */
export interface DynamicModuleLike {
  readonly module: unknown;
  readonly imports?: readonly unknown[];
  readonly providers?: readonly unknown[];
  readonly exports?: readonly unknown[];
  readonly global?: boolean;
}

/**
 * The names loaded from `@nestjs/core`, and the whole of the value coupling to NestJS.
 *
 * All five are public API in NestJS 10 and 11, and all five are DI tokens rather than helpers:
 * four are injected and `DiscoveryModule` is imported so that `DiscoveryService` resolves at all.
 * `test/unit/nest-value-surface.spec.ts` asks the installed framework whether it still exports
 * each of them, which is the same check the structural half already gets.
 */
export const NEST_CORE_VALUE_NAMES = [
  'DiscoveryModule',
  'DiscoveryService',
  'HttpAdapterHost',
  'ModuleRef',
  'Reflector',
] as const;

/**
 * Metadata keys NestJS writes on a controller and on a handler.
 *
 * STRING LITERALS RATHER THAN THE CONSTANTS FROM `@nestjs/common`, because importing them would
 * be a second value coupling, to a second package, for three strings that are part of the
 * framework's on-disk format: they are what `@Controller` and `@Get` have written since NestJS 5
 * and what every third party decorator reads. `test/unit/nest-value-surface.spec.ts` decorates a
 * class with the real decorators and asserts the keys still hold what this table says.
 */
export const NEST_ROUTE_METADATA = {
  /** Path prefix on a controller class, or the path on a handler. */
  path: 'path',
  /** HTTP method on a handler, as a `RequestMethod` enum member. */
  method: 'method',
  /** Version of a controller or a handler, per Nest's versioning. */
  version: '__version__',
} as const;

/**
 * `RequestMethod` as it is written on a handler, mapped to the method name a document uses.
 *
 * The enum is numeric, so what a handler carries is a number, and the eight below have held
 * their values since NestJS 6 and are the whole of what NestJS 10 and 11 agree on: 11 added
 * WebDAV members after `SEARCH`, and this table does not need them to be right about these. A
 * number outside the table is reported rather than guessed at, per SPEC 0.
 *
 * `ALL` is absent on purpose. A handler registered for every method is not one operation, and
 * pairing it with one node would attribute facts to a node the code does not uniquely serve.
 */
export const NEST_REQUEST_METHODS: Readonly<Record<number, string>> = {
  0: 'get',
  1: 'post',
  2: 'put',
  3: 'delete',
  4: 'patch',
  6: 'options',
  7: 'head',
  8: 'search',
};

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

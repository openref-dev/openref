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
  /** Registers a POST route, which the same origin proxy of SPEC 14.5 answers on. */
  post(path: string, handler: (request: unknown, reply: unknown) => void): unknown;
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
  /**
   * The DI token the provider was registered under.
   *
   * IT IS NOT THE TOKEN THE HOST WROTE, FOR AN ENHANCER, and that is the whole reason this field
   * is read rather than `name`. NestJS rewrites `{ provide: APP_GUARD }` to a unique token of the
   * form `APP_GUARD (UUID: ...)`, because several providers may claim the same enhancer token in
   * one application and a container maps one token to one provider. The prefix is what survives,
   * which is why {@link isGlobalEnhancerToken} matches on it rather than on equality.
   */
  readonly token?: unknown;
  /** `'guard'`, `'interceptor'`, `'pipe'` or `'filter'` on a provider registered as an enhancer. */
  readonly subtype?: string;
}

/**
 * Nest's `DiscoveryService`, narrowed to the one enumeration the runtime pass performs.
 *
 * ONE METHOD WAS THE REASON THE VALUE LOAD EXISTS AT ALL. There is no route from a structural
 * type to the list of controller classes: the list lives in the container, and `DiscoveryService`
 * is the only public way to ask for it.
 *
 * `getProviders` ARRIVED IN TX-GLOBALGUARD, AND THE NOTE IT REPLACES SAID IT NEVER WOULD. That
 * note read "a collector that needs a provider resolves it through `ModuleRefLike` by token",
 * which is true of every provider a host wrote and false of the one this package had to find: a
 * guard registered under `APP_GUARD` is not resolvable by that token, because NestJS rewrites it
 * to a unique one per registration. Nothing but an enumeration answers "which providers are
 * enhancers", and the enumeration is public API on both supported majors.
 */
export interface DiscoveryServiceLike {
  getControllers(): readonly InstanceWrapperLike[];
  /** Every provider in the container, which is the only route to the global enhancers. */
  getProviders(): readonly InstanceWrapperLike[];
}

/** Nest's `HttpAdapterHost`, narrowed to the accessor the route table needs. */
export interface HttpAdapterHostLike {
  readonly httpAdapter?: HttpAdapterLike;
}

/** Nest's `HttpArgumentsHost`, which is the half of an execution context an http guard reads. */
export interface HttpArgumentsHostLike {
  getRequest(): unknown;
  getResponse(): unknown;
  getNext(): unknown;
}

/** Nest's `RpcArgumentsHost`, present because the context a guard receives carries it. */
export interface RpcArgumentsHostLike {
  getData(): unknown;
  getContext(): unknown;
}

/** Nest's `WsArgumentsHost`, present for the reason {@link RpcArgumentsHostLike} is. */
export interface WsArgumentsHostLike {
  getClient(): unknown;
  getData(): unknown;
}

/**
 * Nest's `ExecutionContext`, which this package synthesizes rather than receives.
 *
 * SYNTHESIZED BECAUSE THE REFERENCE ROUTES ARE NOT NEST ROUTES, per SPEC 19.6. They are registered
 * on the http adapter directly, which is what keeps a documentation page out from behind whatever
 * the application applies globally, and the price of that is that no framework object exists to
 * hand a guard. `visibility/domain/execution-context.ts` builds one out of the request and the
 * reply the router did hand over.
 *
 * EVERY MEMBER OF THE REAL INTERFACE IS HERE AND NONE IS NARROWER THAN THE REAL ONE, because a
 * host's guard is compiled against the framework's own type and has to remain assignable to this.
 * The returns are `unknown` where Nest's are generic: what a guard does with them is its own
 * business, and a type parameter here would be this package claiming to know the request type of
 * an application it has never seen.
 */
export interface ExecutionContextLike {
  getType(): string;
  getArgs(): readonly unknown[];
  getArgByIndex(index: number): unknown;
  getClass(): unknown;
  getHandler(): unknown;
  switchToHttp(): HttpArgumentsHostLike;
  switchToRpc(): RpcArgumentsHostLike;
  switchToWs(): WsArgumentsHostLike;
}

/**
 * Nest's `CanActivate`, as an instance.
 *
 * THE RETURN IS `unknown` AND THAT IS DELIBERATE. Nest declares
 * `boolean | Promise<boolean> | Observable<boolean>`, and the third of those is an rxjs type this
 * package does not depend on and must not start to. `unknown` accepts all three, and the admission
 * of SPEC 19.6 decides what each one means, refusing anything that is not exactly `true`.
 */
export interface CanActivateLike {
  canActivate(context: ExecutionContextLike): unknown;
}

/**
 * What a host may write as `guard`, per SPEC 13.2.
 *
 * A CLASS OR AN INSTANCE, AND NOTHING IS CONSTRUCTED HERE. SPEC 13.2 writes the class, which is
 * what `@UseGuards` takes, and a class is resolved out of the container. See SPEC 19.6 for why a
 * class the container does not know is refused at boot rather than instantiated by this package.
 */
export type GuardLike = CanActivateLike | (new (...args: never[]) => CanActivateLike);

/**
 * Nest's `HttpException`, narrowed to the one member that carries a status.
 *
 * READ RATHER THAN CAUGHT BY TYPE, because catching by type would mean importing the class, and
 * the whole of this file exists so that this package holds no value coupling to `@nestjs/common`.
 * A guard that throws `UnauthorizedException` therefore still produces a 401, per SPEC 19.6.
 */
export interface HttpExceptionLike {
  getStatus(): number;
}

/**
 * Reports whether a thrown value carries an http status of its own.
 *
 * @param value - Whatever the guard threw
 * @returns True when `getStatus` is callable on it
 */
export function isHttpExceptionLike(value: unknown): value is HttpExceptionLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getStatus' in value &&
    typeof value.getStatus === 'function'
  );
}

/**
 * Reports whether a value can act as a guard.
 *
 * @param value - Whatever the container resolved, or whatever the host passed
 * @returns True when `canActivate` is callable on it
 */
export function isCanActivateLike(value: unknown): value is CanActivateLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'canActivate' in value &&
    typeof value.canActivate === 'function'
  );
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
 * The key `@UseGuards` writes, on a controller class and on a handler alike.
 *
 * A STRING LITERAL FOR THE REASON THE TABLE ABOVE GIVES, and this one has held since NestJS 5.
 * `test/unit/nest-value-surface.spec.ts` decorates a class with the real `@UseGuards` and asserts
 * the key still holds what this says.
 *
 * BOTH LEVELS APPLY AND NEITHER OVERRIDES THE OTHER, which is why the collector reads it with
 * `get` on each target rather than with `getAllAndOverride`. NestJS runs the controller's guards
 * and then the handler's, so a route with one of each is protected by two.
 */
export const NEST_GUARD_METADATA = '__guards__';

/**
 * The four tokens NestJS registers an application wide enhancer under, per SPEC 6.2.1.
 *
 * STRING LITERALS FOR THE REASON THE TABLES ABOVE GIVE, and these four are exported by
 * `@nestjs/core` as the plain strings written here, unchanged since NestJS 6.
 * `test/unit/nest-value-surface.spec.ts` asks the installed framework whether it still says so.
 *
 * `APP_GUARD` AND `APP_PIPE` ARE READ, the pipe since `TX-COLLECTORS`, and the other two are
 * named here rather than omitted so that the next person meets the whole family at once. SPEC
 * 6.2.1 says why each stays unread: an interceptor has no field in `IRNodeRuntime` to land in
 * and the timeout value comes from route metadata instead, and a filter is refused by SPEC 6.4
 * because a registration has no status. The pipe reading is the registration only: no 400 is
 * derived from it, per the same section.
 */
export const NEST_ENHANCER_TOKENS = {
  guard: 'APP_GUARD',
  interceptor: 'APP_INTERCEPTOR',
  pipe: 'APP_PIPE',
  filter: 'APP_FILTER',
} as const;

/**
 * The `subtype` NestJS stamps on the wrapper of a provider registered under `APP_GUARD`.
 *
 * READ ALONGSIDE THE TOKEN AND NOT INSTEAD OF IT. `subtype` is the framework's own answer and is
 * the cheaper check; the token prefix is what the framework's own docs describe a host as writing.
 * Requiring only one of the two would rest the whole reading on a single undocumented field, and
 * accepting either keeps a guard visible if one of them moves in a future minor.
 */
export const NEST_GUARD_ENHANCER_SUBTYPE = 'guard';

/** The `subtype` on a provider registered under `APP_PIPE`, read the way the guard one is. */
export const NEST_PIPE_ENHANCER_SUBTYPE = 'pipe';

/**
 * The key `@UsePipes` writes, on a controller class and on a handler alike.
 *
 * A STRING LITERAL FOR THE REASON THE TABLES ABOVE GIVE. Both levels apply and neither overrides
 * the other, exactly as with `@UseGuards`, so the collector reads it with `get` on each target.
 * `test/unit/nest-value-surface.spec.ts` decorates a class with the real `@UsePipes` and asserts
 * the key still holds what this says.
 */
export const NEST_PIPES_METADATA = '__pipes__';

/**
 * The key `@HttpCode` writes, on the handler and nowhere else.
 *
 * ONLY THE EXPLICIT DECORATOR IS A FACT, per SPEC 6.2.1: a route without it answers the
 * framework default, which is behaviour rather than a decision written on the route, so the
 * collector emits nothing there and `status-drift` stays quiet on every ordinary operation.
 */
export const NEST_HTTP_CODE_METADATA = '__httpCode__';

/**
 * The key NestJS keeps a handler's parameter bindings under, per `TX-COLLECTORS`.
 *
 * IT IS TWO-TARGET METADATA, on the controller class and the method name together, which is why
 * {@link MetadataReflect.getMetadata} carries the optional property key: `ReflectorLike` reads
 * one key off one target and cannot reach this. The value is a record keyed
 * `${paramtype}:${index}`, each entry `{ index, data, pipes }`, where `data` is the name a
 * decorator like `@Query('sort')` binds and `pipes` is the parameter level pipe list. Measured
 * on NestJS 11 and pinned by `nest-value-surface.spec.ts` with the real decorators.
 */
export const NEST_ROUTE_ARGS_METADATA = '__routeArguments__';

/**
 * The marker inside a route argument key written by `createParamDecorator`.
 *
 * A custom parameter decorator's factory receives the execution context and can read the whole
 * request, so a handler binding one is a handler the scan cannot account for. The key is
 * `${random}${marker}:${index}`, so the marker is matched by inclusion rather than position.
 */
export const NEST_CUSTOM_ROUTE_ARGS_MARKER = '__customRouteArgs__';

/**
 * The key `@Controller({ scope })` writes, and how a request scoped controller is recognised.
 *
 * The handler scan refuses such a controller whole: a request scoped class may inject `REQUEST`
 * and read any parameter from a constructor assigned field, which is an access path no scan of
 * the handler body can see. The value is `{ scope }` with `Scope.REQUEST` = 2 and
 * `Scope.TRANSIENT` = 1 on both supported majors, pinned by `nest-value-surface.spec.ts`.
 */
export const NEST_SCOPE_OPTIONS_METADATA = 'scope:options';

/** `Scope.DEFAULT` as the enum spells it, the one value the handler scan accepts. */
export const NEST_DEFAULT_SCOPE = 0;

/**
 * `RouteParamtypes` members this package reads, as they are written on a handler.
 *
 * THE NUMBERS ARE THE ON-DISK FORMAT, like {@link NEST_REQUEST_METHODS}: they have held since
 * NestJS 6 and are what every route argument key starts with. Only the ones with a meaning for
 * the scan are named; a number outside the table is treated as unaccountable rather than
 * guessed at, per SPEC 0.
 */
export const NEST_ROUTE_PARAMTYPES = {
  request: 0,
  response: 1,
  next: 2,
  body: 3,
  query: 4,
  param: 5,
  headers: 6,
  session: 7,
} as const;

/**
 * Reports whether a wrapper's token is the rewritten form of one enhancer token.
 *
 * NestJS turns `{ provide: APP_GUARD, useClass: X }` into a provider whose token is
 * `APP_GUARD (UUID: 5c034508718fe21f57dcd)`, so equality finds nothing and the prefix is the
 * whole of what a reader of the container gets back. Measured on NestJS 11 rather than read out
 * of the documentation, which describes the token a host writes and not the one it becomes.
 *
 * @param token - Whatever the wrapper carried
 * @param enhancer - One of {@link NEST_ENHANCER_TOKENS}
 * @returns True when this provider was registered under that enhancer token
 */
export function isEnhancerToken(token: unknown, enhancer: string): boolean {
  return typeof token === 'string' && (token === enhancer || token.startsWith(`${enhancer} (`));
}

/**
 * The key `@Sse` writes, and the whole of how a streaming route is recognised.
 *
 * MEASURED RATHER THAN GUESSED, AND IT IS NOT `sse`. Applying the real `@Sse('events')` to a
 * handler leaves `path` = `'events'`, `method` = `0` and `__sse__` = `true`, so a collector
 * looking for a key named after the decorator would find nothing on every streaming route and
 * report that the application has none. `test/unit/nest-value-surface.spec.ts` decorates a class
 * with the real decorator and asserts this still holds, the way it does for the other keys.
 *
 * SPEC 13.6: this key says the route streams. It says nothing about what it streams, which is
 * the four level priority the stream collector reads and is a separate question by construction.
 */
export const NEST_SSE_METADATA = '__sse__';

/**
 * The keys `@nestjs/microservices` writes, per SPEC 8.3.
 *
 * STRING LITERALS FOR THE REASON THE TABLES ABOVE GIVE, AND THE PACKAGE IS NOT A PEER. A host that
 * has no microservices has no `@MessagePattern` anywhere, so requiring the package to read three
 * strings would put a dependency on every consumer for a feature most of them do not use. The
 * three are the framework's on-disk format, and `nest-value-surface.spec.ts` applies the real
 * decorators and asserts each still holds what this table says, which is the same check the http
 * keys already get.
 *
 * `microservices:transport` IS THE SECOND ARGUMENT OF THE DECORATOR AND NOT THE APPLICATION'S
 * CONFIGURATION. `@MessagePattern('x', Transport.KAFKA)` writes it; `app.connectMicroservice(...)`
 * does not and is not reachable from the container at all. SPEC 8.3 says what a handler that names
 * no transport is read as, which is the one the host declared rather than a guess.
 */
export const NEST_MICROSERVICE_METADATA = {
  /** The pattern, exactly as written: a string, or an object such as `{ cmd: 'sum' }`. */
  pattern: 'microservices:pattern',
  /** `PatternHandler`, which says whether the handler answers a message or an event. */
  handlerType: 'microservices:handler_type',
  /** `Transport`, when the decorator was given one. */
  transport: 'microservices:transport',
} as const;

/**
 * `PatternHandler` as the enum spells it, which is what tells `@MessagePattern` from `@EventPattern`.
 *
 * MEASURED RATHER THAN READ OUT OF THE DOCUMENTATION, like {@link NEST_REQUEST_METHODS}. The enum
 * is numeric and starts at one, so a handler carrying `0` under this key is not a message handler
 * and a table starting at zero would have called every event handler a message handler.
 */
export const NEST_PATTERN_HANDLERS = { message: 1, event: 2 } as const;

/**
 * `Transport` as the enum spells it, and the protocol name each transport speaks.
 *
 * THE PROTOCOL NAMES ARE ASYNCAPI'S WHERE ASYNCAPI HAS ONE, AND THE TRANSPORT'S OWN WHERE IT DOES
 * NOT. AsyncAPI's Server Object says its protocol list is not closed, so `tcp` and `grpc` are the
 * honest names for two transports it does not enumerate; `amqp` rather than `rmq` and `kafka`
 * rather than `KAFKA` are the names AsyncAPI does enumerate, and using the enum's spelling there
 * would put a protocol in the document that no AsyncAPI reader knows.
 *
 * A NUMBER OUTSIDE THE TABLE IS REPORTED RATHER THAN GUESSED AT, per SPEC 0 and the request method
 * table above. A custom transport strategy carries whatever number its author chose, and inventing
 * a protocol for it would describe a broker nobody named.
 */
export const NEST_TRANSPORT_PROTOCOLS: Readonly<Record<number, string>> = {
  0: 'tcp',
  1: 'redis',
  2: 'nats',
  3: 'mqtt',
  4: 'grpc',
  5: 'amqp',
  6: 'kafka',
};

/** The same seven by the name the enum gives them, which is what a reader of the code recognises. */
export const NEST_TRANSPORT_NAMES: Readonly<Record<number, string>> = {
  0: 'TCP',
  1: 'REDIS',
  2: 'NATS',
  3: 'MQTT',
  4: 'GRPC',
  5: 'RMQ',
  6: 'KAFKA',
};

/**
 * The keys `@nestjs/websockets` writes, per SPEC 8.3.
 *
 * STRING LITERALS AND NOT A PEER DEPENDENCY, for the reason {@link NEST_MICROSERVICE_METADATA}
 * gives.
 *
 * BOTH HALVES OF THE ADDRESS COME OFF THE OPTIONS OBJECT AND NOT OFF A KEY OF THEIR OWN, and that
 * is measured rather than assumed. The package exports a `NAMESPACE_METADATA` constant spelled
 * `namespace`, and applying the real `@WebSocketGateway(8080, { namespace: 'chat', path: '/ws' })`
 * on NestJS 11 leaves that key unset: everything the decorator was given is under
 * `websockets:gateway_options`. Reading the exported constant would have produced a gateway with
 * no namespace on every application that has one, silently.
 */
export const NEST_WEBSOCKET_METADATA = {
  /** True on a class decorated with `@WebSocketGateway`. */
  gateway: 'websockets:is_gateway',
  /** The options object the decorator was given, which carries `namespace` and `path`. */
  options: 'websockets:gateway_options',
  /** True on a method decorated with `@SubscribeMessage`. */
  messageMapping: 'websockets:message_mapping',
  /** The event name `@SubscribeMessage` was given. */
  message: 'message',
} as const;

/**
 * The protocol a WebSocket gateway speaks, per SPEC 8.3 and the AsyncAPI protocol list.
 *
 * `ws` AND NOT `wss`, because the decorator says nothing about TLS. Which of the two a deployment
 * serves is a property of the server in front of the gateway, and naming `wss` here would be this
 * package asserting a certificate it has never seen.
 */
export const NEST_WEBSOCKET_PROTOCOL = 'ws';

/**
 * The key `@nestjs/swagger` keeps operation extensions under.
 *
 * WRITTEN DIRECTLY, AND THAT IS WHY `@nestjs/swagger` IS NOT A PEER OF THIS PACKAGE. `ApiExtension`
 * merges every `x-` key an operation has been given into one object under this key, and the
 * generator reads that object when it builds the operation. Writing the same object ourselves puts
 * `x-openref-audience` and `x-codeSamples` into the document with no value coupling to a third
 * package, which the rule above would otherwise have to admit. Probed end to end through a real
 * `SwaggerModule.createDocument` on 2026-08-11: both extensions came out on the operation.
 *
 * MERGED AND NEVER REPLACED. The object is shared with every other `x-` key, including ones a host
 * wrote with the real decorator, so anything written here reads the object first.
 */
export const SWAGGER_EXTENSION_METADATA = 'swagger/apiExtension';

/**
 * The metadata API a decorator needs, which comes from `reflect-metadata` rather than from NestJS.
 *
 * DECLARED HERE FOR THE REASON EVERYTHING ELSE IN THIS FILE IS. It is a coupling to something in
 * the consumer's environment that this package does not install, so it is named in the one place
 * a compatibility check reads rather than reached for at a call site. NestJS itself requires
 * `reflect-metadata` and every application imports it before `NestFactory.create`, so it is
 * present wherever a decorator of this package can be applied.
 *
 * NOT OPTIONAL, AND A MISSING ONE IS AN ERROR RATHER THAN A NO-OP. A decorator that silently
 * writes nothing produces a reference that is missing facts with nothing anywhere saying why,
 * which is the failure this project refuses everywhere else.
 */
export interface MetadataReflect {
  defineMetadata(key: unknown, value: unknown, target: object): void;
  /**
   * The property key is optional because most reads are off a class or a function, and it exists
   * because one is not: the route argument bindings of {@link NEST_ROUTE_ARGS_METADATA} live on
   * the controller class AND the method name together, and `reflect-metadata` has carried the
   * three argument form since its first release.
   */
  getMetadata(key: unknown, target: object, propertyKey?: string | symbol): unknown;
}

/**
 * The metadata API, or an error naming what is missing.
 *
 * @returns `Reflect`, narrowed to the two members a decorator uses
 * @throws {Error} When `reflect-metadata` has not been loaded
 */
export function metadataReflect(): MetadataReflect {
  const candidate = Reflect as Partial<MetadataReflect>;

  if (
    typeof candidate.defineMetadata !== 'function' ||
    typeof candidate.getMetadata !== 'function'
  ) {
    throw new Error(
      'the decorators of @openref/nest need reflect-metadata, and it has not been loaded. ' +
        "NestJS requires it too: import 'reflect-metadata' once, before NestFactory.create",
    );
  }

  return candidate as MetadataReflect;
}

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

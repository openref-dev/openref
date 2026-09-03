/**
 * The one line of SPEC 2.
 *
 * ```ts
 * OpenRefModule.setup('/docs', app, { document });
 * ```
 *
 * SYNCHRONOUS ON PURPOSE. Routes have to exist before `app.listen()`, and a promise a host
 * forgets to await would register them somewhere after the first requests arrive, which
 * presents as an intermittent 404 on a route that "definitely exists". Everything expensive,
 * the highlighter and the search index, is built on first use behind the service instead.
 *
 * NOTHING IS IMPORTED FROM NestJS AT RUNTIME ON THE `setup` PATH. The application is taken as the
 * structural type in `shared/types/nest-surface.ts`, so this file works against NestJS 10 and 11
 * without either being present at build time, and a consumer's copy is the only one that runs.
 *
 * THE TWO ENTRY POINTS, AND WHAT `setup` DELIBERATELY DOES NOT CARRY. `setup` is SPEC 13.1's one
 * line: a route, the application, a document. It carries no runtime options at all, and that is a
 * consequence rather than a decision. Everything in SPEC 6 needs the controller classes, the only
 * public route to them is `DiscoveryService`, and a service can only be injected into something
 * the container instantiates, which `setup` is not. So `forRoot` carries the runtime surface, and
 * a host that imports it gets the facts on whatever `setup` mounts afterwards, because `setup`
 * asks the container whether the pass is there. `api/module-options.ts` states the option surface
 * in full and is the one place it is written down.
 */

import { loadDefaultAssets } from '@openref/render';
import { assertAgentOptions } from '../agent/domain/agent-mount';
import { createReferenceAdapter } from '../http/infrastructure/adapters/reference-adapter.factory';
import { ReferenceService } from '../reference/application/services/reference.service';
import {
  assertMountsDoNotCollide,
  normalizeRoute,
  type MountAddress,
} from '../reference/domain/routes';
import { admissionFor } from '../visibility/application/services/admission.service';
import { mountRouteTable } from './route-table';
import { isNestApplication } from '../shared/types/nest-surface';
import type { DynamicModuleLike } from '../shared/types/nest-surface';
import type { DynamicModule } from '@nestjs/common';
import type { ModuleRefLike, NestApplicationLike } from '../shared/types/nest-surface';
import { ErrorCode, InvalidOptionsError, type IRDocument } from '@openref/core';
import { loadNestCore } from '../runtime/infrastructure/adapters/nest-core.adapter';
import { MountedReferences } from './mounted-references';
import { assertRootOptions } from './module-options';
import { OPENREF_REFERENCES } from '../shared/constants/tokens';
import type { MountedReferencesDependencies } from './mounted-references';
import type { RuntimePassResult } from '../runtime/application/services/runtime-pass.service';
import type { OpenRefRootAsyncOptions, OpenRefRootOptions } from './module-options';
import type { OpenRefSetupOptions } from './reference-options';

export type { OpenRefSetupOptions } from './reference-options';

/**
 * Mounts an API reference on a running NestJS application.
 *
 * The class carries no NestJS module metadata and does not need to be imported anywhere: it
 * registers its routes on the http adapter directly, which is how a documentation route
 * avoids sitting behind whatever guards and interceptors the application applies globally.
 */
/*
 * A class holding only static methods, which the linter is right to flag in general and wrong
 * to flag here. SPEC 13.1 fixes the call as `OpenRefModule.setup(...)`, which is the shape every
 * NestJS integration uses and the shape `SwaggerModule` established, and SPEC 13.2 puts `forRoot`
 * and `forRootAsync` on the same class, where NestJS itself expects to find them: the value in
 * `DynamicModule.module` has to be a class, because that is what the container keys a module by.
 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class OpenRefModule {
  /**
   * Mounts the reference.
   *
   * @param route - Where to mount it, such as `/docs`
   * @param app - The NestJS application, before `listen`
   * @param options - The document and anything to override about how it is served
   * @returns The service answering those routes, for a host that wants to reach it directly
   * @throws {InvalidOptionsError} When the route or the application is not usable
   * @throws {ConfigError} When the application runs on neither Express nor Fastify
   * @throws {NormalizeError} When the document cannot be normalized
   */
  static setup(
    route: string,
    app: NestApplicationLike,
    options: OpenRefSetupOptions,
  ): ReferenceService {
    if (!isNestApplication(app)) {
      throw new InvalidOptionsError(
        'setup needs the NestJS application, the value INestFactory.create resolved to',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    const basePath = normalizeRoute(route);
    assertMountableAfterInit(route, app);
    // CHECKED BEFORE ANYTHING IS BUILT, per SPEC 18.1: an MCP endpoint with no guard in front of
    // it is refused at boot rather than served, and this entry point is where the ordinary NestJS
    // application mounts, so leaving the check to `forRoot` would leave it unchecked for most
    // hosts. `admissionFor` below refuses the visibility pair on the same principle.
    assertAgentOptions(`the reference mounted on "${route}"`, options);
    const references = referencesIn(app);
    // REFUSED BEFORE ANYTHING IS BUILT, per SPEC 13.3 as amended at `T065`. A mount whose address
    // is a named route of an enclosing mount cannot be ordered around: both sides are static, and
    // the two routers disagree about which of them answers. The provider knows the `documents` a
    // host configured; `mountedOn` knows what earlier `setup` calls on this same application
    // claimed, which is the only registry available when `forRoot` was never imported.
    const claimed = mountedOn(app);
    // The same identity `record` files a `setup` mount under, so a refusal and the provider's own
    // listing name one thing rather than two.
    const candidate = { id: basePath === '' ? '/' : basePath, basePath };
    assertMountsDoNotCollide([...claimed, candidate]);
    references?.assertMountable(candidate);
    let pass: RuntimePassResult | undefined;

    // The theme's own `assets.css` and `bundle` are the defaults, per SPEC 10.4 consumed at
    // T033, and the narrower options override them.
    const theme = options.theme;
    const stylesheets = options.stylesheets ?? theme?.definition.assets?.css;
    const clientBundle = options.clientBundle ?? theme?.bundle;

    const service = new ReferenceService({
      document: options.document,
      basePath,
      ...(references === undefined
        ? {}
        : {
            augment: (document: IRDocument): IRDocument => {
              pass = references.collect(document);
              return pass.document;
            },
          }),
      assets:
        options.assetPlan ??
        loadDefaultAssets({
          ...(stylesheets === undefined ? {} : { stylesheets }),
          ...(clientBundle === undefined ? {} : { clientBundle }),
        }),
      ...(theme === undefined ? {} : { theme }),
      ...(options.cache === undefined ? {} : { cache: options.cache }),
      ...(options.highlight === undefined ? {} : { highlight: options.highlight }),
      ...(options.lang === undefined ? {} : { lang: options.lang }),
      ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
      ...(options.proxy === undefined ? {} : { proxy: options.proxy }),
      ...(options.bridge === undefined ? {} : { bridge: options.bridge }),
      ...(options.agent === undefined ? {} : { agent: options.agent }),
    });

    // The guard of SPEC 19.6 lands on this entry point too, and SPEC 13.2 says why: the document a
    // host builds with `SwaggerModule` does not exist until after `NestFactory.create` has
    // returned, so `setup` is the only way that application mounts anything. A visibility that
    // existed only on `documents` would be a reference the ordinary NestJS application cannot close.
    const admission = admissionFor(
      `the reference mounted on "${route}"`,
      options,
      (token) => guardResolverFor(app)(token),
      options.onError,
    );

    const adapter = createReferenceAdapter(app.getHttpAdapter(), admission, {
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });

    const registerNodeRoute = mountRouteTable(adapter, {
      basePath,
      health: true,
      handle: async (id, request) => service.handle(id, request),
    });

    // THE NODE PAGE ROUTE GOES LAST FOR THE WHOLE PROCESS, per SPEC 13.3 as amended at `T065`.
    // `setup` runs before `onModuleInit` by construction, so registering the bare parameter here
    // put it ahead of every route a `documents` entry nested under this mount registers later, and
    // on Express that is `/docs/events` answered by `/docs/:nodeId` with "no operation of that
    // name is documented here" about an address that exists. When `forRoot` was imported, the
    // provider takes the registration and drains its queue once every named route exists; with no
    // provider, or with a host that called `app.init()` before this line, nothing comes later and
    // the route is registered right here.
    if (references?.deferNodeRoute(registerNodeRoute) !== true) registerNodeRoute();

    claimed.push(candidate);

    // Recorded so a host that mounted through `setup` can still read the pass by document id,
    // and so `all()` answers for every reference this process serves rather than for the subset
    // one entry point happened to build.
    if (references !== undefined && pass !== undefined) {
      references.record({ id: basePath === '' ? '/' : basePath, basePath, service, pass });
    }

    return service;
  }

  /**
   * The full form of SPEC 13.2, and the only entry point that collects runtime facts.
   *
   * IT IS A MODULE AND `setup` IS NOT, WHICH IS THE WHOLE DIFFERENCE. The runtime intelligence of
   * SPEC 6 needs the controller classes, the only public route to them is `DiscoveryService`, and
   * a service can only be injected into something the container instantiates. See
   * `api/module-options.ts` for the option surface and why the unbuilt half of SPEC 13.2 is
   * refused rather than ignored.
   *
   * @param options - The documents to mount and the runtime intelligence to collect
   * @returns The dynamic module to put in a host module's `imports`
   * @throws {InvalidOptionsError} When the options are unusable, per `assertRootOptions`
   * @throws {ConfigError} When `@nestjs/core` cannot be loaded
   */
  static forRoot(options: OpenRefRootOptions): DynamicModule {
    assertRootOptions(options);
    const nest = loadNestCore();

    return asDynamicModule({
      module: OpenRefModule,
      imports: [nest.DiscoveryModule],
      providers: [
        nest.Reflector,
        {
          provide: OPENREF_REFERENCES,
          useFactory: (...resolved: readonly unknown[]): MountedReferences =>
            new MountedReferences(options, dependenciesFrom(resolved, 0)),
          inject: injectionOrder(nest),
        },
      ],
      exports: [OPENREF_REFERENCES],
    });
  }

  /**
   * The async form SPEC 13.2 calls mandatory.
   *
   * A host whose document comes from a configuration service cannot use `forRoot` at all, because
   * the options would have to exist before the container does.
   *
   * @param options - A factory producing the same options, and what to inject into it
   * @returns The dynamic module to put in a host module's `imports`
   * @throws {ConfigError} When `@nestjs/core` cannot be loaded
   */
  static forRootAsync(options: OpenRefRootAsyncOptions): DynamicModule {
    const nest = loadNestCore();
    const injected = options.inject ?? [];

    return asDynamicModule({
      module: OpenRefModule,
      imports: [nest.DiscoveryModule, ...(options.imports ?? [])],
      providers: [
        nest.Reflector,
        {
          provide: OPENREF_REFERENCES,
          useFactory: async (...resolved: readonly unknown[]): Promise<MountedReferences> => {
            // The host's own injections come first, so that adding a framework dependency here
            // never shifts the positions the host's factory reads.
            const built = await options.useFactory(
              ...(resolved.slice(0, injected.length) as never[]),
            );
            assertRootOptions(built);

            return new MountedReferences(built, dependenciesFrom(resolved, injected.length));
          },
          inject: [...injected, ...injectionOrder(nest)],
        },
      ],
      exports: [OPENREF_REFERENCES],
    });
  }
}

/**
 * The one cast in this package, and it is at the framework boundary on purpose.
 *
 * MEASURED RATHER THAN PREFERRED. `DynamicModuleLike` describes exactly what is built above, and
 * a structural description of a `DynamicModule` cannot be assigned to the real one: NestJS types
 * `imports` as a mutable array of module types, so a readonly array of `unknown` is refused, and
 * so is a `module` of `unknown`. The NestJS 10 fixture of the compatibility matrix is what found
 * it, by failing to compile, which is the right place for it to have been found.
 *
 * The type-only import of `DynamicModule` this needs is safe, per the rule in
 * `shared/types/nest-surface.ts`: it is erased, so nothing about loading the package changes, and
 * the shape is identical in NestJS 10 and 11, which the two arms of the matrix compile against
 * their own trees.
 *
 * @param dynamic - The module description, checked against the structural type first
 * @returns The same object, as the framework's own type
 */
function asDynamicModule(dynamic: DynamicModuleLike): DynamicModule {
  return dynamic as unknown as DynamicModule;
}

/**
 * What `setup` has already mounted on one application, keyed by that application.
 *
 * A `WeakMap` AND NOT A MODULE LEVEL LIST, because the list is a fact about one application and not
 * about this process. Two applications in one test file, which this repository's own suites build
 * constantly, must not see each other's mounts, and an application that is closed must not keep its
 * entry alive. Without `forRoot` there is no provider to ask, so this is the only registry a second
 * `setup` call on the same application can be compared against.
 */
const MOUNTED_BY_SETUP = new WeakMap<NestApplicationLike, MountAddress[]>();

/**
 * The mounts `setup` made on one application, as a list this function may append to.
 *
 * @param app - The application `setup` was given
 * @returns The live list for that application
 */
function mountedOn(app: NestApplicationLike): MountAddress[] {
  const existing = MOUNTED_BY_SETUP.get(app);
  if (existing !== undefined) return existing;

  const created: MountAddress[] = [];
  MOUNTED_BY_SETUP.set(app, created);

  return created;
}

/**
 * Refuses a `setup` that comes after `app.init()` on the one platform where it cannot work.
 *
 * MEASURED ON BOTH ADAPTERS 2026-09-03 RATHER THAN REASONED FROM THE FRAMEWORK'S SOURCE. With
 * `app.init()` awaited before `setup`, express answers 404 on the overview, on `openapi.json`, on
 * the health page and on the node page alike: `init` registers NestJS's own not found handler, and
 * express matches in registration order, so every route added afterwards sits behind it and the
 * whole mount is unreachable with nothing anywhere saying so. Fastify answers 200 on all four,
 * because it ranks routes rather than ordering them and accepts registrations until `listen`.
 *
 * SO THE ANSWER IS A REFUSAL ON ONE PLATFORM AND NOT A FIX ON BOTH. Getting ahead of that handler
 * would mean reordering the host application's own middleware stack from inside a documentation
 * mount, which is a larger promise than SPEC 13.1 makes; and SPEC 13.1 already says `setup` takes
 * the application before `listen`. What was missing was the refusal, not the rule.
 *
 * IT FAILS OPEN WHEN THE FLAG CANNOT BE READ. `isInitialized` is NestJS's own property on the
 * application context rather than a documented member, so a value that is not exactly `true` is
 * treated as "not initialized" and nothing is refused. A test double is that case, and so is a
 * NestJS whose internals moved; the cost of being wrong in that direction is the behaviour this
 * package had yesterday.
 *
 * @param route - The mount point as the host wrote it, so the refusal names it
 * @param app - The application `setup` was given
 * @throws {InvalidOptionsError} When express is already initialized
 */
function assertMountableAfterInit(route: string, app: NestApplicationLike): void {
  const initialized = (app as unknown as { readonly isInitialized?: unknown }).isInitialized;
  if (initialized !== true) return;
  if (app.getHttpAdapter().getType() !== 'express') return;

  throw new InvalidOptionsError(
    `the reference mounted on "${route}" was set up after the application was initialized, and ` +
      'on express every route registered after `app.init()` sits behind the not found handler ' +
      'NestJS registers there, so the whole mount would answer 404. Call OpenRefModule.setup ' +
      'before `app.init()` and before `app.listen()`. Fastify ranks routes rather than ordering ' +
      'them and accepts this, which is why the refusal names the platform',
    ErrorCode.CONFIG_INVALID_OPTIONS,
    undefined,
    { route, platform: 'express' },
  );
}

/**
 * How `setup` resolves a guard class, which is the application itself.
 *
 * IT THROWS RATHER THAN ANSWERING NOTHING WHEN THE APPLICATION CANNOT BE ASKED. `get` is optional
 * on `NestApplicationLike`, deliberately, because `setup` works perfectly well without it; a mount
 * that names a guard class does not, and the caller of this turns a throw into a refusal at boot
 * naming the guard, which is the closed direction.
 *
 * @param app - The application `setup` was given
 * @returns A resolver over that application's container
 */
function guardResolverFor(app: NestApplicationLike): (token: unknown) => unknown {
  return (token: unknown): unknown => {
    if (typeof app.get !== 'function') {
      throw new InvalidOptionsError(
        'this application cannot be asked for a provider, so a guard class cannot be resolved. ' +
          'Pass a guard instance instead',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    return app.get(token, { strict: false });
  };
}

/**
 * Asks the application whether `forRoot` was imported.
 *
 * FAIL OPEN, AND THE ONLY REASONABLE POLICY HERE. `setup` without `forRoot` is SPEC 13.1's whole
 * promise and has to keep working, so an application that does not carry the provider is the
 * ordinary case rather than an error. `get` throws when a token is unknown, which is what the
 * catch is for; NestJS offers no way to ask without throwing.
 *
 * THE QUESTION GOES THROUGH `ModuleRef` AND NOT THROUGH THE APPLICATION, AND THAT IS THE WHOLE
 * OF THIS FUNCTION. Written the obvious way, `app.get(OPENREF_REFERENCES)` inside the try above,
 * the catch never runs and SPEC 2's first minute ends in exit code 1 with no output at all.
 * `NestFactory.create` returns a proxy that puts every call through `ExceptionsZone`, and with
 * `abortOnError` at its default the zone hands the error to its own handler and calls
 * `process.exit(1)` instead of rethrowing. So the fail open policy above was written, was
 * correct, and was unreachable: SPEC 0's eighth class, code that is right, loaded and never
 * reached.
 *
 * `ModuleRef` IS ASKED FOR FIRST BECAUSE IT ALWAYS RESOLVES. The framework registers it in
 * every application, so that call cannot be the one that enters the failing path; and
 * `ModuleRef.get` is the container's own method rather than the proxy's, so its throw on an
 * unknown token is an ordinary throw that the catch below handles. Both halves are proved by
 * `packages/nest/test/integration/first-minute.spec.ts`, which boots the way a reader boots,
 * with `NestFactory.create` defaults and no `forRoot` anywhere.
 *
 * @param app - The application `setup` was given
 * @returns The provider, or undefined when the module was not imported
 */
function referencesIn(app: NestApplicationLike): MountedReferences | undefined {
  if (typeof app.get !== 'function') return undefined;

  try {
    // A test double may hand back anything, including nothing, so the container is checked
    // before it is used rather than asserted into shape.
    const container = app.get(loadNestCore().ModuleRef, { strict: false });
    const lookup = (container as { get?: unknown } | null | undefined)?.get;
    if (typeof lookup !== 'function') return undefined;

    const resolved = (container as ModuleRefLike).get(OPENREF_REFERENCES, { strict: false });
    return resolved instanceof MountedReferences ? resolved : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The framework tokens both forms inject, in one order.
 *
 * Declared once so that {@link dependenciesFrom} cannot drift from it: two lists that have to
 * agree positionally, written in two places, disagree the first time one of them grows.
 *
 * @param nest - The loaded tokens
 * @returns The tokens, in the order the factory reads them
 */
function injectionOrder(nest: ReturnType<typeof loadNestCore>): readonly unknown[] {
  return [nest.DiscoveryService, nest.Reflector, nest.ModuleRef, nest.HttpAdapterHost];
}

/*
 * WHY `Reflector` IS ALSO A PROVIDER OF THIS MODULE AND THE OTHER THREE ARE NOT. `ModuleRef` and
 * `HttpAdapterHost` are registered by the framework's own internal module and resolve from
 * anywhere; `DiscoveryService` comes from `DiscoveryModule`, which is imported above. `Reflector`
 * resolves from anywhere on NestJS 11 and does not on NestJS 10, where a module that wants it
 * declares it. The NestJS 10 arm of the compatibility matrix found that, and declaring it is
 * correct on both: it holds no state, so an instance of our own reads the same metadata.
 */

/**
 * Reads the four framework objects back out of what NestJS resolved.
 *
 * @param resolved - Everything the factory was given
 * @param offset - How many of the host's own injections come first
 * @returns The dependencies the mounting needs
 */
function dependenciesFrom(
  resolved: readonly unknown[],
  offset: number,
): MountedReferencesDependencies {
  return {
    discovery: resolved[offset] as MountedReferencesDependencies['discovery'],
    reflector: resolved[offset + 1] as MountedReferencesDependencies['reflector'],
    moduleRef: resolved[offset + 2] as MountedReferencesDependencies['moduleRef'],
    adapterHost: resolved[offset + 3] as MountedReferencesDependencies['adapterHost'],
  };
}

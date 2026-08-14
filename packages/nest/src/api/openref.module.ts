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

import { createReferenceAdapter } from '../http/infrastructure/adapters/reference-adapter.factory';
import { loadDefaultAssets } from '../assets/infrastructure/adapters/package-assets.adapter';
import { ReferenceService } from '../reference/application/services/reference.service';
import { normalizeRoute, referenceRoutes } from '../reference/domain/routes';
import { isNestApplication } from '../shared/types/nest-surface';
import type { DynamicModuleLike } from '../shared/types/nest-surface';
import type { DynamicModule } from '@nestjs/common';
import type { NestApplicationLike } from '../shared/types/nest-surface';
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
    const references = referencesIn(app);
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
    });

    const adapter = createReferenceAdapter(app.getHttpAdapter(), {
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });

    for (const { id, pattern, method } of referenceRoutes(basePath)) {
      adapter[method](pattern, (request) => service.handle(id, request));
    }

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
 * Asks the application whether `forRoot` was imported.
 *
 * FAIL OPEN, AND THE ONLY REASONABLE POLICY HERE. `setup` without `forRoot` is SPEC 13.1's whole
 * promise and has to keep working, so an application that does not carry the provider is the
 * ordinary case rather than an error. `get` throws when a token is unknown, which is what the
 * catch is for; NestJS offers no way to ask without throwing.
 *
 * @param app - The application `setup` was given
 * @returns The provider, or undefined when the module was not imported
 */
function referencesIn(app: NestApplicationLike): MountedReferences | undefined {
  if (typeof app.get !== 'function') return undefined;

  try {
    const resolved = app.get(OPENREF_REFERENCES, { strict: false });
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

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
 * NOTHING IS IMPORTED FROM NestJS AT RUNTIME. The application is taken as the structural type
 * in `shared/types/nest-surface.ts`, so this file works against NestJS 10 and 11 without
 * either being present at build time, and a consumer's copy is the only one that runs.
 */

import { createReferenceAdapter } from '../http/infrastructure/adapters/reference-adapter.factory';
import { loadDefaultAssets } from '../assets/infrastructure/adapters/package-assets.adapter';
import { ReferenceService } from '../reference/application/services/reference.service';
import { normalizeRoute, referenceRoutes } from '../reference/domain/routes';
import { isNestApplication, type NestApplicationLike } from '../shared/types/nest-surface';
import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { AssetPlan } from '../assets/infrastructure/adapters/package-assets.adapter';
import type { ErrorReporter } from '../http/domain/reply';
import type { NonceReader } from '../http/infrastructure/adapters/express-reference.adapter';
import type { IRenderCache } from '@openref/render';

/** Everything `setup` accepts. Only `document` is required, per SPEC 13.1. */
export interface OpenRefSetupOptions {
  /** The OpenAPI document, as the object `SwaggerModule.createDocument` returns, or as text. */
  readonly document: unknown;
  /**
   * Stylesheets the page links, as package specifiers or absolute paths.
   *
   * Defaults to the three files of `@openref/theme`. A host that ships its own theme passes
   * its own list and the default theme is never read.
   */
  readonly stylesheets?: readonly string[];
  /** Client bundle, as a package specifier or an absolute path. Defaults to this package's. */
  readonly clientBundle?: string;
  /**
   * The assets as bytes, for a host that already has them.
   *
   * Supplied, nothing is read from disk and `stylesheets` and `clientBundle` are ignored. It
   * is what a build that produces its own assets uses, and what lets the route table be
   * tested without a theme package or a build being present.
   */
  readonly assetPlan?: AssetPlan;
  /** Render cache, defaulting to the bounded in memory one of SPEC 12. */
  readonly cache?: IRenderCache;
  /** Syntax highlighting on the server. On by default. */
  readonly highlight?: boolean;
  /** Value of the `lang` attribute on the rendered document. */
  readonly lang?: string;
  /** Forces a colour scheme instead of following the reader's system preference. */
  readonly colorScheme?: 'light' | 'dark';
  /**
   * Where the CSP nonce for a response is found.
   *
   * Tried before the two conventions a helmet integration leaves one under,
   * `res.locals.cspNonce` on Express and `reply.cspNonce.script` on Fastify. THIS PACKAGE
   * SENDS NO POLICY HEADER OF ITS OWN: a policy belongs to the application, and one written
   * here would have to guess `connect-src`, which is what the try-it console sends through.
   */
  readonly nonce?: NonceReader;
  /** Where an unexpected failure inside a documentation route is reported. */
  readonly onError?: ErrorReporter;
}

/**
 * Mounts an API reference on a running NestJS application.
 *
 * The class carries no NestJS module metadata and does not need to be imported anywhere: it
 * registers its routes on the http adapter directly, which is how a documentation route
 * avoids sitting behind whatever guards and interceptors the application applies globally.
 */
/*
 * A class holding one static method, which the linter is right to flag in general and wrong
 * to flag here. SPEC 13.1 fixes the call as `OpenRefModule.setup(...)`, which is the shape
 * every NestJS integration uses and the shape `SwaggerModule` established; and SPEC 13.2 adds
 * `forRoot` and `forRootAsync` to this same class, which are NestJS module methods and need a
 * class to hang the module metadata on. Turning it into a namespace object today would have to
 * be turned back.
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

    const service = new ReferenceService({
      document: options.document,
      basePath,
      assets:
        options.assetPlan ??
        loadDefaultAssets({
          ...(options.stylesheets === undefined ? {} : { stylesheets: options.stylesheets }),
          ...(options.clientBundle === undefined ? {} : { clientBundle: options.clientBundle }),
        }),
      ...(options.cache === undefined ? {} : { cache: options.cache }),
      ...(options.highlight === undefined ? {} : { highlight: options.highlight }),
      ...(options.lang === undefined ? {} : { lang: options.lang }),
      ...(options.colorScheme === undefined ? {} : { colorScheme: options.colorScheme }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });

    const adapter = createReferenceAdapter(app.getHttpAdapter(), {
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
      ...(options.onError === undefined ? {} : { onError: options.onError }),
    });

    for (const { id, pattern } of referenceRoutes(basePath)) {
      adapter.get(pattern, (request) => service.handle(id, request));
    }

    return service;
  }
}

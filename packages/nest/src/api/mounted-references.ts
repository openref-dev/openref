/**
 * The provider `forRoot` registers, and the one place the runtime pass is wired to a route table.
 *
 * IT MOUNTS ON `onModuleInit`, AND THE HOOK IS LOAD BEARING. NestJS initializes in this order:
 * instantiate every module, register the application's own routes, call `onModuleInit`, register
 * the router hooks, call `onApplicationBootstrap`. The container is complete by the third step,
 * so `DiscoveryService` sees every controller, and the not found handler has not been registered
 * yet, so a route added here is still ahead of it. Mounting one step later works on Fastify,
 * which ranks routes, and returns 404 on Express, which matches in registration order.
 *
 * NOTHING HERE IS DECORATED. The class carries no `@Injectable`, because the provider is declared
 * with `useFactory` and its dependencies are named in `inject`, so NestJS never reads metadata off
 * it. That is what keeps this file free of a value import of `@nestjs/common`.
 */

import { createReferenceAdapter } from '../http/infrastructure/adapters/reference-adapter.factory';
import { loadDefaultAssets } from '../assets/infrastructure/adapters/package-assets.adapter';
import { ReferenceService } from '../reference/application/services/reference.service';
import { normalizeRoute, referenceRoutes } from '../reference/domain/routes';
import {
  runRuntimePass,
  type RuntimePassResult,
} from '../runtime/application/services/runtime-pass.service';
import { nestCoreVersion } from '../runtime/infrastructure/adapters/nest-core.adapter';
import { ErrorCode, InvalidOptionsError, type IRDocument } from '@openref/core';
import type { OpenRefDocumentOptions, OpenRefRootOptions } from './module-options';
import type {
  DiscoveryServiceLike,
  HttpAdapterHostLike,
  ModuleRefLike,
  ReflectorLike,
} from '../shared/types/nest-surface';

/** The framework objects the pass needs, resolved by NestJS and handed over once. */
export interface MountedReferencesDependencies {
  readonly discovery: DiscoveryServiceLike;
  readonly reflector: ReflectorLike;
  readonly moduleRef: ModuleRefLike;
  readonly adapterHost: HttpAdapterHostLike;
}

/** One mounted document: what serves it, and what the runtime pass found while mounting it. */
export interface MountedReference {
  readonly id: string;
  readonly basePath: string;
  readonly service: ReferenceService;
  /** Undefined only when the pass produced nothing, which cannot happen once it has run. */
  readonly pass: RuntimePassResult;
}

/** Holds every document `forRoot` mounted, addressable by the id the host gave it. */
export class MountedReferences {
  private readonly mounted = new Map<string, MountedReference>();

  /**
   * @param options - The validated root options
   * @param dependencies - What NestJS resolved for the pass
   */
  constructor(
    private readonly options: OpenRefRootOptions,
    private readonly dependencies: MountedReferencesDependencies,
  ) {}

  /**
   * Normalizes, collects and mounts every document.
   *
   * Called by NestJS. It is idempotent, because a module imported twice would otherwise register
   * the route table twice and the second registration would never be reached.
   *
   * @throws {ConfigError} When the http adapter is not available or is neither supported platform
   */
  onModuleInit(): void {
    const entries = this.options.documents ?? [];
    if (entries.length === 0 || this.mounted.size > 0) return;

    const httpAdapter = this.dependencies.adapterHost.httpAdapter;
    if (httpAdapter === undefined) {
      throw new InvalidOptionsError(
        'forRoot ran before the http adapter existed, so no route could be registered',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    for (const entry of entries) this.mount(entry, httpAdapter);
  }

  /**
   * The service answering one document's routes.
   *
   * @param id - The id the host gave it in `documents`
   * @returns The mounted document, or undefined when no such id was configured
   */
  get(id: string): MountedReference | undefined {
    return this.mounted.get(id);
  }

  /**
   * Every mounted document, in the order they were configured.
   *
   * @returns The mounted documents
   */
  all(): readonly MountedReference[] {
    return [...this.mounted.values()];
  }

  /**
   * Builds and registers one document.
   *
   * @param entry - One entry of `documents`
   * @param httpAdapter - The adapter to register the routes on
   */
  private mount(
    entry: OpenRefDocumentOptions,
    httpAdapter: NonNullable<HttpAdapterHostLike['httpAdapter']>,
  ): void {
    const basePath = normalizeRoute(entry.route);
    let pass: RuntimePassResult | undefined;

    const service = new ReferenceService({
      document: entry.document,
      basePath,
      assets:
        entry.assetPlan ??
        loadDefaultAssets({
          ...(entry.stylesheets === undefined ? {} : { stylesheets: entry.stylesheets }),
          ...(entry.clientBundle === undefined ? {} : { clientBundle: entry.clientBundle }),
        }),
      augment: (document: IRDocument): IRDocument => {
        pass = this.collect(document);
        return pass.document;
      },
      ...(entry.cache === undefined ? {} : { cache: entry.cache }),
      ...(entry.highlight === undefined ? {} : { highlight: entry.highlight }),
      ...(entry.lang === undefined ? {} : { lang: entry.lang }),
      ...(entry.colorScheme === undefined ? {} : { colorScheme: entry.colorScheme }),
      ...(entry.onError === undefined ? {} : { onError: entry.onError }),
    });

    const adapter = createReferenceAdapter(httpAdapter, {
      ...(entry.nonce === undefined ? {} : { nonce: entry.nonce }),
      ...(entry.onError === undefined ? {} : { onError: entry.onError }),
    });

    const health = this.options.runtime?.health ?? true;
    for (const { id, pattern } of referenceRoutes(basePath)) {
      if (id === 'health' && !health) continue;
      adapter.get(pattern, (request) => service.handle(id, request));
    }

    // `augment` is called by the constructor above, synchronously, so this is defined by the
    // time it is read. It is checked rather than asserted because the alternative is a cast.
    if (pass === undefined) {
      throw new InvalidOptionsError(
        'the runtime pass did not run while the document was normalized',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    this.mounted.set(entry.id, { id: entry.id, basePath, service, pass });
  }

  /**
   * Records a document mounted by `setup` rather than by this provider.
   *
   * @param mounted - What `setup` built
   */
  record(mounted: MountedReference): void {
    this.mounted.set(mounted.id, mounted);
  }

  /**
   * Runs the collectors over one normalized document.
   *
   * PUBLIC, BECAUSE `setup` IS THE OTHER CALLER AND THE ORDINARY ONE. A host whose document comes
   * from `SwaggerModule` cannot hand it to `forRoot`, so `setup` resolves this provider out of the
   * container and calls this directly. One implementation, two entry points, which is the point
   * of it living here.
   *
   * @param document - The document, before any runtime fact
   * @returns The pass result, whose document carries the facts and a retaken hash
   */
  collect(document: IRDocument): RuntimePassResult {
    const runtime = this.options.runtime;
    const version = nestCoreVersion();

    return runRuntimePass(document, {
      collectors: runtime?.collectors ?? [],
      discovery: this.dependencies.discovery,
      reflector: this.dependencies.reflector,
      moduleRef: this.dependencies.moduleRef,
      ...(runtime?.sourceLink === undefined ? {} : { sourceLinkTemplate: runtime.sourceLink }),
      ...(version === undefined ? {} : { nestVersion: version }),
    });
  }
}

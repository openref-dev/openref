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

import { RemoteLifecycleService, type FederationService } from '@openref/federation';
import { loadDefaultAssets } from '@openref/render';
import { createReferenceAdapter } from '../http/infrastructure/adapters/reference-adapter.factory';
import { FederatedReferenceService } from '../reference/application/services/federated-reference.service';
import { ReferenceService } from '../reference/application/services/reference.service';
import { normalizeRoute } from '../reference/domain/routes';
import { admissionFor } from '../visibility/application/services/admission.service';
import { mountRouteTable } from './route-table';
import {
  runRuntimePass,
  type RuntimePassResult,
} from '../runtime/application/services/runtime-pass.service';
import { nestCoreVersion } from '../runtime/infrastructure/adapters/nest-core.adapter';
import {
  findRepositoryRoot,
  resolveGitRef,
} from '../runtime/infrastructure/adapters/repository.adapter';
import { ErrorCode, InvalidOptionsError, type IRDocument } from '@openref/core';
import { discoverChannels } from '../events/infrastructure/adapters/channel-discovery.adapter';
import { pairChannels } from '../events/domain/channel-pairing';
import { synthesizeEventsDocument } from '../events/domain/asyncapi-synthesis';
import { isEventsDocument, readSourceLink } from './module-options';
import type {
  OpenRefDocumentOptions,
  OpenRefEventsDocumentOptions,
  OpenRefRootOptions,
} from './module-options';
import type { DiscoveryProblem } from '../runtime/infrastructure/adapters/controller-discovery.adapter';
import type { CollectorTarget } from '../runtime/application/services/collector-registry.service';
import type { ChannelDirectionConfidence } from '../runtime/domain/relationships';
import type { SynthesizedChannel } from '../events/domain/asyncapi-synthesis';
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
  /**
   * What the event discovery of SPEC 8.3 could not state, for a synthesized events document.
   *
   * KEPT BESIDE THE PASS AND NOT FOLDED INTO IT, because they are found at two different moments
   * and about two different things. `pass.discoveryProblems` is what the runtime walk could not
   * read about routes that already exist; these are what the synthesis could not say about the
   * document it was building, and a reader of `doctor` needs both. Absent on every other entry.
   *
   * ALL SIX CASES OF SPEC 8.3 LAND HERE, IN THREE GROUPS, AND THE THIRD WAS MISSING UNTIL THE
   * REVIEW OF `T051`. The discovery contributes the unreadable pattern, the transport outside the
   * table and the gateway with no `@SubscribeMessage`; the synthesis contributes the protocol
   * whose host nobody configured and the payload class no schema answers to; the pairing
   * contributes the channel several handlers serve, and its list was built and thrown away.
   *
   * `doctor` PRINTS THIS SINCE `T054`, AND THE GROWTH IT NEEDED WAS TAKEN. This comment said
   * nothing printed it, which was true from `T019` until that task and false the moment it landed;
   * the post-`T054` review found the sentence still here. `IRDriftRule` gained `discovery-incomplete`,
   * code `RT070`, the carrier is `IRRuntimeMeta.problems`, and both lists reach it through the same
   * pass: these through `carriedProblems`, `pass.discoveryProblems` from the walk itself. They are
   * still kept here as well, because an integration suite reads this field to check the events half
   * on its own, which is what tells the two producers apart when the printed report merges them.
   */
  readonly eventProblems?: readonly DiscoveryProblem[];
}

/** Holds every document `forRoot` mounted, addressable by the id the host gave it. */
export class MountedReferences {
  private readonly mounted = new Map<string, MountedReference>();

  /** The federated reference this `forRoot` mounted, when its options named one. */
  private federatedService: FederatedReferenceService | undefined;

  /**
   * @param options - The validated root options
   * @param dependencies - What NestJS resolved for the pass
   */
  constructor(
    private readonly options: OpenRefRootOptions,
    private readonly dependencies: MountedReferencesDependencies,
  ) {}

  /**
   * Normalizes, collects and mounts every document, then the federation over them.
   *
   * Called by NestJS. It is idempotent, because a module imported twice would otherwise register
   * the route table twice and the second registration would never be reached.
   *
   * THE ORDER INSIDE THIS HOOK IS LOAD BEARING FOR SPEC 15.3: the documents mount first, so a
   * federation naming them as local services reads their augmented documents, runtime facts and
   * health included, from what was just mounted.
   *
   * @throws {ConfigError} When the http adapter is not available or is neither supported platform
   */
  onModuleInit(): void {
    const entries = this.options.documents ?? [];
    const federation = this.options.federation;
    if ((entries.length === 0 && federation === undefined) || this.mounted.size > 0) return;
    if (entries.length === 0 && this.federatedService !== undefined) return;

    const httpAdapter = this.dependencies.adapterHost.httpAdapter;
    if (httpAdapter === undefined) {
      throw new InvalidOptionsError(
        'forRoot ran before the http adapter existed, so no route could be registered',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    for (const entry of entries) this.mount(entry, httpAdapter);
    if (federation !== undefined) this.mountFederation(federation, httpAdapter);
  }

  /**
   * Ends every broker subscription, before the http server is asked to close.
   *
   * IT IS THIS HOOK AND NOT `onApplicationShutdown`, WHICH IS A DEFECT THIS PACKAGE'S OWN SUITE
   * CAUGHT. NestJS closes the http server between the two, and a server with an event stream still
   * open has a connection that never drains, so `app.close()` hung until a test's own hook timed
   * out. A bridge subscription is by construction the longest lived response this package can
   * produce, so it is the one that has to go first.
   *
   * IT IS ENDED WITH WORDS RATHER THAN DROPPED, per SPEC 14.8: a reader whose stream simply stops
   * cannot tell a deployment from a network that broke, and the closing event carries the reason
   * and the counts that subscription ended with. Safe to call twice, because closing a session
   * that is already closed does nothing.
   */
  onModuleDestroy(): void {
    for (const mounted of this.mounted.values()) {
      mounted.service.bridge.closeAll('this reference is shutting down');
    }
    this.federatedService?.bridgeSessions.closeAll('this reference is shutting down');
  }

  /**
   * Stops the federation's polling when the application shuts down.
   *
   * Called by NestJS when shutdown hooks are enabled, and safe to call twice. The last served
   * state stays readable, per the lifecycle's own contract, so an in flight reply can finish.
   */
  onApplicationShutdown(): void {
    this.federatedService?.remotes.stop();
  }

  /** The federated reference, when this `forRoot` mounted one. */
  get federated(): FederatedReferenceService | undefined {
    return this.federatedService;
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
    // WHAT THE PAIRING COULD NOT ATTRIBUTE IS COLLECTED HERE AND NOT DISCARDED, which it was until
    // the review of `T051`. `pairChannels` builds a problem for every channel several handlers
    // serve, which is SPEC 8.3's ambiguity rule and the one case of the six whose explanation a
    // reader most needs, and the pass that ran it threw the list away.
    let pairingProblems: readonly DiscoveryProblem[] = [];

    // THE EVENTS DOCUMENT IS BUILT BEFORE THE SERVICE, because the service normalizes whatever it
    // is given in its own constructor and the synthesis is what produces the thing to give it.
    // Everything after this line is the ordinary mount: one reference service, one route table,
    // one runtime pass, and the events half differs only in where the document came from.
    const synthesis = isEventsDocument(entry) ? this.synthesize(entry) : undefined;

    // The entry's own theme wins over the root default, per SPEC 13.2, and the theme's
    // `assets.css` and `bundle` are the defaults the narrower options override.
    const theme = entry.theme ?? this.options.theme;
    const stylesheets = entry.stylesheets ?? theme?.definition.assets?.css;
    const clientBundle = entry.clientBundle ?? theme?.bundle;

    const service = new ReferenceService({
      // `isEventsDocument` narrowed the entry above, and the synthesis is the one produced from
      // it, so the two branches are the two arms of that narrowing rather than a runtime guess.
      document: isEventsDocument(entry) ? synthesis?.document : entry.document,
      basePath,
      assets:
        entry.assetPlan ??
        loadDefaultAssets({
          ...(stylesheets === undefined ? {} : { stylesheets }),
          ...(clientBundle === undefined ? {} : { clientBundle }),
        }),
      ...(theme === undefined ? {} : { theme }),
      augment: (document: IRDocument): IRDocument => {
        // THE CHANNEL PAIRING HAPPENS AGAINST THE NORMALIZED DOCUMENT AND NOT AGAINST THE
        // SYNTHESIS, because the node id a fact is attached to is the normalizer's, per SPEC 8.2.
        // Pairing on the synthesis's own keys would need this package to re-derive that id, which
        // is the second spelling of one rule that `channel-pairing.ts` opens by refusing.
        const paired =
          synthesis === undefined ? undefined : pairChannels(document, synthesis.channels);
        if (paired !== undefined) pairingProblems = paired.problems;
        // THE EVENT PROBLEMS GO IN HERE, WHICH IS THE LAST MOMENT THEY CAN, per SPEC 8.3 as
        // amended by `T054`. Both halves are known by now, the synthesis's from the closure above
        // and the pairing's from the line above this one, and the pass is where the runtime meta
        // that carries them to `doctor` is built. They are still kept on the mount below, because
        // `eventProblems` is what an integration suite reads to check the events half on its own.
        pass = this.collect(
          document,
          paired?.targets,
          paired?.directionConfidence,
          synthesis === undefined ? undefined : [...synthesis.problems, ...pairingProblems],
        );
        return pass.document;
      },
      ...(entry.cache === undefined ? {} : { cache: entry.cache }),
      ...(entry.highlight === undefined ? {} : { highlight: entry.highlight }),
      ...(entry.lang === undefined ? {} : { lang: entry.lang }),
      ...(entry.colorScheme === undefined ? {} : { colorScheme: entry.colorScheme }),
      ...(entry.onError === undefined ? {} : { onError: entry.onError }),
      // Passed on since TX-VIS, which found it missing: `documents` entries are setup options plus
      // an id and a route, so the proxy option was accepted here and read by nothing. A host that
      // enabled the proxy on a `forRoot` document got the permanent 403 of a proxy that is off.
      ...(entry.proxy === undefined ? {} : { proxy: entry.proxy }),
      // THE BRIDGE OF SPEC 14.8 TRAVELS THE SAME ROUTE AND FOR THE SAME REASON THE LINE ABOVE
      // GIVES. It is an option a host writes on a mount and it has to reach the service that
      // answers that mount's routes, or an enabled bridge answers the 403 of a bridge that is off.
      ...(entry.bridge === undefined ? {} : { bridge: entry.bridge }),
    });

    // THE ADMISSION IS BUILT BEFORE THE ADAPTER AND THROWS RATHER THAN WARNS. A guard the container
    // cannot resolve stops the boot here, per SPEC 19.6, which is the last moment before the route
    // table exists and therefore the last moment a refusal costs nobody a served page.
    const admission = admissionFor(
      `the document "${entry.id}"`,
      entry,
      (token) => this.dependencies.moduleRef.get(token, { strict: false }),
      entry.onError,
    );

    const adapter = createReferenceAdapter(httpAdapter, admission, {
      ...(entry.nonce === undefined ? {} : { nonce: entry.nonce }),
      ...(entry.onError === undefined ? {} : { onError: entry.onError }),
    });

    mountRouteTable(adapter, {
      basePath,
      health: this.options.runtime?.health ?? true,
      handle: async (id, request) => service.handle(id, request),
    });

    // `augment` is called by the constructor above, synchronously, so this is defined by the
    // time it is read. It is checked rather than asserted because the alternative is a cast.
    if (pass === undefined) {
      throw new InvalidOptionsError(
        'the runtime pass did not run while the document was normalized',
        ErrorCode.CONFIG_INVALID_OPTIONS,
      );
    }

    this.mounted.set(entry.id, {
      id: entry.id,
      basePath,
      service,
      pass,
      ...(synthesis === undefined
        ? {}
        : { eventProblems: [...synthesis.problems, ...pairingProblems] }),
    });
  }

  /**
   * Builds the AsyncAPI document one events entry stands for, per SPEC 8.3.
   *
   * @param entry - The events entry
   * @returns The document to normalize and the channels the runtime pairing needs
   */
  private synthesize(entry: OpenRefEventsDocumentOptions): {
    readonly document: Record<string, unknown>;
    readonly channels: readonly SynthesizedChannel[];
    readonly problems: readonly DiscoveryProblem[];
  } {
    const discovered = discoverChannels(this.dependencies.discovery);
    const synthesized = synthesizeEventsDocument(discovered.channels, {
      title: entry.title ?? entry.id,
      // `runtime` rather than a number, for the reason the federated header uses `federated`:
      // the document has no version of its own, it is whatever the application is right now,
      // and a made up `1.0.0` would be a claim about compatibility nobody made.
      version: entry.version ?? 'runtime',
      ...(entry.description === undefined ? {} : { description: entry.description }),
      ...(entry.servers === undefined ? {} : { servers: entry.servers }),
      ...(entry.schemas === undefined ? {} : { schemas: entry.schemas }),
    });

    return {
      document: synthesized.document,
      channels: synthesized.channels,
      problems: [...discovered.problems, ...synthesized.problems],
    };
  }

  /**
   * Builds and registers the federated reference, per SPEC 15.3.
   *
   * THE LIFECYCLE STARTS AND IS NOT AWAITED. Routes must exist before `listen`, and
   * `snapshot()` is correct at every moment of the first round: a mixed federation serves its
   * local services while the first fetches are in flight, and a remote-only one answers 503
   * with the reason until one lands, which is the degrade principle at second zero.
   *
   * @param federation - The validated federation options
   * @param httpAdapter - The adapter to register the routes on
   */
  private mountFederation(
    federation: NonNullable<OpenRefRootOptions['federation']>,
    httpAdapter: NonNullable<HttpAdapterHostLike['httpAdapter']>,
  ): void {
    const basePath = normalizeRoute(federation.route);

    // The locals are the documents this hook just mounted, read back by id: their documents
    // carry the runtime pass's facts and the retaken hash, which is the whole reason SPEC 15.3
    // admits local services at all.
    const locals: FederationService[] = (federation.services ?? []).map((local) => {
      const mounted = this.mounted.get(local.id);
      if (mounted === undefined) {
        throw new InvalidOptionsError(
          `the federation names the local service "${local.id}", and no documents entry ` +
            'carries that id',
          ErrorCode.CONFIG_INVALID_OPTIONS,
          undefined,
          { serviceId: local.id },
        );
      }

      return {
        id: local.id,
        document: mounted.service.document,
        ...(local.prefix === undefined ? {} : { prefix: local.prefix }),
      };
    });

    const lifecycle = new RemoteLifecycleService({
      remotes: federation.remotes ?? [],
      ...(locals.length === 0 ? {} : { services: locals }),
      document: {
        id: federation.id,
        info: {
          title: federation.title ?? federation.id,
          version: federation.version ?? 'federated',
          ...(federation.description === undefined ? {} : { description: federation.description }),
        },
        ...(federation.servers === undefined ? {} : { servers: federation.servers }),
        ...(federation.onConflict === undefined ? {} : { onConflict: federation.onConflict }),
      },
      ...(federation.refreshMs === undefined ? {} : { refreshMs: federation.refreshMs }),
      ...(federation.timeoutMs === undefined ? {} : { timeoutMs: federation.timeoutMs }),
      ...(federation.failureMode === undefined ? {} : { failureMode: federation.failureMode }),
      ...(federation.store === undefined ? {} : { cache: federation.store }),
    });

    const theme = federation.theme ?? this.options.theme;
    const stylesheets = federation.stylesheets ?? theme?.definition.assets?.css;
    const clientBundle = federation.clientBundle ?? theme?.bundle;

    const service = new FederatedReferenceService(lifecycle, {
      basePath,
      assets:
        federation.assetPlan ??
        loadDefaultAssets({
          ...(stylesheets === undefined ? {} : { stylesheets }),
          ...(clientBundle === undefined ? {} : { clientBundle }),
        }),
      ...(theme === undefined ? {} : { theme }),
      ...(federation.cache === undefined ? {} : { cache: federation.cache }),
      ...(federation.highlight === undefined ? {} : { highlight: federation.highlight }),
      ...(federation.lang === undefined ? {} : { lang: federation.lang }),
      ...(federation.colorScheme === undefined ? {} : { colorScheme: federation.colorScheme }),
      ...(federation.onError === undefined ? {} : { onError: federation.onError }),
      ...(federation.proxy === undefined ? {} : { proxy: federation.proxy }),
      ...(federation.bridge === undefined ? {} : { bridge: federation.bridge }),
    });

    const admission = admissionFor(
      'the federated reference',
      federation,
      (token) => this.dependencies.moduleRef.get(token, { strict: false }),
      federation.onError,
    );

    const adapter = createReferenceAdapter(httpAdapter, admission, {
      ...(federation.nonce === undefined ? {} : { nonce: federation.nonce }),
      ...(federation.onError === undefined ? {} : { onError: federation.onError }),
    });

    mountRouteTable(adapter, {
      basePath,
      health: this.options.runtime?.health ?? true,
      handle: async (id, request) => service.handle(id, request),
    });

    this.federatedService = service;
    void lifecycle.start();
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
   * THE PAIRING IS THE CALLER'S AND NOT THIS METHOD'S, since the review of `T051`. It used to run
   * here, and its second half, the channels no fact could be attributed to, had nowhere to go: this
   * method returns one pass result and the problems are not part of one. The caller runs
   * `pairChannels` and keeps both halves, which is what put SPEC 8.3's ambiguity explanation into
   * `MountedReference.eventProblems` instead of dropping it on the floor.
   *
   * @param document - The document, before any runtime fact
   * @param channelTargets - Channels paired with their handler, when there are any
   * @param directionConfidence - How each synthesized channel's direction was read, per SPEC 9.3
   * @param carriedProblems - What the event discovery found and could not state, per SPEC 8.3
   * @returns The pass result, whose document carries the facts and a retaken hash
   */
  collect(
    document: IRDocument,
    channelTargets?: readonly CollectorTarget[],
    directionConfidence?: ChannelDirectionConfidence,
    carriedProblems?: readonly DiscoveryProblem[],
  ): RuntimePassResult {
    const runtime = this.options.runtime;
    const version = nestCoreVersion();
    const template = this.sourceLinkTemplate();

    return runRuntimePass(document, {
      collectors: runtime?.collectors ?? [],
      discovery: this.dependencies.discovery,
      reflector: this.dependencies.reflector,
      moduleRef: this.dependencies.moduleRef,
      ...(template === undefined ? {} : { sourceLinkTemplate: template }),
      ...(version === undefined ? {} : { nestVersion: version }),
      ...(runtime?.guardSecuritySchemes === undefined
        ? {}
        : { guardSecuritySchemes: runtime.guardSecuritySchemes }),
      ...(channelTargets === undefined ? {} : { channelTargets }),
      ...(directionConfidence === undefined
        ? {}
        : { channelDirectionConfidence: directionConfidence }),
      ...(carriedProblems === undefined ? {} : { carriedProblems }),
    });
  }

  /**
   * The template as it goes into the document, with `{ref}` already resolved.
   *
   * THE REVISION IS SUBSTITUTED HERE AND NOT AT RENDER TIME, because it is a property of the
   * build environment and the renderer does not run in one. `IRRuntimeMeta.sourceLinkTemplate`
   * then holds a template with two placeholders left, `{file}` and `{line}`, which is exactly
   * what a node's own `source` fills. The alternative, carrying the revision as a second field
   * of the meta, would put the same string in the document once and ask every consumer to
   * remember to combine them.
   *
   * WHEN NO REVISION CAN BE FOUND THE PLACEHOLDER STAYS, deliberately. `expandSourceLink` then
   * refuses the link and names `{ref}` and the option that supplies it, which is a reader being
   * told why there is no link rather than a link to a branch nobody asked for.
   *
   * @returns The template, or undefined when the host configured none
   */
  private sourceLinkTemplate(): string | undefined {
    const configured = readSourceLink(this.options.runtime?.sourceLink);
    if (configured === undefined) return undefined;
    if (!configured.template.includes('{ref}')) return configured.template;

    const root = findRepositoryRoot(process.cwd());
    const ref = configured.ref ?? (root === undefined ? undefined : resolveGitRef(root));

    return ref === undefined ? configured.template : configured.template.replaceAll('{ref}', ref);
  }
}

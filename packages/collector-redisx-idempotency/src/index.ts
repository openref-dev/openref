/**
 * `@openref/collector-redisx-idempotency`: the statuses an idempotent route can answer with.
 *
 * IT IS ITS OWN PACKAGE AND NOT PART OF `@openref/nest`, per SPEC 4, for the reason every ecosystem
 * collector is: the edge would put a Redis library into the closure of every application that
 * installs the reference, including the ones that are idempotent about nothing. Both packages it
 * needs are peers, and so is the one it exists to read.
 *
 * WHAT IT REPORTS IS AN ERROR CONTRACT AND NOT A NEW SHAPE, which is why nothing in `@openref/core`
 * moved for it. `IRErrorContracts.runtimeDerived` already means "derived from facts collected about
 * the route", `mergeContributions` already accumulates the three groups across collectors rather
 * than letting one own them, and `error-undocumented` already compares that group against what the
 * document declares. A route that answers 409 and says so nowhere is exactly the drift finding this
 * project exists to produce, so the fact travels the path that was already built for it.
 *
 * THE DECORATOR BINDS THE INTERCEPTOR ITSELF, AND THAT IS THE WHOLE REASON THIS PACKAGE EXISTS
 * WHILE A CACHE ONE DOES NOT. `@Idempotent` is `applyDecorators(SetMetadata(IDEMPOTENT_OPTIONS,
 * options), UseInterceptors(IdempotencyInterceptor))`, so the presence of the key is proof the
 * behaviour is active on that route. The same library's `@Cacheable` is a bare `SetMetadata` whose
 * interceptor is registered by nobody, so its key proves an intention and not a behaviour.
 *
 * ONLY THE TWO REACHABLE STATUSES ARE REPORTED, AND THAT WAS READ OFF THE SOURCE RATHER THAN OFF THE
 * FILTER'S TABLE. `IdempotencyExceptionFilter` maps five errors to four statuses, and two of those
 * errors are constructed nowhere in the library: `IdempotencyKeyRequiredError`, the 400, has no
 * throw site at all because a request with no key is a plain passthrough, and
 * `IdempotencyRecordNotFoundError`, one of the three 409 variants, is guarded by a comment in the
 * filter saying it should be unreachable. Reporting either would put a status on an operation that
 * the application cannot produce, which is the guess CLAUDE.md rule 5 forbids.
 */

import { createRequire } from 'node:module';
import type { IRErrorContract, IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-redisx-idempotency';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const REDISX_IDEMPOTENCY_COLLECTOR_NAME = 'redisxIdempotencyCollector';

/** The package this collector exists to read. */
export const REDISX_IDEMPOTENCY_PACKAGE = '@nestjs-redisx/idempotency';

/**
 * The key the library writes its route options under.
 *
 * `Symbol.for` AND NOT AN IMPORT, for the reason `@openref/collector-redisx-rate-limit` gives about
 * its own key: the global symbol registry is keyed by the string, so this expression yields the same
 * symbol the library's own module yields without loading it, and the collector reads metadata rather
 * than running code. The package is still resolved, in {@link isPackageInstalled}, because a global
 * symbol is available whether or not the library that names it is present.
 */
export const IDEMPOTENT_OPTIONS_KEY: symbol = Symbol.for('IDEMPOTENT_OPTIONS');

/** The DI token the library registers its merged plugin configuration under. */
export const IDEMPOTENCY_PLUGIN_OPTIONS_KEY: symbol = Symbol.for('IDEMPOTENCY_PLUGIN_OPTIONS');

/** The header the library falls back to when the plugin names none. */
export const DEFAULT_HEADER_NAME = 'Idempotency-Key';

/** The status a reused key answers with while the first request is still in flight, or failed. */
export const CONFLICT_STATUS = 409;

/** The status a reused key answers with when the request it repeats is not the same request. */
export const FINGERPRINT_STATUS = 422;

/** What a host may tell the collector that it cannot work out for itself. */
export interface RedisxIdempotencyCollectorOptions {
  /**
   * Whether the library this collector reads is installed.
   *
   * Injected by the tests and by nothing else. It is a seam because the two behaviours worth
   * pinning, the skip and the run, cannot both be reached in a repository that has one tree.
   */
  readonly resolvePackage?: () => boolean;

  /**
   * How metadata is read off one target.
   *
   * `Reflect` with `reflect-metadata` loaded is the real one, and NestJS loads it before any
   * application code runs. It is a seam for the same reason as above.
   */
  readonly metadata?: MetadataValueReader;
}

/**
 * Reading one key off one target, which is all this collector does.
 *
 * THE NAME IS THE ONE `@openref/collector-redisx-rate-limit` USES AND THE SHAPE IS THE SAME SHAPE.
 * Two published packages exporting one name with two shapes is a defect this repository has already
 * catalogued; two exporting one name with one shape is the contract holding.
 */
export interface MetadataValueReader {
  get(key: string | symbol, target: unknown): unknown;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface RedisxIdempotencyCollectorProblem {
  /** `OrdersController.create`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface RedisxIdempotencyCollector extends IRuntimeCollector {
  problems(): readonly RedisxIdempotencyCollectorProblem[];
}

/** What the factory returns, since an absent library means it does not run at all. */
export type RedisxIdempotencyCollectorRegistration = RedisxIdempotencyCollector | SkippedCollector;

/**
 * The options object the library stores, as much of it as this collector reads.
 *
 * EVERY FIELD IS `unknown` BECAUSE THE VALUE IS SOMEBODY ELSE'S OBJECT. It arrives from a decorator
 * in the host application through a metadata key, so nothing between the two checked its shape, and
 * a declared type here would be an assertion rather than a reading.
 */
interface StoredOptions {
  readonly keyExtractor?: unknown;
  readonly skip?: unknown;
  readonly validateFingerprint?: unknown;
  readonly cacheHeaders?: unknown;
  readonly ttl?: unknown;
}

/** What the library's own merged plugin configuration states, as much as is read here. */
export interface PluginConfiguration {
  /** `headerName`, which is the header a request carries its key in. */
  readonly headerName: string;
  /** `validateFingerprint`, which decides whether a reused key can answer 422 at all. */
  readonly validateFingerprint: boolean;
}

/**
 * Builds the redisx idempotency collector.
 *
 * @param options - Seams for the tests; a host passes nothing
 * @returns The collector, or a skip naming what was missing
 */
export function redisxIdempotencyCollector(
  options: RedisxIdempotencyCollectorOptions = {},
): RedisxIdempotencyCollectorRegistration {
  if (!(options.resolvePackage ?? isPackageInstalled)()) {
    return {
      name: REDISX_IDEMPOTENCY_COLLECTOR_NAME,
      skipped:
        `${REDISX_IDEMPOTENCY_PACKAGE} is not installed, so nothing in this application writes the ` +
        'metadata this collector reads and no route replays a response. Installing it is the fix; ' +
        'nothing here guesses a status',
    };
  }

  const metadata = options.metadata ?? globalMetadataReader();
  if (metadata === undefined) {
    return {
      name: REDISX_IDEMPOTENCY_COLLECTOR_NAME,
      skipped:
        'the runtime offers no metadata reflection, so the idempotency options cannot be read. ' +
        '`reflect-metadata` is loaded by NestJS itself, so this means the collector is running ' +
        'outside a NestJS application',
    };
  }

  const problems: RedisxIdempotencyCollectorProblem[] = [];
  // THE PLUGIN CONFIGURATION IS READ ONCE PER PASS AND NOT ONCE PER ROUTE. It is one provider value
  // for the whole application and it cannot change between two nodes of one pass, so a thousand
  // routes must not pay for a thousand container lookups. `null` distinguishes "asked and there was
  // none" from `undefined`, "not asked yet".
  let plugin: PluginConfiguration | null | undefined;

  return {
    name: REDISX_IDEMPOTENCY_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      // THE HANDLER AND THE CONTROLLER ARE TWO DIFFERENT QUESTIONS HERE, WHICH IS NOT HOW THE RATE
      // LIMIT COLLECTOR BESIDE THIS ONE WORKS, and the asymmetry is the library's. Its interceptor
      // is bound by whichever target carries the decorator, so either one activates the route;
      // its options are read with `reflector.get(IDEMPOTENT_OPTIONS, context.getHandler())`, so
      // only the handler's are ever used. Merging the two would report a ttl nobody applies.
      const onHandler = readOptions(metadata, context.handler);
      const onController = readOptions(metadata, context.controller);

      if (onHandler === undefined && onController === undefined) return undefined;

      const subject = `${context.declaredOn.name}.${context.handlerName}`;

      if (plugin === undefined) plugin = readPluginConfiguration(context) ?? null;

      if (onHandler === undefined && onController !== undefined) {
        recordControllerOptions(onController, subject, problems);
      }

      const declared = onHandler ?? {};
      recordUnreadable(declared, subject, problems);

      const contracts = buildContracts(declared, plugin, subject, problems);

      return {
        errors: { declared: [], runtimeDerived: contracts, global: [] },
      };
    },

    problems(): readonly RedisxIdempotencyCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Builds the statuses the route can answer with, and records what decided against one.
 *
 * THE CONFLICT IS UNCONDITIONAL AND THE OTHER ONE IS NOT. A route whose interceptor is bound can
 * always meet a key that is still in flight past `waitTimeout` or whose first attempt failed, and
 * both of those are `IdempotencyTimeoutError` and `IdempotencyFailedError`, both thrown, both 409.
 * The 422 exists only where the library compares fingerprints, and that comparison is
 * `options.validateFingerprint ?? config.validateFingerprint ?? true`, read in that order.
 *
 * @param declared - What the handler's own decorator stored
 * @param plugin - The merged plugin configuration, or null when nothing registered it
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The contracts, in ascending status order
 */
function buildContracts(
  declared: StoredOptions,
  plugin: PluginConfiguration | null,
  subject: string,
  problems: RedisxIdempotencyCollectorProblem[],
): readonly IRErrorContract[] {
  const contracts: IRErrorContract[] = [
    {
      status: CONFLICT_STATUS,
      title: 'The idempotency key is already in use',
      detail:
        "The request repeats a key whose first attempt is still running past the plugin's " +
        'waitTimeout, or whose first attempt failed. Both are answered by ' +
        'IdempotencyExceptionFilter.',
      origin: 'runtime-derived',
      confidence: 'derived',
      collector: REDISX_IDEMPOTENCY_COLLECTOR_NAME,
    },
  ];

  const validating = resolveValidation(declared, plugin);

  if (validating === undefined) {
    problems.push({
      subject,
      reason:
        'the plugin configuration was not resolvable, so whether a reused key can answer 422 is not known',
      action:
        'declare validateFingerprint on @Idempotent to make the answer a fact about this route',
      detail:
        'The library resolves it as the decorator option, then the plugin option, then true. The ' +
        'plugin option is registered under Symbol.for("IDEMPOTENCY_PLUGIN_OPTIONS") and nothing ' +
        'answered that token here, so the 422 is left off rather than assumed.',
    });

    return contracts;
  }

  if (!validating) return contracts;

  contracts.push({
    status: FINGERPRINT_STATUS,
    title: 'The idempotency key was reused for a different request',
    detail:
      'The key repeats one already recorded and the request fingerprint does not match the ' +
      'recorded one, so the stored response is not replayed.',
    origin: 'runtime-derived',
    confidence: 'derived',
    collector: REDISX_IDEMPOTENCY_COLLECTOR_NAME,
  });

  return contracts;
}

/**
 * Says whether the library compares fingerprints on this route, when that is knowable.
 *
 * @param declared - What the handler's own decorator stored
 * @param plugin - The merged plugin configuration, or null when nothing registered it
 * @returns True or false when the answer is read, undefined when nothing states it
 */
function resolveValidation(
  declared: StoredOptions,
  plugin: PluginConfiguration | null,
): boolean | undefined {
  if (typeof declared.validateFingerprint === 'boolean') return declared.validateFingerprint;

  return plugin === null ? undefined : plugin.validateFingerprint;
}

/**
 * Reads the library's own merged plugin configuration out of the container.
 *
 * IT IS REACHED THE WAY `@openref/collector-redisx-rate-limit` REACHES ITS OWN, and for the same
 * measured reason: the plugin registers `{ provide: IDEMPOTENCY_PLUGIN_OPTIONS, useValue:
 * IdempotencyPlugin.mergeDefaults(options) }` and puts the same token in `getExports()`, so the
 * token answers whether the hosting module is global or plainly imported, and throws
 * `UnknownElementException` when nothing registered it.
 *
 * IT IS CONFIGURATION AND NOT A ROUTE FACT, so nothing read here is written onto a node as its own
 * value. What it decides is whether a status this route can answer with is knowable at all.
 *
 * @param context - The node's context, for the module reference
 * @returns The two fields read, or undefined when the token answers nothing usable
 */
function readPluginConfiguration(context: CollectorContext): PluginConfiguration | undefined {
  let value: unknown;
  try {
    value = context.moduleRef.get(IDEMPOTENCY_PLUGIN_OPTIONS_KEY, { strict: false });
  } catch {
    // `UnknownElementException` is the ordinary answer in an application that installed the
    // library and never registered the plugin, so it is not a failure and produces no problem.
    return undefined;
  }

  if (typeof value !== 'object' || value === null) return undefined;

  const { headerName, validateFingerprint } = value as {
    headerName?: unknown;
    validateFingerprint?: unknown;
  };

  return {
    headerName:
      typeof headerName === 'string' && headerName !== '' ? headerName : DEFAULT_HEADER_NAME,
    // `mergeDefaults` fills this in, so a registered plugin always states it. A registration that
    // somehow did not is read as the library's own fallback rather than as unknown, because the
    // library's own `?? true` is what the request will take.
    validateFingerprint: typeof validateFingerprint === 'boolean' ? validateFingerprint : true,
  };
}

/**
 * Records a decorator on the controller whose options the library will never read.
 *
 * IT IS A FACT ABOUT THE ROUTE THAT LOOKS LIKE A CONFIGURATION AND IS NOT ONE. `@Idempotent({ ttl:
 * 60 })` on a controller binds the interceptor to every route on it, so the routes are idempotent;
 * the interceptor then reads its options from the handler alone, so the ttl is discarded in silence.
 * A reference that said nothing here would leave a reader believing a window that is not applied.
 *
 * @param onController - What the controller's decorator stored
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordControllerOptions(
  onController: StoredOptions,
  subject: string,
  problems: RedisxIdempotencyCollectorProblem[],
): void {
  const named = Object.keys(onController);
  if (named.length === 0) return;

  problems.push({
    subject,
    reason: `@Idempotent is on the controller and the library reads its options off the handler, so ${named.join(', ')} is not applied`,
    action: 'move the options onto the method, where the interceptor reads them',
    detail:
      'The decorator on the controller binds the interceptor to every route on it, so the route ' +
      'is idempotent. The interceptor then reads the options with reflector.get(key, ' +
      'context.getHandler()), which is the handler and never the class.',
  });
}

/**
 * Records what the route decided in code, which is never read.
 *
 * SPEC 6.1 FORBIDS READING INTERCEPTOR LOGIC WITHOUT QUALIFICATION, and both of these are exactly
 * that stored under a key. `keyExtractor` decides what the request is keyed by and `skip` decides
 * whether the route is idempotent for this request at all, so the difference between "keyed by the
 * header" and "keyed by a function nobody can read" has to be visible.
 *
 * @param declared - What the handler's own decorator stored
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordUnreadable(
  declared: StoredOptions,
  subject: string,
  problems: RedisxIdempotencyCollectorProblem[],
): void {
  if (typeof declared.keyExtractor === 'function') {
    problems.push({
      subject,
      reason:
        'its key comes from a keyExtractor function, so what a caller must send to repeat a request is not known',
      action:
        'nothing to do here: the statuses shown hold either way, and this says the key is not the header',
      detail:
        'A function under a key is never read, per SPEC 6.1. Without it the key is the header the ' +
        'plugin names, which defaults to Idempotency-Key.',
    });
  }

  if (typeof declared.skip === 'function') {
    problems.push({
      subject,
      reason:
        'it carries a skip function, so which requests are handled idempotently at all is not known',
      action: 'nothing to do here: the statuses shown are what a handled request can answer with',
      detail:
        'Which requests the function skips is written in code this never reads, per SPEC 6.1.',
    });
  }
}

/**
 * Reads the options object off one target.
 *
 * `@Idempotent()` WITH NO ARGUMENT STORES `{}` AND NOT `undefined`, which is the opposite of
 * `@RateLimit()` beside it: the library defaults the parameter before it calls `SetMetadata`. So an
 * empty object here is a decorated route rather than an undecorated one, and the two are told apart
 * by presence rather than by content.
 *
 * @param metadata - The reader
 * @param target - Controller class or handler
 * @returns The stored object, or undefined when the key is absent or holds something else
 */
function readOptions(metadata: MetadataValueReader, target: unknown): StoredOptions | undefined {
  const stored: unknown = metadata.get(IDEMPOTENT_OPTIONS_KEY, target);

  return typeof stored === 'object' && stored !== null ? stored : undefined;
}

/**
 * Reports whether the library this collector reads is installed.
 *
 * THE ENTRY POINT RATHER THAN THE MANIFEST, AND NOT BY PREFERENCE. This library's `exports` map
 * declares only `"."`, so asking for `@nestjs-redisx/idempotency/package.json` fails with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED` on an installation where the package is present and working.
 * Resolving the entry point answers the only question being asked, is it installed.
 *
 * IT RESOLVES AND NEVER REQUIRES: `resolve` walks the lookup and hands back a path, and nothing in
 * the library is evaluated.
 *
 * @returns True when the package is resolvable from here
 */
function isPackageInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(REDISX_IDEMPOTENCY_PACKAGE);

    return true;
  } catch {
    return false;
  }
}

/**
 * The metadata reader the runtime provides, when it provides one.
 *
 * @returns A reader over the global `Reflect`, or undefined when `reflect-metadata` is not loaded
 */
function globalMetadataReader(): MetadataValueReader | undefined {
  const reflect = Reflect as unknown as {
    getMetadata?: (key: unknown, target: unknown) => unknown;
  };

  const get = reflect.getMetadata;
  if (typeof get !== 'function') return undefined;

  return {
    get(key: string | symbol, target: unknown): unknown {
      return get.call(Reflect, key, target);
    },
  };
}

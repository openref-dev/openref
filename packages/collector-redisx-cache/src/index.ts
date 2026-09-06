/**
 * `@openref/collector-redisx-cache`: what a handler declares about caching its own response.
 *
 * IT IS ITS OWN PACKAGE AND NOT PART OF `@openref/nest`, per SPEC 4, for the reason every ecosystem
 * collector is: the edge would put a Redis library into the closure of every application that
 * installs the reference, including the ones that cache nothing. Both packages it needs are peers,
 * and so is the one it exists to read.
 *
 * IT WAS REFUSED TWICE ON A CRITERION THAT WAS WRONG, AND THE CORRECTION IS THE REASON IT EXISTS.
 * The refusals were "the interceptor is registered by nobody, so the decorators are inert" and
 * "`@Cached` often sits on a service". Neither is a reason to withhold a fact. OPENREF reports what
 * an application DECLARES, with a confidence and a collector beside it, and a handler declaring a
 * ttl, a key template, tags or a stale window is telling a reader something no OpenAPI field
 * carries. What the first refusal was actually about is REACH, which is now a member of the fact:
 * see {@link IRHandlerPolicyReach}. What the second was about is POSITION, and it answers itself,
 * because this collector is handed route handlers and never sees a service method at all.
 *
 * THE LIBRARY SHIPS TWO FAMILIES OF DECORATOR UNDER ONE NAME AND THEY ARE NOT THE SAME FACT.
 * `@Cached`, `@InvalidateTags` and `@InvalidateOn` replace the method with a wrapper the instant
 * they are applied and write their options onto that wrapper, so the key's presence is proof the
 * behaviour is bound to the route. `@Cacheable`, `@CachePut` and `@CacheEvict` are bare
 * `SetMetadata` calls whose reader is `CacheInterceptor`, which the library exports and registers
 * nowhere: measured over its whole source, the only occurrences are the class declaration, its own
 * logger and a `@UseInterceptors` line inside a doc comment. So those three are reported at
 * `unbound` reach rather than withheld, which is what "say it in the fact's own words" asks for.
 *
 * NO ERROR CONTRACT IS REPORTED, AND THAT IS A MEASUREMENT. `@nestjs-redisx/cache` contains no
 * `ExceptionFilter`, no `HttpException` and no `HttpStatus` anywhere in its source; a cache miss
 * runs the method and a cache failure runs it too, per its own fail open policy. There is no status
 * to put in `IRErrorContracts.runtimeDerived`, and inventing one would be the guess CLAUDE.md rule
 * 5 forbids.
 */

import { createRequire } from 'node:module';
import type { IRHandlerPolicy, IRHandlerPolicySetting, IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-redisx-cache';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const REDISX_CACHE_COLLECTOR_NAME = 'redisxCacheCollector';

/** The package this collector exists to read. */
export const REDISX_CACHE_PACKAGE = '@nestjs-redisx/cache';

/**
 * The key `@Cached` writes its options under.
 *
 * A STRING AND NOT A SYMBOL, WHICH IS THE OPPOSITE OF THE TWO REDISX COLLECTORS BESIDE THIS ONE.
 * `@nestjs-redisx/rate-limit` and `@nestjs-redisx/idempotency` both key on `Symbol.for`, so those
 * packages reach the same key without loading the library; this one uses plain strings for its own
 * three keys and a global symbol for the other two, so both forms appear here. Neither needs the
 * library loaded, and both are still guarded by {@link isPackageInstalled} for the reason
 * `@openref/collector-redisx-rate-limit` gives: a generic key is a key a second library could claim.
 */
export const CACHED_OPTIONS_KEY = 'cache:options';

/** The key `@InvalidateTags` writes its options under. */
export const INVALIDATE_TAGS_KEY = 'cache:invalidate:tags';

/** The key `@InvalidateOn` writes its options under. */
export const INVALIDATE_ON_KEY: symbol = Symbol.for('INVALIDATE_ON_OPTIONS');

/** The key `@Cacheable` writes its options under, whose reader the library registers nowhere. */
export const CACHEABLE_KEY = 'cache:cacheable';

/** The key `@CachePut` writes its options under, whose reader the library registers nowhere. */
export const CACHE_PUT_KEY = 'cache:put';

/** The key `@CacheEvict` writes its options under, whose reader the library registers nowhere. */
export const CACHE_EVICT_KEY = 'cache:evict';

/** Milliseconds in the second `@Cached({ ttl })` is written in. */
export const MILLISECONDS_PER_SECOND = 1000;

/** What a host may tell the collector that it cannot work out for itself. */
export interface RedisxCacheCollectorOptions {
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
 * THE NAME AND THE SHAPE ARE THE ONES THE TWO REDISX COLLECTORS BESIDE THIS ONE ALREADY EXPORT.
 * Two published packages exporting one name with two shapes is a defect this repository has
 * catalogued twice; three exporting one name with one shape is the contract holding.
 */
export interface MetadataValueReader {
  get(key: string | symbol, target: unknown): unknown;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface RedisxCacheCollectorProblem {
  /** `OrdersController.list`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface RedisxCacheCollector extends IRuntimeCollector {
  problems(): readonly RedisxCacheCollectorProblem[];
}

/** What the factory returns, since an absent library means it does not run at all. */
export type RedisxCacheCollectorRegistration = RedisxCacheCollector | SkippedCollector;

/**
 * The options object the library stores, as much of it as this collector reads.
 *
 * EVERY FIELD IS `unknown` BECAUSE THE VALUE IS SOMEBODY ELSE'S OBJECT. It arrives from a decorator
 * in the host application through a metadata key, so nothing between the two checked its shape, and
 * a declared type here would be an assertion rather than a reading.
 */
interface StoredCached {
  readonly key?: unknown;
  readonly ttl?: unknown;
  readonly tags?: unknown;
  readonly strategy?: unknown;
  readonly condition?: unknown;
  readonly unless?: unknown;
  readonly varyBy?: unknown;
  readonly contextKeys?: unknown;
  readonly swr?: unknown;
  readonly staleIfError?: unknown;
}

/** What `@InvalidateTags` stores. */
interface StoredInvalidateTags {
  readonly tags?: unknown;
  readonly when?: unknown;
}

/** What `@InvalidateOn` stores. */
interface StoredInvalidateOn {
  readonly events?: unknown;
  readonly tags?: unknown;
  readonly keys?: unknown;
  readonly condition?: unknown;
  readonly publish?: unknown;
}

/** The three decorators whose reader the library registers nowhere, with the names a reader uses. */
const UNBOUND_KEYS: readonly (readonly [string, string])[] = [
  [CACHEABLE_KEY, '@Cacheable'],
  [CACHE_PUT_KEY, '@CachePut'],
  [CACHE_EVICT_KEY, '@CacheEvict'],
];

/**
 * Builds the redisx cache collector.
 *
 * @param options - Seams for the tests; a host passes nothing
 * @returns The collector, or a skip naming what was missing
 */
export function redisxCacheCollector(
  options: RedisxCacheCollectorOptions = {},
): RedisxCacheCollectorRegistration {
  if (!(options.resolvePackage ?? isPackageInstalled)()) {
    return {
      name: REDISX_CACHE_COLLECTOR_NAME,
      skipped:
        `${REDISX_CACHE_PACKAGE} is not installed, so nothing in this application writes the ` +
        'metadata this collector reads and no route declares a cache. Installing it is the fix; ' +
        'nothing here guesses a ttl',
    };
  }

  const metadata = options.metadata ?? globalMetadataReader();
  if (metadata === undefined) {
    return {
      name: REDISX_CACHE_COLLECTOR_NAME,
      skipped:
        'the runtime offers no metadata reflection, so the cache options cannot be read. ' +
        '`reflect-metadata` is loaded by NestJS itself, so this means the collector is running ' +
        'outside a NestJS application',
    };
  }

  const problems: RedisxCacheCollectorProblem[] = [];

  return {
    name: REDISX_CACHE_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      // THE HANDLER AND ONLY THE HANDLER, WHICH IS NOT A NARROWING BUT THE LIBRARY'S OWN SHAPE.
      // Every one of the six decorators is a `MethodDecorator`, so none of them can stand on the
      // controller class, and the three proxy based ones write onto the wrapper function that
      // REPLACES the method, which is the value `CollectorContext.handler` holds. Reading the
      // controller as well would ask a question the library never answers.
      const subject = `${context.declaredOn.name}.${context.handlerName}`;
      const policies: IRHandlerPolicy[] = [];

      // THE THREE CASTS ARE THE ONLY PLACE SOMEBODY ELSE'S OBJECT IS GIVEN A NAME, and each
      // `Stored*` type declares every member `unknown` for exactly that reason: the cast admits
      // that a shape was assumed, and nothing downstream trusts a member's type without checking
      // it. A declared return type on the reader would have hidden the assumption instead.
      const cached = readObject(metadata, CACHED_OPTIONS_KEY, context.handler) as
        StoredCached | undefined;
      if (cached !== undefined) policies.push(cachedPolicy(cached, subject, problems));

      const invalidateTags = readObject(metadata, INVALIDATE_TAGS_KEY, context.handler) as
        StoredInvalidateTags | undefined;
      if (invalidateTags !== undefined) {
        policies.push(invalidateTagsPolicy(invalidateTags, subject, problems));
      }

      const invalidateOn = readObject(metadata, INVALIDATE_ON_KEY, context.handler) as
        StoredInvalidateOn | undefined;
      if (invalidateOn !== undefined) {
        policies.push(invalidateOnPolicy(invalidateOn, subject, problems));
      }

      for (const [key, name] of UNBOUND_KEYS) {
        if (readObject(metadata, key, context.handler) === undefined) continue;
        policies.push(unboundPolicy(name));
        recordUnbound(name, subject, problems);
      }

      // NOTHING AT ALL RATHER THAN AN EMPTY LIST, per the same rule the idempotency collector
      // follows: a present and empty list would claim this route was examined and declares no
      // cache, and this collector cannot tell an undecorated route from one in an application that
      // never installed the plugin. The registry says which collectors ran; that is where the
      // sentence about absence belongs.
      return policies.length === 0 ? undefined : { handlerPolicies: policies };
    },

    problems(): readonly RedisxCacheCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Turns `@Cached` options into the policy a reader sees.
 *
 * THE TTL IS CONVERTED AND THE CONVERSION IS THE REASON THE SETTING IS NOT CALLED `ttl`. This
 * library writes `@Cached({ ttl })` in SECONDS and `@WithLock({ ttl })` in MILLISECONDS, so a page
 * carrying both under one word would put two quantities in one column. Milliseconds throughout, for
 * the reason `IRRateLimit.ttlMs` is milliseconds.
 *
 * AN ABSENT TTL IS NOT REPORTED AS A NUMBER. The library falls back to the plugin's `defaultTtl`,
 * which is configuration of the module rather than a decision recorded on this route, and printing
 * it would attribute a module wide default to one endpoint. That is the ruling
 * `@openref/collector-redisx-rate-limit` already took for a half declared budget.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The policy
 */
function cachedPolicy(
  stored: StoredCached,
  subject: string,
  problems: RedisxCacheCollectorProblem[],
): IRHandlerPolicy {
  const settings: IRHandlerPolicySetting[] = [];

  const ttl = positiveNumber(stored.ttl);
  if (ttl === undefined) {
    problems.push({
      subject,
      reason:
        'it declares @Cached with no ttl, so how long its response is served from cache is not known',
      action: 'name ttl on the decorator to make the window a fact about this route',
      detail:
        "Without it the library falls back to the plugin's defaultTtl, which is configuration of " +
        'the module rather than a decision recorded on this route, so it is not written here.',
    });
  } else {
    settings.push({ name: 'ttlMs', value: ttl * MILLISECONDS_PER_SECOND });
  }

  const tags = stringList(stored.tags);
  if (tags !== undefined) settings.push({ name: 'tags', value: tags });

  if (typeof stored.strategy === 'string' && stored.strategy !== '') {
    settings.push({ name: 'layers', value: stored.strategy });
  }

  const stale = staleWindow(stored.swr, 'staleTime');
  if (stale !== undefined) {
    settings.push({ name: 'staleWhileRevalidateMs', value: stale * MILLISECONDS_PER_SECOND });
  }

  const onError = staleWindow(stored.staleIfError, 'window');
  if (onError !== undefined) {
    settings.push({ name: 'staleIfErrorMs', value: onError * MILLISECONDS_PER_SECOND });
  }

  recordUnreadableCached(stored, subject, problems);

  const key = typeof stored.key === 'string' && stored.key !== '' ? stored.key : undefined;

  return {
    kind: 'cache',
    ...(key === undefined ? {} : { key }),
    settings,
    reach: 'handler',
    confidence: 'derived',
    collector: REDISX_CACHE_COLLECTOR_NAME,
  };
}

/**
 * Turns `@InvalidateTags` options into the policy a reader sees.
 *
 * IT IS A CACHE FACT ABOUT THIS ROUTE EVEN THOUGH THIS ROUTE CACHES NOTHING. A write endpoint that
 * drops the `orders` tag on every call is telling a reader which reads go stale when it succeeds,
 * which is exactly the kind of thing a specification cannot carry.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The policy
 */
function invalidateTagsPolicy(
  stored: StoredInvalidateTags,
  subject: string,
  problems: RedisxCacheCollectorProblem[],
): IRHandlerPolicy {
  const settings: IRHandlerPolicySetting[] = [];

  const tags = stringList(stored.tags);
  if (tags === undefined) {
    problems.push({
      subject,
      reason:
        'its @InvalidateTags tags come from a function, so which cached reads it drops is not known',
      action: 'use a static tag array if the tags should be named in the reference',
      detail: 'A function under a key is never read, per SPEC 6.1.',
    });
  } else {
    settings.push({ name: 'invalidatesTags', value: tags });
  }

  settings.push({
    name: 'invalidatesWhen',
    value: stored.when === 'before' ? 'before' : 'after',
  });

  return {
    kind: 'cache',
    settings,
    reach: 'handler',
    confidence: 'derived',
    collector: REDISX_CACHE_COLLECTOR_NAME,
  };
}

/**
 * Turns `@InvalidateOn` options into the policy a reader sees.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The policy
 */
function invalidateOnPolicy(
  stored: StoredInvalidateOn,
  subject: string,
  problems: RedisxCacheCollectorProblem[],
): IRHandlerPolicy {
  const settings: IRHandlerPolicySetting[] = [];

  const events = stringList(stored.events);
  if (events !== undefined) settings.push({ name: 'invalidatesOnEvents', value: events });

  const tags = stringList(stored.tags);
  if (tags !== undefined) settings.push({ name: 'invalidatesTags', value: tags });

  const keys = stringList(stored.keys);
  if (keys !== undefined) settings.push({ name: 'invalidatesKeys', value: keys });

  if (typeof stored.publish === 'boolean') {
    settings.push({ name: 'publishesInvalidation', value: stored.publish });
  }

  if (typeof stored.condition === 'function') {
    problems.push({
      subject,
      reason:
        'its @InvalidateOn carries a condition function, so whether a call invalidates anything is not known',
      action: 'nothing to do here: the tags shown are what a call that meets the condition drops',
      detail:
        'Which results the function admits is written in code this never reads, per SPEC 6.1.',
    });
  }

  return {
    kind: 'cache',
    settings,
    reach: 'handler',
    confidence: 'derived',
    collector: REDISX_CACHE_COLLECTOR_NAME,
  };
}

/**
 * The policy of a decorator the library reads with an interceptor it registers nowhere.
 *
 * THE SETTINGS ARE NOT READ AND THAT IS DELIBERATE. A ttl on a declaration that binds nothing is a
 * number a reader would take for a window their responses are served in, and the whole value of
 * `unbound` is that it says the opposite. What is reported is that the declaration exists and which
 * decorator made it, which is what a reader has to know to go and wire the interceptor.
 *
 * @param decorator - The decorator's own name, as a reader writes it
 * @returns The policy
 */
function unboundPolicy(decorator: string): IRHandlerPolicy {
  return {
    kind: 'cache',
    settings: [{ name: 'declaredBy', value: decorator }],
    reach: 'unbound',
    confidence: 'derived',
    collector: REDISX_CACHE_COLLECTOR_NAME,
  };
}

/**
 * Records a declaration nothing in the library binds to a response.
 *
 * @param decorator - The decorator's own name, as a reader writes it
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordUnbound(
  decorator: string,
  subject: string,
  problems: RedisxCacheCollectorProblem[],
): void {
  problems.push({
    subject,
    reason: `it carries ${decorator}, whose interceptor the library registers nowhere, so nothing here caches`,
    action:
      'bind CacheInterceptor with @UseInterceptors, or move the route to @Cached, which binds itself',
    detail:
      'The library exports the interceptor as DeclarativeCacheInterceptor and registers it in no ' +
      'module, so the key proves an intention rather than a behaviour. @Cached replaces the method ' +
      'with a wrapper when it is applied and needs nothing wired.',
  });
}

/**
 * Records what the `@Cached` decorator decided in code, which is never read.
 *
 * SPEC 6.1 FORBIDS READING INTERCEPTOR LOGIC WITHOUT QUALIFICATION, and each of these is exactly
 * that stored under a key. A tag function decides which reads go stale, `condition` and `unless`
 * decide whether the response is cached at all, and `varyBy` and `contextKeys` decide what the key
 * is split by using values a request supplies at call time.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordUnreadableCached(
  stored: StoredCached,
  subject: string,
  problems: RedisxCacheCollectorProblem[],
): void {
  if (
    typeof stored.key === 'function' ||
    (stored.key !== undefined && stored.key !== null && typeof stored.key !== 'string')
  ) {
    problems.push({
      subject,
      reason:
        'its @Cached key is not a literal template, so what the cached response varies by is not known',
      action: 'use a string key template if the bucket should be named in the reference',
      detail: 'A value that is not a string under a key is never interpreted, per SPEC 6.1.',
    });
  } else if (stored.key === undefined) {
    problems.push({
      subject,
      reason: 'it names no @Cached key, so the cache is split by arguments this cannot enumerate',
      action:
        'nothing to do here: the key is generated from the class, the method and the arguments',
      detail:
        'Without a template the library builds ClassName:methodName:args, hashing any argument ' +
        'that is an object. What the arguments are at call time is runtime state.',
    });
  }

  if (typeof stored.tags === 'function') {
    problems.push({
      subject,
      reason:
        'its @Cached tags come from a function, so which invalidations reach this response is not known',
      action: 'use a static tag array if the tags should be named in the reference',
      detail: 'A function under a key is never read, per SPEC 6.1.',
    });
  }

  if (typeof stored.condition === 'function' || typeof stored.unless === 'function') {
    problems.push({
      subject,
      reason:
        'it carries a condition or unless function, so which responses are cached at all is not known',
      action: 'nothing to do here: the window shown is what a cached response is served for',
      detail: 'Which calls the functions admit is written in code this never reads, per SPEC 6.1.',
    });
  }

  const varyBy = stringList(stored.varyBy) ?? [];
  const contextKeys = stringList(stored.contextKeys) ?? [];
  if (varyBy.length + contextKeys.length > 0) {
    problems.push({
      subject,
      reason:
        'its cache key is split by context values a provider supplies, so one response per caller is possible',
      action:
        'nothing to do here: this says the window shown is per context value and not per route',
      detail:
        `The keys are ${[...contextKeys, ...varyBy].join(', ')}, resolved from the plugin's ` +
        'contextProvider when the request runs. What each resolves to is runtime state.',
    });
  }
}

/**
 * Reads a stale window off an option object that carries an `enabled` flag beside it.
 *
 * A DISABLED BLOCK IS NOT A WINDOW. `{ enabled: false, staleTime: 30 }` is a number the library
 * never applies, and reporting it would put a stale window on a route that serves none.
 *
 * @param value - Whatever the decorator stored under `swr` or `staleIfError`
 * @param field - The member holding the window, in seconds
 * @returns The window in seconds, or undefined
 */
function staleWindow(value: unknown, field: 'staleTime' | 'window'): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const block = value as { enabled?: unknown; staleTime?: unknown; window?: unknown };
  if (block.enabled !== true) return undefined;

  return positiveNumber(block[field]);
}

/**
 * Reads a value that has to be a positive finite number to mean anything.
 *
 * @param value - Whatever the decorator stored
 * @returns The number, or undefined
 */
function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Reads a value that has to be a list of non empty strings to mean anything.
 *
 * @param value - Whatever the decorator stored
 * @returns The list, or undefined when it is a function, absent, or holds something else
 */
function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const strings = value.filter(
    (member): member is string => typeof member === 'string' && member !== '',
  );

  return strings.length === 0 ? undefined : strings;
}

/**
 * Reads an options object off one target.
 *
 * @param metadata - The reader
 * @param key - Which decorator's key
 * @param target - The handler
 * @returns The stored object, or undefined when the key is absent or holds something else
 */
function readObject(
  metadata: MetadataValueReader,
  key: string | symbol,
  target: unknown,
): object | undefined {
  const stored: unknown = metadata.get(key, target);

  return typeof stored === 'object' && stored !== null ? stored : undefined;
}

/**
 * Reports whether the library this collector reads is installed.
 *
 * THE ENTRY POINT RATHER THAN THE MANIFEST, AND NOT BY PREFERENCE. This library's `exports` map
 * declares only `"."`, so asking for `@nestjs-redisx/cache/package.json` fails with
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
    createRequire(import.meta.url).resolve(REDISX_CACHE_PACKAGE);

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

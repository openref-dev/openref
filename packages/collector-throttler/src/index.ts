/**
 * `@openref/collector-throttler`: the rate limit an endpoint actually enforces.
 *
 * IT IS ITS OWN PACKAGE AND NOT PART OF `@openref/nest`, per SPEC 4. The reason is the dependency
 * rather than the size: this collector exists to read `@nestjs/throttler`, and an edge from the
 * package every consumer installs would put a throttler in the closure of applications that do not
 * rate limit anything. The edge runs the other way, and both of the packages it needs are peers.
 *
 * WHAT IT READS IS THE FRAMEWORK'S ON-DISK FORMAT, WHICH IS WHY THE KEYS ARE ENUMERATED RATHER
 * THAN NAMED. `@Throttle({ short: { limit, ttl } })` writes `THROTTLER:LIMITshort` and
 * `THROTTLER:TTLshort`: the throttler's name is part of the key, so there is no fixed key to ask
 * for, and a list of likely names would be the guess SPEC 6.1 forbids. The keys present on the
 * target are read instead, which finds every named throttler and invents none.
 *
 * THE UNIT IS THE WHOLE REASON THE VERSION IS READ. `ttl` was seconds before `@nestjs/throttler`
 * 5.0 and is milliseconds from 5.0, and `IRRateLimit.ttlMs` is milliseconds. A number whose unit is
 * unknown is not a fact, so a copy whose version cannot be read produces no rate limit at all
 * rather than one that is wrong by a factor of a thousand.
 *
 * `SkipThrottle` IS HONOURED AND IS NOT A FACT. A route that opts out has no rate limit to report,
 * so nothing is reported for it: `THROTTLER:SKIP<name>` set to true suppresses that throttler.
 */

import { createRequire } from 'node:module';
import type {
  IRGuard,
  IRGuardScope,
  IRNodeRuntime,
  IRRateLimit,
  IRRateLimitReach,
} from '@openref/core';
import { NEST_GUARD_METADATA } from '@openref/nest';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-throttler';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const THROTTLER_COLLECTOR_NAME = 'throttlerCollector';

/** The package this collector exists to read. */
export const THROTTLER_PACKAGE = '@nestjs/throttler';

/**
 * The guard class `@nestjs/throttler` ships, which is what enforces every limit this collector reads.
 *
 * A NAME AND NEVER A TEST, per {@link IRGuardPurpose}. Nothing here decides that a class whose name
 * sounds like a limiter is one; this is the class the package this collector exists to read defines
 * as its limiter, and it is claimed only where it was actually observed standing on the route or in
 * front of the application. `@Throttle` does not apply it, unlike the redisx decorator, so its
 * presence is read rather than deduced from the metadata.
 */
export const THROTTLER_GUARD = 'ThrottlerGuard';

/** Key prefixes `@nestjs/throttler` writes, with the throttler's name appended to each. */
export const THROTTLER_KEY_PREFIXES = {
  limit: 'THROTTLER:LIMIT',
  ttl: 'THROTTLER:TTL',
  skip: 'THROTTLER:SKIP',
} as const;

/**
 * The release that changed `ttl` from seconds to milliseconds.
 *
 * Below it `ttl` is seconds and this collector multiplies; at it and above, `ttl` is already
 * milliseconds and nothing is done.
 */
export const MILLISECOND_TTL_FROM_MAJOR = 5;

/** What a host may tell the collector that it cannot work out for itself. */
export interface ThrottlerCollectorOptions {
  /**
   * Where the throttler is resolved from, and the version read.
   *
   * Injected by the tests and by nothing else. It is a seam because the two behaviours worth
   * pinning, the second unit and the refusal on an unreadable version, cannot be reached by
   * installing one copy of one package.
   */
  readonly resolveVersion?: () => string | undefined;

  /**
   * How metadata is enumerated and read.
   *
   * `Reflect` with `reflect-metadata` loaded is the real one, and NestJS loads it before any
   * application code runs. It is a seam for the same reason as above.
   */
  readonly metadata?: MetadataReader;
}

/** Enumerating and reading metadata on one target, which is all this collector does. */
export interface MetadataReader {
  keys(target: unknown): readonly (string | symbol)[];
  get(key: string | symbol, target: unknown): unknown;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface ThrottlerCollectorProblem {
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
export interface ThrottlerCollector extends IRuntimeCollector {
  problems(): readonly ThrottlerCollectorProblem[];
}

/** What the factory returns, since an absent throttler means it does not run at all. */
export type ThrottlerCollectorRegistration = ThrottlerCollector | SkippedCollector;

/**
 * Builds the throttler collector of SPEC 6.2.
 *
 * @param options - Seams for the tests; a host passes nothing
 * @returns The collector, or a skip naming what was missing
 */
export function throttlerCollector(
  options: ThrottlerCollectorOptions = {},
): ThrottlerCollectorRegistration {
  const version = (options.resolveVersion ?? readInstalledVersion)();

  if (version === undefined) {
    return {
      name: THROTTLER_COLLECTOR_NAME,
      skipped:
        `${THROTTLER_PACKAGE} is not installed, or its version cannot be read, so there is no ` +
        'rate limit to report and no unit to report it in. Installing it is the fix; nothing here ' +
        'guesses a limit',
    };
  }

  const scale = ttlScale(version);
  if (scale === undefined) {
    return {
      name: THROTTLER_COLLECTOR_NAME,
      skipped:
        `${THROTTLER_PACKAGE} reports version "${version}", which is not a version this collector ` +
        'can read a unit from. `ttl` was seconds before 5.0 and is milliseconds from 5.0, and a ' +
        'number whose unit is unknown is not a fact',
    };
  }

  const metadata = options.metadata ?? globalMetadataReader();
  if (metadata === undefined) {
    return {
      name: THROTTLER_COLLECTOR_NAME,
      skipped:
        'the runtime offers no metadata reflection, so the throttler keys cannot be enumerated. ' +
        '`reflect-metadata` is loaded by NestJS itself, so this means the collector is running ' +
        'outside a NestJS application',
    };
  }

  const problems: ThrottlerCollectorProblem[] = [];

  return {
    name: THROTTLER_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;

      // WHAT STANDS IN FRONT OF THIS ROUTE IS NAMED AS A LIMITER WHEREVER IT IS OBSERVED, and it
      // rides every answer below rather than one of them. `security-drift` chose between an error
      // and a warning on a guard's SCOPE alone, so `@UseGuards(ThrottlerGuard)` on a handler, which
      // this project's own documentation shows, was read as an authorisation decision about the
      // route and produced a critical finding on a route nobody said anything about protecting.
      // `guardsCollector` reports the same class from `@UseGuards` and from the container and
      // cannot say what it is for; the merge folds this purpose onto that reading.
      const guards = limiterGuards(context, metadata);
      const naming = guards.length === 0 ? {} : { guards };

      // THE HANDLER IS READ AFTER THE CONTROLLER SO THAT IT WINS. `@Throttle` on a method
      // replaces the class's setting for the same throttler name, which is what NestJS enforces.
      const limits = new Map<string, Partial<IRRateLimit>>();
      let declared = false;
      for (const target of [context.controller, context.handler]) {
        declared = readInto(limits, metadata, target, scale) || declared;
      }

      const found = firstComplete(limits, subject, problems);
      if (found !== undefined) return { ...naming, rateLimit: context.fact(found, 'derived') };

      // NO LIMIT OF ITS OWN IS TWO DIFFERENT ANSWERS AND USED TO BE ONE SILENCE, per SPEC 6.2.3.
      // `ThrottlerGuard` under `APP_GUARD` is the ordinary way this package is installed, so a
      // route without `@Throttle` is usually limited by something and occasionally by nothing, and
      // returning `undefined` for both told a reader neither.
      //
      // A ROUTE THAT WROTE ANY THROTTLER KEY AT ALL IS EXCLUDED, and that is why `readInto` reports
      // whether it saw one. A half declared throttler and a `@SkipThrottle` are both decisions this
      // route made: the first is already a `problems` record about what could not be read, and the
      // second is an opt out of one throttler and not an observation about everything else in front
      // of the route. Answering either with a reach would be this package stating something it did
      // not observe.
      // A ROUTE THAT DECLARED SOMETHING GETS NO REACH AND STILL GETS THE NAMING. What is withheld
      // here is the claim about what limits the route, which this package did not observe; that a
      // `ThrottlerGuard` was seen standing in front of it is a separate reading and is not
      // withdrawn by the route having declared a half throttler or opted one out.
      if (declared) return guards.length === 0 ? undefined : { guards };

      return { ...naming, rateLimitReach: context.fact(reachOf(context), 'derived') };
    },

    problems(): readonly ThrottlerCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Where the throttler's own guard was observed standing, if anywhere, per SPEC 6.2.1.
 *
 * OBSERVED AND NEVER ASSUMED, which is the difference between this and the redisx collector beside
 * it. There, one decorator writes the metadata and applies the guard, so the key's presence is the
 * guard's presence; here `@Throttle` writes metadata and applies nothing, and the guard is put in
 * front of the route separately, usually as one `APP_GUARD` provider and sometimes with
 * `@UseGuards` on a handler or a controller. Claiming it unobserved would put a guard on a route
 * that has none, which is the direction a security rule must never be wrong in.
 *
 * BOTH SCOPES ARE REPORTED WHERE BOTH HOLD, because they are two registrations, per SPEC 6.2.1, and
 * because `security-drift` reads the scope. The route reading uses the key `@UseGuards` writes,
 * exported by `@openref/nest` rather than spelled again here, and reads the controller and the
 * handler for the reason `readGuards` reads both: NestJS applies both and neither overrides.
 *
 * @param context - The node's context, for the two targets and the global registrations
 * @param metadata - The reader
 * @returns The guard, at each scope it was seen at, or nothing when it was seen at neither
 */
function limiterGuards(context: CollectorContext, metadata: MetadataReader): readonly IRGuard[] {
  const scopes: IRGuardScope[] = [];

  const onRoute = [context.controller, context.handler].some((target) =>
    asArray(metadata.get(NEST_GUARD_METADATA, target)).some(isThrottlerGuard),
  );
  if (onRoute) scopes.push('route');
  if (context.globalGuards.includes(THROTTLER_GUARD)) scopes.push('global');

  return scopes.map((scope) => ({
    name: THROTTLER_GUARD,
    scope,
    purpose: 'rate-limit',
    // `derived`, per the SPEC 6.1 table, which names a guard's class name as the example of that
    // level. It is the same level `guardsCollector` reports the same class at, which is what lets
    // the merge recognise the two readings as one guard.
    confidence: 'derived',
    collector: THROTTLER_COLLECTOR_NAME,
  }));
}

/**
 * Reports whether one entry of the guard metadata is this package's guard.
 *
 * `@UseGuards(ThrottlerGuard)` STORES THE CLASS AND `@UseGuards(new ThrottlerGuard(...))` STORES
 * THE INSTANCE, and both are ordinary usage, so both are read. Anything else is somebody else's
 * guard and is not this collector's to name.
 *
 * @param entry - One entry from the metadata
 * @returns True when it is `ThrottlerGuard`
 */
function isThrottlerGuard(entry: unknown): boolean {
  if (typeof entry === 'function') return entry.name === THROTTLER_GUARD;

  if (typeof entry === 'object' && entry !== null) {
    const constructor: unknown = (entry as { constructor?: unknown }).constructor;

    return typeof constructor === 'function' && constructor.name === THROTTLER_GUARD;
  }

  return false;
}

/**
 * Narrows whatever was under the guard metadata key to a list.
 *
 * The key holds an array in every NestJS version this package supports, and it is still checked:
 * the value is whatever somebody put there.
 *
 * @param value - Whatever the reader returned
 * @returns The entries, or an empty list
 */
function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Reads every throttler named on one target into the accumulator.
 *
 * @param limits - Accumulator, keyed by throttler name
 * @param metadata - The reader
 * @param target - Controller class or handler
 * @param scale - What a `ttl` has to be multiplied by to become milliseconds
 * @returns Whether this target wrote any throttler key at all, readable or not
 */
function readInto(
  limits: Map<string, Partial<IRRateLimit>>,
  metadata: MetadataReader,
  target: unknown,
  scale: number,
): boolean {
  let declared = false;

  for (const key of metadata.keys(target)) {
    if (typeof key !== 'string') continue;

    const limitName = suffixAfter(key, THROTTLER_KEY_PREFIXES.limit);
    if (limitName !== undefined) {
      declared = true;
      const value = metadata.get(key, target);
      if (typeof value === 'number' && Number.isFinite(value)) {
        limits.set(limitName, { ...limits.get(limitName), limit: value, name: limitName });
      }
      continue;
    }

    const ttlName = suffixAfter(key, THROTTLER_KEY_PREFIXES.ttl);
    if (ttlName !== undefined) {
      declared = true;
      const value = metadata.get(key, target);
      if (typeof value === 'number' && Number.isFinite(value)) {
        limits.set(ttlName, { ...limits.get(ttlName), ttlMs: value * scale, name: ttlName });
      }
      continue;
    }

    // A ROUTE THAT OPTED OUT HAS NO RATE LIMIT TO REPORT. `@SkipThrottle()` writes true and
    // `@SkipThrottle({ short: false })` writes false, which un-skips, so the value is read.
    const skipName = suffixAfter(key, THROTTLER_KEY_PREFIXES.skip);
    if (skipName !== undefined) {
      declared = true;
      if (metadata.get(key, target) === true) limits.delete(skipName);
    }
  }

  return declared;
}

/**
 * Says which of the two states a route that wrote no throttler key at all is in, per SPEC 6.2.3.
 *
 * IT IS THE SAME TWO STATES `@openref/collector-redisx-rate-limit` REPORTS AND DELIBERATELY NOT THE
 * SAME LINES. The two packages share a contract and no code, per SPEC 4, because their key shapes
 * have nothing in common; what they share is {@link IRRateLimitReach}, and the words a reader sees
 * are built once from that shape by whoever renders it. So a `ThrottlerGuard` under `APP_GUARD` and
 * a redisx guard under one produce the same row.
 *
 * NO BUDGET TRAVELS, AND THE ABSENCE IS THE MEASUREMENT. `@nestjs/throttler` holds its defaults in
 * `ThrottlerModule.forRoot`, whose value reaches the guard through a token this collector has not
 * measured a reachable reading of. The redisx collector carries a budget because a reading of its
 * provider was measured; this one does not, and stating one would be the guess SPEC 6.1 forbids.
 *
 * @param context - The node's context, for the global guard list
 * @returns The reach, for the node's `rateLimitReach` fact
 */
function reachOf(context: CollectorContext): IRRateLimitReach {
  return context.globalGuards.length === 0
    ? { kind: 'none' }
    : { kind: 'external', by: [...context.globalGuards] };
}

/**
 * Takes the first throttler that has both halves, recording any that has one.
 *
 * ONE RATE LIMIT PER NODE, BECAUSE `IRRateLimit` IS ONE. An application with several named
 * throttlers on one route enforces all of them, and the IR has room for the tightest rather than
 * for the set. The first complete one in insertion order is taken, which is the controller's
 * before the handler's for the same name and the declaration order otherwise, and the rest are
 * recorded so the reference does not silently claim to be the whole policy.
 *
 * @param limits - What was read
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The rate limit, or undefined
 */
function firstComplete(
  limits: ReadonlyMap<string, Partial<IRRateLimit>>,
  subject: string,
  problems: ThrottlerCollectorProblem[],
): IRRateLimit | undefined {
  const complete: IRRateLimit[] = [];

  for (const [name, partial] of limits) {
    if (partial.limit === undefined || partial.ttlMs === undefined) {
      problems.push({
        subject,
        reason:
          `the throttler "${name}" declares ${partial.limit === undefined ? 'a ttl and no limit' : 'a limit and no ttl'}, ` +
          'so no rate limit is known for it',
        action: 'name both limit and ttl on the throttler',
        detail:
          'Half a throttler is not a rate limit anything can be said about: a count with no ' +
          'window and a window with no count each describe nothing a reader could act on.',
      });
      continue;
    }

    complete.push({ limit: partial.limit, ttlMs: partial.ttlMs, name });
  }

  if (complete.length > 1) {
    problems.push({
      subject,
      reason: `${String(complete.length)} named throttlers apply here and the reference carries one`,
      action: `check which of them this route is really limited by; it shows "${complete[0]?.name ?? ''}"`,
      detail:
        'The others are ' +
        complete
          .slice(1)
          .map((limit) => `"${limit.name ?? ''}"`)
          .join(', ') +
        '. Which one a request is counted against is decided inside the guard, and guard logic ' +
        'is never read, per SPEC 6.1.',
    });
  }

  return complete[0];
}

/**
 * Reads the suffix of a key after a prefix, which is the throttler's name.
 *
 * @param key - The metadata key
 * @param prefix - One of the three prefixes
 * @returns The name, or undefined when the key is not one of this package's
 */
function suffixAfter(key: string, prefix: string): string | undefined {
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
}

/**
 * What a `ttl` has to be multiplied by to reach milliseconds, from the installed version.
 *
 * @param version - What the package's own manifest says
 * @returns 1, 1000, or undefined when the version cannot be read
 */
function ttlScale(version: string): number | undefined {
  const major = /^(\d+)\./.exec(version)?.[1];
  if (major === undefined) return undefined;

  return Number(major) >= MILLISECOND_TTL_FROM_MAJOR ? 1 : 1000;
}

/**
 * Reads the installed throttler's version, without loading the package itself.
 *
 * ITS MANIFEST AND NOT ITS ENTRY POINT. Requiring the module would run it, and this collector has
 * no reason to: everything it reads is metadata the application's own decorators already wrote.
 *
 * @returns The version, or undefined when the package is not resolvable
 */
function readInstalledVersion(): string | undefined {
  try {
    const manifest = createRequire(import.meta.url)(`${THROTTLER_PACKAGE}/package.json`) as {
      version?: unknown;
    };

    return typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The metadata reader the runtime provides, when it provides one.
 *
 * @returns A reader over the global `Reflect`, or undefined when `reflect-metadata` is not loaded
 */
function globalMetadataReader(): MetadataReader | undefined {
  const reflect = Reflect as unknown as {
    getMetadataKeys?: (target: unknown) => unknown;
    getMetadata?: (key: unknown, target: unknown) => unknown;
  };

  const keys = reflect.getMetadataKeys;
  const get = reflect.getMetadata;
  if (typeof keys !== 'function' || typeof get !== 'function') return undefined;

  return {
    keys(target: unknown): readonly (string | symbol)[] {
      const found: unknown = keys.call(Reflect, target);

      return Array.isArray(found) ? (found as (string | symbol)[]) : [];
    },
    get(key: string | symbol, target: unknown): unknown {
      return get.call(Reflect, key, target);
    },
  };
}

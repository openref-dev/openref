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
import type { IRNodeRuntime, IRRateLimit, IRRateLimitReach } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-throttler';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const THROTTLER_COLLECTOR_NAME = 'throttlerCollector';

/** The package this collector exists to read. */
export const THROTTLER_PACKAGE = '@nestjs/throttler';

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
  readonly reason: string;
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

      // THE HANDLER IS READ AFTER THE CONTROLLER SO THAT IT WINS. `@Throttle` on a method
      // replaces the class's setting for the same throttler name, which is what NestJS enforces.
      const limits = new Map<string, Partial<IRRateLimit>>();
      let declared = false;
      for (const target of [context.controller, context.handler]) {
        declared = readInto(limits, metadata, target, scale) || declared;
      }

      const found = firstComplete(limits, subject, problems);
      if (found !== undefined) return { rateLimit: context.fact(found, 'derived') };

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
      if (declared) return undefined;

      return { rateLimitReach: context.fact(reachOf(context), 'derived') };
    },

    problems(): readonly ThrottlerCollectorProblem[] {
      return problems;
    },
  };
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
          'so it is not a rate limit anything can be said about and nothing was reported for it',
      });
      continue;
    }

    complete.push({ limit: partial.limit, ttlMs: partial.ttlMs, name });
  }

  if (complete.length > 1) {
    problems.push({
      subject,
      reason:
        `${String(complete.length)} named throttlers apply and the reference carries one: ` +
        `"${complete[0]?.name ?? ''}". The others are ` +
        complete
          .slice(1)
          .map((limit) => `"${limit.name ?? ''}"`)
          .join(', '),
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

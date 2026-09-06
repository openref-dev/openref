/**
 * `@openref/collector-redisx-locks`: how a route behaves when two callers arrive at once.
 *
 * IT IS ITS OWN PACKAGE AND NOT PART OF `@openref/nest`, per SPEC 4, for the reason every ecosystem
 * collector is: the edge would put a Redis library into the closure of every application that
 * installs the reference, including the ones that lock nothing. Both packages it needs are peers,
 * and so is the one it exists to read.
 *
 * IT WAS REFUSED AS "NO HTTP CONTRACT" AND THAT WAS THE WRONG TEST. A lock on a route handler
 * changes what a second concurrent caller experiences: they wait, they are refused, or they get an
 * empty answer. None of that is in the specification and all of it is behaviour a reader wants
 * before they write a client. The absence of a status is a fact ABOUT the lock, not a reason to
 * withhold the lock, and this package reports both.
 *
 * NO STATUS IS REPORTED, AND THAT IS A MEASUREMENT RATHER THAN A CAUTION. Read over the whole
 * source of `@nestjs-redisx/locks`: there is no `ExceptionFilter`, no `HttpException` and no
 * `HttpStatus` anywhere in it. `LockAcquisitionError` extends the library's own `RedisXError`, which
 * extends `Error`, so what a losing caller receives is decided by whatever exception filter the
 * host application registered. Putting a 409 or a 503 in `IRErrorContracts.runtimeDerived` would
 * have been the cheap home and would have been an invented status, which CLAUDE.md rule 5 forbids.
 *
 * A LOCK ON A SERVICE IS NOT A ROUTE FACT AND IS NEVER DRAWN AS ONE. `@WithLock` is a
 * `MethodDecorator` that wraps a function on any `Injectable`, so most of them in a real
 * application sit on services and repositories. This collector is handed route handlers by the
 * runtime pass and reads nothing else: it never walks the container, never reads a provider's
 * prototype, and therefore cannot attribute a service's lock to an endpoint. What it reports is
 * exactly the set of locks that wrap a function NestJS routes to.
 */

import { createRequire } from 'node:module';
import type { IRHandlerPolicy, IRHandlerPolicySetting, IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-redisx-locks';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const REDISX_LOCK_COLLECTOR_NAME = 'redisxLockCollector';

/** The package this collector exists to read. */
export const REDISX_LOCKS_PACKAGE = '@nestjs-redisx/locks';

/**
 * The key the library writes its lock options under.
 *
 * `Symbol.for` AND NOT AN IMPORT, for the reason the two redisx collectors beside this one give
 * about their own keys: the global symbol registry is keyed by the string, so this expression
 * yields the same symbol the library's own module yields without loading it, and the collector
 * reads metadata rather than running code. The package is still resolved, in
 * {@link isPackageInstalled}, because a global symbol is available whether or not the library that
 * names it is present.
 */
export const WITH_LOCK_OPTIONS_KEY: symbol = Symbol.for('WITH_LOCK_OPTIONS');

/** What a host may tell the collector that it cannot work out for itself. */
export interface RedisxLockCollectorOptions {
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
 * THE NAME AND THE SHAPE ARE THE ONES THE REDISX COLLECTORS BESIDE THIS ONE ALREADY EXPORT. Two
 * published packages exporting one name with two shapes is a defect this repository has catalogued
 * twice; four exporting one name with one shape is the contract holding.
 */
export interface MetadataValueReader {
  get(key: string | symbol, target: unknown): unknown;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface RedisxLockCollectorProblem {
  /** `OrdersController.place`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface RedisxLockCollector extends IRuntimeCollector {
  problems(): readonly RedisxLockCollectorProblem[];
}

/** What the factory returns, since an absent library means it does not run at all. */
export type RedisxLockCollectorRegistration = RedisxLockCollector | SkippedCollector;

/**
 * The options object the library stores, as much of it as this collector reads.
 *
 * EVERY FIELD IS `unknown` BECAUSE THE VALUE IS SOMEBODY ELSE'S OBJECT. It arrives from a decorator
 * in the host application through a metadata key, so nothing between the two checked its shape, and
 * a declared type here would be an assertion rather than a reading.
 */
interface StoredOptions {
  readonly key?: unknown;
  readonly ttl?: unknown;
  readonly waitTimeout?: unknown;
  readonly autoRenew?: unknown;
  readonly onLockFailed?: unknown;
}

/** What a caller that cannot acquire the lock gets, as the decorator's own two words spell it. */
const THROW = 'throw';

/** The other of the two, under which the method is skipped and resolves to nothing at all. */
const SKIP = 'skip';

/**
 * Builds the redisx lock collector.
 *
 * @param options - Seams for the tests; a host passes nothing
 * @returns The collector, or a skip naming what was missing
 */
export function redisxLockCollector(
  options: RedisxLockCollectorOptions = {},
): RedisxLockCollectorRegistration {
  if (!(options.resolvePackage ?? isPackageInstalled)()) {
    return {
      name: REDISX_LOCK_COLLECTOR_NAME,
      skipped:
        `${REDISX_LOCKS_PACKAGE} is not installed, so nothing in this application writes the ` +
        'metadata this collector reads and no route is serialized under a lock. Installing it is ' +
        'the fix; nothing here guesses a lock',
    };
  }

  const metadata = options.metadata ?? globalMetadataReader();
  if (metadata === undefined) {
    return {
      name: REDISX_LOCK_COLLECTOR_NAME,
      skipped:
        'the runtime offers no metadata reflection, so the lock options cannot be read. ' +
        '`reflect-metadata` is loaded by NestJS itself, so this means the collector is running ' +
        'outside a NestJS application',
    };
  }

  const problems: RedisxLockCollectorProblem[] = [];

  return {
    name: REDISX_LOCK_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      // THE HANDLER AND ONLY THE HANDLER. `@WithLock` is a `MethodDecorator`, so it cannot stand on
      // the controller class, and it writes its options onto the wrapper function that REPLACES the
      // method, which is the value `CollectorContext.handler` holds. Reading the controller would
      // ask a question the library never answers, and walking providers would attribute a service's
      // lock to an endpoint that does not have one.
      const stored: StoredOptions | undefined = readOptions(metadata, context.handler);
      if (stored === undefined) return undefined;

      const subject = `${context.declaredOn.name}.${context.handlerName}`;

      return { handlerPolicies: [lockPolicy(stored, subject, problems)] };
    },

    problems(): readonly RedisxLockCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Turns the stored options into the policy a reader sees, and records what decided against a value.
 *
 * EVERY DURATION IS ALREADY MILLISECONDS, WHICH IS WHY NOTHING IS CONVERTED HERE AND SOMETHING IS
 * CONVERTED IN THE CACHE COLLECTOR. `@WithLock({ ttl })` and `@WithLock({ waitTimeout })` are both
 * documented in milliseconds by the library's own option comments, and `@Cached({ ttl })` next door
 * is seconds. The setting names carry the unit for exactly that reason.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The policy
 */
function lockPolicy(
  stored: StoredOptions,
  subject: string,
  problems: RedisxLockCollectorProblem[],
): IRHandlerPolicy {
  const settings: IRHandlerPolicySetting[] = [];

  const ttl = positiveNumber(stored.ttl);
  if (ttl !== undefined) settings.push({ name: 'ttlMs', value: ttl });

  const waitTimeout = positiveNumber(stored.waitTimeout);
  if (waitTimeout !== undefined) settings.push({ name: 'waitTimeoutMs', value: waitTimeout });

  if (typeof stored.autoRenew === 'boolean') {
    settings.push({ name: 'autoRenew', value: stored.autoRenew });
  }

  const onFailure = readOnFailure(stored.onLockFailed);
  settings.push({ name: 'onFailure', value: onFailure });

  recordUnreadable(stored, onFailure, subject, problems);

  const key = typeof stored.key === 'string' && stored.key !== '' ? stored.key : undefined;

  return {
    kind: 'lock',
    ...(key === undefined ? {} : { key }),
    settings,
    reach: 'handler',
    confidence: 'derived',
    collector: REDISX_LOCK_COLLECTOR_NAME,
  };
}

/**
 * Says which of the three failure behaviours the route declared.
 *
 * THE DEFAULT IS `throw` AND IT IS THE LIBRARY'S OWN, READ OFF ITS SOURCE RATHER THAN ASSUMED:
 * `handleLockFailed` resolves `options.onLockFailed ?? 'throw'`. A custom error factory is a
 * function and is neither of the two words, so it gets its own value rather than being folded into
 * `throw`, because what a caller receives under it is a host error this cannot name.
 *
 * @param value - Whatever the decorator stored
 * @returns One of `throw`, `skip` or `custom-error`
 */
function readOnFailure(value: unknown): string {
  if (value === SKIP) return SKIP;
  if (typeof value === 'function') return 'custom-error';

  return THROW;
}

/**
 * Records what cannot be tied to a served response, and what was decided in code.
 *
 * THE MISSING STATUS IS THE FINDING THIS PACKAGE EXISTS TO WRITE. A route that throws
 * `LockAcquisitionError` answers with whatever the host's exception filter does, and there is no
 * filter in the library to read: saying nothing would leave a reader believing the reference had
 * listed every code their endpoint can produce.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param onFailure - What {@link readOnFailure} concluded
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordUnreadable(
  stored: StoredOptions,
  onFailure: string,
  subject: string,
  problems: RedisxLockCollectorProblem[],
): void {
  if (typeof stored.key === 'function') {
    problems.push({
      subject,
      reason:
        'its lock key comes from a function, so what concurrent calls are serialized per is not known',
      action: 'use a string key template if the lock scope should be named in the reference',
      detail:
        'A function under a key is never read, per SPEC 6.1, so whether the lock is per caller, ' +
        'per tenant or per resource cannot be stated. A string template is read and shown.',
    });
  }

  if (onFailure === SKIP) {
    problems.push({
      subject,
      reason:
        'a caller that loses the race is skipped, so this route can answer with no body at all',
      action:
        'document the empty response, or use the default onLockFailed if a caller should be refused',
      detail:
        'Under onLockFailed: "skip" the library returns undefined without running the method, so ' +
        'the route answers with whatever NestJS serializes for an empty handler result.',
    });

    return;
  }

  problems.push({
    subject,
    reason: `a caller that loses the race gets ${onFailure === THROW ? 'LockAcquisitionError' : 'a host error'}, whose status is not known`,
    action: 'declare the status your exception filter maps it to with @ApiErrors on this route',
    detail:
      'The library contains no exception filter, no HttpException and no HttpStatus anywhere in ' +
      'its source, so the code a losing caller sees is decided by the host application and is not ' +
      'a fact about this library. Nothing here guesses one.',
  });
}

/**
 * Reads the options object off one target.
 *
 * `@WithLock` REQUIRES ITS ARGUMENT, so unlike `@RateLimit()` next door there is no bare form and
 * no stored `undefined` to tell apart from an absent key. Presence of an object is a decorated
 * route.
 *
 * @param metadata - The reader
 * @param target - The handler
 * @returns The stored object, or undefined when the key is absent or holds something else
 */
function readOptions(metadata: MetadataValueReader, target: unknown): StoredOptions | undefined {
  const stored: unknown = metadata.get(WITH_LOCK_OPTIONS_KEY, target);

  return typeof stored === 'object' && stored !== null ? stored : undefined;
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
 * Reports whether the library this collector reads is installed.
 *
 * THE ENTRY POINT RATHER THAN THE MANIFEST, AND NOT BY PREFERENCE. This library's `exports` map
 * declares only `"."`, so asking for `@nestjs-redisx/locks/package.json` fails with
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
    createRequire(import.meta.url).resolve(REDISX_LOCKS_PACKAGE);

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

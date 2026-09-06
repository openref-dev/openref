/**
 * `@openref/collector-redisx-circuit-breaker`: what a route does when the thing behind it is down.
 *
 * IT IS ITS OWN PACKAGE AND NOT PART OF `@openref/nest`, per SPEC 4, for the reason every ecosystem
 * collector is: the edge would put a Redis library into the closure of every application that
 * installs the reference, including the ones that break no circuits. Both packages it needs are
 * peers, and so is the one it exists to read.
 *
 * IT WAS REFUSED AS "NO HTTP CONTRACT" AND THAT WAS THE WRONG TEST, exactly as it was for the lock
 * collector beside it. A breaker on a route handler decides whether the route runs at all after a
 * run of failures, and how long it stays refusing: five failures in ten seconds followed by thirty
 * seconds of rejection is behaviour a client author has to know and no OpenAPI field carries.
 *
 * NO STATUS IS REPORTED, AND THAT IS A MEASUREMENT RATHER THAN A CAUTION. Read over the whole
 * source of `@nestjs-redisx/circuit-breaker`: there is no `ExceptionFilter`, no `HttpException` and
 * no `HttpStatus` anywhere in it. `CircuitBreakerOpenError` extends the library's own
 * `RedisXError`, which extends `Error`, and the plugin's `errorFactory` lets a host replace even
 * that with an error of its own. A 503 here would have been the obvious guess and the wrong one,
 * which CLAUDE.md rule 5 forbids.
 *
 * A BREAKER ON A SERVICE IS NOT A ROUTE FACT AND IS NEVER DRAWN AS ONE. `@WithCircuitBreaker` is a
 * `MethodDecorator` that wraps a function on any `Injectable`, and the library's own examples put
 * it on a payments service rather than on a controller. This collector is handed route handlers by
 * the runtime pass and reads nothing else, so it cannot attribute a service's breaker to an
 * endpoint. What it reports is exactly the set of breakers that wrap a function NestJS routes to.
 */

import { createRequire } from 'node:module';
import type { IRHandlerPolicy, IRHandlerPolicySetting, IRNodeRuntime } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-redisx-circuit-breaker';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME = 'redisxCircuitBreakerCollector';

/** The package this collector exists to read. */
export const REDISX_CIRCUIT_BREAKER_PACKAGE = '@nestjs-redisx/circuit-breaker';

/**
 * The key the library writes its breaker options under.
 *
 * `Symbol.for` AND NOT AN IMPORT, for the reason the redisx collectors beside this one give about
 * their own keys: the global symbol registry is keyed by the string, so this expression yields the
 * same symbol the library's own module yields without loading it, and the collector reads metadata
 * rather than running code. The package is still resolved, in {@link isPackageInstalled}, because a
 * global symbol is available whether or not the library that names it is present.
 */
export const WITH_CIRCUIT_BREAKER_OPTIONS_KEY: symbol = Symbol.for('WITH_CIRCUIT_BREAKER_OPTIONS');

/** What a host may tell the collector that it cannot work out for itself. */
export interface RedisxCircuitBreakerCollectorOptions {
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
 * twice; five exporting one name with one shape is the contract holding.
 */
export interface MetadataValueReader {
  get(key: string | symbol, target: unknown): unknown;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface RedisxCircuitBreakerCollectorProblem {
  /** `PaymentsController.charge`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface RedisxCircuitBreakerCollector extends IRuntimeCollector {
  problems(): readonly RedisxCircuitBreakerCollectorProblem[];
}

/** What the factory returns, since an absent library means it does not run at all. */
export type RedisxCircuitBreakerCollectorRegistration =
  RedisxCircuitBreakerCollector | SkippedCollector;

/**
 * The options object the library stores, as much of it as this collector reads.
 *
 * EVERY FIELD IS `unknown` BECAUSE THE VALUE IS SOMEBODY ELSE'S OBJECT. It arrives from a decorator
 * in the host application through a metadata key, so nothing between the two checked its shape, and
 * a declared type here would be an assertion rather than a reading.
 */
interface StoredOptions {
  readonly key?: unknown;
  readonly failureThreshold?: unknown;
  readonly windowMs?: unknown;
  readonly openDurationMs?: unknown;
  readonly halfOpenMaxCalls?: unknown;
  readonly successThreshold?: unknown;
  readonly probeTimeoutMs?: unknown;
  readonly fallback?: unknown;
  readonly onOpen?: unknown;
  readonly skip?: unknown;
}

/**
 * The numeric knobs, in the reader's names, paired with the option each is read from.
 *
 * NAMED WITH THE UNIT WHERE THERE IS ONE AND WITHOUT WHERE THERE IS NOT, which is the rule
 * `IRHandlerPolicySetting` states. Four of these are already milliseconds in the library's own
 * option comments and are carried across untouched; two are counts and take no unit.
 */
const NUMERIC_SETTINGS: readonly (readonly [keyof StoredOptions, string])[] = [
  ['failureThreshold', 'failureThreshold'],
  ['windowMs', 'windowMs'],
  ['openDurationMs', 'openDurationMs'],
  ['halfOpenMaxCalls', 'halfOpenMaxCalls'],
  ['successThreshold', 'successThreshold'],
  ['probeTimeoutMs', 'probeTimeoutMs'],
];

/** The word the decorator uses for skipping the call rather than refusing it. */
const SKIP = 'skip';

/**
 * Builds the redisx circuit breaker collector.
 *
 * @param options - Seams for the tests; a host passes nothing
 * @returns The collector, or a skip naming what was missing
 */
export function redisxCircuitBreakerCollector(
  options: RedisxCircuitBreakerCollectorOptions = {},
): RedisxCircuitBreakerCollectorRegistration {
  if (!(options.resolvePackage ?? isPackageInstalled)()) {
    return {
      name: REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,
      skipped:
        `${REDISX_CIRCUIT_BREAKER_PACKAGE} is not installed, so nothing in this application ` +
        'writes the metadata this collector reads and no route stands behind a breaker. ' +
        'Installing it is the fix; nothing here guesses a threshold',
    };
  }

  const metadata = options.metadata ?? globalMetadataReader();
  if (metadata === undefined) {
    return {
      name: REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,
      skipped:
        'the runtime offers no metadata reflection, so the circuit breaker options cannot be ' +
        'read. `reflect-metadata` is loaded by NestJS itself, so this means the collector is ' +
        'running outside a NestJS application',
    };
  }

  const problems: RedisxCircuitBreakerCollectorProblem[] = [];

  return {
    name: REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      // THE HANDLER AND ONLY THE HANDLER. `@WithCircuitBreaker` is a `MethodDecorator`, so it
      // cannot stand on the controller class, and it writes its options onto the wrapper function
      // that REPLACES the method, which is the value `CollectorContext.handler` holds.
      const stored: StoredOptions | undefined = readOptions(metadata, context.handler);
      if (stored === undefined) return undefined;

      const subject = `${context.declaredOn.name}.${context.handlerName}`;

      return { handlerPolicies: [breakerPolicy(stored, subject, problems)] };
    },

    problems(): readonly RedisxCircuitBreakerCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Turns the stored options into the policy a reader sees, and records what decided against a value.
 *
 * ONLY WHAT THE ROUTE DECLARED, NEVER WHAT THE PLUGIN CONFIGURED. Every knob here has a module wide
 * default under `Symbol.for("CIRCUIT_BREAKER_PLUGIN_OPTIONS")`, and reading one would attribute a
 * module wide figure to one endpoint, which is the ruling
 * `@openref/collector-redisx-rate-limit` already took for a half declared budget. A route that
 * declares only a key carries only a key, and the record below says so.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The policy
 */
function breakerPolicy(
  stored: StoredOptions,
  subject: string,
  problems: RedisxCircuitBreakerCollectorProblem[],
): IRHandlerPolicy {
  const settings: IRHandlerPolicySetting[] = [];

  for (const [field, name] of NUMERIC_SETTINGS) {
    const value = positiveNumber(stored[field]);
    if (value !== undefined) settings.push({ name, value });
  }

  const onOpen = readOnOpen(stored);
  settings.push({ name: 'whenOpen', value: onOpen });

  recordUnreadable(stored, onOpen, settings.length, subject, problems);

  const key = typeof stored.key === 'string' && stored.key !== '' ? stored.key : undefined;

  return {
    kind: 'circuit-breaker',
    ...(key === undefined ? {} : { key }),
    settings,
    reach: 'handler',
    confidence: 'derived',
    collector: REDISX_CIRCUIT_BREAKER_COLLECTOR_NAME,
  };
}

/**
 * Says what the route does when the breaker refuses the call.
 *
 * THE ORDER IS THE LIBRARY'S OWN, READ OFF `resolveFallback` RATHER THAN ASSUMED: a `fallback`
 * function wins outright, then `onOpen === 'skip'`, then throwing. So a decorator carrying both is
 * reported as falling back, which is what the application does.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @returns One of `fallback`, `skip` or `throw`
 */
function readOnOpen(stored: StoredOptions): string {
  if (typeof stored.fallback === 'function') return 'fallback';
  if (stored.onOpen === SKIP) return SKIP;

  return 'throw';
}

/**
 * Records what cannot be tied to a served response, and what was decided in code.
 *
 * @param stored - What the decorator wrote onto the wrapper
 * @param onOpen - What {@link readOnOpen} concluded
 * @param declared - How many settings the policy carries, the `whenOpen` one included
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordUnreadable(
  stored: StoredOptions,
  onOpen: string,
  declared: number,
  subject: string,
  problems: RedisxCircuitBreakerCollectorProblem[],
): void {
  if (typeof stored.key === 'function') {
    problems.push({
      subject,
      reason:
        'its circuit key comes from a function, so what the breaker counts failures per is not known',
      action: 'use a string key template if the circuit should be named in the reference',
      detail:
        'A function under a key is never read, per SPEC 6.1, so whether the circuit is shared ' +
        'with other routes or is per tenant cannot be stated. A string template is read and shown.',
    });
  }

  // ONE SETTING MEANS ONLY `whenOpen`, WHICH IS DERIVED RATHER THAN DECLARED. A route in that state
  // carries a breaker whose every threshold is the module's, so the row says the route is guarded
  // and nothing on the row says by how much.
  if (declared === 1) {
    problems.push({
      subject,
      reason:
        'it declares a breaker and no threshold of its own, so what trips this route is not known',
      action:
        'name failureThreshold and windowMs on the decorator to make the figures facts about this route',
      detail:
        'The rest is resolved per call from the module provider under ' +
        'Symbol.for("CIRCUIT_BREAKER_PLUGIN_OPTIONS"), which is configuration of the module ' +
        'rather than a decision recorded on this route.',
    });
  }

  if (typeof stored.skip === 'function') {
    problems.push({
      subject,
      reason:
        'it carries a skip function, so which calls go through the breaker at all is not known',
      action:
        'nothing to do here: the thresholds shown are what a call the breaker sees is judged by',
      detail:
        'A call the function opts out runs directly, with no state read and none recorded. Which ' +
        'calls those are is written in code this never reads, per SPEC 6.1.',
    });
  }

  if (onOpen === 'fallback') {
    problems.push({
      subject,
      reason:
        'a refused call is answered by a fallback function, so what body it returns is not known',
      action: 'document the fallback body with @ApiResponse if a client can receive it',
      detail:
        'The fallback runs instead of the method and its return value becomes the response, so ' +
        'this route can answer with a shape the handler never produces. A function under a key is ' +
        'never read, per SPEC 6.1.',
    });

    return;
  }

  if (onOpen === SKIP) {
    problems.push({
      subject,
      reason: 'a refused call resolves to nothing, so this route can answer with no body at all',
      action:
        'document the empty response, or drop onOpen so a refused caller is told the circuit is open',
      detail:
        'Under onOpen: "skip" the library resolves to undefined without running the method, so ' +
        'the route answers with whatever NestJS serializes for an empty handler result.',
    });

    return;
  }

  problems.push({
    subject,
    reason: 'a refused call gets CircuitBreakerOpenError, whose status is not known',
    action: 'declare the status your exception filter maps it to with @ApiErrors on this route',
    detail:
      'The library contains no exception filter, no HttpException and no HttpStatus anywhere in ' +
      'its source, and its plugin can replace even that error through errorFactory, so the code a ' +
      'refused caller sees is decided by the host application. Nothing here guesses one.',
  });
}

/**
 * Reads the options object off one target.
 *
 * `@WithCircuitBreaker` REQUIRES ITS ARGUMENT, so there is no bare form and no stored `undefined`
 * to tell apart from an absent key. Presence of an object is a decorated route.
 *
 * @param metadata - The reader
 * @param target - The handler
 * @returns The stored object, or undefined when the key is absent or holds something else
 */
function readOptions(metadata: MetadataValueReader, target: unknown): StoredOptions | undefined {
  const stored: unknown = metadata.get(WITH_CIRCUIT_BREAKER_OPTIONS_KEY, target);

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
 * declares only `"."`, so asking for `@nestjs-redisx/circuit-breaker/package.json` fails with
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
    createRequire(import.meta.url).resolve(REDISX_CIRCUIT_BREAKER_PACKAGE);

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

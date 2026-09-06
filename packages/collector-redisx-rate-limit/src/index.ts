/**
 * `@openref/collector-redisx-rate-limit`: the rate limit an endpoint actually enforces.
 *
 * IT IS ITS OWN PACKAGE AND NOT PART OF `@openref/nest`, per SPEC 4, for the reason every ecosystem
 * collector is: the edge would put a rate limiting library into the closure of every application
 * that installs the reference, including the ones that limit nothing. Both packages it needs are
 * peers, and so is the one it exists to read.
 *
 * IT IS ALSO NOT A GENERALISATION OF `@openref/collector-throttler`, AND THAT WAS MEASURED RATHER
 * THAN PREFERRED. That package enumerates key prefixes because `@nestjs/throttler` concatenates the
 * throttler's name into the key, so there is no fixed key to ask for; and it reads the installed
 * version because `ttl` changed from seconds to milliseconds at 5.0. This library has one symbol,
 * one object and one unambiguous unit. Shared code would fuse two unrelated key shapes and make
 * each of them carry the other's caveats, so the two packages share a contract and no lines.
 *
 * THE WHOLE ROUTE METADATA SURFACE OF THE LIBRARY IS ONE `SetMetadata` CALL. `@RateLimit(options)`
 * applies `SetMetadata(RATE_LIMIT_OPTIONS, options)` and `UseGuards(RateLimitGuard)`, and the value
 * under that key is the decorator's options object VERBATIM: no default is merged into it. The
 * defaults are resolved per request from a DI provider, which is module configuration and not a
 * fact about the route, so this collector never reaches for them.
 *
 * `points` IS EVALUATED WHERE IT IS WRITTEN, WHICH IS THE WHOLE ARGUMENT FOR READING IT AT RUNTIME.
 * `@RateLimit({ points: perNodePoints(720, resolveNodeCount()) })` stores the integer the call
 * returned, including whatever the environment made it. Static analysis of the source can only ever
 * report the call; a runtime collector reports the number the application is enforcing.
 *
 * IT REPORTS THE STATUSES A LIMITED ROUTE ANSWERS WITH, SINCE 2026-09-05, AND IT REPORTED NONE
 * BEFORE. The library answers 429 and 503 and this package carried neither, which left a route whose
 * limit it did report reading as a route that cannot refuse anybody. The statuses go into
 * `IRErrorContracts.runtimeDerived`, the group `error-undocumented` already compares against the
 * document, exactly as `@openref/collector-redisx-idempotency` puts its own there; nothing in
 * `@openref/core` moved for either. See {@link buildContracts} for which of the two is
 * unconditional and why the other one is not.
 */

import { createRequire } from 'node:module';
import type { IRErrorContract, IRNodeRuntime, IRRateLimit, IRRateLimitReach } from '@openref/core';
import type { CollectorContext, IRuntimeCollector, SkippedCollector } from '@openref/nest';

/** Name of this package. */
export const PACKAGE_NAME = '@openref/collector-redisx-rate-limit';

/** The name this collector stamps on everything it reports, per SPEC 6.2. */
export const REDISX_RATE_LIMIT_COLLECTOR_NAME = 'redisxRateLimitCollector';

/** The package this collector exists to read. */
export const REDISX_RATE_LIMIT_PACKAGE = '@nestjs-redisx/rate-limit';

/**
 * The key the library writes its route options under.
 *
 * `Symbol.for` AND NOT AN IMPORT, WHICH IS WHY THE PACKAGE IS RESOLVED SEPARATELY BELOW. The global
 * symbol registry is keyed by the string, so this expression yields the same symbol the library's
 * own module yields without loading it, and the collector reads metadata rather than running code.
 */
export const RATE_LIMIT_OPTIONS_KEY: symbol = Symbol.for('RATE_LIMIT_OPTIONS');

/**
 * The DI token the library registers its merged module configuration under.
 *
 * IT IS READ AND IT IS NEVER WRITTEN ONTO A ROUTE. See {@link readModuleDefault} for what was
 * measured, and {@link describeUnreadableRoute} for why the numbers under it are not route facts.
 */
export const RATE_LIMIT_PLUGIN_OPTIONS_KEY: symbol = Symbol.for('RATE_LIMIT_PLUGIN_OPTIONS');

/**
 * How the reach fact names where it read the module budget, per SPEC 6.2.3.
 *
 * IT IS THE PLACE AND NOT THE SENTENCE. The words a reader sees are built once, in the renderer,
 * out of `IRRateLimitReach`; what only this package can supply is which provider it looked in, so
 * that is all it supplies. A reader can go and read the same registration.
 */
export const BUDGET_SOURCE = 'the provider under Symbol.for("RATE_LIMIT_PLUGIN_OPTIONS")';

/** Milliseconds in the second `duration` is written in. */
export const MILLISECONDS_PER_SECOND = 1000;

/**
 * The algorithm whose `points` is a bucket capacity rather than a count per window.
 *
 * Under it the library's own default refill rate is `points / duration` tokens per second and there
 * is no fixed window at all, so `{ limit: points, ttlMs: duration * 1000 }` would describe
 * something the application does not enforce. See {@link buildRateLimit}.
 */
export const CAPACITY_ALGORITHM = 'token-bucket';

/** The store that counts in one process, so the number on the route is a per instance number. */
export const PER_INSTANCE_STORE = 'memory';

/** The status the guard's rejection is answered with, on every route the decorator is on. */
export const RATE_LIMIT_EXCEEDED_STATUS = 429;

/** The status a store failure is answered with, and only under one of the two policies. */
export const STORE_UNAVAILABLE_STATUS = 503;

/**
 * What the module does when the store backing a limit fails.
 *
 * IT HAS NO ROUTE HALF, WHICH IS WHY IT IS READ FROM THE CONTAINER AND NOWHERE ELSE. `@RateLimit`
 * takes no such option: `RateLimitService.handleError` reads `this.config.errorPolicy`, and
 * `this.config` is the merged plugin configuration under
 * {@link RATE_LIMIT_PLUGIN_OPTIONS_KEY}.
 */
export type RateLimitErrorPolicy = 'fail-closed' | 'fail-open';

/** The policy that rejects a request the store could not be asked about. */
export const FAIL_CLOSED_POLICY: RateLimitErrorPolicy = 'fail-closed';

/** The policy that admits it instead, which is what removes 503 from the answers. */
export const FAIL_OPEN_POLICY: RateLimitErrorPolicy = 'fail-open';

/** What a host may tell the collector that it cannot work out for itself. */
export interface RedisxRateLimitCollectorOptions {
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
 * IT IS NOT THE `MetadataReader` OF `@openref/collector-throttler`, AND THE NAME SAYS SO. That one
 * enumerates the keys present on a target as well as reading them, because the throttler puts its
 * own name inside the key and there is nothing fixed to ask for; this one asks for one key it knows.
 * Two published packages exporting one name with two shapes is a defect this repository has already
 * catalogued twice, so the narrower reader takes the narrower name.
 */
export interface MetadataValueReader {
  get(key: string | symbol, target: unknown): unknown;
}

/** What the collector could not read, kept per node for `doctor`. */
export interface RedisxRateLimitCollectorProblem {
  /** `WidgetsController.ingest`, as a reader recognises it. */
  readonly subject: string;
  /** The cause and what is not known because of it, in one clause, per SPEC 7.1. */
  readonly reason: string;
  /** The action, or that there is none and why the finding is recorded anyway, per SPEC 7.1. */
  readonly action: string;
  /** The reasoning behind it, for a reader who opens it. Absent where the cause is its own. */
  readonly detail?: string;
}

/** The collector, with the record of what it could not read. */
export interface RedisxRateLimitCollector extends IRuntimeCollector {
  problems(): readonly RedisxRateLimitCollectorProblem[];
}

/** What the factory returns, since an absent library means it does not run at all. */
export type RedisxRateLimitCollectorRegistration = RedisxRateLimitCollector | SkippedCollector;

/**
 * The options object the library stores, as much of it as this collector reads.
 *
 * EVERY FIELD IS `unknown` BECAUSE THE VALUE IS SOMEBODY ELSE'S OBJECT. It arrives from a decorator
 * in the host application through a metadata key, so nothing between the two checked its shape, and
 * a declared type here would be an assertion rather than a reading.
 */
interface StoredOptions {
  readonly points?: unknown;
  readonly duration?: unknown;
  readonly key?: unknown;
  readonly skip?: unknown;
  readonly algorithm?: unknown;
  readonly store?: unknown;
}

/** The module wide budget, as the library's own merged configuration states it. */
export interface ModuleDefaultBudget {
  /** `defaultPoints`, which the library falls back to when a route names no `points`. */
  readonly points: number;
  /** `defaultDuration`, converted from the seconds it is written in. */
  readonly ttlMs: number;
}

/**
 * What the library's own merged plugin configuration states, as much of it as is read here.
 *
 * TWO ANSWERS OUT OF ONE CONTAINER LOOKUP, AND THEY FAIL SEPARATELY. A provider can state a budget
 * and no policy, or a policy and no budget, and neither absence tells anything about the other.
 * They are read together because the lookup is one, and they are carried apart because a reader of
 * either has to be able to tell "read" from "not stated".
 */
export interface ModuleConfiguration {
  /** The module wide budget, absent when the provider does not state both halves of one. */
  readonly budget?: ModuleDefaultBudget;
  /** `errorPolicy`, absent when the provider states nothing this collector recognises. */
  readonly errorPolicy?: RateLimitErrorPolicy;
}

/**
 * Builds the redisx rate limit collector of SPEC 6.2.2.
 *
 * @param options - Seams for the tests; a host passes nothing
 * @returns The collector, or a skip naming what was missing
 */
export function redisxRateLimitCollector(
  options: RedisxRateLimitCollectorOptions = {},
): RedisxRateLimitCollectorRegistration {
  if (!(options.resolvePackage ?? isPackageInstalled)()) {
    return {
      name: REDISX_RATE_LIMIT_COLLECTOR_NAME,
      skipped:
        `${REDISX_RATE_LIMIT_PACKAGE} is not installed, so nothing in this application writes the ` +
        'metadata this collector reads and there is no rate limit to report. Installing it is the ' +
        'fix; nothing here guesses a limit',
    };
  }

  const metadata = options.metadata ?? globalMetadataReader();
  if (metadata === undefined) {
    return {
      name: REDISX_RATE_LIMIT_COLLECTOR_NAME,
      skipped:
        'the runtime offers no metadata reflection, so the rate limit options cannot be read. ' +
        '`reflect-metadata` is loaded by NestJS itself, so this means the collector is running ' +
        'outside a NestJS application',
    };
  }

  const problems: RedisxRateLimitCollectorProblem[] = [];
  // THE MODULE CONFIGURATION IS READ ONCE PER PASS AND NOT ONCE PER ROUTE. It is one provider value
  // for the whole application and it cannot change between two nodes of one pass, so a thousand
  // routes must not pay for a thousand container lookups. `null` distinguishes "asked and there was
  // none" from `undefined`, "not asked yet".
  let configuration: ModuleConfiguration | null | undefined;
  // THE POLICY RECORD IS PUSHED ON THE FIRST DECORATED ROUTE AND NOT ON THE FIRST ROUTE. What it
  // says is about the module, so it is said once, with `subject: "the application"`, by the
  // precedent the budget record already sets; what makes it worth saying at all is that a route
  // carries the decorator, and an application that installed the library and decorated nothing
  // should not be told about a status no route of it can answer with.
  let policyRecorded = false;

  return {
    name: REDISX_RATE_LIMIT_COLLECTOR_NAME,

    collect(context: CollectorContext): IRNodeRuntime | undefined {
      const subject = `${context.declaredOn.name}.${context.handlerName}`;

      if (configuration === undefined) {
        configuration = readModuleConfiguration(context) ?? null;
        recordModuleDefault(configuration?.budget ?? null, problems);
      }

      const budget = configuration?.budget ?? null;

      // THE BRANCH IS DECIDED BY THE PRESENCE OF THE KEY AND NOT BY THE CONTENT UNDER IT, and that
      // was measured on the installed library rather than remembered: `RateLimit(options = {})`
      // defaults the parameter before calling `SetMetadata`, so `@RateLimit()` with no argument
      // stores `{}`. Until 2026-09-05 this asked whether the merged object carried any field this
      // collector reads, which answered "no" for exactly that decorator, sent the route down the
      // undecorated branch and reported `rateLimitReach: none` on a route the guard is bound to.
      // That is the confident wrong answer SPEC 6.2.3 exists about, arrived at from the other side.
      if (!isDecorated(metadata, context)) {
        describeUnreadableRoute(context, subject, budget, problems);

        // THE ROUTE NOW ANSWERS ON ITS OWN PAGE AND NOT ONLY IN `doctor`. The record above is the
        // report's; this is the row's, and it is the same observation in a shape a renderer can
        // draw. Returning `undefined` here is what left a reader with one sentence over two
        // different situations, per SPEC 6.2.3.
        return { rateLimitReach: context.fact(reachOf(context, budget), 'derived') };
      }

      // THE HANDLER IS READ AFTER THE CONTROLLER AND MERGED FIELD BY FIELD, because that is what
      // the library's own guard enforces: it reads both and spreads `{ ...classOptions,
      // ...handlerOptions }`. A route that names only `points` therefore inherits the class's
      // `duration`, and a collector that replaced the whole object would report a window nobody
      // set. Reporting what is enforced is the only thing that makes this a fact.
      const merged: StoredOptions = {
        ...readOptions(metadata, context.controller),
        ...readOptions(metadata, context.handler),
      };

      recordUnreadable(merged, subject, problems);

      const limit = buildRateLimit(merged, subject, problems);

      // THE POLICY RECORD IS PUSHED AFTER THIS ROUTE'S OWN, so that what a reader meets first about
      // a node is the node. It is still one record for the pass.
      if (!policyRecorded) {
        policyRecorded = true;
        recordErrorPolicy(configuration?.errorPolicy, problems);
      }

      const errors = {
        declared: [],
        runtimeDerived: buildContracts(configuration?.errorPolicy),
        global: [],
      };

      // THE STATUSES DO NOT DEPEND ON THE BUDGET BEING READABLE, which is the whole of what was
      // missing. A route whose `points` is half declared, or whose algorithm has no window this
      // model can carry, still refuses a request that goes over whatever the module completes it
      // with, and still answers 429 for it.
      return limit === undefined
        ? { errors }
        : { rateLimit: context.fact(limit, 'derived'), errors };
    },

    problems(): readonly RedisxRateLimitCollectorProblem[] {
      return problems;
    },
  };
}

/**
 * Says which of the two states a route that declares no limit of its own is in, per SPEC 6.2.3.
 *
 * IT IS THE SAME OBSERVATION `describeUnreadableRoute` WRITES INTO `doctor`, IN A SHAPE A ROW CAN
 * DRAW, and the two are built beside each other so they cannot come to say different things. The
 * split is the one SPEC 6.2.1 already ruled on for `scopesCollector`: a route standing behind a
 * globally registered guard has a policy written in code that is never read, and a route standing
 * behind nothing has no policy. The first is `external` and the second is `none`.
 *
 * THE BUDGET TRAVELS AND IS STILL NOT ATTRIBUTED. It goes into the fact because a reader otherwise
 * has to leave the page to learn the only number anybody configured; it goes in under `budget` on
 * `external` rather than into `rateLimit`, so nothing that reads a route's enforced limit can pick
 * it up, per {@link IRRateLimitReach}.
 *
 * @param context - The node's context, for the global guard list
 * @param budget - The module budget, or null when nothing registered one
 * @returns The reach, for the node's `rateLimitReach` fact
 */
function reachOf(context: CollectorContext, budget: ModuleDefaultBudget | null): IRRateLimitReach {
  if (context.globalGuards.length === 0) return { kind: 'none' };

  return {
    kind: 'external',
    by: [...context.globalGuards],
    ...(budget === null
      ? {}
      : {
          budget: { limit: budget.points, ttlMs: budget.ttlMs },
          budgetSource: BUDGET_SOURCE,
        }),
  };
}

/**
 * Reads the module wide budget and the store failure policy out of one configuration provider.
 *
 * IT IS REACHABLE, AND THAT WAS MEASURED RATHER THAN ASSUMED. The library registers
 * `{ provide: RATE_LIMIT_PLUGIN_OPTIONS, useValue: RateLimitPlugin.mergeDefaults(options) }` and
 * puts the same token in its `getExports()`. Measured on NestJS 11 against a container holding that
 * exact registration: `ModuleRef.get(token)` and `ModuleRef.get(token, { strict: false })` both
 * return the merged object, whether the hosting module is `@Global()` or plainly imported, and both
 * throw `UnknownElementException` when nothing registered it. So the four outcomes are
 * distinguishable and none of them is a guess.
 *
 * WHAT IS READ AND WHAT IS STILL NOT A ROUTE FACT ARE TWO DIFFERENT SENTENCES. This function
 * answers "what did the application configure"; it does not answer "what limit does this route
 * enforce", and nothing here writes its numbers onto a node. See {@link describeUnreadableRoute}.
 * The policy is the one thing read here that changes what a route's own row says, and even that is
 * a status rather than a number: see {@link buildContracts}.
 *
 * `errorPolicy` IS TAKEN ONLY WHERE THE PROVIDER STATES ONE OF THE TWO VALUES. `mergeDefaults`
 * always states it, so a registered plugin is readable; an object that does not is not this
 * library's merged configuration, and reading the library's own `?? "fail-closed"` fallback off it
 * would be substituting a default for a reading, which is what puts an unprovable status on a page.
 *
 * @param context - The node's context, for the module reference
 * @returns What the provider states, or undefined when nothing registered one
 */
function readModuleConfiguration(context: CollectorContext): ModuleConfiguration | undefined {
  let value: unknown;
  try {
    value = context.moduleRef.get(RATE_LIMIT_PLUGIN_OPTIONS_KEY, { strict: false });
  } catch {
    // `UnknownElementException` is the ordinary answer in an application that installed the
    // library and never registered the plugin, so it is not a failure and produces no problem.
    return undefined;
  }

  if (typeof value !== 'object' || value === null) return undefined;

  const { defaultPoints, defaultDuration, errorPolicy } = value as {
    defaultPoints?: unknown;
    defaultDuration?: unknown;
    errorPolicy?: unknown;
  };
  const points = positiveNumber(defaultPoints);
  const duration = positiveNumber(defaultDuration);
  const policy = readErrorPolicy(errorPolicy);

  return {
    ...(points === undefined || duration === undefined
      ? {}
      : { budget: { points, ttlMs: duration * MILLISECONDS_PER_SECOND } }),
    ...(policy === undefined ? {} : { errorPolicy: policy }),
  };
}

/**
 * Reads a store failure policy that has to be one of the two the library acts on.
 *
 * @param value - Whatever the provider held under `errorPolicy`
 * @returns The policy, or undefined when the provider states nothing this collector recognises
 */
function readErrorPolicy(value: unknown): RateLimitErrorPolicy | undefined {
  if (value === FAIL_CLOSED_POLICY) return FAIL_CLOSED_POLICY;
  if (value === FAIL_OPEN_POLICY) return FAIL_OPEN_POLICY;

  return undefined;
}

/**
 * The statuses a route the decorator is on can answer with, and only those.
 *
 * 429 IS UNCONDITIONAL BECAUSE THE DECORATOR BINDS THE GUARD ITSELF. `@RateLimit` is
 * `applyDecorators(SetMetadata(RATE_LIMIT_OPTIONS, options), UseGuards(RateLimitGuard))`, so the
 * key being present is proof the guard stands in front of this route; the guard throws
 * `RateLimitExceededError` the moment `check` answers `allowed: false`, and
 * `RateLimitExceptionFilter` answers it with 429 and a `Retry-After` header. Nothing about the
 * budget, the algorithm, the store or a `skip` function changes that, so nothing about them is
 * consulted here.
 *
 * 503 IS NOT, AND WHAT DECIDES IT IS READ RATHER THAN ASSUMED. A store failure reaches
 * `RateLimitService.handleError`, where `this.config.errorPolicy ?? "fail-closed"` decides:
 * `fail-closed` throws `RateLimitScriptError`, which the same filter answers with 503; `fail-open`
 * returns an allowed result instead, so the request goes through and no store failure is answered
 * at all. That option has no route half, so the only place it can be read is the plugin provider,
 * and where the provider does not state it the status is left off and {@link recordErrorPolicy}
 * says why. A status this collector cannot tie to a configuration it read is not reported.
 *
 * @param policy - What the module states, or undefined when nothing readable states it
 * @returns The contracts, in ascending status order
 */
function buildContracts(policy: RateLimitErrorPolicy | undefined): readonly IRErrorContract[] {
  const contracts: IRErrorContract[] = [
    {
      status: RATE_LIMIT_EXCEEDED_STATUS,
      title: 'The rate limit on this route is exhausted',
      detail:
        'The request was counted past the budget in force and RateLimitGuard rejected it, which ' +
        'RateLimitExceptionFilter answers with Retry-After and the remaining window.',
      origin: 'runtime-derived',
      confidence: 'derived',
      collector: REDISX_RATE_LIMIT_COLLECTOR_NAME,
    },
  ];

  if (policy !== FAIL_CLOSED_POLICY) return contracts;

  contracts.push({
    status: STORE_UNAVAILABLE_STATUS,
    title: 'Rate limiting is temporarily unavailable',
    detail:
      'The store backing the limit could not be asked, and the module declares errorPolicy: ' +
      '"fail-closed", so the request is rejected rather than admitted.',
    origin: 'runtime-derived',
    confidence: 'derived',
    collector: REDISX_RATE_LIMIT_COLLECTOR_NAME,
  });

  return contracts;
}

/**
 * Records what the store failure policy decided, once, as a statement about the application.
 *
 * IT IS ONE RECORD AND NOT ONE PER ROUTE, by the precedent {@link recordModuleDefault} follows:
 * `errorPolicy` has no route half at all, so a sentence about it repeated on every decorated route
 * of an application would be one fact wearing many subjects.
 *
 * NOTHING IS RECORDED UNDER `fail-closed`, because there the status is in the contracts and a
 * finding beside it would say the same thing twice.
 *
 * @param policy - What the module states, or undefined when nothing readable states it
 * @param problems - Accumulator
 */
function recordErrorPolicy(
  policy: RateLimitErrorPolicy | undefined,
  problems: RedisxRateLimitCollectorProblem[],
): void {
  if (policy === FAIL_CLOSED_POLICY) return;

  if (policy === FAIL_OPEN_POLICY) {
    problems.push({
      subject: 'the application',
      reason: `the module declares errorPolicy: "${FAIL_OPEN_POLICY}", so a store failure lets the request through and 503 is not an answer`,
      action: `declare errorPolicy: "${FAIL_CLOSED_POLICY}" if an outage has to reject rather than admit; there is nothing to do if admitting is the intent`,
      detail:
        'Under this policy RateLimitService.handleError returns an allowed result instead of ' +
        'throwing, so for as long as the store is failing every decorated route stops being ' +
        'limited and nothing answers 503. The 429 stands either way: it is the guard rejecting a ' +
        'request it did count, which needs no store failure. One 503 path is left and is not a ' +
        'contract: a route naming a store other than "redis" or "memory" throws ' +
        'InvalidRateLimitConfigError before the policy is consulted, which is a configuration ' +
        'defect rather than something the route answers with.',
    });

    return;
  }

  problems.push({
    subject: 'the application',
    reason:
      'no readable errorPolicy stands under the plugin options token, so whether a store failure answers 503 is not known',
    action:
      'register RateLimitPlugin so its merged configuration answers that token; the 429 on each decorated route holds either way',
    detail:
      'The library resolves it as this.config.errorPolicy ?? "fail-closed" inside ' +
      'RateLimitService.handleError, and RateLimitPlugin.mergeDefaults always states it, so a ' +
      'registered plugin is readable. Either the token answered nothing, which is what NestJS ' +
      'does when nobody registered it, or it answered an object that does not state the field. ' +
      'The 503 is left off rather than taken from the library default, because a status nothing ' +
      'read is a status this reference cannot stand behind.',
  });
}

/**
 * Records the module budget once, as a statement about the application rather than about a route.
 *
 * IT IS ONE RECORD AND NOT ONE PER ROUTE, by the precedent the runtime pass already sets for a
 * guard registered under `APP_GUARD` that cannot be named: an unnameable global registration is one
 * problem for the application, not one per route.
 *
 * @param budget - What the provider held, or null when nothing did
 * @param problems - Accumulator
 */
function recordModuleDefault(
  budget: ModuleDefaultBudget | null,
  problems: RedisxRateLimitCollectorProblem[],
): void {
  if (budget === null) return;

  problems.push({
    subject: 'the application',
    // THE FIGURE IS IN THE ACTION AS WELL AS THE REASON, and that is not a repeat. `openref
    // doctor` prints the subject and the action and never the reason, per SPEC 7.2, and this is
    // the one finding whose whole content is the number: an action that did not carry it would
    // send a terminal reader to look up a budget nothing on that surface names.
    //
    // IT SAYS WHAT IT OBSERVED AND NOT WHAT IT HAS NOT LOOKED AT. This record is pushed on the
    // first node of the pass, before any route's own decorator has been read, so a sentence
    // claiming no route uses the default would be an assertion about routes nothing had examined.
    reason:
      `the module declares a default budget of ${String(budget.points)} request(s) per ` +
      `${String(budget.ttlMs)} ms and it is written onto no route`,
    action:
      `declare @RateLimit({ points: ${String(budget.points)}, duration: ` +
      `${String(budget.ttlMs / MILLISECONDS_PER_SECOND)} }) on a route to make that budget a fact ` +
      'about it; a route that declares its own points and duration carries them already and does ' +
      'not use this',
    detail:
      'The figure is read from the provider under Symbol.for("RATE_LIMIT_PLUGIN_OPTIONS"). Which ' +
      'routes it reaches is decided by whatever guard the application registered and by what that ' +
      'guard passes, and guard logic is never read, per SPEC 6.1.',
  });
}

/**
 * Says what is true of a route that declares no rate limit of its own.
 *
 * THIS IS THE CASE THAT WAS A CONFIDENT WRONG ANSWER, and it is the one SPEC 6.2.1 already rules on
 * for `scopesCollector`. A route with a guard and no metadata under the key is not a route with no
 * policy: it is a route whose policy is written in code that is never read, and the difference has
 * to be visible. An application that puts a rate limiting guard under `APP_GUARD` and decorates
 * four of its fifty eight routes has fifty four routes whose limit is real and unreadable, and a
 * reference that answered them the same way it answers an unlimited route would be wrong on
 * fifty four operations while looking certain.
 *
 * A ROUTE WITH NO GLOBAL GUARD GETS NOTHING, and that is the other half of the same rule. There the
 * absence of metadata is the absence of policy rather than unreadable policy, because the library's
 * own guard is applied by the decorator and a route without the decorator is not behind it. Warning
 * on every route of every application that installed the package would be the noise that makes a
 * report unreadable, which is worse than the silence it replaced.
 *
 * THE ROW SAYS IT TOO SINCE SPEC 6.2.3, and this record is no longer the only place it is said.
 * {@link reachOf} builds the same observation as a fact on the node, so a reader on the operation
 * page is not sent to a different report on a different page to learn which of the three states
 * their route is in. The two are built from the same two inputs and neither is derived from the
 * other's words.
 *
 * @param context - The node's context, for the global guard list
 * @param subject - The route, for a message
 * @param budget - The module budget, or null when nothing registered one
 * @param problems - Accumulator
 */
function describeUnreadableRoute(
  context: CollectorContext,
  subject: string,
  budget: ModuleDefaultBudget | null,
  problems: RedisxRateLimitCollectorProblem[],
): void {
  if (context.globalGuards.length === 0) return;

  const named = context.globalGuards.join(', ');

  problems.push({
    subject,
    reason: `it declares no limit of its own and stands behind ${named}, so its budget is not known`,
    action:
      'declare @RateLimit({ points, duration }) on the route if it has a budget, which is what ' +
      'makes the number a fact about it',
    detail:
      'Whether that guard limits this route, and at what budget, is written in its own code and ' +
      'is never read, per SPEC 6.1. ' +
      (budget === null
        ? 'No module budget was registered either, so nothing anywhere states a number for this route.'
        : `The module's configured default is ${String(budget.points)} request(s) per ` +
          `${String(budget.ttlMs)} ms, and it is not written here because nothing observed says ` +
          'that guard applies it to this route.'),
  });
}

/**
 * Reads the options object off one target.
 *
 * @param metadata - The reader
 * @param target - Controller class or handler
 * @returns The stored object, or an empty one when the key is absent or holds something else
 */
function readOptions(metadata: MetadataValueReader, target: unknown): StoredOptions {
  const stored: unknown = metadata.get(RATE_LIMIT_OPTIONS_KEY, target);

  // `@RateLimit()` WITH NO ARGUMENT STORES `{}` AND NOT `undefined`, measured on the installed
  // library: `RateLimit(options = {})` defaults the parameter before it calls `SetMetadata`. So an
  // empty object here is a decorated route whose whole budget is module configuration, which
  // {@link isDecorated} tells from an undecorated one and `buildRateLimit` reports as a route that
  // named neither half.
  return typeof stored === 'object' && stored !== null ? stored : {};
}

/**
 * Reports whether the library's decorator is on this route at all.
 *
 * PRESENCE AND NOT CONTENT, which is the distinction the empty object above makes necessary. What
 * decides whether the guard stands in front of a route is that `@RateLimit` was applied, since the
 * decorator is `applyDecorators(SetMetadata(...), UseGuards(RateLimitGuard))`; what is under the
 * key decides only how much of the budget the route named for itself. A check that asked for
 * content answered "undecorated" for `@RateLimit()` and reported that nothing limits the route.
 *
 * EITHER TARGET COUNTS, because either one applies the decorator, and the guard is bound by
 * whichever carries it.
 *
 * @param metadata - The reader
 * @param context - The node's context, for the two targets
 * @returns True when the key stands on the handler or on the controller
 */
function isDecorated(metadata: MetadataValueReader, context: CollectorContext): boolean {
  const onTarget = (target: unknown): boolean => {
    const stored: unknown = metadata.get(RATE_LIMIT_OPTIONS_KEY, target);

    return typeof stored === 'object' && stored !== null;
  };

  return onTarget(context.handler) || onTarget(context.controller);
}

/**
 * Turns the options into a rate limit, or into a reason there is none.
 *
 * THE HALF DECLARED CASE PRODUCES NOTHING, AND THE REASON IS THE ONE SPEC 6.2.2 GIVES. A decorator
 * that names `points` and not `duration` is completed at request time from the module's
 * `defaultDuration`, under a DI token this collector deliberately does not resolve: that number is
 * configuration of the module rather than a decision recorded on the route, and a reference that
 * printed it would attribute a module wide default to one endpoint.
 *
 * @param options - What both targets contributed
 * @param subject - The route, for a message
 * @param problems - Accumulator
 * @returns The rate limit, or undefined
 */
function buildRateLimit(
  options: StoredOptions,
  subject: string,
  problems: RedisxRateLimitCollectorProblem[],
): IRRateLimit | undefined {
  const points = positiveNumber(options.points);
  const duration = positiveNumber(options.duration);

  if (points === undefined || duration === undefined) {
    problems.push({
      subject,
      reason: `it carries @RateLimit and declares ${describeHalves(points, duration)}, so no limit is known`,
      action: 'name both points and duration on the decorator',
      detail:
        'The rest is resolved per request from the module provider under ' +
        'Symbol.for("RATE_LIMIT_PLUGIN_OPTIONS"), which is configuration of the module rather ' +
        'than a decision recorded on this route.',
    });

    return undefined;
  }

  // A TOKEN BUCKET IS NOT `limit` PER `ttlMs` AND SAYING SO WOULD BE WRONG BY MORE THAN A NAME.
  // Under it `points` is the bucket's capacity, the sustained rate is `refillRate` tokens per
  // second and defaults to `points / duration`, and there is no window that resets. `IRRateLimit`
  // has three fields and none of them means capacity, so nothing is reported, which is the same
  // answer `@openref/collector-throttler` gives a `ttl` whose unit it cannot establish.
  if (options.algorithm === CAPACITY_ALGORITHM) {
    problems.push({
      subject,
      reason: `it declares the ${CAPACITY_ALGORITHM} algorithm, so no count per window is known`,
      action:
        'nothing to do here unless the route can use a windowed algorithm: the reference has no ' +
        'shape for a bucket capacity, and this finding is what says the row is unmeasured',
      detail:
        'Under this algorithm points is the bucket capacity and the sustained rate is a refill ' +
        `per second rather than a count per window, so a rate limit of ${String(points)} per ` +
        `${String(duration * MILLISECONDS_PER_SECOND)} ms would describe something this route ` +
        'does not enforce.',
    });

    return undefined;
  }

  // THE NUMBER IS TRUE AND WHOSE TRUTH IT IS DEPENDS ON THE STORE, so the fact stands and the
  // qualification goes to `doctor`. The memory store counts inside one process, so the limit named
  // here is what one instance enforces and the global one is this number times the instance count,
  // which is runtime state and unreadable by definition.
  if (options.store === PER_INSTANCE_STORE) {
    problems.push({
      subject,
      reason: `it declares store: "${PER_INSTANCE_STORE}", so the limit across the deployment is not known`,
      action: 'declare store: "redis", which is what makes the number exact',
      detail:
        `A memory store counts inside one process, so ${String(points)} is what one instance ` +
        'allows and the deployment allows that number times the instance count. The instance ' +
        'count is runtime state and is not readable here.',
    });
  }

  // THE STRING KEY IS THE BUCKET'S OWN NAME, which is exactly what `IRRateLimit.name` carries for
  // the throttler beside it. A function under the same field is not a name and is reported by
  // `recordUnreadable`, per SPEC 6.2.2: a function under a key is a reason for `doctor`.
  const name = typeof options.key === 'string' && options.key !== '' ? options.key : undefined;

  return {
    limit: points,
    ttlMs: duration * MILLISECONDS_PER_SECOND,
    ...(name === undefined ? {} : { name }),
  };
}

/**
 * Records what the route decided in code, which is never read.
 *
 * SPEC 6.1 FORBIDS READING GUARD LOGIC WITHOUT QUALIFICATION, and both of these are guard logic
 * stored under a key. `key` decides which bucket a request is counted in and `skip` decides whether
 * it is counted at all, so the difference between "this route has no bucket scope" and "this route
 * has one and it is a function nobody can read" has to be visible.
 *
 * @param options - What both targets contributed
 * @param subject - The route, for a message
 * @param problems - Accumulator
 */
function recordUnreadable(
  options: StoredOptions,
  subject: string,
  problems: RedisxRateLimitCollectorProblem[],
): void {
  if (typeof options.key === 'function') {
    problems.push({
      subject,
      reason:
        'its bucket is chosen by a key function, so what the limit is counted per is not known',
      action: 'use a string key if the bucket should be named in the reference',
      detail:
        'A function under a key is never read, per SPEC 6.1, so whether the limit is counted per ' +
        'caller, per tenant or per address cannot be stated. A string key is read and shown as ' +
        'the bucket name.',
    });
  }

  if (typeof options.skip === 'function') {
    problems.push({
      subject,
      reason: 'it carries a skip function, so which requests are counted at all is not known',
      action:
        'nothing to do here: the limit shown is what applies to a request that is counted, and ' +
        'this finding is what says the row does not cover every request',
      detail:
        'Which requests the function skips is written in code this never reads, per SPEC 6.1.',
    });
  }
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
 * Names which halves of the budget the route declared, for the message above.
 *
 * @param points - The limit, when it is readable
 * @param duration - The window in seconds, when it is readable
 * @returns A phrase naming what is present and what is not
 */
function describeHalves(points: number | undefined, duration: number | undefined): string {
  if (points !== undefined) return 'points and no duration';
  if (duration !== undefined) return 'duration and no points';

  return 'neither points nor duration';
}

/**
 * Reports whether the library this collector reads is installed.
 *
 * THE PACKAGE IS RESOLVED EVEN THOUGH THE SYMBOL DOES NOT NEED IT, AND THAT IS THE POINT OF THIS
 * FUNCTION. `Symbol.for("RATE_LIMIT_OPTIONS")` reaches the global registry, so the key is available
 * in any process whether or not this library is present, and `RATE_LIMIT_OPTIONS` is a generic
 * enough name that a second library could claim the same symbol and store an object of its own
 * shape under it. Reading that object as though it were this library's would produce a limit out of
 * somebody else's configuration, at `derived` confidence, with this collector's name on it. So the
 * manifest is resolved first: the object is only read where the library that writes it is installed.
 *
 * IT RESOLVES AND NEVER REQUIRES, which is the property that matters: `resolve` walks the lookup
 * and hands back a path, and nothing in the library is evaluated. This collector has no reason to
 * run it, since everything it reads is metadata the application's own decorator already wrote.
 *
 * THE ENTRY POINT RATHER THAN THE MANIFEST, AND NOT BY PREFERENCE. `@openref/collector-throttler`
 * resolves `@nestjs/throttler/package.json` because it needs the version out of it; this collector
 * needs no version, and this library's `exports` map declares only `"."`, so asking for
 * `@nestjs-redisx/rate-limit/package.json` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` on an
 * installation where the package is present and working. Resolving the entry point answers the only
 * question being asked, is it installed, and is the one route the manifest leaves open.
 *
 * @returns True when the package is resolvable from here
 */
function isPackageInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve(REDISX_RATE_LIMIT_PACKAGE);

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

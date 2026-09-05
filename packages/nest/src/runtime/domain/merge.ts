import type {
  IRConfidence,
  IRDriftIssue,
  IRErrorContract,
  IRFact,
  IRGuard,
  IRNodeRuntime,
  IRPipe,
} from '@openref/core';

/**
 * How two collectors' output for one node becomes one.
 *
 * THE RULE IS ONE SENTENCE AND THE REST OF THIS FILE IS ITS CONSEQUENCES: the better provenance
 * wins, and registration order breaks a tie. That satisfies both halves of what T017 asks for.
 * Independent collectors touch different fields, so no order of registration changes the
 * result. Collectors that disagree about the same field resolve the same way every time, and
 * the way they resolve is the project's own model of truth rather than an arbitrary last-wins.
 *
 * WHY CONFIDENCE AND NOT ORDER ALONE. A `declared` fact came from a decorator somebody wrote on
 * purpose; a `derived` one came from metadata under a known key; an `inferred` one is a compile
 * time best effort, per SPEC 6.1. A registration list that let an inferred fact overwrite a
 * declared one because it happened to be registered later would be a mechanism for losing the
 * only fact in the set that a human asserted.
 *
 * WHY ORDER BREAKS THE TIE RATHER THAN THE LATER ONE WINNING. The list in `runtime.collectors`
 * reads top to bottom as a statement of precedence, and the first line of a list is where a
 * reader expects the strongest claim. It also means adding a collector to the end of the list
 * cannot change any fact that already existed, which is the property that makes the list safe
 * to extend.
 *
 * AND A TIE IS NOW SAID OUT LOUD, WHICH IS THE HALF THAT WAS MISSING FROM T017. The rule above was
 * written, enforced and tested from the day it landed, and the loser still vanished without trace:
 * the page draws the winner's provenance, so a reader looking at a rate limit could not tell "this
 * is the only thing anybody reported" from "this is one of two, and the other said a different
 * number". It stayed unreachable because every field of {@link FACT_FIELDS} had exactly one
 * producer in the shipped set; the second producer of `rateLimit` makes it reachable for the first
 * time, and a silent tie break on a fact a reader trusts is this project's own worst class.
 * {@link mergeContributions} records each one in an accumulator the registry drains into
 * `IRRuntimeMeta.problems`, so `doctor` names the field, both collectors and the confidence.
 *
 * ONLY THE TIE IS RECORDED, NOT EVERY LOSS. A `derived` fact beaten by a `declared` one lost by the
 * rule of SPEC 6.1, and the reader holds the evidence: the winning fact carries the confidence that
 * won. A tie of equal confidence is the only case whose resolution comes from somewhere the fact
 * itself cannot show.
 */

/** Rank of each level, high wins. There is no fourth, per SPEC 6.1. */
const CONFIDENCE_RANK: Readonly<Record<IRConfidence, number>> = {
  declared: 3,
  derived: 2,
  inferred: 1,
};

/** One field two collectors reported at the same confidence, and how it was decided. */
export interface FactContest {
  /** Which fact was contested, as {@link FACT_FIELDS} names it. */
  readonly field: FactField;
  /** The collector whose value is in the document, which is the earlier registration. */
  readonly kept: string;
  /** The collector whose value was dropped. */
  readonly dropped: string;
  /** The level both of them claimed, which is why order had to decide. */
  readonly confidence: IRConfidence;
}

/** One of the fact valued fields, named by {@link FACT_FIELDS}. */
export type FactField = (typeof FACT_FIELDS)[number];

/**
 * Resolves one fact field between what is held and what a later collector produced.
 *
 * @param field - Which fact, for the contest record
 * @param held - What the merge has so far, or undefined
 * @param incoming - What this collector produced for the same field, or undefined
 * @param collector - Name of the collector that produced it
 * @param contests - Accumulator for a tie of equal confidence
 * @returns Whichever fact wins, attributed to whoever produced it
 */
function resolve<T>(
  field: FactField,
  held: IRFact<T> | undefined,
  incoming: IRFact<T> | undefined,
  collector: string,
  contests: FactContest[],
): IRFact<T> | undefined {
  if (incoming === undefined) return held;
  if (held === undefined) return stamp(incoming, collector);

  if (CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[held.confidence]) {
    return stamp(incoming, collector);
  }

  // THE HELD FACT IS ALREADY STAMPED, so `held.collector` names the winner rather than whatever
  // the collector wrote into its own literal. That matters here more than anywhere: a contest
  // record that named the wrong side would be worse than no record.
  if (incoming.confidence === held.confidence) {
    contests.push({
      field,
      kept: held.collector,
      dropped: collector,
      confidence: held.confidence,
    });
  }

  return held;
}

/**
 * Rewrites a fact so it names the collector that actually produced it.
 *
 * THE REGISTRY OWNS PROVENANCE, and this is where it takes it. `CollectorContext.fact` fills
 * the name in already, so for a collector written the ordinary way this changes nothing. It
 * exists because the type of `IRFact` cannot stop a collector building an object literal with
 * another collector's name in it, and a fact that lies about its source is worse than a fact
 * that is missing: the UI shows provenance, `doctor` reports it, and drift is attributed by it.
 *
 * @param fact - Whatever the collector returned
 * @param collector - Name of the collector that returned it
 * @returns The same fact, attributed correctly
 */
function stamp<T>(fact: IRFact<T>, collector: string): IRFact<T> {
  return fact.collector === collector ? fact : { ...fact, collector };
}

/** The fact valued fields, named once so the merge and its test cannot drift apart. */
export const FACT_FIELDS = [
  'scopes',
  'roles',
  'rateLimit',
  'rateLimitReach',
  'timeout',
  'requiredHeaders',
  'parameterReads',
  'statusCode',
  'streaming',
] as const;

/** The list valued fields, which accumulate rather than compete. */
export const LIST_FIELDS = ['guards', 'pipes', 'drift'] as const;

/**
 * The fields that are three lists rather than one, per SPEC 6.4.
 *
 * `errors` LEFT {@link LIST_FIELDS} IN T021, AND THE MOVE IS THE POINT OF THAT TASK. It used to be
 * one array whose members each carried an `origin`, which is one list however carefully it is read:
 * anything wanting "the errors" gets all three groups concatenated and nothing complains. Three
 * named groups accumulate group by group, so a promise and an observation can only end up in the
 * same list if somebody writes the concatenation on purpose.
 */
export const GROUPED_FIELDS = ['errors'] as const;

/** The three groups of an error contract set, named once for the fold below. */
const ERROR_GROUPS = ['declared', 'runtimeDerived', 'global'] as const;

/** What one collector contributed, with the name to attribute it to. */
export interface Contribution {
  readonly collector: string;
  readonly runtime: IRNodeRuntime;
}

/**
 * Folds every collector's output for one node into a single runtime record.
 *
 * @param contributions - What each collector returned, in registration order
 * @param contests - Accumulator for the ties of equal confidence, when a caller wants to see them
 * @returns The merged facts, or undefined when no collector said anything
 */
export function mergeContributions(
  contributions: readonly Contribution[],
  contests: FactContest[] = [],
): IRNodeRuntime | undefined {
  const merged: {
    source?: IRNodeRuntime['source'];
    scopes?: IRFact<readonly string[]> | undefined;
    roles?: IRFact<readonly string[]> | undefined;
    rateLimit?: IRNodeRuntime['rateLimit'] | undefined;
    rateLimitReach?: IRNodeRuntime['rateLimitReach'] | undefined;
    timeout?: IRNodeRuntime['timeout'] | undefined;
    requiredHeaders?: IRNodeRuntime['requiredHeaders'] | undefined;
    parameterReads?: IRNodeRuntime['parameterReads'] | undefined;
    statusCode?: IRNodeRuntime['statusCode'] | undefined;
    streaming?: IRNodeRuntime['streaming'] | undefined;
    guards?: IRGuard[];
    pipes?: IRPipe[];
    errors?: {
      declared: IRErrorContract[];
      runtimeDerived: IRErrorContract[];
      global: IRErrorContract[];
    };
    drift?: IRDriftIssue[];
  } = {};

  for (const { collector, runtime } of contributions) {
    // `source` carries no confidence, because there is nothing to be uncertain about: either
    // the handler was found on a controller or it was not. First one wins, so a later collector
    // cannot move a reader's source link out from under them.
    if (merged.source === undefined && runtime.source !== undefined) merged.source = runtime.source;

    // EIGHT CALLS TO ONE FUNCTION RATHER THAN EIGHT NEAR IDENTICAL BLOCKS, and the change is what
    // made the tie recordable at all: the rule now lives in one place, so a field cannot be added
    // to the merge with the contest half quietly left out of it.
    merged.scopes = resolve('scopes', merged.scopes, runtime.scopes, collector, contests);
    merged.roles = resolve('roles', merged.roles, runtime.roles, collector, contests);
    merged.rateLimit = resolve(
      'rateLimit',
      merged.rateLimit,
      runtime.rateLimit,
      collector,
      contests,
    );
    merged.rateLimitReach = resolve(
      'rateLimitReach',
      merged.rateLimitReach,
      runtime.rateLimitReach,
      collector,
      contests,
    );
    merged.timeout = resolve('timeout', merged.timeout, runtime.timeout, collector, contests);
    merged.requiredHeaders = resolve(
      'requiredHeaders',
      merged.requiredHeaders,
      runtime.requiredHeaders,
      collector,
      contests,
    );
    merged.parameterReads = resolve(
      'parameterReads',
      merged.parameterReads,
      runtime.parameterReads,
      collector,
      contests,
    );
    merged.statusCode = resolve(
      'statusCode',
      merged.statusCode,
      runtime.statusCode,
      collector,
      contests,
    );
    merged.streaming = resolve(
      'streaming',
      merged.streaming,
      runtime.streaming,
      collector,
      contests,
    );

    // THE LISTS ACCUMULATE, AND TWO COLLECTORS EMITTING GUARDS ARE NOT INDEPENDENT. Order does
    // show in these, and it has to: three guards on a route are three facts, not one fact three
    // collectors disagree about. Duplicates are dropped by the pair that identifies each kind,
    // so registering the same collector twice cannot double a list.
    if (runtime.guards !== undefined) {
      merged.guards = dedupe(
        [...(merged.guards ?? []), ...runtime.guards.map((guard) => ({ ...guard, collector }))],
        // THE SCOPE IS PART OF WHAT MAKES TWO GUARDS THE SAME, per SPEC 6.2.1. One class both
        // registered under `APP_GUARD` and named in `@UseGuards` on a route is two registrations,
        // and a key without the scope would keep whichever arrived first and drop the other,
        // which is the half a reader asking "is this the route's own decision" is asking for.
        (guard) => `${guard.name}\0${guard.scope}\0${guard.confidence}`,
      );
    }
    if (runtime.pipes !== undefined) {
      merged.pipes = dedupe(
        [...(merged.pipes ?? []), ...runtime.pipes.map((pipe) => ({ ...pipe, collector }))],
        // The scope is part of the identity for the guard reason, with the third value:
        // `TrimPipe` on the route and `TrimPipe` on one parameter are two decisions.
        (pipe) => `${pipe.name}\0${pipe.scope}\0${pipe.confidence}`,
      );
    }
    // THE GROUPS ACCUMULATE SEPARATELY AND ARE NEVER CONCATENATED, which is what makes SPEC 6.4
    // structural rather than a convention. Two collectors both reporting errors contribute to the
    // same three groups; a contract moves between groups only by changing its own origin, and the
    // only thing that reads an origin is `groupErrorContracts` in `core`.
    if (runtime.errors !== undefined) {
      const held = merged.errors ?? { declared: [], runtimeDerived: [], global: [] };
      const incoming = runtime.errors;

      for (const group of ERROR_GROUPS) {
        held[group] = dedupe(
          [...held[group], ...incoming[group].map((error) => ({ ...error, collector }))],
          (error) => `${String(error.status)}\0${error.title}\0${error.origin}`,
        );
      }

      merged.errors = held;
    }
    if (runtime.drift !== undefined) {
      merged.drift = dedupe(
        [...(merged.drift ?? []), ...runtime.drift],
        (issue) => `${issue.rule}\0${issue.nodeId ?? ''}\0${issue.message}`,
      );
    }
  }

  // BUILT BY SPREADING RATHER THAN BY ASSIGNING, because `exactOptionalPropertyTypes` draws the
  // distinction this project wants: a field that is absent is not a field whose value is
  // `undefined`. The IR is hashed after canonical serialization, and a key present with an
  // undefined value would be a difference the hash can see and a reader cannot.
  const result: IRNodeRuntime = {
    ...(merged.source === undefined ? {} : { source: merged.source }),
    ...(merged.scopes === undefined ? {} : { scopes: merged.scopes }),
    ...(merged.roles === undefined ? {} : { roles: merged.roles }),
    ...(merged.rateLimit === undefined ? {} : { rateLimit: merged.rateLimit }),
    ...(merged.rateLimitReach === undefined ? {} : { rateLimitReach: merged.rateLimitReach }),
    ...(merged.timeout === undefined ? {} : { timeout: merged.timeout }),
    ...(merged.requiredHeaders === undefined ? {} : { requiredHeaders: merged.requiredHeaders }),
    ...(merged.parameterReads === undefined ? {} : { parameterReads: merged.parameterReads }),
    ...(merged.statusCode === undefined ? {} : { statusCode: merged.statusCode }),
    ...(merged.streaming === undefined ? {} : { streaming: merged.streaming }),
    ...(merged.guards === undefined ? {} : { guards: merged.guards }),
    ...(merged.pipes === undefined ? {} : { pipes: merged.pipes }),
    ...(merged.errors === undefined ? {} : { errors: merged.errors }),
    ...(merged.drift === undefined ? {} : { drift: merged.drift }),
  };

  return Object.keys(result).length === 0 ? undefined : result;
}

/**
 * Keeps the first of each key, preserving order.
 *
 * @param items - What accumulated
 * @param keyOf - What makes two of them the same
 * @returns The list with later duplicates removed
 */
function dedupe<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = keyOf(item);
    if (seen.has(key)) return false;
    seen.add(key);

    return true;
  });
}

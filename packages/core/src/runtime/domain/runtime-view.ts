/**
 * What a reader is shown about the runtime, decided once for every consumer.
 *
 * THE PREDICATE LIVES HERE BECAUSE TWO PACKAGES ASK THE SAME QUESTION. `@openref/render` asks it
 * to decide whether to emit the runtime block at all, and `useRuntime` in `@openref/vue` asks it
 * so a theme can decide the same thing about its own markup. Two copies of "is there anything to
 * show" is the shape the standing rule about a shared definition names: each copy has its own
 * tests, both stay green, and they come to disagree the first time a field is added.
 *
 * SPEC 6.3: THE BLOCK IS NOT DRAWN AT ALL WHEN THERE ARE NO FACTS. A scaffold of labelled slots
 * with nothing in them is what most readers arriving from plain `@nestjs/swagger` would see,
 * because they have registered no collectors, and it reads as a broken product rather than as an
 * unused feature.
 */

import type { IRDocument } from '../../ir/domain/document.types';
import type { IRNodeRuntime, IRRuntimeMeta } from '../../ir/domain/runtime.types';

/**
 * The fields of {@link IRNodeRuntime} that are facts about the running application.
 *
 * `drift` is deliberately not one of them. A finding is a statement about the disagreement
 * between two documents, not an observation of the application, and a node that has nothing but
 * findings has nothing to put in a runtime block.
 */
export const RUNTIME_FACT_FIELDS = [
  'source',
  'guards',
  'pipes',
  'scopes',
  'roles',
  'rateLimit',
  'rateLimitReach',
  'handlerPolicies',
  'timeout',
  'requiredHeaders',
  'parameterReads',
  'statusCode',
  'errors',
  'streaming',
] as const satisfies readonly (keyof IRNodeRuntime)[];

/** One of the fact valued fields. */
export type RuntimeFactField = (typeof RUNTIME_FACT_FIELDS)[number];

/**
 * Compile time proof that every field of {@link IRNodeRuntime} is a fact or is `drift`.
 *
 * `satisfies` above catches a name that is not a field. This catches a field that is not named,
 * which is the direction that would ship a fact the runtime block silently refuses to draw. It is
 * the same partition assertion `collector-contract.spec.ts` makes over the merge.
 */
export type RUNTIME_FIELDS_ARE_PARTITIONED =
  Exclude<keyof IRNodeRuntime, RuntimeFactField | 'drift'> extends never ? true : never;

/**
 * Reports whether a node has any runtime fact at all.
 *
 * A PRESENT FIELD COUNTS EVEN WHEN IT IS EMPTY, and that is the distinction of SPEC 6.2 and 6.4
 * rather than an oversight. An `errors` record whose three groups are all empty means a collector
 * examined the route and found nothing declared on it, which is a sentence worth printing; the
 * field being absent means nobody was asked, which is not.
 *
 * @param runtime - The node's runtime record, or nothing when no collector reached it
 * @returns True when there is something to draw
 */
export function hasRuntimeFacts(runtime: IRNodeRuntime | undefined): boolean {
  if (runtime === undefined) return false;

  return RUNTIME_FACT_FIELDS.some((field) => runtime[field] !== undefined);
}

/**
 * The collectors this distribution ships for each fact, so an absence can name what would fill it.
 *
 * IT IS A SUGGESTION LIST AND NEVER THE TEST FOR PRESENCE, which is the whole reason it is safe to
 * write down. A host's own collector is not in it and never will be, so a reader whose limiter is
 * not `@nestjs/throttler` must not be told that nothing reports a rate limit merely because the
 * name they registered is not on this list. {@link runtimeInstrument} asks
 * {@link observedFactCollectors} first for exactly that reason: a fact that exists is proof no list
 * can be wrong about, and this list only answers the case where nothing was produced at all.
 *
 * A `Record` over {@link RuntimeFactField} rather than a partial one, so a fact added to
 * `IRNodeRuntime` cannot reach a reader with no instrument named for it.
 */
export const RUNTIME_FACT_COLLECTORS: Readonly<Record<RuntimeFactField, readonly string[]>> = {
  source: ['sourceCollector'],
  guards: ['guardsCollector'],
  pipes: ['pipesCollector'],
  scopes: ['scopesCollector', 'declarationsCollector', 'caslCollector'],
  roles: ['rolesCollector', 'accessControlCollector'],
  // TWO NAMES SINCE `TX-REDISX-RATELIMIT`, AND THE SENTENCE THE ROW BUILDS CHANGES SHAPE BECAUSE OF
  // IT. `scopes` and `roles` already carried more than one, so the joining is not new; what is new
  // is that this is the first field two SHIPPED collectors can both produce on one route, which is
  // the tie `mergeContributions` now records rather than resolving in silence.
  rateLimit: ['throttlerCollector', 'redisxRateLimitCollector'],
  // THE SAME TWO NAMES, BECAUSE THE ANSWER COMES FROM THE SAME INSTRUMENT. A collector that can
  // report a limit is the collector that can report there is none, so a reader missing this fact
  // is missing it for exactly the reason they are missing `rateLimit`, and pointing them at a
  // third name would be pointing them at a package that does not exist.
  rateLimitReach: ['throttlerCollector', 'redisxRateLimitCollector'],
  // THREE NAMES, WHICH IS THE FIRST FIELD MORE THAN TWO SHIPPED COLLECTORS FILL, and unlike
  // `rateLimit` they never contest each other: a cache, a lock and a breaker on one handler are
  // three behaviours, so the list accumulates and `mergeContributions` records no tie.
  handlerPolicies: ['redisxCacheCollector', 'redisxLockCollector', 'redisxCircuitBreakerCollector'],
  timeout: ['timeoutCollector'],
  requiredHeaders: ['headersCollector'],
  parameterReads: ['handlerScanCollector'],
  statusCode: ['httpCodeCollector'],
  errors: ['errorsCollector'],
  streaming: ['streamCollector'],
};

/**
 * Why one fact is absent from one node, which is four different sentences and not one.
 *
 * THIS IS THE DISTINCTION `IRErrorContracts` ALREADY DRAWS ONE LEVEL DOWN AND `IRRuntimeMeta`
 * DRAWS ONE LEVEL UP, made available to a reader. A group present and empty means the route was
 * examined and was silent; the whole field absent means nobody was asked. Until this existed every
 * consumer printed one phrase over both, so an application with no rate limit collector registered
 * and an application whose route simply has no limit produced the same cell, and neither reader
 * could act on it.
 */
export type RuntimeInstrument =
  /** No runtime pass ran on this document at all, so no question was put to the application. */
  | { readonly kind: 'unmeasured' }
  /** Something reported this fact somewhere in this document, so the empty node is the answer. */
  | { readonly kind: 'ran'; readonly collector: string }
  /** A collector for it was registered and did not run, with the registry's own reason. */
  | { readonly kind: 'skipped'; readonly collector: string; readonly reason: string }
  /** Nothing that reports this fact is registered, and these are the names that would. */
  | { readonly kind: 'absent'; readonly shipped: readonly string[] };

/**
 * The collector behind one fact on one node, when the fact names one.
 *
 * AN EXHAUSTIVE SWITCH RATHER THAN A WALK OVER UNKNOWN VALUES, because the three shapes a fact
 * comes in are three shapes and not one: a list whose members each carry a name, an `IRFact` that
 * carries one itself, and `IRErrorContracts`, whose groups can all be present and all be empty, in
 * which case the field is proof a collector ran and carries no name to prove it with.
 *
 * @param runtime - The node's facts
 * @param field - Which fact
 * @returns The collector's name, the empty string when the fact is present and anonymous, and
 *   undefined when the fact is absent
 */
function collectorOfFact(runtime: IRNodeRuntime, field: RuntimeFactField): string | undefined {
  switch (field) {
    case 'guards':
      return runtime.guards === undefined ? undefined : (runtime.guards[0]?.collector ?? '');
    case 'pipes':
      return runtime.pipes === undefined ? undefined : (runtime.pipes[0]?.collector ?? '');
    // THE LIST SHAPE, LIKE THE TWO ABOVE IT: a present but empty list is a collector that ran and
    // found nothing, which carries no name to prove it with, so it answers the empty string and
    // the caller falls back to the registry.
    case 'handlerPolicies':
      return runtime.handlerPolicies === undefined
        ? undefined
        : (runtime.handlerPolicies[0]?.collector ?? '');
    case 'errors': {
      const errors = runtime.errors;
      if (errors === undefined) return undefined;

      return [...errors.declared, ...errors.runtimeDerived, ...errors.global][0]?.collector ?? '';
    }
    case 'source':
      return runtime.source === undefined ? undefined : '';
    case 'scopes':
      return runtime.scopes?.collector;
    case 'roles':
      return runtime.roles?.collector;
    case 'rateLimit':
      return runtime.rateLimit?.collector;
    case 'rateLimitReach':
      return runtime.rateLimitReach?.collector;
    case 'timeout':
      return runtime.timeout?.collector;
    case 'requiredHeaders':
      return runtime.requiredHeaders?.collector;
    case 'parameterReads':
      return runtime.parameterReads?.collector;
    case 'statusCode':
      return runtime.statusCode?.collector;
    case 'streaming':
      return runtime.streaming?.collector;
  }
}

/**
 * Which facts anything in this document actually produced, and who produced each.
 *
 * ONE PASS OVER THE DOCUMENT, MEANT TO BE HOISTED. It is proof of presence that no name table can
 * be wrong about: a host who wrote their own collector for a fact this distribution ships none for
 * is still told that their instrument ran, because the instrument left a fact behind on some other
 * route. `IRSourceLocation` carries no collector name at all, per its own type, so `source`
 * resolves to the empty string and the caller falls back to the registry for a name.
 *
 * @param document - The document, with whatever facts are attached to it
 * @returns Fact field to the first collector name seen on it, in node order
 */
export function observedFactCollectors(
  document: IRDocument,
): ReadonlyMap<RuntimeFactField, string> {
  const seen = new Map<RuntimeFactField, string>();

  for (const node of document.nodes.values()) {
    const runtime = node.runtime;
    if (runtime === undefined) continue;

    for (const field of RUNTIME_FACT_FIELDS) {
      const name = collectorOfFact(runtime, field);
      if (name === undefined) continue;
      if (name !== '' || !seen.has(field)) seen.set(field, name);
    }

    if (seen.size === RUNTIME_FACT_FIELDS.length) break;
  }

  return seen;
}

/**
 * Why one fact is missing from one node: the instrument, not the route.
 *
 * THE ORDER OF THE FOUR ANSWERS IS THE ORDER OF HOW MUCH EACH CLAIMS. An observed fact is proof and
 * comes first. A registered collector that declined or was retired is the registry's own record and
 * comes second, because a reader whose collector threw needs the reason before anything else. A
 * registered name that produced nothing anywhere still ran, so it is `ran` and not `absent`. Only
 * when none of those hold is anything said about absence, and even then the claim is about what is
 * registered rather than about what exists.
 *
 * @param meta - The document's runtime metadata, absent when no pass ran
 * @param field - Which fact is missing
 * @param observed - The result of {@link observedFactCollectors}, hoisted by the caller
 * @returns Which of the four states the absence is
 */
export function runtimeInstrument(
  meta: IRRuntimeMeta | undefined,
  field: RuntimeFactField,
  observed: ReadonlyMap<RuntimeFactField, string>,
): RuntimeInstrument {
  if (meta === undefined) return { kind: 'unmeasured' };

  const shipped = RUNTIME_FACT_COLLECTORS[field];
  const registered = shipped.filter((name) => meta.collectors.includes(name));
  const witness = observed.get(field);

  if (witness !== undefined && witness !== '') return { kind: 'ran', collector: witness };

  const declined = (meta.skipped ?? []).find((entry) => shipped.includes(entry.collector));
  if (declined !== undefined) {
    return { kind: 'skipped', collector: declined.collector, reason: declined.reason };
  }

  const named = registered[0];
  if (named !== undefined) return { kind: 'ran', collector: named };
  if (witness !== undefined) return { kind: 'ran', collector: '' };

  return { kind: 'absent', shipped };
}

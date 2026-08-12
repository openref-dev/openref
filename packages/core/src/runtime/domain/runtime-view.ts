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

import type { IRNodeRuntime } from '../../ir/domain/runtime.types';

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
  'scopes',
  'roles',
  'rateLimit',
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

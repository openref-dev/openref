import {
  driftForNode,
  expandSourceLink,
  hasRuntimeFacts,
  type IRDriftIssue,
  type IRErrorContracts,
  type IRFact,
  type IRGuard,
  type IRNodeRuntime,
  type IRRateLimit,
  type IRRuntimeMeta,
  type IRSourceLocation,
  type IRStreaming,
  type SourceLinkExpansion,
} from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useDocState } from '../state/api/context';
import { useNode } from './useNode';

/**
 * Runtime facts about one node, per SPEC 6.
 *
 * The IR carries the shape from M0 and the collectors that fill it arrived in M1. `available`
 * says whether any collector ran for the document at all. A theme must not read an absent fact
 * as "this endpoint has no guards": absent facts and facts that say nothing are different
 * claims, and only the collectors can tell them apart.
 *
 * EVERY FACT IS HANDED OVER WITH ITS PROVENANCE STILL ON IT. These are `IRFact` wrappers rather
 * than bare values, so a theme that renders a scope without saying where the scope came from has
 * to unwrap it on purpose. That is the same move the IR makes and it is made again here because
 * a composable is the last place the wrapper could quietly be dropped.
 */
export interface UseRuntime {
  readonly runtime: ComputedRef<IRNodeRuntime | undefined>;
  /** Whether any collector ran for this document at all. */
  readonly available: ComputedRef<boolean>;
  /**
   * Whether this node has a fact worth drawing a block around, per SPEC 6.3.
   *
   * `false` MEANS DRAW NOTHING, NOT DRAW AN EMPTY BLOCK. It is the whole of the rule that a
   * reference arriving from plain `@nestjs/swagger` shows no scaffold of labelled slots with
   * dashes in them. The predicate is `hasRuntimeFacts` from `@openref/core`, so this and the
   * renderer cannot come to disagree about what counts as a fact.
   */
  readonly hasFacts: ComputedRef<boolean>;
  readonly guards: ComputedRef<readonly IRGuard[]>;
  readonly scopes: ComputedRef<IRFact<readonly string[]> | undefined>;
  readonly roles: ComputedRef<IRFact<readonly string[]> | undefined>;
  readonly rateLimit: ComputedRef<IRFact<IRRateLimit> | undefined>;
  readonly streaming: ComputedRef<IRFact<IRStreaming> | undefined>;
  /**
   * Error contracts in the three groups of SPEC 6.4, never as one list.
   *
   * Absent means no error collector ran. A present record whose `declared` group is empty means
   * the route was examined and nothing was declared on it, which is a different sentence.
   */
  readonly errors: ComputedRef<IRErrorContracts | undefined>;
  /** Where the handler is written. It carries no confidence: V8 either answered or did not. */
  readonly source: ComputedRef<IRSourceLocation | undefined>;
  /**
   * The source link, or the reason there is none.
   *
   * Undefined when there is no source at all, which is the case where there is nothing to say.
   * A present expansion carrying a `reason` is a link that could not be built, and SPEC 6.3 wants
   * that reason shown rather than a clickable link that lands on a 404.
   */
  readonly sourceLink: ComputedRef<SourceLinkExpansion | undefined>;
  /** Findings about this node, read out of the document's report. */
  readonly drift: ComputedRef<readonly IRDriftIssue[]>;
  /** Document wide collector metadata, for a panel that reports what ran. */
  readonly meta: ComputedRef<IRRuntimeMeta | undefined>;
}

/**
 * @param id - Node id, or nothing to follow the current selection
 * @returns The runtime facts of that node
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { guards, hasFacts } = useRuntime();
 */
export function useRuntime(id?: MaybeRefOrGetter<string | undefined>): UseRuntime {
  const state = useDocState();
  const { node } = useNode(id);

  const runtime = computed(() => node.value?.node.runtime);
  const meta = computed(() => state.document.value.runtime);

  const sourceLink = computed<SourceLinkExpansion | undefined>(() => {
    const source = runtime.value?.source;
    if (source === undefined) return undefined;

    // THE TEMPLATE ARRIVES WITH `{ref}` ALREADY SUBSTITUTED, per SPEC 6.3: the revision is a
    // property of the build environment and nothing in a browser is in one. An unconfigured
    // template is passed through as the empty string, so the expansion answers with the reason
    // rather than this composable inventing one.
    return expandSourceLink(meta.value?.sourceLinkTemplate ?? '', source);
  });

  return {
    runtime,
    available: computed(() => meta.value !== undefined),
    hasFacts: computed(() => hasRuntimeFacts(runtime.value)),
    guards: computed(() => runtime.value?.guards ?? []),
    scopes: computed(() => runtime.value?.scopes),
    roles: computed(() => runtime.value?.roles),
    rateLimit: computed(() => runtime.value?.rateLimit),
    streaming: computed(() => runtime.value?.streaming),
    errors: computed(() => runtime.value?.errors),
    source: computed(() => runtime.value?.source),
    sourceLink,
    // THE REPORT IS THE SOURCE AND `IRNodeRuntime.drift` IS THE FALLBACK, not the other way
    // round. The rules of SPEC 7.1 need the whole document to fire, so they run once over it and
    // the findings live on the report; the node field stays for a document that arrived from a
    // federation remote with findings already attached to its nodes.
    drift: computed(() => {
      const own = runtime.value?.drift;
      if (own !== undefined) return own;

      const nodeId = node.value?.id;
      if (nodeId === undefined) return [];

      return driftForNode(state.document.value.health?.drift ?? [], nodeId);
    }),
    meta,
  };
}

/**
 * The runtime pass: discover, pair, collect, and hand back a document that carries the facts.
 *
 * IT RUNS ONCE, AT BOOTSTRAP. Walking the container on every request would put a proportional
 * cost on a documentation route, which is a denial of service written by us rather than by an
 * attacker. Everything after this is a pure function of the IR, exactly as it was before.
 *
 * THE HASH IS RECOMPUTED, AND THAT IS NOT AN OPTIMIZATION DETAIL. The SPEC 12 cache is keyed by
 * document hash and so is the navigation route, so a document carrying runtime facts under the
 * hash of the document without them would serve a reader a page from before the pass ran, and
 * would keep serving it. `finalizeDocument` takes it and freezes what it measured, per CLAUDE.md.
 *
 * FAIL OPEN, LIKE THE REGISTRY IT DRIVES. A collector pass is an augmentation of a document that
 * already renders. If discovery finds nothing, the document is returned unchanged and the report
 * says why, rather than the application failing to boot over a panel.
 */

import {
  buildHealthReport,
  finalizeDocument,
  orderRelationships,
  withRuntimeErrorContracts,
  type DriftObservation,
  type IRDocument,
  type IRNode,
  type IRNodeRuntime,
} from '@openref/core';
import {
  CollectorRegistry,
  type CollectorRegistryOptions,
  type CollectorTarget,
} from './collector-registry.service';
import type { CollectorRegistration } from '../ports/collector.port';
import {
  discoverRoutes,
  type DiscoveryProblem,
} from '../../infrastructure/adapters/controller-discovery.adapter';
import { pairRoutes, type PairingResult } from '../../domain/route-pairing';
import { readGlobalGuards } from '../../domain/guards';
import { readGlobalPipes } from '../../domain/pipes';
import {
  declaredRelationships,
  withReadConfidence,
  type ChannelDirectionConfidence,
} from '../../domain/relationships';
import type { DiscoveryServiceLike } from '../../../shared/types/nest-surface';

/** Everything the pass needs, gathered by whoever has access to the container. */
export interface RuntimePassOptions extends CollectorRegistryOptions {
  /** The collectors the host registered, in declaration order. */
  readonly collectors: readonly CollectorRegistration[];
  /** Nest's `DiscoveryService`, which is the only public route to the controller classes. */
  readonly discovery: DiscoveryServiceLike;
  /** Guard class name to security scheme id, per SPEC 13.2, for `security-drift`. */
  readonly guardSecuritySchemes?: Readonly<Record<string, string>>;
  /**
   * Channel nodes already paired with the handler that serves them, per SPEC 8.3.
   *
   * THEY ARRIVE PAIRED BECAUSE THE PAIRING IS NOT THE SAME QUESTION. An HTTP route has to be
   * matched to a node somebody else wrote, which is what `pairRoutes` does with three ordered
   * rules; a channel node exists because the event discovery produced it, so the pairing is a
   * lookup done by `events/domain/channel-pairing.ts` before this runs. Passing the result in
   * keeps this service the one place collectors are driven, rather than adding a second driver.
   *
   * EMPTY MEANS THERE ARE NONE, AND THERE IS NO THIRD STATE, which is the rule `globalGuards`
   * already sets on the collector context one level down.
   */
  readonly channelTargets?: readonly CollectorTarget[];
  /**
   * How confidently the direction of each synthesized channel was read, by node id, per SPEC 9.3.
   *
   * IT EXISTS TO TAKE A WORD BACK. An events document is synthesized by this package and then
   * normalized, so every `send` and `receive` edge comes out `declared`, which is true of the
   * document and false of the reading behind it wherever `@ApiChannel({ direction })` was absent.
   * Absent here, nothing is lowered, which is the correct answer for a document the host handed in.
   */
  readonly channelDirectionConfidence?: ChannelDirectionConfidence;
}

/**
 * What the pass produced.
 *
 * The report is kept whole rather than reduced to a count. A node with no route is what
 * `orphan-operation` fires on, and T022 reads it from here. The other three lists are not drift
 * and deliberately never become findings: a route with no node is what `include` produces on
 * purpose, and the remaining two are defects in this pass or in the application's own routing,
 * which `doctor` reports as problems rather than as a disagreement between two sides.
 */
export interface RuntimePassResult {
  /** The document with facts attached and its hash retaken. */
  readonly document: IRDocument;
  /** How many nodes received at least one fact. */
  readonly nodesWithFacts: number;
  /** What discovery skipped. */
  readonly discoveryProblems: readonly DiscoveryProblem[];
  /** What could not be attributed to exactly one node, on either side. */
  readonly pairing: PairingResult;
  /** What ran, what declined and what was retired, per SPEC 6.2. */
  readonly registry: CollectorRegistry;
}

/**
 * Drops any finding a collector attached that names a node this document does not hold.
 *
 * FOUND IN T025 BY WRITING A COLLECTOR THAT REPORTS ONE. `IRDriftIssue.nodeId` is a free string
 * that a collector fills in, and nothing checked it against the document, so a stale id from a
 * cache, a typo, or a remote's id arriving in a federated record all reached the page. There the
 * finding renders with `nodeHref(nodeId)` behind it, so a reader is offered a link to an operation
 * that does not exist and lands on a 404 they blame on the reference.
 *
 * IT IS DROPPED AND RECORDED, NOT DROPPED QUIETLY. A finding that cannot be shown is a defect in
 * whatever produced it, and `doctor` is where a defect in an instrument goes, per SPEC 7. Silently
 * discarding it would leave a collector author with a finding that never appears and no reason.
 *
 * @param runtime - The merged facts of one node
 * @param document - The document being augmented, which is what a node id has to exist in
 * @param problems - Accumulator, so the drop is reported once per finding rather than per reader
 * @returns The same facts with the unreachable findings removed
 */
function withoutGhostFindings(
  runtime: IRNodeRuntime,
  document: IRDocument,
  problems: DiscoveryProblem[],
): IRNodeRuntime {
  const drift = runtime.drift;
  if (drift === undefined) return runtime;

  const reachable = drift.filter(
    (issue) => issue.nodeId === undefined || document.nodes.has(issue.nodeId),
  );
  if (reachable.length === drift.length) return runtime;

  for (const issue of drift) {
    if (issue.nodeId === undefined || document.nodes.has(issue.nodeId)) continue;

    problems.push({
      subject: `the finding "${issue.message}"`,
      reason:
        `a collector reported it against node "${issue.nodeId}", which this document does not ` +
        'hold, so it was dropped rather than drawn as a link to an operation that is not there',
    });
  }

  return { ...runtime, drift: reachable };
}

/**
 * Runs the collectors over every route of the application.
 *
 * @param document - The normalized document, before any runtime fact
 * @param options - The collectors and the framework objects behind them
 * @returns The augmented document and the whole report
 */
export function runRuntimePass(
  document: IRDocument,
  options: RuntimePassOptions,
): RuntimePassResult {
  // THE GLOBAL GUARDS AND PIPES ARE READ ONCE, HERE, per SPEC 6.2.1. Each is one registration
  // for the whole application, so the container is walked once rather than once per node, and
  // the answers are handed to every collector through its context instead of each one finding
  // its own way to them.
  const global = readGlobalGuards(options.discovery);
  const globalPipes = readGlobalPipes(options.discovery);
  const registry = new CollectorRegistry(options.collectors, {
    ...options,
    globalGuards: global.names,
    globalPipes: globalPipes.names,
  });
  const discovered = discoverRoutes(options.discovery, options.reflector);
  const pairing = pairRoutes(document.nodes.values(), discovered.routes);

  // THE ERROR DERIVATION RUNS HERE AND NOT IN A COLLECTOR, per SPEC 6.4. The runtime derived group
  // follows from a rate limit and from guards, and both of those are produced by other collectors,
  // one of them from a package that ships separately. A collector reading another collector's
  // output would make the result depend on registration order, which SPEC 6.2 forbids and T017's
  // both-orders test checks. Deriving from the merged record instead reads exactly what a reader
  // will see, and it is a pure function of `core` rather than anything this pass knows.
  const runtimeByNode = new Map<string, IRNodeRuntime>();
  const ghosts: DiscoveryProblem[] = [];
  // THE CHANNEL TARGETS RUN THROUGH THE SAME REGISTRY AND THE SAME COLLECTORS, per SPEC 8.3. A
  // channel is an `IRNode` under the discriminant SPEC 5.1 reserved, so the collector contract
  // `T017` froze already admits one, and every fact a channel carries is produced by a collector
  // that carries its own name and confidence rather than by a second mechanism.
  const collected = [...pairing.targets, ...(options.channelTargets ?? [])];
  for (const target of collected) {
    const runtime = registry.collect(target);
    if (runtime !== undefined)
      runtimeByNode.set(
        target.node.id,
        withRuntimeErrorContracts(withoutGhostFindings(runtime, document, ghosts)),
      );
  }

  // THE TOPOLOGY IS READ OFF THE SAME WALK AND NOT BY A COLLECTOR, per SPEC 9.3. An edge is a
  // fact about the document rather than about one node, and the collector contract `T017` froze
  // returns `IRNodeRuntime`, which has nowhere to put one. Reading it here costs no second walk:
  // every handler is already in hand.
  const declared = declaredRelationships(collected, options.reflector);

  // AN UNNAMEABLE GLOBAL GUARD IS ONE PROBLEM FOR THE APPLICATION AND NOT ONE PER ROUTE, which is
  // why it is recorded here and not by the collector. `{ provide: APP_GUARD, useValue: { ... } }`
  // protects every route with something the reference cannot name, and a reader is owed the fact
  // that it is there rather than a row that says `Object`.
  const problems: readonly DiscoveryProblem[] = [
    ...discovered.problems,
    ...ghosts,
    ...declared.problems,
    ...(global.anonymous === 0
      ? []
      : [
          {
            subject: 'the application',
            reason:
              `${String(global.anonymous)} guard(s) are registered under APP_GUARD and have no ` +
              'class name to report, so they protect every route and are absent from the ' +
              'reference. A plain object under useValue, or an anonymous class, produces this',
          },
        ]),
    ...(globalPipes.anonymous === 0
      ? []
      : [
          {
            subject: 'the application',
            reason:
              `${String(globalPipes.anonymous)} pipe(s) are registered under APP_PIPE and have ` +
              'no class name to report, so they stand on every route and are absent from the ' +
              'reference. A plain object under useValue, or an anonymous class, produces this',
          },
        ]),
  ];

  const nodes = new Map<string, IRNode>();
  for (const [id, node] of document.nodes) {
    const runtime = runtimeByNode.get(id);
    nodes.set(id, runtime === undefined ? node : { ...node, runtime });
  }

  // THE OBSERVATION IS BUILT FROM THE PAIRING AND NOT FROM WHICH NODES GOT FACTS. A node paired
  // with a real handler that no collector had anything to say about still has a handler, and
  // reading `runtime` to decide would report it as an orphan, which is the drift rule this
  // application does not have telling a reader to delete documentation that is correct.
  //
  // ONLY THE HANDLED SIDE IS PASSED, per SPEC 7.1: `pairing.routesWithoutNode` is a route the
  // document does not describe, which is what `include` produces on purpose, and `DriftObservation`
  // has nowhere to put it.
  const observation: DriftObservation = {
    handledNodeIds: new Set(collected.map((target) => target.node.id)),
    ...(options.guardSecuritySchemes === undefined
      ? {}
      : { guardSchemes: new Map(Object.entries(options.guardSecuritySchemes)) }),
  };

  // THE EDGES ARE CORRECTED FIRST AND ADDED SECOND, in that order because the two do different
  // things: `withReadConfidence` takes back a word the normalizer said about edges it produced,
  // and the decorator's own edges were never laundered and are not its subject.
  //
  // `orderRelationships` ORDERS THE TWO LISTS INTO ONE AND FOLDS NOTHING BETWEEN THEM. Each list
  // arrives folded already, and no edge of one can equal an edge of the other: a decorator edge
  // ends at an `event`, which `declaredRelationships` is the only writer of anywhere in the
  // repository, and every edge a normalizer produces ends at a `node` or a `service`. So a
  // decorator cannot restate a document edge in the first place, and this call is here because two
  // separately ordered lists concatenated are not one ordered list, which the hash would notice.
  const relationships = orderRelationships([
    ...withReadConfidence(document, options.channelDirectionConfidence ?? new Map()),
    ...declared.edges,
  ]);

  const documented: IRDocument = {
    ...document,
    nodes,
    relationships,
    runtime: registry.meta(),
    hash: '',
  };
  const withFacts: IRDocument = {
    ...documented,
    // THE REPORT IS BUILT AFTER THE FACTS AND BEFORE THE HASH, in that order and for two separate
    // reasons. After, because every rule of SPEC 7.1 reads a fact a collector attached above.
    // Before, because the report is part of the document a reader is served, and a document whose
    // hash predates its own health panel is a cache key that never changes when the panel does.
    health: buildHealthReport(documented, { observation, checks: [registry.healthCheck()] }),
  };

  return {
    document: finalizeDocument(withFacts),
    nodesWithFacts: runtimeByNode.size,
    discoveryProblems: problems,
    pairing,
    registry,
  };
}

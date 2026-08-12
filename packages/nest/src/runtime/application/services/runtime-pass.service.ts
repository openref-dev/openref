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
 * would keep serving it. `hashDocument` is the one canonical way to take it, per CLAUDE.md.
 *
 * FAIL OPEN, LIKE THE REGISTRY IT DRIVES. A collector pass is an augmentation of a document that
 * already renders. If discovery finds nothing, the document is returned unchanged and the report
 * says why, rather than the application failing to boot over a panel.
 */

import {
  buildHealthReport,
  hashDocument,
  withRuntimeErrorContracts,
  type DriftObservation,
  type IRDocument,
  type IRNode,
  type IRNodeRuntime,
} from '@openref/core';
import { CollectorRegistry, type CollectorRegistryOptions } from './collector-registry.service';
import type { CollectorRegistration } from '../ports/collector.port';
import {
  discoverRoutes,
  type DiscoveryProblem,
} from '../../infrastructure/adapters/controller-discovery.adapter';
import { pairRoutes, type PairingResult } from '../../domain/route-pairing';
import { readGlobalGuards } from '../../domain/guards';
import type { DiscoveryServiceLike } from '../../../shared/types/nest-surface';

/** Everything the pass needs, gathered by whoever has access to the container. */
export interface RuntimePassOptions extends CollectorRegistryOptions {
  /** The collectors the host registered, in declaration order. */
  readonly collectors: readonly CollectorRegistration[];
  /** Nest's `DiscoveryService`, which is the only public route to the controller classes. */
  readonly discovery: DiscoveryServiceLike;
  /** Guard class name to security scheme id, per SPEC 13.2, for `security-drift`. */
  readonly guardSecuritySchemes?: Readonly<Record<string, string>>;
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
  // THE GLOBAL GUARDS ARE READ ONCE, HERE, per SPEC 6.2.1. They are one registration for the whole
  // application, so the container is walked once rather than once per node, and the answer is
  // handed to every collector through its context instead of each one finding its own way to it.
  const global = readGlobalGuards(options.discovery);
  const registry = new CollectorRegistry(options.collectors, {
    ...options,
    globalGuards: global.names,
  });
  const discovered = discoverRoutes(options.discovery, options.reflector);
  const pairing = pairRoutes(document.nodes.values(), discovered.routes);

  // AN UNNAMEABLE GLOBAL GUARD IS ONE PROBLEM FOR THE APPLICATION AND NOT ONE PER ROUTE, which is
  // why it is recorded here and not by the collector. `{ provide: APP_GUARD, useValue: { ... } }`
  // protects every route with something the reference cannot name, and a reader is owed the fact
  // that it is there rather than a row that says `Object`.
  const problems =
    global.anonymous === 0
      ? discovered.problems
      : [
          ...discovered.problems,
          {
            subject: 'the application',
            reason:
              `${String(global.anonymous)} guard(s) are registered under APP_GUARD and have no ` +
              'class name to report, so they protect every route and are absent from the ' +
              'reference. A plain object under useValue, or an anonymous class, produces this',
          },
        ];

  // THE ERROR DERIVATION RUNS HERE AND NOT IN A COLLECTOR, per SPEC 6.4. The runtime derived group
  // follows from a rate limit and from guards, and both of those are produced by other collectors,
  // one of them from a package that ships separately. A collector reading another collector's
  // output would make the result depend on registration order, which SPEC 6.2 forbids and T017's
  // both-orders test checks. Deriving from the merged record instead reads exactly what a reader
  // will see, and it is a pure function of `core` rather than anything this pass knows.
  const runtimeByNode = new Map<string, IRNodeRuntime>();
  for (const target of pairing.targets) {
    const runtime = registry.collect(target);
    if (runtime !== undefined)
      runtimeByNode.set(target.node.id, withRuntimeErrorContracts(runtime));
  }

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
    handledNodeIds: new Set(pairing.targets.map((target) => target.node.id)),
    ...(options.guardSecuritySchemes === undefined
      ? {}
      : { guardSchemes: new Map(Object.entries(options.guardSecuritySchemes)) }),
  };

  const documented: IRDocument = { ...document, nodes, runtime: registry.meta(), hash: '' };
  const withFacts: IRDocument = {
    ...documented,
    // THE REPORT IS BUILT AFTER THE FACTS AND BEFORE THE HASH, in that order and for two separate
    // reasons. After, because every rule of SPEC 7.1 reads a fact a collector attached above.
    // Before, because the report is part of the document a reader is served, and a document whose
    // hash predates its own health panel is a cache key that never changes when the panel does.
    health: buildHealthReport(documented, { observation, checks: [registry.healthCheck()] }),
  };

  return {
    document: { ...withFacts, hash: hashDocument(withFacts) },
    nodesWithFacts: runtimeByNode.size,
    discoveryProblems: problems,
    pairing,
    registry,
  };
}

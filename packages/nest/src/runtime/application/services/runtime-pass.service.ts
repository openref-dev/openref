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

import { hashDocument, type IRDocument, type IRNode, type IRNodeRuntime } from '@openref/core';
import { CollectorRegistry, type CollectorRegistryOptions } from './collector-registry.service';
import type { CollectorRegistration } from '../ports/collector.port';
import {
  discoverRoutes,
  type DiscoveryProblem,
} from '../../infrastructure/adapters/controller-discovery.adapter';
import { pairRoutes, type PairingResult } from '../../domain/route-pairing';
import type { DiscoveryServiceLike } from '../../../shared/types/nest-surface';

/** Everything the pass needs, gathered by whoever has access to the container. */
export interface RuntimePassOptions extends CollectorRegistryOptions {
  /** The collectors the host registered, in declaration order. */
  readonly collectors: readonly CollectorRegistration[];
  /** Nest's `DiscoveryService`, which is the only public route to the controller classes. */
  readonly discovery: DiscoveryServiceLike;
}

/**
 * What the pass produced.
 *
 * The report is kept whole rather than reduced to a count, because T022 turns each of its four
 * lists into a different drift rule: a route with no node is `orphan-operation` inverted, a node
 * with no route is `orphan-operation` itself, and the other two are defects in this pass or in
 * the application's own routing.
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
  const registry = new CollectorRegistry(options.collectors, options);
  const discovered = discoverRoutes(options.discovery, options.reflector);
  const pairing = pairRoutes(document.nodes.values(), discovered.routes);

  const runtimeByNode = new Map<string, IRNodeRuntime>();
  for (const target of pairing.targets) {
    const runtime = registry.collect(target);
    if (runtime !== undefined) runtimeByNode.set(target.node.id, runtime);
  }

  const nodes = new Map<string, IRNode>();
  for (const [id, node] of document.nodes) {
    const runtime = runtimeByNode.get(id);
    nodes.set(id, runtime === undefined ? node : { ...node, runtime });
  }

  const withFacts: IRDocument = { ...document, nodes, runtime: registry.meta(), hash: '' };

  return {
    document: { ...withFacts, hash: hashDocument(withFacts) },
    nodesWithFacts: runtimeByNode.size,
    discoveryProblems: discovered.problems,
    pairing,
    registry,
  };
}

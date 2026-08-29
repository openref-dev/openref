import { hash, healthScore } from '@openref/core';
import type {
  IRDocumentKind,
  IRHealthCheck,
  IRHealthReport,
  IRRelationship,
  IRService,
} from '@openref/core';
import type { FederationService } from './federation-options';
import { rewriteDriftIssue, type RewriteMaps } from './rewrite';

/**
 * The parts of a merged document that are neither a node nor a name: kind, health, topology, and
 * the record of each service.
 *
 * WHAT THIS FILE IS REALLY ABOUT IS WHERE A DOCUMENT LEVEL FACT GOES WHEN THERE ARE THREE
 * DOCUMENTS. Three answers were available for each one: fold them into a single merged value, keep
 * them per service, or drop them. Dropping is what makes a merge lossy, so it is used nowhere.
 * Folding is right where the merged value is still true of the whole, which is the document kind
 * and the health score. Keeping is right where folding would invent a claim nobody made, which is
 * a title, a version, a server list and the collectors that ran.
 */

/**
 * The kind of a document made of several.
 *
 * @param kinds - The kind each service's document declared
 * @returns `http` or `events` when every service agrees, `mixed` otherwise
 */
export function mergeKind(kinds: readonly IRDocumentKind[]): IRDocumentKind {
  const distinct = new Set(kinds);
  if (distinct.size === 1) {
    const [only] = distinct;
    if (only !== undefined) return only;
  }
  return 'mixed';
}

/**
 * Moves the subjects of a health report onto the merged names.
 *
 * THE SCORE AND THE CHECKS ARE THE SERVICE'S OWN AND DO NOT MOVE; THE FINDINGS ARE ABOUT NODES AND
 * DO. A finding carries the id of the node it is about, and in a merged document that id is the
 * merged one. Keeping the source spelling here was the first shape of `IRService.health` and the
 * merge's own reference check refused it by name: every per service finding pointed at a node that
 * does not exist, which is a panel of dead links on the service page T046 builds.
 *
 * @param report - A service's own report
 * @param maps - How that service's names map onto the merged ones
 * @returns The report, addressing the merged document
 */
export function rewriteHealthReport(report: IRHealthReport, maps: RewriteMaps): IRHealthReport {
  return { ...report, drift: report.drift.map((issue) => rewriteDriftIssue(issue, maps)) };
}

/**
 * Builds the per service record that carries everything document level a source document said.
 *
 * @param service - The service and its document
 * @param prefix - The prefix its addresses were actually moved under, when any
 * @param maps - How this service's names map onto the merged ones
 * @returns The service record for `IRDocument.services`
 */
export function serviceRecord(
  service: FederationService,
  prefix: string | undefined,
  maps: RewriteMaps,
): IRService {
  const { document } = service;
  const record: { -readonly [Key in keyof IRService]: IRService[Key] } = {
    id: service.id,
    documentId: document.id,
    documentHash: document.hash,
    kind: document.kind,
    info: document.info,
    servers: document.servers,
  };

  if (prefix !== undefined) record.prefix = prefix;
  if (document.runtime !== undefined) record.runtime = document.runtime;
  if (document.health !== undefined) record.health = rewriteHealthReport(document.health, maps);
  if (document.extensions !== undefined) record.extensions = document.extensions;
  if (document.unreadKeys !== undefined) record.unreadKeys = document.unreadKeys;

  return record;
}

/** One service's health, with the maps that move its findings onto the merged document. */
export interface HealthSource {
  readonly report: IRHealthReport;
  readonly maps: RewriteMaps;
}

/**
 * Folds the health of several services into one report.
 *
 * THE SCORE IS RECOMPUTED FROM THE MERGED CHECKS RATHER THAN AVERAGED. `healthScore` is the mean
 * of the per check ratios, and the mean of three means is not the mean unless the three have the
 * same number of checks with something to count. Summing `passed` and `total` per check id and
 * asking `core` for the score again is the same question asked of the merged document, which is
 * what the number on a federated page has to mean.
 *
 * A CHECK IS MATCHED BY ID, and its label and severity come from the first service that reported
 * it, in service order. Two services disagreeing about the label of one check id would be a defect
 * in whichever is older, not something for the merge to average.
 *
 * @param sources - Each service's report with its rewrite maps, in service order
 * @returns The merged report, or nothing when no service reported health
 */
export function mergeHealth(sources: readonly HealthSource[]): IRHealthReport | undefined {
  if (sources.length === 0) return undefined;

  const checks = new Map<string, { -readonly [Key in keyof IRHealthCheck]: IRHealthCheck[Key] }>();
  let operationCount = 0;

  for (const source of sources) {
    operationCount += source.report.operationCount;

    for (const check of source.report.checks) {
      const existing = checks.get(check.id);
      if (existing === undefined) {
        checks.set(check.id, { ...check });
        continue;
      }
      existing.passed += check.passed;
      existing.total += check.total;
    }
  }

  const merged = [...checks.values()];

  return {
    score: healthScore(merged),
    operationCount,
    checks: merged,
    drift: sources.flatMap((source) => rewriteHealthReport(source.report, source.maps).drift),
  };
}

/**
 * Collects the topology edges of every service onto the merged document.
 *
 * AN EDGE THAT NAMES A NODE MOVES; ONE THAT NAMES A SERVICE DOES NOT. SPEC 9 says `from` and `to`
 * are a node id or a service name, and the rewrite maps answer exactly that question: a value the
 * map knows is a node id and is moved, and one it does not is left alone, which is what a service
 * name has to be. Nothing here has to guess.
 *
 * EDGES ARE DEDUPLICATED BY VALUE, because two services describing the same publication of the
 * same event are describing one edge, and a topology graph that drew it twice would weight it
 * twice.
 *
 * @param sources - Each service's relationships with its rewrite maps, in service order
 * @returns The merged edges, first occurrence order, without repeats
 */
export function mergeRelationships(
  sources: readonly { readonly edges: readonly IRRelationship[]; readonly maps: RewriteMaps }[],
): IRRelationship[] {
  const seen = new Set<string>();
  const merged: IRRelationship[] = [];

  for (const source of sources) {
    for (const edge of source.edges) {
      const moved: IRRelationship = {
        ...edge,
        from: source.maps.nodeIds.get(edge.from) ?? edge.from,
        to: source.maps.nodeIds.get(edge.to) ?? edge.to,
      };

      const key = hash(moved);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(moved);
    }
  }

  return merged;
}

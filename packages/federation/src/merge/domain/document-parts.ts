import { hash, healthScore } from '@openref/core';
import type {
  IRDocumentKind,
  IRHealthCheck,
  IRHealthReport,
  IRRelationship,
  IRService,
} from '@openref/core';
import type { FederationService } from './federation-options';
import type {
  MergeEndpointAnswerKind,
  MergeEndpointKind,
  MergeEndpointSourceKind,
  MergeRename,
} from './merge-report';
import { rewriteDriftIssue, rewriteServers, type RewriteMaps } from './rewrite';

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
    // THE SERVERS ARE THE SERVICE'S OWN AND THEIR SCHEME IDS ARE NOT. A server of an AsyncAPI
    // document may declare `security`, whose requirements name entries of that service's own
    // `IRDocument.security`, and the merge renames those whenever two services claim one name.
    servers: rewriteServers(document.servers, maps),
  };

  if (prefix !== undefined) record.prefix = prefix;
  if (document.runtime !== undefined) record.runtime = document.runtime;
  if (document.health !== undefined) record.health = rewriteHealthReport(document.health, maps);
  if (document.extensions !== undefined) record.extensions = document.extensions;
  if (document.unreadKeys !== undefined) record.unreadKeys = document.unreadKeys;
  if (document.readerProblems !== undefined) record.readerProblems = document.readerProblems;

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

/** One service's edges, with everything needed to move them into the merged address space. */
export interface RelationshipSource {
  readonly edges: readonly IRRelationship[];
  readonly maps: RewriteMaps;
  /** `IRDocument.id` of the source document, which is what its own `service` ends name. */
  readonly documentId: string;
  /** Service id in the merged document, which is what they name after the move. */
  readonly serviceId: string;
}

/** What the whole federation answers for a source channel address, per SPEC 15.1. */
export interface EventTargets {
  /** Source channel address to merged node id, holding only the addresses one channel answers. */
  readonly resolved: ReadonlyMap<string, string>;
  /** Every source channel address any service of the federation answers, ambiguous ones included. */
  readonly held: ReadonlySet<string>;
}

/** One edge end after the merge decided what it is. */
interface MovedEnd {
  readonly value: string;
  readonly kind: IRRelationship['fromKind'];
}

/**
 * Collects the topology edges of every service onto the merged document.
 *
 * EACH END MOVES BY ITS OWN KIND, AND NOTHING HERE GUESSES ANY MORE. Until `T052` this asked the
 * rewrite map whether it had heard of the value and treated a hit as proof the value was a node
 * id, which is a coincidence standing in for a fact: a service whose name happened to equal a
 * dropped node's id would have been rewritten into a node. SPEC 9.1 puts the kind in the type, so
 * a `node` end goes through the node map, a `service` end that names this service's own document
 * becomes this service's id, and an `event` end is answered federation wide as described below.
 *
 * AN `event` END IS THE CROSS SERVICE CASE AND IT IS WHY `T053` EXISTS. The publisher and the
 * consumer of one event live in different remotes: an HTTP service writes `@ApiPublishes` naming
 * an address it documents no channel for, and the channel is in the event document next door. It
 * cannot be resolved before the merge, because the other document is not here.
 *
 * IT IS ALSO WHY `T053-R1` EXISTS, AND THAT IS WHAT THE THREE ANSWERS BELOW ARE. Resolving it
 * after the merge is worse than useless: the merged addresses are the ones the merge invented, so
 * two services holding a channel at `created` come apart into `a/created` and `b/created` and a
 * third service that wrote `@ApiPublishes('a/created')` resolved into service `a`'s channel with
 * no source document ever saying so. So the question is asked here, once, against the source
 * addresses of every service at once, and the answer is written into the end's kind rather than
 * recomputed later: `node` when exactly one channel of the federation answers, `event` when two or
 * more do, which is an ambiguity SPEC 9.5 keeps unresolved, and `undeclared-event` when nothing
 * does, which is a true statement about the federation.
 *
 * A `service` END NAMING SOMETHING ELSE IS LEFT ALONE, and that is the interesting half. A
 * service that declares an edge to `ledger-service` while `ledger-service` is not part of this
 * federation has still declared it, and rewriting or dropping it would either invent membership or
 * hide a dependency. It stays, and the topology view draws it as leading outside the known set.
 *
 * EDGES ARE DEDUPLICATED BY VALUE, because two services describing the same publication of the
 * same event are describing one edge, and a topology graph that drew it twice would weight it
 * twice.
 *
 * THE LAST THREE PARAMETERS ARE REQUIRED, AND THE FIRST TWO OF THEM CARRIED DEFAULTS FOR EXACTLY
 * ONE REVIEW. An empty map and a discarded array are the pre-`T053` behaviour of this function, so
 * a caller that forgot them got a merge with every event end left where it was written and a
 * report that no longer inverts the merge, silently and with nothing red. That is the shape of
 * defect this repository keeps finding, and a compile error is the cheapest place to put it. The
 * package is internal and unpublished per SPEC 4, so nothing outside this repository is obliged by
 * the change.
 *
 * @param sources - Each service's relationships with its identity and rewrite maps, in service order
 * @param events - What the federation answers for each source channel address
 * @param renames - Report entries, appended to, so the report still inverts the merge
 * @param endpointKinds - Kind changes, appended to, so the report inverts those too
 * @returns The merged edges, first occurrence order, without repeats
 */
export function mergeRelationships(
  sources: readonly RelationshipSource[],
  events: EventTargets,
  renames: MergeRename[],
  endpointKinds: MergeEndpointKind[],
): IRRelationship[] {
  const seen = new Set<string>();
  const merged: IRRelationship[] = [];
  const reported = new Set<string>();

  for (const source of sources) {
    /**
     * What this federation answers for one event end, and what the report owes for the answer.
     *
     * THE END'S CURRENT KIND IS AN INPUT AND NOT A VERDICT, per SPEC 9.1. An `undeclared-event`
     * end is an answer some other estate gave, and this estate is a different estate: a merge's
     * output is a service, so the service handed to this merge may itself be a merge's output, and
     * the channel its inner federation lacked may be right here. Leaving it alone printed "no
     * document in this federation declares this event" about a federation whose document declares
     * it, which is the same false statement the kind exists to refuse, running the other way.
     *
     * @param value - The event name, as the declaring service wrote it
     * @param kind - What the end says it is now, which is one of the two event kinds
     * @returns The end after this federation answered
     */
    const answer = (value: string, kind: MergeEndpointSourceKind): MovedEnd => {
      const target = events.resolved.get(value);
      const settled: { readonly value: string; readonly kind: MergeEndpointAnswerKind } =
        target !== undefined
          ? { value: target, kind: 'node' }
          : { value, kind: events.held.has(value) ? 'event' : 'undeclared-event' };

      // AN UNCHANGED KIND OWES THE REPORT NOTHING, because there is nothing to undo. This is what
      // keeps a federation that changes no answer out of the report entirely.
      if (settled.kind === kind) return settled;

      // One record per service and source name, which is the invariant the report's own sort
      // states. An edge repeated inside one service, or two edges naming one address, is one
      // decision taken once.
      const key = `${source.serviceId} ${value}`;
      if (reported.has(key)) return settled;
      reported.add(key);

      if (target !== undefined) {
        renames.push({
          kind: 'event-name',
          serviceId: source.serviceId,
          from: value,
          to: target,
          reason: 'target-moved',
          contestedBy: [],
        });
      }

      endpointKinds.push({
        serviceId: source.serviceId,
        name: settled.value,
        from: kind,
        to: settled.kind,
      });

      return settled;
    };

    /**
     * One end, moved into the merged document by its own kind.
     *
     * IT IS A `switch` AND NOT AN `if` CHAIN, AND THE REASON IS A PROBE RATHER THAN A STYLE. The
     * chain this replaced ended in a `kind !== 'event'` return, so a fifth member of
     * `IRRelationshipEndpointKind` would have been absorbed here in silence while
     * `ai-docs/design/CONTRACT.md` claimed two compile breaks. Measured on 2026-08-29: one.
     *
     * @param value - The end, as the declaring service wrote it
     * @param kind - What the edge says the end is
     * @returns The end after the merge decided
     */
    const move = (value: string, kind: IRRelationship['fromKind']): MovedEnd => {
      switch (kind) {
        case 'node':
          return { value: source.maps.nodeIds.get(value) ?? value, kind };
        case 'service':
          return { value: value === source.documentId ? source.serviceId : value, kind };
        case 'event':
        case 'undeclared-event':
          return answer(value, kind);
      }
    };

    for (const edge of source.edges) {
      const from = move(edge.from, edge.fromKind);
      const to = move(edge.to, edge.toKind);
      const moved: IRRelationship = {
        ...edge,
        from: from.value,
        fromKind: from.kind,
        to: to.value,
        toKind: to.kind,
      };

      const key = hash(moved);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(moved);
    }
  }

  return merged;
}

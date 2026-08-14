/**
 * The runtime block and the Health panel, as flat JSON a component renders without computing.
 *
 * Everything here is decided on the server, once per document hash: what a rate limit reads as
 * in words, which of the three error groups a contract is in, whether a source link could be
 * built at all. That is the same rule the rest of the page model follows, and it matters more
 * here than anywhere else. `expandSourceLink` is the difference between a link and a clickable
 * 404, and a browser has no revision, no repository and no reason to be asked; and every branch
 * decided here is a branch that is not in the bundle every reader downloads, which SPEC 20 caps
 * with 2 KB of room in it.
 *
 * THE BLOCK IS ONE LIST OF LABELLED ROWS AND NOT FIVE SHAPES. A guard, a scope, a rate limit, an
 * error contract and a source link are one thing to a reader, a labelled line with a mark saying
 * where it came from, so they are one thing here. The alternative, a field per kind with a
 * component branch per field, was written first and cost 1.4 KB of the first paint to say what
 * this says in a loop.
 *
 * THE BLOCK IS ABSENT RATHER THAN EMPTY, per SPEC 6.3. `buildRuntimeModel` answers `null` for a
 * node with no facts, and the predicate it asks is `hasRuntimeFacts` from `@openref/core`, which
 * the theme layer asks too. Two copies of "is there anything to show" would come to disagree the
 * first time a fact is added, and each copy's tests would stay green while they did.
 */

import {
  DRIFT_RULE_CODES,
  driftForNode,
  expandSourceLink,
  groupDriftByRule,
  hasRuntimeFacts,
  type IRDocument,
  type IRDriftIssue,
  type IRErrorContract,
  type IRErrorContracts,
  type IRGuardScope,
  type IRHealthReport,
  type IRNodeRuntime,
} from '@openref/core';
import { schemaDisplayName } from '@openref/vue';
import type {
  DriftModel,
  ErrorContractGroupModel,
  ErrorContractItemModel,
  HealthModel,
  ResponseMarkModel,
  RuntimeModel,
  RuntimeRowKind,
  RuntimeRowModel,
} from '@openref/vue';
import { nodeHref, schemaHref } from './links';
import { buildParityRows } from './parity-model';
import {
  EMPTY_VALUE,
  guardValues,
  mark,
  rateLimitLabel,
  SEVERITY_CLASSES,
  streamingLabel,
} from './runtime-values';
import { statusClass } from '../../shared/status';

export { rateLimitLabel, streamingLabel };

/**
 * THE SHAPES THESE FUNCTIONS BUILD LIVE IN `@openref/vue`, since `TX-SLOTWIRE`.
 *
 * They are the projection a theme is handed, and the slot contract is declared in terms of them,
 * so they belong to the package a theme is written against rather than to the one that builds
 * them. What is here is the building, which needs the document, the link expander and the status
 * vocabulary, and none of that may cross into the headless layer.
 */

/**
 * Group keys and labels, in the order SPEC 6.4 lists them.
 *
 * READING THE THREE FIELDS BY NAME IS WHAT KEEPS THEM APART. A helper that took
 * `IRErrorContracts` and returned one array would put a promise and an observation on the same
 * row, and nothing in the type system would object, which is exactly what T021 made structural.
 */
const ERROR_GROUPS = [
  ['declared', 'errors-declared', 'Errors, declared'],
  ['runtimeDerived', 'errors-runtime-derived', 'Errors, runtime-derived'],
  ['global', 'errors-global', 'Errors, global'],
] as const satisfies readonly (readonly [keyof IRErrorContracts, RuntimeRowKind, string])[];

/**
 * The two guard rows of SPEC 6.2.1, in the order a reader needs them.
 *
 * A ROW PER SCOPE, THE WAY `errorRows` DRAWS A ROW PER GROUP, and for the same reason. A guard
 * declared on the route and a guard registered for the whole application are the same fact about
 * whether the endpoint is protected and different facts about who decided it, and a reader
 * deciding whether an endpoint is protected on purpose needs the second one. One row holding both
 * would answer the first question and lose the second, which is exactly what T021 refused to do
 * to the three error groups.
 *
 * THE ROUTE'S OWN ROW IS STILL CALLED `Guards`, unqualified. Every application that had a guard
 * row before this existed had a route level one, and renaming it would churn every page for a
 * distinction that is carried by the row that was added rather than by the row that was there.
 */
const GUARD_SCOPES = [
  ['route', 'guards', 'Guards'],
  ['global', 'guards-global', 'Guards, global'],
] as const satisfies readonly (readonly [IRGuardScope, RuntimeRowKind, string])[];

/**
 * The rows of the runtime block, in the order SPEC 2 prints them.
 *
 * @param runtime - The node's runtime record
 * @param template - `IRRuntimeMeta.sourceLinkTemplate`, with `{ref}` already substituted
 * @returns Every row that has something in it
 */
function rowsOf(runtime: IRNodeRuntime, template: string | undefined): RuntimeRowModel[] {
  const rows: RuntimeRowModel[] = [];

  for (const [scope, kind, label] of GUARD_SCOPES) {
    const values = guardValues(runtime.guards ?? [], scope);
    if (values.length > 0) rows.push({ kind, label, values });
  }

  const scalar = [
    ['scopes', 'Scopes', runtime.scopes, (value: readonly string[]) => value.join(', ')],
    ['roles', 'Roles', runtime.roles, (value: readonly string[]) => value.join(', ')],
    ['rate-limit', 'Rate limit', runtime.rateLimit, rateLimitLabel],
    ['streaming', 'Streaming', runtime.streaming, streamingLabel],
  ] as const satisfies readonly (readonly [RuntimeRowKind, string, unknown, unknown])[];

  for (const [kind, label, fact, format] of scalar) {
    if (fact === undefined) continue;

    rows.push({
      kind,
      label,
      // The cast is over the union of the four value types above, each of which is paired with
      // the formatter that reads it. TypeScript cannot see the pairing through a tuple list, and
      // splitting it into four copies of these six lines is what the cast buys off.
      values: [
        {
          ...EMPTY_VALUE,
          text: (format as (value: unknown) => string)(fact.value),
          ...mark(fact.confidence, fact.collector),
        },
      ],
    });
  }

  rows.push(...errorRows(runtime.errors));

  const source = runtime.source;
  if (source !== undefined) {
    const expansion = expandSourceLink(template ?? '', source);

    rows.push({
      kind: 'source',
      label: 'Source',
      values: [
        {
          ...EMPTY_VALUE,
          text: `${source.controller}.${source.handler}()`,
          href: expansion.url ?? '',
          // A REASON IS SHOWN RATHER THAN A LINK THAT DOES NOT WORK, per SPEC 6.3, and the
          // degradation to a file link is reported rather than left to be noticed: it is the
          // signal that a build shipped no source maps.
          note:
            expansion.reason ?? (expansion.withoutLine === true ? 'file only, no source map' : ''),
        },
      ],
    });
  }

  return rows;
}

/**
 * The three groups of SPEC 6.4, with the empty one that asserts something kept.
 *
 * ONLY `declared` SURVIVES BEING EMPTY. It is the group a person writes, so an empty one says
 * the route was read and nobody wrote anything on it. The other two are a derivation and a host
 * wide list, and neither asserts anything by being empty. The row says that about the handler
 * and offers the decorator as the edit, because a value column that reports on the collector
 * instead of on the application is instrumentation standing where documentation goes.
 *
 * @param errors - The record, or nothing when no error collector ran
 * @returns The rows worth drawing
 */
function errorRows(errors: IRErrorContracts | undefined): RuntimeRowModel[] {
  if (errors === undefined) return [];

  const rows: RuntimeRowModel[] = [];

  for (const [key, kind, label] of ERROR_GROUPS) {
    const contracts = errors[key];

    if (contracts.length === 0) {
      if (key !== 'declared') continue;

      // THE ROW STATES A FACT ABOUT THE OPERATION AND NAMES THE DECORATOR AS THE FIX, per SPEC
      // 6.4. It read "examined, nothing declared with @ApiErrors", which describes the instrument
      // in a column where every other row describes the application, and it put the decorator in
      // the finding rather than in the edit that answers it.
      rows.push({
        kind,
        label,
        values: [
          {
            ...EMPTY_VALUE,
            text: 'This handler declares no errors',
            note: 'Add @ApiErrors to list the ones it answers with',
          },
        ],
      });
      continue;
    }

    // A SENTENCE TWO CONTRACTS SHARE IS SHOWN ONCE, ON THE FIRST OF THEM, per SPEC 6.4. 401 and
    // 403 are derived from one fact and their `detail` differs by nothing at all, so the pair
    // read as a repetition rather than as two contracts. Only the row loses the second copy: the
    // contract keeps its own field, because it travels alone in a drift finding and its RFC 9457
    // body pins `detail` with a `const`.
    let shown = '';

    rows.push({
      kind,
      label,
      values: contracts.map((contract) => {
        const detail = contract.detail ?? '';
        const note = detail === shown ? '' : detail;
        shown = detail;

        return {
          status: String(contract.status),
          statusClass: `oref-status ${statusClass(String(contract.status))}`,
          text: contract.title,
          href: '',
          note,
          ...mark(contract.confidence, contract.collector),
        };
      }),
    });
  }

  return rows;
}

/** Confidence order of SPEC 6.1, for the one place a code known twice keeps one mark. */
const CONFIDENCE_RANK: Readonly<Record<string, number>> = {
  declared: 3,
  derived: 2,
  inferred: 1,
};

/**
 * What the runtime knows per response code, for the merged responses list of `TX-MARKUP`.
 *
 * A CODE KNOWN TO SEVERAL GROUPS KEEPS THE HIGHEST CONFIDENCE, declared over derived over
 * inferred, because a person's declaration about a code outranks a derivation about the same
 * code, which is the guard rule of SPEC 6.2 pointed at presentation. Whether a code is
 * documented is the literal containment the parity rows already use, so the two surfaces
 * cannot disagree about the same 429.
 *
 * @param errors - The three groups, or nothing when no error collector ran
 * @param documented - Status codes the document declares, as written
 * @returns One mark per distinct code, in code point order
 */
function responseMarks(
  errors: IRErrorContracts | undefined,
  documented: readonly string[],
): ResponseMarkModel[] {
  if (errors === undefined) return [];

  const byCode = new Map<string, IRErrorContract>();
  for (const contract of [...errors.declared, ...errors.runtimeDerived, ...errors.global]) {
    const code = String(contract.status);
    const held = byCode.get(code);
    if (
      held === undefined ||
      (CONFIDENCE_RANK[contract.confidence] ?? 0) > (CONFIDENCE_RANK[held.confidence] ?? 0)
    ) {
      byCode.set(code, contract);
    }
  }

  return [...byCode.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([code, contract]) => ({
      statusCode: code,
      statusClass: `oref-status ${statusClass(code)}`,
      title: contract.title,
      confidence: contract.confidence,
      collector: contract.collector,
      undocumented: !documented.includes(code),
    }));
}

/**
 * The grid's group vocabulary, per SPEC 6.4: the head and the line saying where contracts of
 * the group come from, in the reader's words rather than the collector's.
 */
const CONTRACT_GROUPS = [
  ['declared', 'errors-declared', 'Declared in code', 'decorators and explicit handler exceptions'],
  [
    'runtimeDerived',
    'errors-runtime-derived',
    'Derived from runtime',
    'follows from facts collected about the route',
  ],
  ['global', 'errors-global', 'Global to the application', 'declared by the host for every route'],
] as const satisfies readonly (readonly [keyof IRErrorContracts, RuntimeRowKind, string, string])[];

/** The key contracts merge on: the parts a reader would see said twice, per the demo pin. */
function contractMergeKey(contract: IRErrorContract): string {
  return [contract.detail ?? '', contract.type ?? '', contract.confidence, contract.collector].join(
    '\u0000',
  );
}

/** The named schema a contract answers with, when the document has a page for it. */
function contractSchema(
  contract: IRErrorContract,
  document: IRDocument,
  basePath: string,
): { label: string; href: string } {
  const slot = contract.schema;
  if (slot?.kind !== 'named') return { label: '', href: '' };

  const entry = document.schemas.get(slot.schemaId);
  if (entry === undefined) return { label: '', href: '' };

  return {
    label: schemaDisplayName(entry, slot.schemaId),
    href: schemaHref(slot.schemaId, basePath),
  };
}

/**
 * The error contracts grid of `TX-MARKUP`: the three groups of SPEC 6.4, each item one
 * contract or several that say the same thing.
 *
 * CONTRACTS SHARING DETAIL, TYPE, CONFIDENCE AND COLLECTOR MERGE INTO ONE ITEM with joined
 * codes, which is how the 401 and 403 pair prints its shared sentence exactly once. The merge
 * is presentation: the contract keeps its own fields in the IR and travels alone in a finding.
 * Only the declared group survives being empty, with the SPEC 6.4 sentence, because it is the
 * group a person writes; the other two assert nothing by being empty and are not built.
 */
function contractGroups(
  errors: IRErrorContracts | undefined,
  document: IRDocument,
  basePath: string,
): ErrorContractGroupModel[] {
  if (errors === undefined) return [];

  const groups: ErrorContractGroupModel[] = [];

  for (const [key, kind, label, sub] of CONTRACT_GROUPS) {
    const contracts = errors[key];

    if (contracts.length === 0) {
      if (key !== 'declared') continue;
      groups.push({
        kind,
        label,
        sub,
        items: [],
        empty: 'This handler declares no errors. Add @ApiErrors to list the ones it answers with.',
      });
      continue;
    }

    const items: ErrorContractItemModel[] = [];
    const at = new Map<string, number>();

    for (const contract of contracts) {
      const mergeKey = contractMergeKey(contract);
      const held = at.get(mergeKey);
      const schema = contractSchema(contract, document, basePath);

      if (held === undefined) {
        at.set(mergeKey, items.length);
        items.push({
          status: String(contract.status),
          statusClass: `oref-status ${statusClass(String(contract.status))}`,
          title: contract.title,
          typeUri: contract.type ?? '',
          detail: contract.detail ?? '',
          schemaLabel: schema.label,
          schemaHref: schema.href,
          confidence: contract.confidence,
          collector: contract.collector,
        });
        continue;
      }

      const item = items[held];
      if (item === undefined) continue;
      items[held] = {
        ...item,
        status: `${item.status}, ${String(contract.status)}`,
        title: item.title === contract.title ? item.title : `${item.title}, ${contract.title}`,
        // A merged item keeps the schema only when every member names the same one, because
        // a link that stands for two different schemas would answer for the wrong one.
        schemaLabel: item.schemaHref === schema.href ? item.schemaLabel : '',
        schemaHref: item.schemaHref === schema.href ? item.schemaHref : '',
      };
    }

    groups.push({ kind, label, sub, items, empty: '' });
  }

  return groups;
}

/**
 * One finding as a row, with a link to its subject when the page is not already about it.
 *
 * @param issue - The finding
 * @param document - The document, for the subject's own title
 * @param basePath - Mount point, so the link is the one the server answers at
 * @param linked - Whether to build the link and name the subject
 * @returns The row
 */
function driftModel(
  issue: IRDriftIssue,
  document: IRDocument,
  basePath: string,
  linked: boolean,
): DriftModel {
  const sides: string[] = [];
  if (issue.runtimeValue !== undefined) sides.push(`Runtime: ${issue.runtimeValue}`);
  if (issue.specValue !== undefined) sides.push(`OpenAPI: ${issue.specValue}`);

  const base = {
    rule: issue.rule,
    code: DRIFT_RULE_CODES[issue.rule],
    severityClass: SEVERITY_CLASSES[issue.severity],
    message: issue.message,
    sides,
    suggestion: issue.suggestion,
  };

  if (!linked) return { ...base, href: '', subject: '' };

  if (issue.nodeId !== undefined) {
    const node = document.nodes.get(issue.nodeId);
    const subject =
      node === undefined
        ? issue.nodeId
        : node.kind === 'channel'
          ? (node.address ?? issue.nodeId)
          : `${node.method.toUpperCase()} ${node.path}`;

    return { ...base, href: nodeHref(issue.nodeId, basePath), subject };
  }

  if (issue.schemaId !== undefined) {
    return {
      ...base,
      href: schemaHref(issue.schemaId, basePath),
      subject: `${issue.schemaId}${issue.pointer ?? ''}`,
    };
  }

  return { ...base, href: '', subject: '' };
}

/**
 * The runtime block of one node, or nothing when it has no facts.
 *
 * @param document - The normalized document, for the report and the link template
 * @param nodeId - Node the page is about
 * @param basePath - Mount point, kept for a finding that names another subject
 * @returns The block, or null when SPEC 6.3 says to draw none
 */
export function buildRuntimeModel(
  document: IRDocument,
  nodeId: string,
  basePath: string,
): RuntimeModel | null {
  const node = document.nodes.get(nodeId);
  const runtime = node?.runtime;
  if (node === undefined || runtime === undefined || !hasRuntimeFacts(runtime)) return null;

  // THE FINDINGS COME FROM THE REPORT AND NOT FROM THE NODE. The rules of SPEC 7.1 need the whole
  // document to fire, so they run once over it; `IRNodeRuntime.drift` is what a federated remote
  // may arrive carrying, and it wins when it is there because it is about that remote.
  const found = runtime.drift ?? driftForNode(document.health?.drift ?? [], nodeId);

  return {
    rows: rowsOf(runtime, document.runtime?.sourceLinkTemplate),
    drift: found.map((issue) => driftModel(issue, document, basePath, false)),
    // THE SCALE IS AN OPERATION'S, per SPEC 6.3: a channel keeps the labelled rows until M5
    // designs one, and a component that finds `parity` empty draws `rows` the way it always did.
    parity: node.kind === 'operation' ? buildParityRows(document, node, found, basePath) : [],
    // The merged responses and the grid are an operation's for the same reason: every error
    // collector is HTTP, so a channel cannot carry the record before M5.
    responseMarks:
      node.kind === 'operation'
        ? responseMarks(
            runtime.errors,
            node.responses.map((response) => response.statusCode),
          )
        : [],
    contracts: node.kind === 'operation' ? contractGroups(runtime.errors, document, basePath) : [],
  };
}

/**
 * The Health panel of the overview page, or nothing when nothing measured the document.
 *
 * A SCORE OF ZERO AND NO PANEL AT ALL ARE DIFFERENT STATEMENTS, per SPEC 7.3. A document that no
 * drift engine ever ran over has no report, and drawing 0% for it would say the documentation is
 * bad rather than that nothing looked at it.
 *
 * @param document - The normalized document
 * @param basePath - Mount point, so a finding can be jumped to
 * @returns The panel, or null
 */
export function buildHealthModel(document: IRDocument, basePath: string): HealthModel | null {
  const report: IRHealthReport | undefined = document.health;
  if (report === undefined) return null;

  const operations = String(report.operationCount);
  const findings = String(report.drift.length);

  return {
    title: `Documentation health, ${operations} operations, ${findings} findings`,
    score: `${String(report.score)}%`,
    // A CHECK WITH NOTHING TO COUNT IS NOT SCORED AND NOT DRAWN, per SPEC 7.2's 2026-08-14
    // line. The row used to render `n/a`, which reports on the instrument in a column where
    // every other row reports on the application, the class F26 named. Unlike F26's empty
    // declared group, which SPEC 6.4 makes an assertion and which kept its row, a question
    // that applied to nothing asserts nothing about the application, so it renders nothing,
    // the way a node without runtime facts gets no empty column.
    checks: report.checks
      .filter((check) => check.total > 0)
      .map((check) => ({
        label: check.label,
        count: `${String(check.passed)} / ${String(check.total)}`,
      })),
    rules: groupDriftByRule(report.drift).map((group) => ({
      rule: group.rule,
      count: String(group.issues.length),
      findings: group.issues.map((issue) => driftModel(issue, document, basePath, true)),
    })),
  };
}

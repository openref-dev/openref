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
  driftForNode,
  expandSourceLink,
  groupDriftByRule,
  hasRuntimeFacts,
  type IRConfidence,
  type IRDocument,
  type IRDriftIssue,
  type IRDriftRule,
  type IRDriftSeverity,
  type IRErrorContracts,
  type IRGuard,
  type IRGuardScope,
  type IRHealthReport,
  type IRNodeRuntime,
  type IRRateLimit,
  type IRStreaming,
} from '@openref/core';
import { nodeHref, schemaHref } from './links';
import { statusClass } from '../../shared/status';

/**
 * One value on a runtime row.
 *
 * Every field is present and empty rather than absent, so the component tests one thing per
 * field instead of narrowing a union. `confidence` is the exception and is null when the value
 * carries no provenance, because a source location has none to carry: V8 either answered or did
 * not, and SPEC 6.3 gives it no collector for that reason.
 */
export interface RuntimeValueModel {
  /** Status code of an error contract, drawn before the text. Empty on every other row. */
  readonly status: string;
  /** Whole class of the status code, so the two columns colour a code the same way. */
  readonly statusClass: string;
  readonly text: string;
  /** Where the text links to. Empty when the value is not a link. */
  readonly href: string;
  /** A short aside after the text: an error's detail, or why there is no source link. */
  readonly note: string;
  /**
   * The three letter code of the provenance, per SPEC 6.1, which is the half of the mark a
   * reader reads. Empty when the value carries no provenance, which is the source row: V8 either
   * answered or did not, so there is no collector to name and nothing to doubt.
   */
  readonly code: string;
  /** Whole class of the mark, which carries the level as an edge style as well as a colour. */
  readonly markClass: string;
  /** The level and the collector in words, which is the mark's accessible name and its tooltip. */
  readonly markTitle: string;
}

/** One labelled row of the runtime block. */
export interface RuntimeRowModel {
  readonly label: string;
  readonly values: readonly RuntimeValueModel[];
}

/** One finding, as a row. */
export interface DriftModel {
  readonly rule: IRDriftRule;
  /** Class carrying the severity, which the design names crit, warn and note. */
  readonly severityClass: string;
  readonly message: string;
  /** What each side says, already labelled, so the component draws a list and not two cases. */
  readonly sides: readonly string[];
  readonly suggestion: string;
  /** Where the subject is. Empty on the page that is already about the subject. */
  readonly href: string;
  /** What the finding is about, for a row on a page that is not about it. Empty otherwise. */
  readonly subject: string;
}

/** The runtime block of one node. */
export interface RuntimeModel {
  readonly rows: readonly RuntimeRowModel[];
  readonly drift: readonly DriftModel[];
}

/** One line of the check list, which is one question asked of the whole document. */
export interface HealthCheckModel {
  readonly label: string;
  /** `124 / 127`, or `n/a` for a check nothing in this document could be asked. */
  readonly count: string;
}

/** Everything one rule found, which is what the panel lists. */
export interface HealthRuleModel {
  readonly rule: IRDriftRule;
  /** How many findings the rule produced, as the closed group prints it. */
  readonly count: string;
  readonly findings: readonly DriftModel[];
}

/** The Health panel of SPEC 7.2, which the overview page carries. */
export interface HealthModel {
  /**
   * Heading of the panel, carrying what was asked and how much came back.
   *
   * IT IS A STRING FROM THE MODEL AND NOT THREE ELEMENTS IN THE COMPONENT. The panel's chunk is
   * measured against the tightest cap in SPEC 20, and a heading assembled here costs the page it
   * appears on thirty bytes while costing every other page nothing.
   */
  readonly title: string;
  /** The percentage of SPEC 7.2, as it is printed. */
  readonly score: string;
  readonly checks: readonly HealthCheckModel[];
  readonly rules: readonly HealthRuleModel[];
}

/**
 * Group keys and labels, in the order SPEC 6.4 lists them.
 *
 * READING THE THREE FIELDS BY NAME IS WHAT KEEPS THEM APART. A helper that took
 * `IRErrorContracts` and returned one array would put a promise and an observation on the same
 * row, and nothing in the type system would object, which is exactly what T021 made structural.
 */
const ERROR_GROUPS = [
  ['declared', 'Errors, declared'],
  ['runtimeDerived', 'Errors, runtime-derived'],
  ['global', 'Errors, global'],
] as const satisfies readonly (readonly [keyof IRErrorContracts, string])[];

/** The three letter code of each level, per the design contract. */
const CODES: Readonly<Record<IRConfidence, string>> = {
  declared: 'DCL',
  derived: 'DRV',
  inferred: 'INF',
};

/** Which drift token group a severity paints from. `crit`, `warn` and `note` are the design's. */
const SEVERITY_CLASSES: Readonly<Record<IRDriftSeverity, string>> = {
  error: 'oref-drift-crit',
  warning: 'oref-drift-warn',
  info: 'oref-drift-note',
};

/** Windows a rate limit is most often written in, so the row reads as a sentence. */
const WINDOWS: readonly (readonly [number, string])[] = [
  [1000, 'second'],
  [60_000, 'minute'],
  [3_600_000, 'hour'],
  [86_400_000, 'day'],
];

/** A value with nothing but text on it, which is most of them. */
const EMPTY_VALUE = {
  status: '',
  statusClass: '',
  text: '',
  href: '',
  note: '',
  code: '',
  markClass: '',
  markTitle: '',
} as const satisfies RuntimeValueModel;

/**
 * The provenance half of a value: the code, the class carrying the edge style, and the words.
 *
 * @param confidence - Level of the fact
 * @param collector - Name of the collector that produced it
 * @returns The three fields the mark is drawn from
 */
function mark(
  confidence: IRConfidence,
  collector: string,
): Pick<RuntimeValueModel, 'code' | 'markClass' | 'markTitle'> {
  return {
    code: CODES[confidence],
    markClass: `oref-prov oref-prov-${confidence}`,
    markTitle: `${confidence}, ${collector}`,
  };
}

/**
 * A rate limit in the words a reader would use.
 *
 * @param limit - The limit as the throttler declares it
 * @returns `100 / minute`, or `100 / 30 s` for a window with no name
 */
export function rateLimitLabel(limit: IRRateLimit): string {
  const named = WINDOWS.find(([ms]) => ms === limit.ttlMs)?.[1];
  const window = named ?? `${String(limit.ttlMs / 1000)} s`;
  const suffix = limit.name === undefined || limit.name === '' ? '' : ` (${limit.name})`;

  return `${String(limit.limit)} / ${window}${suffix}`;
}

/**
 * A streaming fact in one line.
 *
 * THE ITEM SCHEMA IS NAMED AS PRESENT OR ABSENT AND NEVER GUESSED, per SPEC 13.6. A stream with
 * no declared item type is the subject of the `stream-unspecified` rule, and printing a shape
 * here would be the guess that rule exists to report.
 *
 * @param streaming - The streaming fact
 * @returns `SSE`, with the heartbeat when one was declared
 */
export function streamingLabel(streaming: IRStreaming): string {
  const transport = streaming.transport === 'sse' ? 'SSE' : streaming.transport;
  const beat =
    streaming.heartbeatMs === undefined
      ? ''
      : `, heartbeat ${String(streaming.heartbeatMs / 1000)} s`;

  return `${transport}${beat}`;
}

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
  ['route', 'Guards'],
  ['global', 'Guards, global'],
] as const satisfies readonly (readonly [IRGuardScope, string])[];

/**
 * Guards at one scope, as one value per provenance rather than one per guard.
 *
 * Three guards read by one collector are one observation of three names, and three marks saying
 * the same thing about where they came from is noise. Two collectors reporting guards at
 * different confidence are two observations, and those stay apart.
 *
 * @param guards - Guards observed on the route, at every scope
 * @param scope - The scope this row draws
 * @returns One value per distinct provenance, in the order the guards were merged
 */
function guardValues(guards: readonly IRGuard[], scope: IRGuardScope): RuntimeValueModel[] {
  const values: RuntimeValueModel[] = [];

  for (const guard of guards) {
    if (guard.scope !== scope) continue;

    const at = values.findIndex(
      (value) => value.markTitle === `${guard.confidence}, ${guard.collector}`,
    );

    if (at === -1) {
      values.push({ ...EMPTY_VALUE, text: guard.name, ...mark(guard.confidence, guard.collector) });
      continue;
    }

    const held = values[at];
    if (held !== undefined) values[at] = { ...held, text: `${held.text}, ${guard.name}` };
  }

  return values;
}

/**
 * The rows of the runtime block, in the order SPEC 2 prints them.
 *
 * @param runtime - The node's runtime record
 * @param template - `IRRuntimeMeta.sourceLinkTemplate`, with `{ref}` already substituted
 * @returns Every row that has something in it
 */
function rowsOf(runtime: IRNodeRuntime, template: string | undefined): RuntimeRowModel[] {
  const rows: RuntimeRowModel[] = [];

  for (const [scope, label] of GUARD_SCOPES) {
    const values = guardValues(runtime.guards ?? [], scope);
    if (values.length > 0) rows.push({ label, values });
  }

  const scalar = [
    ['Scopes', runtime.scopes, (value: readonly string[]) => value.join(', ')],
    ['Roles', runtime.roles, (value: readonly string[]) => value.join(', ')],
    ['Rate limit', runtime.rateLimit, rateLimitLabel],
    ['Streaming', runtime.streaming, streamingLabel],
  ] as const;

  for (const [label, fact, format] of scalar) {
    if (fact === undefined) continue;

    rows.push({
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

  for (const [key, label] of ERROR_GROUPS) {
    const contracts = errors[key];

    if (contracts.length === 0) {
      if (key !== 'declared') continue;

      // THE ROW STATES A FACT ABOUT THE OPERATION AND NAMES THE DECORATOR AS THE FIX, per SPEC
      // 6.4. It read "examined, nothing declared with @ApiErrors", which describes the instrument
      // in a column where every other row describes the application, and it put the decorator in
      // the finding rather than in the edit that answers it.
      rows.push({
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
  const runtime = document.nodes.get(nodeId)?.runtime;
  if (runtime === undefined || !hasRuntimeFacts(runtime)) return null;

  // THE FINDINGS COME FROM THE REPORT AND NOT FROM THE NODE. The rules of SPEC 7.1 need the whole
  // document to fire, so they run once over it; `IRNodeRuntime.drift` is what a federated remote
  // may arrive carrying, and it wins when it is there because it is about that remote.
  const found = runtime.drift ?? driftForNode(document.health?.drift ?? [], nodeId);

  return {
    rows: rowsOf(runtime, document.runtime?.sourceLinkTemplate),
    drift: found.map((issue) => driftModel(issue, document, basePath, false)),
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
    checks: report.checks.map((check) => ({
      label: check.label,
      // A CHECK WITH NOTHING TO COUNT IS SHOWN AND NOT SCORED, per SPEC 7.2. A document with no
      // streaming endpoint is asked nine questions rather than given the tenth for free, and the
      // row saying so is how a reader knows the question was not skipped by accident.
      count: check.total === 0 ? 'n/a' : `${String(check.passed)} / ${String(check.total)}`,
    })),
    rules: groupDriftByRule(report.drift).map((group) => ({
      rule: group.rule,
      count: String(group.issues.length),
      findings: group.issues.map((issue) => driftModel(issue, document, basePath, true)),
    })),
  };
}

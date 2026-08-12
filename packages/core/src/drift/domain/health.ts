/**
 * The Documentation Health report of SPEC 7.2: a percentage, a line per rule, and the findings.
 *
 * THE SCORE IS THE MEAN OF THE PER CHECK RATIOS AND NOT ONE POOLED RATIO, per SPEC 7.2. Each check
 * is one question about the document, and the score answers how many of those questions the
 * document answers well. Pooling every subject into one fraction would let the rule with the
 * largest denominator decide for the rest: five hundred DTO fields would outvote a hundred and
 * twenty seven operations, and a document with no described endpoint at all would score well for
 * having described its fields.
 *
 * A CHECK WITH NOTHING TO COUNT IS LEFT OUT RATHER THAN COUNTED AS PERFECT. A document with no
 * streaming endpoint is scored on the questions it can be asked; giving it the tenth question for
 * free would mean every document scored higher the fewer kinds of thing it contained.
 *
 * THE DRIFT LIST IS ORDERED BY SUBJECT AND NOT BY RULE, because that is how SPEC 7.2 prints it and
 * how a reader uses it: everything wrong with one endpoint, together. The order is fixed rather
 * than incidental, since the report goes into the IR and the IR is hashed.
 */

import { runDriftRules, type DriftObservation, type RuleResult } from './drift-rules';
import type { IRDocument } from '../../ir/domain/document.types';
import type { IRHealthCheck, IRHealthReport } from '../../ir/domain/health.types';
import type { IRDriftIssue, IRDriftRule, IRDriftSeverity } from '../../ir/domain/runtime.types';

/** What a caller supplies beyond the document itself. */
export interface HealthReportOptions {
  /** What the runtime pass observed, when one ran. */
  readonly observation?: DriftObservation;
  /**
   * Checks another subsystem owns, such as `runtime-collectors` from the collector registry.
   *
   * THEY COME FIRST IN THE REPORT, deliberately. A collector that did not run means facts are
   * missing from everything below it, so a reader is told how much to trust the rest before
   * reading the rest.
   */
  readonly checks?: readonly IRHealthCheck[];
}

/**
 * Computes the percentage of SPEC 7.2 from the checks it is made of.
 *
 * @param checks - Every check in the report
 * @returns Whole percentage points, 0 to 100, and 100 when nothing could be asked
 */
export function healthScore(checks: readonly IRHealthCheck[]): number {
  const asked = checks.filter((check) => check.total > 0);
  if (asked.length === 0) return 100;

  const total = asked.reduce((sum, check) => sum + check.passed / check.total, 0);

  return Math.round((total / asked.length) * 100);
}

/**
 * Runs every rule of SPEC 7.1 and returns the findings alone.
 *
 * @param document - The document, with whatever runtime facts are attached to it
 * @param observation - What the runtime pass saw, when one ran
 * @returns The findings, ordered by subject and then by rule
 */
export function collectDrift(
  document: IRDocument,
  observation?: DriftObservation,
): readonly IRDriftIssue[] {
  return orderIssues(document, runDriftRules(document, observation));
}

/**
 * The findings about one node, out of a report about the whole document.
 *
 * THE REPORT IS THE ONLY PLACE A FINDING LIVES, and `IRNodeRuntime.drift` stays empty in a pass
 * that this package runs. The rules need the document to fire at all, so they run once over it
 * rather than once per node, and a copy hung on each node would be the same list stored twice in
 * one hashed document.
 *
 * @param issues - Findings from {@link IRHealthReport.drift}
 * @param nodeId - Node whose page is being drawn
 * @returns The findings about that node, in report order
 */
export function driftForNode(
  issues: readonly IRDriftIssue[],
  nodeId: string,
): readonly IRDriftIssue[] {
  return issues.filter((issue) => issue.nodeId === nodeId);
}

/** Every finding one rule produced, for a panel that lists rules rather than findings. */
export interface DriftRuleGroup {
  readonly rule: IRDriftRule;
  /** Severity of the rule, taken from its findings, which all carry the same one. */
  readonly severity: IRDriftSeverity;
  readonly issues: readonly IRDriftIssue[];
}

/** Loudest first, which is the order the panel reads in. */
const SEVERITY_RANK: Readonly<Record<IRDriftSeverity, number>> = { error: 0, warning: 1, info: 2 };

/**
 * Groups findings by the rule that produced them.
 *
 * THE PANEL IS BUILT FOR FOUR HUNDRED FINDINGS AND FOR TWO. Four hundred findings are still at
 * most ten rules, so grouping is what keeps the panel readable at the size where it matters most:
 * a reader sees ten rows and opens the one they mean to act on. A flat list of four hundred rows
 * is a panel that gets closed once and not opened again.
 *
 * A GROUP IS NEVER TRUNCATED HERE. Whatever bounds the markup is the markup's business and says
 * so; a cap applied at this level would make a group's own count disagree with its contents.
 *
 * @param issues - Findings from {@link IRHealthReport.drift}
 * @returns One group per rule that found something, loudest severity first, then most findings
 */
export function groupDriftByRule(issues: readonly IRDriftIssue[]): readonly DriftRuleGroup[] {
  const groups = new Map<IRDriftRule, IRDriftIssue[]>();

  for (const issue of issues) {
    const held = groups.get(issue.rule);
    if (held === undefined) groups.set(issue.rule, [issue]);
    else held.push(issue);
  }

  return [...groups]
    .map(([rule, found]) => ({
      rule,
      // Every finding of one rule carries that rule's severity, so the first is the rule's. The
      // list is never empty: a key exists here only because something was pushed under it.
      severity: found[0]?.severity ?? 'info',
      issues: found,
    }))
    .sort((left, right) => {
      const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severity !== 0) return severity;

      const count = right.issues.length - left.issues.length;

      return count === 0 ? left.rule.localeCompare(right.rule) : count;
    });
}

/**
 * Builds the whole health report.
 *
 * @param document - The document, with whatever runtime facts are attached to it
 * @param options - The runtime observation and any check another subsystem owns
 * @returns The report, ready to hang on {@link IRDocument.health}
 */
export function buildHealthReport(
  document: IRDocument,
  options: HealthReportOptions = {},
): IRHealthReport {
  const results = runDriftRules(document, options.observation);
  const checks: readonly IRHealthCheck[] = [
    ...(options.checks ?? []),
    ...results.map((result) => ({
      id: result.rule,
      label: result.label,
      passed: result.passed,
      total: result.total,
      severity: result.severity,
    })),
  ];

  let operationCount = 0;
  for (const node of document.nodes.values()) if (node.kind === 'operation') operationCount += 1;

  return {
    score: healthScore(checks),
    operationCount,
    checks,
    drift: orderIssues(document, results),
  };
}

/**
 * Puts the findings in report order: node by node in document order, then the schema findings.
 *
 * @param document - The document the findings are about
 * @param results - What each rule produced
 * @returns One flat list, ordered
 */
function orderIssues(
  document: IRDocument,
  results: readonly RuleResult[],
): readonly IRDriftIssue[] {
  const nodeOrder = new Map<string, number>();
  for (const id of document.nodes.keys()) nodeOrder.set(id, nodeOrder.size);

  const schemaOrder = new Map<string, number>();
  for (const id of document.schemas.keys()) schemaOrder.set(id, schemaOrder.size);

  const ruleOrder = new Map<string, number>();
  for (const result of results) ruleOrder.set(result.rule, ruleOrder.size);

  const issues = results.flatMap((result) => result.issues);

  return [...issues].sort((left, right) => {
    const rank = subjectRank(left) - subjectRank(right);
    if (rank !== 0) return rank;

    const subject =
      subjectIndex(left, nodeOrder, schemaOrder) - subjectIndex(right, nodeOrder, schemaOrder);
    if (subject !== 0) return subject;

    const pointer = (left.pointer ?? '').localeCompare(right.pointer ?? '');
    if (pointer !== 0) return pointer;

    return (ruleOrder.get(left.rule) ?? 0) - (ruleOrder.get(right.rule) ?? 0);
  });
}

/**
 * Which family of subject a finding is about: a node, a schema, or the document.
 *
 * @param issue - The finding
 * @returns 0 for a node, 1 for a schema, 2 for the document as a whole
 */
function subjectRank(issue: IRDriftIssue): number {
  if (issue.nodeId !== undefined) return 0;

  return issue.schemaId === undefined ? 2 : 1;
}

/**
 * Where the finding's subject stands in the document.
 *
 * @param issue - The finding
 * @param nodeOrder - Node ids in document order
 * @param schemaOrder - Schema ids in document order
 * @returns The index, or 0 for a finding about the document as a whole
 */
function subjectIndex(
  issue: IRDriftIssue,
  nodeOrder: ReadonlyMap<string, number>,
  schemaOrder: ReadonlyMap<string, number>,
): number {
  if (issue.nodeId !== undefined) return nodeOrder.get(issue.nodeId) ?? 0;
  if (issue.schemaId !== undefined) return schemaOrder.get(issue.schemaId) ?? 0;

  return 0;
}

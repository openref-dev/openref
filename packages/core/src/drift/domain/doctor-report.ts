/**
 * The doctor report of SPEC 7.2 and 7.4, made self contained and versioned.
 *
 * `ai-docs/BUILD-AMENDMENTS.md`'s `T037` entry, following `ai-docs/REMEDIATION.md`: `doctor` needs
 * a machine readable form beside the text one, carrying every field T022 already records on a
 * finding, plus what only the document can add: the rule's display code, a human subject for the
 * node or schema the finding is about, and the location by file and line through the source link
 * of T018. `IRDriftIssue` itself stays document relative on purpose, per SPEC 7.1, so this is the
 * join, computed once here rather than reimplemented by every consumer.
 *
 * VERSIONED FOR THE SAME REASON THE SEARCH INDEX OF T007 IS. A consumer that pins or caches this
 * shape has to be able to refuse a shape it does not recognise instead of reading it as empty,
 * which is indistinguishable from a clean report and is the worst output this tool can produce.
 *
 * PURE, LIKE EVERYTHING ELSE THIS FUNCTION READS. `doctor --from-nest` hands it a document whose
 * `.health` a live runtime pass already computed against a full `DriftObservation`; `lint` hands
 * it a bare specification with none. Both go through {@link buildDoctorReport}, and the difference
 * between them is entirely in what the document already carries, never in a branch here.
 */

import { expandSourceLink, type SourceLinkExpansion } from '../../source-link/domain/source-link';
import { buildHealthReport } from './health';
import { DRIFT_RULE_CODES } from './rule-codes';
import type { IRConfidence } from '../../ir/domain/confidence.types';
import type { IRDocument } from '../../ir/domain/document.types';
import type { IRHealthCheck } from '../../ir/domain/health.types';
import type {
  IRDriftAssertion,
  IRDriftClassification,
  IRDriftIssue,
  IRDriftRule,
  IRDriftSeverity,
  IRSourceLocation,
} from '../../ir/domain/runtime.types';

/**
 * Version of the doctor report shape, checked by any reader before it trusts the rest.
 *
 * Bumped only when an existing field is removed or its meaning changes, never for an addition,
 * per the discipline `SEARCH_INDEX_VERSION` already documents for the same reason.
 *
 * A NEW RULE IS NOT AN ADDITION TO THIS SHAPE, AND IT IS STILL A BREAKING CHANGE. This comment
 * used to stop at the line above, and read as if "never for an addition" settled what an addition
 * costs. It settles one question of two. The number here describes the wire shape a JSON reader
 * parses, and a reader on version 1 handed a finding whose `rule` it has never heard of can still
 * print its `severity`, `subject` and `message`, so the number does not move and must not: bumping
 * it would make every existing reader reject a report it can read perfectly well.
 *
 * The other question is the TypeScript contract, and SPEC 11 already answered it for
 * `StateNoticeKind`: adding a member to an exported union is breaking, not additive, because a
 * total `Record<Union, ...>` is a sanctioned spelling and a total record over a grown union does
 * not compile. `IRDriftRule` is such a union and {@link DRIFT_RULE_CODES} is such a record, in
 * this package, on purpose, so that a rule added without a display code fails the build instead
 * of printing an empty one. `ai-docs/design/CONTRACT.md` carries the ruling.
 *
 * WHAT THAT MEANS FOR M4 AND M5, WHICH BOTH ADD RULES. Each new rule leaves this constant at 1
 * and moves the major version of `@openref/core` once the package is published. Nothing is
 * published yet, so today the cost is only the compile error inside this repository, which is the
 * point of the total record. From 1.0 on, `T064` carries it into the release notes beside the
 * `StateNoticeKind` entry: a consumer switching exhaustively over `finding.rule` reads a new rule
 * as a break, and the report version will not warn it, because the report version is not the
 * thing that changed.
 */
export const DOCTOR_REPORT_VERSION = 1;

/** One line of {@link IRDoctorReport.checks}, with the code a reader cites when it has one. */
export interface IRDoctorCheck extends IRHealthCheck {
  /** Display code of SPEC 7.1. Absent for the one check that is not a rule, `runtime-collectors`. */
  readonly code?: string;
}

/** One finding, self contained: everything {@link IRDriftIssue} carries, plus where it points. */
export interface IRDoctorFinding {
  readonly rule: IRDriftRule;
  readonly code: string;
  readonly severity: IRDriftSeverity;
  /** The bucket of SPEC 7.4, exactly as the finding carries it. */
  readonly classification: IRDriftClassification;
  /** Confidence of the runtime fact behind the finding. Absent when nothing was observed. */
  readonly confidence?: IRConfidence;
  /**
   * The assertion that would describe the fact, in values, when the rule could name one.
   *
   * CARRIED VERBATIM AND NOT RECOMPUTED, exactly as `classification` is. It is what lets a fix
   * mode write an edit without reading `suggestion`, which is a sentence written for a person.
   */
  readonly assertion?: IRDriftAssertion;
  readonly nodeId?: string;
  readonly schemaId?: string;
  readonly pointer?: string;
  /** A human readable name for the subject: `POST /users`, a schema pointer, or `(document)`. */
  readonly subject: string;
  readonly message: string;
  readonly runtimeValue?: string;
  readonly specValue?: string;
  readonly suggestion: string;
  /** Where the handler lives, per T018, when the finding is about a node the source collector reached. */
  readonly source?: IRSourceLocation;
  /** The source location expanded against the host's link template, when one is configured. */
  readonly sourceLink?: SourceLinkExpansion;
}

/** The whole of SPEC 7.2, self contained and versioned. */
export interface IRDoctorReport {
  readonly version: number;
  readonly score: number;
  readonly operationCount: number;
  readonly checks: readonly IRDoctorCheck[];
  readonly findings: readonly IRDoctorFinding[];
}

/** What {@link readDoctorReport} returns: the report, or the reason it refused to hand one over. */
export type DoctorReportRead =
  | { readonly ok: true; readonly report: IRDoctorReport }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads `doctor --json` output back, refusing anything this build does not recognise.
 *
 * THE VERSION FIELD HAD NO READER UNTIL THE PRE-M4 REVIEW, which is what made it a promise
 * instead of a check. `DOCTOR_REPORT_VERSION` has been written into every report since `T036`,
 * with the stated purpose that "a consumer that pins or caches refuses a shape it does not
 * recognise", and nothing anywhere refused anything: every consumer in this repository gets the
 * report in process from {@link buildDoctorReport}, and the one place that crossed the JSON
 * boundary, the `--fix` integration suite, crossed it with an unchecked cast. A field written by
 * a writer and read by nobody is a field that cannot be wrong, which is not the same as right.
 *
 * IT RETURNS A REFUSAL RATHER THAN THROWING, unlike `loadSearchIndex`, which is the same idea for
 * the search index. That reader runs in a browser where a throw is the only signal the call site
 * can act on. This one runs in a pipeline that wants to print why it stopped, and `core` is the
 * package that must not decide how a host reports failure. A version mismatch is also an ordinary
 * outcome of reading a file somebody else wrote, not an exceptional one.
 *
 * WHAT IT CHECKS IS THE ENVELOPE, NOT THE FINDINGS. The version, and that the four fields the
 * envelope declares are present with the right primitive shape. It does not validate every
 * finding, because a report of the right version is written by this package and a consumer that
 * has to re-validate the writer's own output gains nothing for the bytes.
 *
 * @param serialized - The stdout of `openref doctor --json`
 * @returns The report, or the reason it was refused
 *
 * @example
 * const read = readDoctorReport(stdout);
 * if (!read.ok) process.stderr.write(`${read.reason}\n`);
 */
export function readDoctorReport(serialized: string): DoctorReportRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return { ok: false, reason: 'the doctor report is not valid JSON' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'the doctor report is not an object' };
  }

  const envelope = parsed as Partial<Record<keyof IRDoctorReport, unknown>>;
  if (envelope.version !== DOCTOR_REPORT_VERSION) {
    return {
      ok: false,
      reason:
        `the doctor report is version ${JSON.stringify(envelope.version)}, ` +
        `this build reads version ${String(DOCTOR_REPORT_VERSION)}`,
    };
  }

  if (typeof envelope.score !== 'number' || typeof envelope.operationCount !== 'number') {
    return { ok: false, reason: 'the doctor report carries no score or operation count' };
  }

  if (!Array.isArray(envelope.checks) || !Array.isArray(envelope.findings)) {
    return { ok: false, reason: 'the doctor report carries no checks or findings' };
  }

  return { ok: true, report: parsed as IRDoctorReport };
}

/**
 * Names the subject of a finding for a reader who has not loaded the document.
 *
 * @param document - The document the finding is about
 * @param issue - The finding
 * @returns A method and path, a schema id and pointer, the issue's own subject, or `(document)`
 */
function findingSubject(document: IRDocument, issue: IRDriftIssue): string {
  // THE ISSUE'S OWN SUBJECT COMES FIRST, per SPEC 7.2 and `T054`. A rule whose subject is neither
  // a node nor a schema, which is what `discovery-incomplete` is, names it itself; `(document)`
  // would drop the one word a reader acts on, and the two members below cannot carry a gateway
  // class, a broker protocol or a handler method.
  if (issue.subject !== undefined) return issue.subject;

  if (issue.nodeId !== undefined) {
    const node = document.nodes.get(issue.nodeId);
    if (node === undefined) return issue.nodeId;

    return node.kind === 'channel'
      ? (node.address ?? issue.nodeId)
      : `${node.method.toUpperCase()} ${node.path}`;
  }

  if (issue.schemaId !== undefined) return `${issue.schemaId}${issue.pointer ?? ''}`;

  return '(document)';
}

/**
 * Where a finding's handler lives, when it is about a node the source collector reached.
 *
 * @param document - The document the finding is about, for the source link template
 * @param issue - The finding
 * @returns The raw location and its expansion, or neither when there is nothing to link
 */
function findingSource(
  document: IRDocument,
  issue: IRDriftIssue,
): Pick<IRDoctorFinding, 'source' | 'sourceLink'> {
  if (issue.nodeId === undefined) return {};

  const source = document.nodes.get(issue.nodeId)?.runtime?.source;
  if (source === undefined) return {};

  const template = document.runtime?.sourceLinkTemplate;

  return { source, sourceLink: expandSourceLink(template ?? '', source) };
}

/**
 * Turns one {@link IRDriftIssue} into a finding a consumer can act on without the document.
 *
 * @param document - The document the finding is about
 * @param issue - The finding, as T022 recorded it
 * @returns The finding, joined with the document
 */
function doctorFinding(document: IRDocument, issue: IRDriftIssue): IRDoctorFinding {
  const basis = issue.basis;
  const confidence = basis.kind === 'collected' ? basis.confidence : undefined;

  return {
    rule: issue.rule,
    code: DRIFT_RULE_CODES[issue.rule],
    severity: issue.severity,
    classification: issue.classification,
    ...(confidence === undefined ? {} : { confidence }),
    ...(issue.assertion === undefined ? {} : { assertion: issue.assertion }),
    ...(issue.nodeId === undefined ? {} : { nodeId: issue.nodeId }),
    ...(issue.schemaId === undefined ? {} : { schemaId: issue.schemaId }),
    ...(issue.pointer === undefined ? {} : { pointer: issue.pointer }),
    subject: findingSubject(document, issue),
    message: issue.message,
    ...(issue.runtimeValue === undefined ? {} : { runtimeValue: issue.runtimeValue }),
    ...(issue.specValue === undefined ? {} : { specValue: issue.specValue }),
    suggestion: issue.suggestion,
    ...findingSource(document, issue),
  };
}

/**
 * Builds the versioned doctor report of SPEC 7.2, 7.4 and `ai-docs/REMEDIATION.md` section 6.
 *
 * `document.health` IS USED WHEN PRESENT AND NEVER RECOMPUTED OVER IT, because a live runtime pass
 * already ran every rule against a real `DriftObservation`, and recomputing with none would
 * silently lose every runtime rule's finding. Its absence, a bare specification or a hand built
 * document that never went through `runRuntimePass`, is not an error: `buildHealthReport` with no
 * observation asks a document only the questions it can answer, per SPEC 7.1's own scoping, which
 * is exactly `lint`'s job over a specification with no application at all.
 *
 * @param document - The document, from `--from-nest` or from a bare specification
 * @returns The report, ready for a human renderer or for `canonicalize`
 */
export function buildDoctorReport(document: IRDocument): IRDoctorReport {
  const report = document.health ?? buildHealthReport(document);

  return {
    version: DOCTOR_REPORT_VERSION,
    score: report.score,
    operationCount: report.operationCount,
    checks: report.checks.map((check) => ({
      ...check,
      ...(check.id in DRIFT_RULE_CODES ? { code: DRIFT_RULE_CODES[check.id as IRDriftRule] } : {}),
    })),
    findings: report.drift.map((issue) => doctorFinding(document, issue)),
  };
}

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

/**
 * Names the subject of a finding for a reader who has not loaded the document.
 *
 * @param document - The document the finding is about
 * @param issue - The finding
 * @returns A method and path, a schema id and pointer, or `(document)` for neither
 */
function findingSubject(document: IRDocument, issue: IRDriftIssue): string {
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

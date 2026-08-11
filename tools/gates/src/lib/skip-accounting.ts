/**
 * What a run can say about its own skips on a machine that has none of the private documents.
 *
 * THE M0 EXIT CONDITION IS ENFORCED WHERE `ai-docs/` IS PRESENT, WHICH TODAY IS ONE MACHINE.
 * Four gates read that directory and skip where it is absent, so on the runner they document
 * the exception list rather than enforcing it. That is a decision and not a defect, and it is
 * recorded as one in SPEC 20 and in the amendments.
 *
 * What CI can still enforce without the directory is the shape of the skipping itself:
 *
 * - every skip names a declared reason, so a gate cannot skip for a cause nobody wrote down
 * - the reason it names is true in this run, so a gate cannot cite absent documents on a
 *   checkout that has them
 * - where a reason holds, the gates it forces to skip did skip, so an absent directory can
 *   never come out as a pass. AN ABSENCE READING AS COVERAGE IS THE FAILURE THIS REPOSITORY
 *   KEEPS REMOVING, and it is the one this check exists for
 *
 * None of that needs `ai-docs/` to be there. It needs only to know whether it is, which is
 * exactly what `aiDocsPresent` answers.
 */

import type { GateFinding, GateResult, SkipReasonId } from '../types.js';
import { AI_DOCS_DIR } from './ai-docs.js';

/** A cause a gate is allowed to skip for. */
export interface SkipReason {
  readonly id: SkipReasonId;

  /** Printed beside the gate in the accounting section. */
  readonly description: string;

  /**
   * Gates permitted to name this reason.
   *
   * A gate outside the list naming it is an error rather than a curiosity: the reason was
   * written for a known set of readers, and a fifth one appearing means either a new reader or
   * a copied literal, and both are decisions.
   */
  readonly permitted: readonly string[];

  /**
   * Gates that MUST skip when the cause holds and they ran.
   *
   * Empty where skipping is conditional on more than the cause. `budget-exceptions` is the
   * example: with an empty exception list it needs no plan to validate, so it passes on a
   * checkout with no documents rather than skipping.
   */
  readonly forced: readonly string[];
}

/** Conditions the accounting can test for itself. */
export interface SkipConditions {
  /** Whether `ai-docs/` is a directory in the checkout the gates just ran against. */
  readonly aiDocsPresent: boolean;
}

/**
 * The declared causes, and the only ones a gate may skip for.
 *
 * `artifact-absent` carries no `forced` list on purpose. Whether a build has happened is not
 * something this function can read without duplicating each gate's own idea of its artifact,
 * and a wrong answer there would fail a green build. What it does enforce is the half that
 * needs no such knowledge: a gate that skips for a missing artifact says so, rather than
 * looking the same as one skipping for missing documents.
 */
export const SKIP_REASONS: readonly SkipReason[] = [
  {
    id: 'ai-docs-absent',
    description: `${AI_DOCS_DIR}/ is not in this checkout, and no clone restores it`,
    permitted: ['build-manifest', 'claims', 'theme-motion', 'budget-exceptions'],
    forced: ['build-manifest', 'claims', 'theme-motion'],
  },
  {
    id: 'artifact-absent',
    description: 'what the gate reads is produced by a build that has not run',
    permitted: ['budgets', 'csp', 'theme-tokens', 'fixture-licenses'],
    forced: [],
  },
];

/**
 * Checks that every skip in a run is accounted for, and that no cause was left unskipped.
 *
 * Info findings are produced for the skips that are in order, so a green run still prints what
 * it did not check. Error findings mean the run is wrong.
 *
 * @param results - Results of the gates that ran, which may be a subset of all of them
 * @param conditions - What the accounting knows about the checkout
 * @returns Findings, one per accounted skip plus one per problem
 */
export function accountForSkips(
  results: readonly GateResult[],
  conditions: SkipConditions,
): GateFinding[] {
  const findings: GateFinding[] = [];
  const byId = new Map(SKIP_REASONS.map((reason) => [reason.id, reason]));

  for (const result of results.filter((item) => item.status === 'skip')) {
    const reasonId = result.skipReason;

    if (reasonId === undefined) {
      findings.push({
        level: 'error',
        message:
          `${result.id} skipped and named no reason. A skip is a gate reporting that it ` +
          `checked nothing, so the cause is part of the report. Declared reasons: ` +
          SKIP_REASONS.map((reason) => reason.id).join(', '),
      });
      continue;
    }

    const reason = byId.get(reasonId);
    if (reason === undefined) {
      findings.push({
        level: 'error',
        message: `${result.id} skipped for an undeclared reason ${reasonId}`,
      });
      continue;
    }

    if (!reason.permitted.includes(result.id)) {
      findings.push({
        level: 'error',
        message:
          `${result.id} skipped for ${reason.id}, which is declared for ` +
          `${reason.permitted.join(', ')} and not for it`,
      });
      continue;
    }

    if (reason.id === 'ai-docs-absent' && conditions.aiDocsPresent) {
      findings.push({
        level: 'error',
        message:
          `${result.id} skipped for ${reason.id} on a checkout that HAS ${AI_DOCS_DIR}/. ` +
          `The cause it named is false here, so whatever stopped it is unreported`,
      });
      continue;
    }

    findings.push({
      level: 'info',
      message: `UNVALIDATED ${result.id}: ${reason.description} (${reason.id})`,
    });
  }

  if (!conditions.aiDocsPresent) {
    const ran = new Set(results.map((result) => result.id));
    const reason = byId.get('ai-docs-absent');

    for (const id of reason?.forced ?? []) {
      if (!ran.has(id)) continue;

      const status = results.find((result) => result.id === id)?.status;
      if (status !== 'skip') {
        findings.push({
          level: 'error',
          message:
            `${id} reported ${String(status)} with ${AI_DOCS_DIR}/ absent, and it reads that ` +
            `directory. A gate that cannot see what it checks has to say so, because an ` +
            `absence reported as a pass is coverage this project does not have`,
        });
      }
    }
  }

  return findings;
}

/**
 * Whether the accounting found anything wrong.
 *
 * @param findings - What `accountForSkips` produced
 * @returns True when the run is unaccounted for and must go red
 */
export function skipAccountingFailed(findings: readonly GateFinding[]): boolean {
  return findings.some((finding) => finding.level === 'error');
}

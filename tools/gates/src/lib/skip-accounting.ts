/**
 * What a run can say about its own skips on a machine that has none of the private documents.
 *
 * THREE NUMBERS DESCRIBE THIS CHANGE AND THEY COUNT THREE DIFFERENT THINGS. The sentence that used
 * to open this file said "IT USED TO BE FOURTEEN GATES AND IT IS NOW TWO" with fourteen standing in
 * for the skip count, and contradicted its own list twenty lines below, where two of the fourteen
 * are described as passing rather than skipping. Each number is now said to be what it is, and
 * {@link GATES_THAT_SKIPPED} carries the one a test can hold:
 *
 * - TWELVE gates reported `skip` for {@link SKIP_REASON_AI_DOCS} on a checkout without the
 *   documents, which is every clone and therefore every CI run. That is the true skip count and it
 *   is the number the ruling was made on.
 * - FOURTEEN was the LENGTH OF THE PERMITTED LIST below. It is not the skip count and never was:
 *   two of its entries named the reason without reaching it in a run. WHICH TWO IS NOT RECORDED
 *   HERE, because a conditional skip depends on the other half of its own gate at the moment of the
 *   run, and nothing in this file can read a past run. Saying it is unknown is the accurate report.
 * - THIRTEEN IS NOT A GATE COUNT IN THIS FILE AT ALL. It is how many gates report an error once the
 *   committed artefact is deleted, which is a count of things in the repository, so
 *   `GATES_THAT_READ_THE_PROJECTION` in `lib/projection.ts` holds it and a test re-derives it.
 *
 * WHAT EACH OF THE TWELVE NEEDED is now generated into a committed artefact and read from there,
 * so the two entries that remain are the two that still open a document: `budget-exceptions`, which
 * needs the plan only when the exception list is not empty, and `coverage`, which reconciles the
 * STANDARDS 9.1 table while enforcing every floor wherever it runs.
 *
 * What CI can enforce without the directory is the shape of the skipping itself:
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

/** The cause the three numbers above are all about. */
export const SKIP_REASON_AI_DOCS = 'ai-docs-absent';

/**
 * The twelve gates that reported `skip` for absent documents before the projection existed.
 *
 * A COUNT OF THINGS IN THE REPOSITORY, SO A TEST HOLDS IT. Each of these twelve now reads the
 * committed artefact instead and reports a verdict on every checkout, which is what makes the list
 * checkable today: `GATES_THAT_READ_THE_PROJECTION` is this list plus `projection-privacy`, the
 * gate the artefact itself needed, and `projection.spec.ts` derives both from the gate sources.
 * The two entries of the old fourteen that are not here are the two still named in
 * {@link SKIP_REASONS}.
 */
export const GATES_THAT_SKIPPED: readonly string[] = [
  'build-manifest',
  'capability-debts',
  'claims',
  'deferrals',
  'events-suites',
  'federation-suites',
  'm6-suites',
  'm7-suites',
  'publish-list',
  'reader-pages',
  'static-suites',
  'theme-motion',
];

/**
 * How long the permitted list was when those twelve skipped.
 *
 * NOT THE SKIP COUNT. It is two longer than {@link GATES_THAT_SKIPPED}, and the difference is the
 * point: a list of who MAY skip is not a record of who DID.
 */
export const GATES_PERMITTED_TO_SKIP_THEN = 14;

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
    id: SKIP_REASON_AI_DOCS,
    description: `${AI_DOCS_DIR}/ is not in this checkout, and no clone restores it`,
    permitted: [
      // `budget-exceptions` reads the plan to expire an entry, and with an empty exception list
      // there is nothing to expire, so it passes on a clone rather than skipping. It is here for
      // the day the list is not empty, which is the day the reading matters.
      'budget-exceptions',
      // `coverage` compares STANDARDS 9.1's governed table with `COVERAGE_FLOORS`, which is the
      // direction neither copy of that table can see. IT IS THE ONE GATE ON THIS LIST WHOSE SKIP
      // SAYS THE LEAST, so the wording is the part that matters: the suite is measured with
      // coverage and every committed floor is enforced whether or not the directory is there, and
      // a violation still fails, so a skip here means the prose table alone went unread.
      'coverage',
    ],
    // NOTHING IS FORCED ANY MORE, AND THE EMPTY LIST IS THE FINDING RATHER THAN AN OVERSIGHT.
    // The three gates that had to skip without the documents, `build-manifest`, `claims` and
    // `theme-motion`, read the committed projection instead and report a verdict on every
    // checkout. Both gates above skip on a condition wider than the cause, so neither can be
    // required to skip whenever it holds. The rule itself is still enforced, over whatever this
    // list holds, and `accountForSkips` takes the reasons as an argument so that a case can prove
    // it red without inventing a gate.
    forced: [],
  },
  {
    id: 'artifact-absent',
    description: 'what the gate reads is produced by a build that has not run',
    permitted: ['budgets', 'csp', 'browser-resolution', 'theme-tokens', 'fixture-licenses'],
    forced: [],
  },
];

/**
 * Checks that every skip in a run is accounted for, and that no cause was left unskipped.
 *
 * Info findings are produced for the skips that are in order, so a green run still prints what
 * it did not check. Error findings mean the run is wrong.
 *
 * THE REASONS ARE AN ARGUMENT AND THEY WERE A LITERAL UNTIL THE PROJECTION LANDED. The rule that
 * a gate forced to skip may not come out as a pass had three subjects, and the artefact gave all
 * three a verdict on every checkout, so `forced` is empty and the rule became untestable against
 * the real list. A rule with no case that can redden it is the class this repository keeps
 * removing, so the list is injected and a case supplies one that still has a subject.
 *
 * @param results - Results of the gates that ran, which may be a subset of all of them
 * @param conditions - What the accounting knows about the checkout
 * @param reasons - The declared causes, defaulting to the committed ones
 * @returns Findings, one per accounted skip plus one per problem
 */
export function accountForSkips(
  results: readonly GateResult[],
  conditions: SkipConditions,
  reasons: readonly SkipReason[] = SKIP_REASONS,
): GateFinding[] {
  const findings: GateFinding[] = [];
  const byId = new Map(reasons.map((reason) => [reason.id, reason]));

  for (const result of results.filter((item) => item.status === 'skip')) {
    const reasonId = result.skipReason;

    if (reasonId === undefined) {
      findings.push({
        level: 'error',
        message:
          `${result.id} skipped and named no reason. A skip is a gate reporting that it ` +
          `checked nothing, so the cause is part of the report. Declared reasons: ` +
          reasons.map((reason) => reason.id).join(', '),
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

    if (reason.id === SKIP_REASON_AI_DOCS && conditions.aiDocsPresent) {
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
    const reason = byId.get(SKIP_REASON_AI_DOCS);

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

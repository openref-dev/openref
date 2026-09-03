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
    permitted: [
      'build-manifest',
      'claims',
      'theme-motion',
      'budget-exceptions',
      // `static-suites` reads SPEC 21's own row and matches this repository's wiring against it,
      // which is the half that needs the document. Its other three halves, the named suites, the
      // named cases and the budget job, run there and fail there, so it skips only when all three
      // are clean and the row alone went unread.
      'static-suites',
      // `capability-debts` reads the task ids and milestones out of `BUILD.md` to tell a live debt
      // from a stale one, and without them it can still answer the half that needs no document:
      // whether the marker a debt names is still in the source. It skips when that half is clean.
      //
      // ADDED BY THE PRE-M4 REVIEW, WHICH FOUND THE GATE SKIPPING FOR A REASON IT WAS NOT ON THIS
      // LIST FOR. Measured by moving `ai-docs/` aside and running the gates: the accounting printed
      // "capability-debts skipped for ai-docs-absent, which is declared for ... and not for it" and
      // the whole run went red on it. That is every checkout but the maintainer's, so the run this
      // list exists to make possible was the run it refused. The finding was correct and the answer
      // to it is this entry rather than a quieter accounting: the gate's skip is legitimate, and
      // nothing had said so.
      'capability-debts',
      // `publish-list` reads SPEC 4's own tables and compares them with the intended set, and it
      // reads `.changeset/config.json`'s fixed groups against the same table. Those two halves need
      // the document. The two that do not, the dry run and what a published package owes, run there
      // and fail there, so it skips only when both are clean and the documents alone went unread.
      //
      // A FOURTH COMPARISON IS NOT ENFORCED IN CI AT ALL, AND IT IS RECORDED HERE SO THAT NOBODY
      // READS IT AS THOUGH IT WERE. The gate also holds `CLAUDE.md`'s two package tables against the
      // intended set, and `CLAUDE.md` is excluded from git in `.git/info/exclude` exactly as
      // `ai-docs/` is: `git ls-files CLAUDE.md` is empty, so no clone and no runner has the file.
      // Its absence is reported as a `warning` naming the unread copy rather than as an error, which
      // is what keeps a clone green, and the consequence is that this quarter of the gate runs on
      // the maintainer's machine and nowhere else. It is the same standing exception the four `ai-docs`
      // readers carry, arriving through a file that is not under `ai-docs/`, and it is written down
      // because a comparison that exists in the code and never runs on a runner is indistinguishable
      // from an enforced one to anyone reading the gate list.
      'publish-list',
      // `federation-suites` is the Static gate's mechanism over the SPEC 21 Federation row and the
      // M4 definition of done, so it skips for the same reason and only under the same condition:
      // the halves that need no document, the named suites, the named cases and the run itself,
      // all happen on a checkout with no `ai-docs/` and fail there. Added by T047 with the gate,
      // rather than discovered by the first CI run that went red on the accounting, which is how
      // `capability-debts` came to be on this list.
      'federation-suites',
      // `events-suites` is the same mechanism over the SPEC 21 Events row and the M5 definition of
      // done, added by `T054` with the gate. It skips under the same condition and only that one:
      // the named suites, the named cases and the run itself all happen on a checkout with no
      // `ai-docs/` and fail there, so a skip here means the two documents alone went unread.
      'events-suites',
      // `m6-suites` is the same mechanism over four SPEC 21 rows and the M6 definition of done,
      // added by `T059` with the gate. It skips under the same condition and only that one: the
      // named suites, the named cases and the run itself, the bridge soak included, all happen on
      // a checkout with no `ai-docs/` and fail there, so a skip here means the two documents alone
      // went unread. It reads four rows rather than one, and a row the table has lost is an error
      // there rather than an empty list, so the skip cannot hide a missing row either.
      'm6-suites',
      // `m7-suites` is the same mechanism over the SPEC 21 Nuxt row and the M7 definition of done,
      // added by `T062` with the gate, and it reads one document more than the four above: it also
      // states which tasks M7 closes over, out of `BUILD.md` and the open `T060` section of
      // `BUILD-AMENDMENTS.md`. That third reading is a `warning` and not a `skip` of its own, and
      // its message says the scope went unread rather than passing on it, so the skip here still
      // means what the four above mean: the documents alone went unread, while the named suites,
      // the named cases and the run itself, the real `nuxt generate` included, all happen on a
      // checkout with no `ai-docs/` and fail there. A row the table has lost is an error rather
      // than an empty list here too, so the skip cannot hide a missing row.
      'm7-suites',
      // `reader-pages` compares SPEC 13.3's reader page line with the `PageKind` union, which is
      // the direction no total record in the tree can see. Added by `T054` with the gate. Its
      // other half, that every kind the reader page table names is a member of the union, reads
      // two committed files and runs on a clone, so a skip here means the specification alone
      // went unread.
      'reader-pages',
      // `coverage` compares STANDARDS 9.1's governed table with `COVERAGE_FLOORS`, which is the
      // direction neither copy of that table can see. Added by the post-`T054` review with the
      // check. IT IS THE HEAVIEST GATE ON THIS LIST AND THE ONE WHOSE SKIP SAYS THE LEAST, so the
      // wording is the part that matters: the suite is measured with coverage and every committed
      // floor is enforced whether or not the directory is there, and a violation still fails, so
      // a skip here means the prose table alone went unread. It is not on `forced` for that
      // reason, and because a checkout with a violation must report `fail` rather than `skip`.
      'coverage',
      // `deferrals` reads the seven documents and `BUILD.md`'s milestones to decide whether a
      // deferral has outlived its owner, and without them it still answers the half that needs no
      // document: whether a parenthesised milestone in any project's `src` says which of the two
      // things it means. It skips only when that half is clean, which is the `capability-debts`
      // condition, and it is on this list from the day the gate was written rather than after a
      // red run, which is how `capability-debts` came to be here.
      'deferrals',
    ],
    forced: ['build-manifest', 'claims', 'theme-motion'],
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

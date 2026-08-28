import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUDGET_EXCEPTIONS,
  BUDGET_EXCEPTION_HISTORY,
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  SPEC_20_BUDGET_IDS,
} from '../config.js';
import { BASELINE_ANSWERED_BUDGET_IDS } from '../lib/browser-baseline.js';
import { aiDocsAbsentMessage, aiDocsPresent } from '../lib/ai-docs.js';
import {
  checkBudgetExceptions,
  checkExceptionHistory,
  describeClosedException,
  describeException,
} from '../lib/budget-exceptions.js';
import { collectBudgetOutcomes, overBudgetIds } from '../lib/budget-report.js';
import type { BudgetReport } from '../lib/budget-report.js';
import { BUILT_OUTPUT_SEGMENT } from '../lib/budgets.js';
import { parseMilestones, planTaskIds, splitLines } from '../lib/build-manifest.js';
import {
  describeReading,
  emptyReadingMessage,
  readingIsEmpty,
  type ArtifactReading,
} from '../lib/debt-artifacts.js';
import type { BudgetException, ClosedException } from '../lib/budget-exceptions.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The list of budgets that are over, and the terms each one is over on.
 *
 * A budget owned by one task and only fixable in two others blocks every task behind it on a
 * defect that is not its own. The threshold is not the thing that moves: the number stays, the
 * failure stays visible on every run, and the debt carries an owner and a milestone it must be
 * gone by. This gate is what makes that different from a raised threshold.
 *
 * It fails on an entry with no owner, an owner that is not a task the plan carries, a milestone
 * BUILD.md does not have, a milestone that closes while the entry is still there, and an entry
 * whose budget is inside its limit again. The last one is the same default this repository
 * applies to every allowlist: an entry matching nothing is stale, not coverage.
 *
 * A MILESTONE CANNOT CLOSE OVER AN OUTSTANDING ENTRY. Ticking the last task of a milestone while
 * one of its debts is still here fails the build, which is what makes the expiry real rather
 * than a date written in a comment.
 *
 * AND SINCE T042 IT WEIGHS THE ARTEFACTS WHATEVER THE LIST HOLDS. T035 filed the hole: the empty
 * list branch returned before `collectBudgetOutcomes` ran, so with no entries nothing was weighed
 * and the gate passed unconditionally, on exactly the day it mattered most. `capability-debts`
 * carried the same defect over a different artefact and one rule answers both, in
 * `lib/debt-artifacts.ts`: a gate whose list is empty still reads the artefact it is about, prints
 * what it read, and fails when it read nothing.
 *
 * WHAT COUNTS AS HAVING READ SOMETHING IS A BUILD AND ONLY A BUILD, corrected within T042 after the
 * first form of the fix was measured passing on the case it was written for. With every package's
 * `dist` removed, four budgets still weighed files: the two font budgets and the two
 * theme stylesheet budgets, whose roots include the committed `packages/theme/fonts`. The gate
 * printed "read 4 weighed budget(s) under the built artefacts of SPEC 20" and passed, and not one
 * of those four came from a build. So the reading counts `builtCount`, the committed inputs are
 * printed on their own line, and the sentence says which of the two it counted.
 */
export function runBudgetExceptionsGate(
  context: GateContext,
  exceptions: readonly BudgetException[],
  history: readonly ClosedException[],
): GateResult {
  const findings: GateFinding[] = [];

  // THE CLOSED ENTRIES ARE CHECKED WHETHER OR NOT ANYTHING IS LIVE, and that ordering is the
  // point rather than a detail: the day the last live entry goes away is exactly the day this
  // gate would otherwise stop reading the record of what used to be here.
  const closed = history.map((entry) => ({
    level: 'info' as const,
    message: `CLOSED ${describeClosedException(entry)}`,
  }));

  // WEIGHED ONCE, BEFORE THE LIST IS CONSULTED. The live branch needs the figures to tell a stale
  // entry from a live one; the empty branch needs them because a run that weighed nothing and a
  // repository whose budgets are all inside their limits produce the same silence.
  const report: BudgetReport = collectBudgetOutcomes(context.repoRoot);
  const reading: ArtifactReading = {
    unit: 'SPEC 20 budget weighed over built output',
    where: `the ${BUILT_OUTPUT_SEGMENT} directories the size budgets name`,
    count: report.builtCount,
    remedy: 'Run pnpm build before pnpm gates',
  };

  findings.push({ level: 'info', message: describeReading(reading) });

  // THE COMMITTED HALF IS PRINTED AND NEVER COUNTED. Saying nothing about it would read as four
  // budgets having gone missing; counting it would answer the build question with files a build
  // never touches, which is the defect this line exists beside.
  if (report.committedCount > 0) {
    findings.push({
      level: 'info',
      message:
        `${String(report.committedCount)} further SPEC 20 budget(s) were weighed over committed ` +
        'inputs alone, the font files a theme ships and, with nothing built, the stylesheet beside ' +
        'them: gated here as always, and answering for no build',
    });
  }

  const unweighed = readingIsEmpty(reading);
  if (unweighed) {
    findings.push({ level: 'error', message: emptyReadingMessage(reading) });
  }

  if (exceptions.length === 0) {
    const historyIssues = checkExceptionHistory(history, exceptions, SPEC_20_BUDGET_IDS);
    const over = overBudgetIds(report);

    return {
      id: budgetExceptionsGate.id,
      title: budgetExceptionsGate.title,
      status: historyIssues.length === 0 && !unweighed ? 'pass' : 'fail',
      findings: [
        ...findings,
        ...historyIssues.map((issue) => ({
          level: 'error' as const,
          message: `[${issue.rule}] ${issue.message}`,
        })),
        // AN OVER BUDGET WITH NO ENTRY IS SAID HERE AND FAILED NEXT DOOR. The sentence below used
        // to read "every SPEC 20 budget is inside its limit" over budgets nobody had weighed, and
        // now that they are weighed it must not say that while one is over. It is a warning and
        // not an error because `budgets` already fails on the same measurement, and one cause
        // turning two gates red is how a reader learns to skip one of them.
        ...over.map((id) => ({
          level: 'warning' as const,
          message: `${id} is over its SPEC 20 limit and no entry here owns it. The budgets gate fails on it; either it is fixed, or it is excepted here with an owner and a milestone`,
        })),
        {
          level: 'info',
          message:
            over.length === 0
              ? `no budget is excepted: every one of the ${String(report.measuredCount)} weighed budgets is inside its limit`
              : `no budget is excepted, and ${String(over.length)} of the ${String(report.measuredCount)} weighed budgets is over: ${over.join(', ')}`,
        },
        ...closed,
      ],
    };
  }

  // THE LIST CANNOT BE VALIDATED WITHOUT THE PLAN, AND AN UNVALIDATED EXCEPTION IS A RAISED
  // THRESHOLD. Owners and milestones are read out of BUILD.md and the amendments, both of
  // which live in `ai-docs/`. Where that is absent this gate reports what it could not check
  // rather than waving the entries through, and the budgets gate goes on printing them.
  //
  // THE HALF THAT NEEDS NO PLAN STILL RUNS HERE, and it did not until 2026-08-11. The history
  // is checked against the live list and against SPEC 20's budget ids, neither of which is in
  // `ai-docs/`, so skipping it was skipping a check that had everything it needed. It was
  // invisible for as long as the live list was empty, because the branch above returns first,
  // and the first entry written since made it reachable. A history problem fails here rather
  // than being reported as a skip: what could not be checked is the terms, not the record.
  if (!aiDocsPresent(context.repoRoot)) {
    const historyIssues = checkExceptionHistory(history, exceptions, SPEC_20_BUDGET_IDS);

    return {
      id: budgetExceptionsGate.id,
      title: budgetExceptionsGate.title,
      ...(historyIssues.length === 0
        ? { status: 'skip' as const, skipReason: 'ai-docs-absent' as const }
        : { status: 'fail' as const }),
      findings: [
        ...historyIssues.map((issue) => ({
          level: 'error' as const,
          message: `[${issue.rule}] ${issue.message}`,
        })),
        {
          level: 'warning',
          message: aiDocsAbsentMessage(budgetExceptionsGate.title, [
            BUILD_FILE,
            BUILD_AMENDMENTS_FILE,
          ]),
        },
        ...exceptions.map((entry) => ({
          level: 'warning' as const,
          message: `UNVALIDATED ${describeException(entry)}`,
        })),
        ...closed,
      ],
    };
  }

  const build = readFileSync(join(context.repoRoot, BUILD_FILE), 'utf8');
  const amendmentsPath = join(context.repoRoot, BUILD_AMENDMENTS_FILE);
  const amendments = existsSync(amendmentsPath) ? readFileSync(amendmentsPath, 'utf8') : '';
  const lines = splitLines(build);

  const issues = checkBudgetExceptions(exceptions, {
    budgetIds: SPEC_20_BUDGET_IDS,
    // The browser-measured set: a live entry over one of these cites the committed record,
    // and the record does not move with the tree, so the entry has to carry the commit its
    // figure was taken at.
    recordedBudgetIds: BASELINE_ANSWERED_BUDGET_IDS,
    overBudgetIds: overBudgetIds(report),
    taskIds: planTaskIds(build, amendments),
    milestones: parseMilestones(lines),
    history,
  });

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  for (const entry of exceptions) {
    findings.push({ level: 'warning', message: `EXCEPTED ${describeException(entry)}` });
  }

  findings.push(...closed);

  return {
    id: budgetExceptionsGate.id,
    title: budgetExceptionsGate.title,
    status: issues.length === 0 && !unweighed ? 'pass' : 'fail',
    findings,
  };
}

export const budgetExceptionsGate: Gate = {
  id: 'budget-exceptions',
  title: 'Every budget that is over has an owner and an expiry',

  run(context): Promise<GateResult> {
    return Promise.resolve(
      runBudgetExceptionsGate(context, BUDGET_EXCEPTIONS, BUDGET_EXCEPTION_HISTORY),
    );
  },
};

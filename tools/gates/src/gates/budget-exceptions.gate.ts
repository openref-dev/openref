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
import { parseMilestones, planTaskIds, splitLines } from '../lib/build-manifest.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

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
 */
export const budgetExceptionsGate: Gate = {
  id: 'budget-exceptions',
  title: 'Every budget that is over has an owner and an expiry',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];

    // THE CLOSED ENTRIES ARE CHECKED WHETHER OR NOT ANYTHING IS LIVE, and that ordering is the
    // point rather than a detail: the day the last live entry goes away is exactly the day this
    // gate would otherwise stop reading the record of what used to be here.
    const closed = BUDGET_EXCEPTION_HISTORY.map((entry) => ({
      level: 'info' as const,
      message: `CLOSED ${describeClosedException(entry)}`,
    }));

    if (BUDGET_EXCEPTIONS.length === 0) {
      const historyIssues = checkExceptionHistory(
        BUDGET_EXCEPTION_HISTORY,
        BUDGET_EXCEPTIONS,
        SPEC_20_BUDGET_IDS,
      );

      return Promise.resolve({
        id: budgetExceptionsGate.id,
        title: budgetExceptionsGate.title,
        status: historyIssues.length === 0 ? 'pass' : 'fail',
        findings: [
          ...historyIssues.map((issue) => ({
            level: 'error' as const,
            message: `[${issue.rule}] ${issue.message}`,
          })),
          {
            level: 'info',
            message: 'no budget is excepted: every SPEC 20 budget is inside its limit',
          },
          ...closed,
        ],
      });
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
      const historyIssues = checkExceptionHistory(
        BUDGET_EXCEPTION_HISTORY,
        BUDGET_EXCEPTIONS,
        SPEC_20_BUDGET_IDS,
      );

      return Promise.resolve({
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
          ...BUDGET_EXCEPTIONS.map((entry) => ({
            level: 'warning' as const,
            message: `UNVALIDATED ${describeException(entry)}`,
          })),
          ...closed,
        ],
      });
    }

    const build = readFileSync(join(context.repoRoot, BUILD_FILE), 'utf8');
    const amendmentsPath = join(context.repoRoot, BUILD_AMENDMENTS_FILE);
    const amendments = existsSync(amendmentsPath) ? readFileSync(amendmentsPath, 'utf8') : '';
    const lines = splitLines(build);

    const issues = checkBudgetExceptions(BUDGET_EXCEPTIONS, {
      budgetIds: SPEC_20_BUDGET_IDS,
      // The browser-measured set: a live entry over one of these cites the committed record,
      // and the record does not move with the tree, so the entry has to carry the commit its
      // figure was taken at.
      recordedBudgetIds: BASELINE_ANSWERED_BUDGET_IDS,
      overBudgetIds: overBudgetIds(collectBudgetOutcomes(context.repoRoot)),
      taskIds: planTaskIds(build, amendments),
      milestones: parseMilestones(lines),
      history: BUDGET_EXCEPTION_HISTORY,
    });

    for (const issue of issues) {
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    for (const entry of BUDGET_EXCEPTIONS) {
      findings.push({ level: 'warning', message: `EXCEPTED ${describeException(entry)}` });
    }

    findings.push(...closed);

    return Promise.resolve({
      id: budgetExceptionsGate.id,
      title: budgetExceptionsGate.title,
      status: issues.length === 0 ? 'pass' : 'fail',
      findings,
    });
  },
};

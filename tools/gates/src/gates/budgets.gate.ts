import { BUDGET_EXCEPTIONS } from '../config.js';
import { collectBudgetOutcomes, type BudgetOutcome } from '../lib/budget-report.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Checks the size budgets from SPEC 20 against built artifacts.
 *
 * A budget whose artifacts do not exist yet is reported as skipped, naming the task that
 * will produce them. A skip is printed on every run so that an unbuilt bundle can never
 * read as a passing budget.
 *
 * The three font budgets are per theme, per SPEC 20, and measured over the theme's own font
 * directory: what the first paint waits for, what a latin reader downloads across a session,
 * and what the package weighs. Gzip of a woff2 is a fraction of a percent larger than the file,
 * because woff2 is already brotli compressed and a server must not compress it again, so these
 * three effectively bound the raw bytes and do it in the unfavourable direction.
 *
 * A BUDGET ON THE EXCEPTION LIST IS STILL OVER AND STILL SAYS SO. It is printed on every run,
 * with the figure, the target, the tasks that own the fix and the milestone it must clear by,
 * and it does not stop the build. The threshold does not move. Whether the entry is allowed to
 * be there at all is the `budget-exceptions` gate's question, and that gate fails on an entry
 * with no owner, an expired one, or one whose budget is no longer over.
 */
export const budgetsGate: Gate = {
  id: 'budgets',
  title: 'Size budgets',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const report = collectBudgetOutcomes(context.repoRoot);
    const excepted = new Map(BUDGET_EXCEPTIONS.map((entry) => [entry.budget, entry]));
    let failed = false;

    const emit = (outcome: BudgetOutcome): void => {
      if (outcome.status === 'over') {
        const entry = excepted.get(outcome.id);
        const prefix = outcome.source === 'recorded' ? 'OVER BUDGET' : 'OVER';

        if (entry === undefined) {
          failed = true;
          findings.push({ level: 'error', message: `${prefix} ${outcome.message}` });
          return;
        }

        // The figure and the terms, not the whole diagnosis: that is printed once, by the gate
        // that owns the list, and printing it twice trains a reader to skip both.
        findings.push({
          level: 'warning',
          message:
            `${prefix}, EXCEPTED ${outcome.message}. Owned by ${entry.owners.join(', ')}, ` +
            `must clear by ${entry.clearBy}, see the budget-exceptions gate`,
        });
        return;
      }

      if (outcome.status === 'skip') {
        findings.push({ level: 'info', message: `SKIP ${outcome.message}` });
        return;
      }

      if (outcome.status === 'not-measured') {
        findings.push({ level: 'info', message: `NOT MEASURED HERE ${outcome.message}` });
        return;
      }

      findings.push({
        level: 'info',
        message: `${outcome.source === 'recorded' ? 'MEASURED' : 'OK'} ${outcome.message}`,
      });
    };

    for (const outcome of report.outcomes.filter((item) => item.source === 'artifact'))
      emit(outcome);

    for (const error of report.errors) {
      failed = true;
      findings.push({ level: 'error', message: error });
    }

    for (const note of report.notes) findings.push({ level: 'info', message: note });

    // A stale baseline does not stop the build and must not read as information either; the
    // reasoning, and the reason there is no failing distance, is on `baselineFreshness`.
    for (const warning of report.warnings) findings.push({ level: 'warning', message: warning });

    for (const outcome of report.outcomes.filter((item) => item.source === 'recorded'))
      emit(outcome);

    // NOTHING BUILT IS NOT EVERY BUDGET INSIDE ITS LIMIT, and until the pre-M4 review this line
    // asked the wrong count. `measuredCount` includes budgets weighed over committed inputs, which
    // on this tree is three of them: the two font budgets and `theme-css`, whose roots reach
    // `packages/theme/fonts`. So it never reaches zero, and a tree with the client bundle removed,
    // or with every `dist` removed, printed twelve `SKIP` lines and returned `pass`. Measured on a
    // mirror of this repository with the build taken away, twice.
    //
    // IT WAS FOUR UNTIL 2026-08-31, AND THE FOURTH WAS THE DEFECT ITSELF. `theme-css-raw` weighed
    // the one committed `fonts.css` on a tree with nothing built and printed `OK theme-css-raw:
    // 4.1 KB raw of 61.0 KB across 1 file(s)`, silent about the two stylesheets that were not
    // there at all. It now weighs the published form, so on that tree it fails naming the client
    // bundle it could not read. Measured A/B on one copy: six gates fail there where five did,
    // and `budget-exceptions` reads three committed budgets where it read four. See SPEC 20.
    //
    // `builtCount` is the figure that answers the question the comment above always claimed to
    // ask, and it was added at `T042` for the debt gate and not wired into the gate that owns the
    // measurement. A budget weighed over a committed input is still weighed and still gated; what
    // it may not do is stand in for a build.
    const status = failed ? 'fail' : report.builtCount === 0 ? 'skip' : 'pass';

    return Promise.resolve({
      id: budgetsGate.id,
      title: budgetsGate.title,
      status,
      ...(status === 'skip' ? { skipReason: 'artifact-absent' as const } : {}),
      findings,
    });
  },
};

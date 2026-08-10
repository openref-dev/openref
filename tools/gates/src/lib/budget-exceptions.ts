/**
 * Budgets that are over, with a name on the debt and a date it has to be gone.
 *
 * THE THRESHOLD IS NEVER THE THING THAT MOVES. A budget owned by one task and only fixable in
 * two others blocks every task behind it on a defect that is not its own, and the two ways out
 * of that are both wrong on their own: raising the number hides the cost, and leaving the build
 * red stops the plan. What this does instead is keep the number, keep the failure visible on
 * every run, and let the work continue while the debt carries an owner and an expiry.
 *
 * AN EXCEPTION THAT CANNOT EXPIRE IS A RAISED THRESHOLD WEARING A DIFFERENT HAT, which is why
 * every rule below exists. An entry names the figure it was recorded at, the target it misses,
 * the tasks that own the fix and the milestone it must clear by. An entry with no owner, an
 * owner that is not a real task, a milestone that closes while it is still there, or a budget
 * that is not actually over any more is a failure of this check, not a quiet pass.
 *
 * THE TWO GATES ARE SPLIT ON PURPOSE. The budgets gate prints the figure and does not fail on a
 * budget that has an entry; this is what decides whether the entry may be there at all. A broken
 * excuse therefore stops the build here rather than being argued about twice, and the number the
 * reader sees is the same number either way.
 */

import type { BuildMilestone } from './build-manifest.js';

/** One budget that is over, and the terms on which it is allowed to be. */
export interface BudgetException {
  /** The budget id this covers, as SPEC 20 and the gates name it. */
  readonly budget: string;
  /** The figure measured when the entry was written, in the budget's own units. */
  readonly measured: string;
  /** The target it misses. */
  readonly target: string;
  /** Tasks that own the fix. Every one must be a task the plan carries. */
  readonly owners: readonly string[];
  /** Milestone by which this must be gone. The milestone cannot close while it is here. */
  readonly clearBy: string;
  /** When the entry was written. */
  readonly recordedAt: string;
  /** Why the budget is over, measured rather than supposed. */
  readonly diagnosis: string;
}

/** One problem with the exception list. */
export interface BudgetExceptionIssue {
  readonly rule: string;
  readonly budget: string;
  readonly message: string;
}

/** An entry that is no longer live, kept with how it ended. */
export interface ClosedException extends BudgetException {
  readonly closedAt: string;
  readonly closedBecause: string;
}

/** What the list is checked against. */
export interface BudgetExceptionContext {
  /** Every budget id SPEC 20 sets. */
  readonly budgetIds: readonly string[];
  /** The budget ids that are over right now, measured this run. */
  readonly overBudgetIds: readonly string[];
  /** Every task id the plan carries, from BUILD.md and from the amendments. */
  readonly taskIds: readonly string[];
  /** The milestones of BUILD.md with their tasks, for the expiry check. */
  readonly milestones: readonly BuildMilestone[];
  /** Entries that have been closed, checked so the record cannot rot into decoration. */
  readonly history?: readonly ClosedException[];
}

/**
 * Checks the record of closed exceptions.
 *
 * A HISTORY THAT IS NOT CHECKED IS A COMMENT. The rules are the smallest set that keeps it a
 * record: an entry cannot be closed and live at once, because then which terms apply is a
 * guess; it has to say when and why it closed, because "it went away" is what a deleted entry
 * already says; and it has to name a budget SPEC 20 still sets, because a closed entry for a
 * budget that no longer exists is a note about a number nobody can look up.
 *
 * @param history - The closed entries
 * @param live - The entries that are still open
 * @param budgetIds - Every budget id SPEC 20 sets
 * @returns Every problem found
 */
export function checkExceptionHistory(
  history: readonly ClosedException[],
  live: readonly BudgetException[],
  budgetIds: readonly string[],
): BudgetExceptionIssue[] {
  const issues: BudgetExceptionIssue[] = [];
  const open = new Set(live.map((entry) => entry.budget));
  const ids = new Set(budgetIds);

  for (const entry of history) {
    const add = (rule: string, message: string): void => {
      issues.push({ rule, budget: entry.budget, message });
    };

    if (open.has(entry.budget)) {
      add(
        'closed-and-live',
        `${entry.budget} is recorded as closed on ${entry.closedAt} and is also on the live list, so which terms apply is a guess`,
      );
    }

    if (entry.closedBecause.trim().length === 0 || entry.closedAt.trim().length === 0) {
      add(
        'closed-without-reason',
        `${entry.budget} was closed without saying when or why. A closed entry that says nothing is a deleted entry with extra steps`,
      );
    }

    if (!ids.has(entry.budget)) {
      add(
        'closed-unknown-budget',
        `${entry.budget} was closed and is not a budget SPEC 20 sets any more, so the record points at nothing a reader can look up`,
      );
    }
  }

  return issues;
}

/**
 * Checks the exception list against the plan and against this run's measurements.
 *
 * @param exceptions - The committed list
 * @param context - Budget ids, what is over, the plan's task ids and its milestones
 * @returns Every problem found, empty when the list is sound
 */
export function checkBudgetExceptions(
  exceptions: readonly BudgetException[],
  context: BudgetExceptionContext,
): BudgetExceptionIssue[] {
  const issues: BudgetExceptionIssue[] = [
    ...checkExceptionHistory(context.history ?? [], exceptions, context.budgetIds),
  ];
  const budgetIds = new Set(context.budgetIds);
  const over = new Set(context.overBudgetIds);
  const taskIds = new Set(context.taskIds);
  const seen = new Set<string>();

  for (const entry of exceptions) {
    const add = (rule: string, message: string): void => {
      issues.push({ rule, budget: entry.budget, message });
    };

    if (seen.has(entry.budget)) {
      add('duplicate', `${entry.budget} has more than one entry, so which terms apply is a guess`);
    }
    seen.add(entry.budget);

    if (!budgetIds.has(entry.budget)) {
      add(
        'unknown-budget',
        `${entry.budget} is not a budget SPEC 20 sets, so this entry excuses nothing and hides a typo`,
      );
      continue;
    }

    for (const [field, value] of [
      ['measured', entry.measured],
      ['target', entry.target],
      ['recordedAt', entry.recordedAt],
      ['diagnosis', entry.diagnosis],
    ] as const) {
      if (value.trim().length > 0) continue;
      add(
        'incomplete',
        `${entry.budget} has no ${field}. An entry that says nothing is a raised threshold`,
      );
    }

    if (entry.owners.length === 0) {
      add(
        'no-owner',
        `${entry.budget} names no task that owns the fix, so nothing will come back to it`,
      );
    }

    for (const owner of entry.owners) {
      if (taskIds.has(owner)) continue;
      add(
        'unknown-owner',
        `${entry.budget} is owned by ${owner}, which is not a task in BUILD.md or in the amendments`,
      );
    }

    const milestone = context.milestones.find((candidate) => candidate.id === entry.clearBy);

    if (milestone === undefined) {
      add(
        'unknown-milestone',
        `${entry.budget} clears by ${entry.clearBy}, which is not a milestone in BUILD.md, so it has no expiry`,
      );
    } else if (milestone.tasks.every((task) => task.done)) {
      add(
        'milestone-closed',
        `${entry.budget} had to clear by ${milestone.label}, and every task of that milestone is ticked while it is still here. ` +
          `The milestone is not done: ${entry.measured} against ${entry.target}, owned by ${entry.owners.join(', ')}`,
      );
    }

    if (!over.has(entry.budget)) {
      add(
        'stale',
        `${entry.budget} is inside its budget now, so this entry records a debt that is paid. A stale entry is not coverage: remove it`,
      );
    }
  }

  return issues;
}

/**
 * One line describing an entry, printed on every run so the debt is never out of sight.
 *
 * @param entry - The exception
 * @returns A single line naming the figure, the target, the owners and the expiry
 */
export function describeException(entry: BudgetException): string {
  return (
    `${entry.budget}: ${entry.measured} against ${entry.target}, owned by ${entry.owners.join(', ')}, ` +
    `must clear by ${entry.clearBy}, recorded ${entry.recordedAt}. ${entry.diagnosis}`
  );
}

/**
 * One line describing a closed entry, printed so a debt that ended is as visible as one that
 * stands.
 *
 * @param entry - The closed exception
 * @returns A single line naming the figure it was recorded at and why it closed
 */
export function describeClosedException(entry: ClosedException): string {
  return (
    `${entry.budget}: ${entry.measured} against ${entry.target}, recorded ${entry.recordedAt}, ` +
    `closed ${entry.closedAt}. ${entry.closedBecause}`
  );
}

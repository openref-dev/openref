import { describe, expect, it } from 'vitest';
import { BUDGET_EXCEPTIONS, SPEC_20_BUDGET_IDS } from '../../src/config';
import {
  checkBudgetExceptions,
  describeException,
  type BudgetException,
  type BudgetExceptionContext,
} from '../../src/lib/budget-exceptions';
import type { BuildMilestone } from '../../src/lib/build-manifest';

/**
 * A milestone with one task, ticked or not, which is what expiry is judged against.
 *
 * @param id - Milestone id
 * @param done - Whether its only task is ticked
 * @returns The milestone
 */
function milestone(id: string, done: boolean): BuildMilestone {
  return {
    id,
    label: `${id} - PLANTED`,
    tasks: [{ id: 'T001', done, startLine: 1, endLine: 2, title: 'planted' }],
  };
}

const SOUND: BudgetException = {
  budget: 'tti',
  measured: '213.9 ms',
  target: '150 ms',
  owners: ['T011-R'],
  clearBy: 'M0',
  recordedAt: '2026-08-10',
  diagnosis: 'the bundle and the stylesheet, measured',
};

/**
 * A context in which the entry above is sound, so each case below changes exactly one thing.
 *
 * @param overrides - What this case changes
 * @returns The context
 */
function context(overrides: Partial<BudgetExceptionContext> = {}): BudgetExceptionContext {
  return {
    budgetIds: ['tti', 'theme-css'],
    overBudgetIds: ['tti'],
    taskIds: ['T011-R', 'T012-R3'],
    milestones: [milestone('M0', false)],
    ...overrides,
  };
}

describe('checkBudgetExceptions', () => {
  it('should accept an entry that names a budget that is over, an owner and an open milestone', () => {
    // Given
    const exceptions = [SOUND];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues).toEqual([]);
  });

  it('should refuse an entry that names no task, because nothing will come back to it', () => {
    // Given
    const exceptions = [{ ...SOUND, owners: [] }];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['no-owner']);
  });

  it('should refuse an owner that is not a task the plan carries', () => {
    // Given, a task id that was invented rather than filed reads exactly like one that was.
    const exceptions = [{ ...SOUND, owners: ['T999-R'] }];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unknown-owner']);
    expect(issues[0]?.message).toContain('T999-R');
  });

  it('should refuse a milestone BUILD.md does not have, because it is then no expiry at all', () => {
    // Given
    const exceptions = [{ ...SOUND, clearBy: 'M9' }];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unknown-milestone']);
  });

  it('should fail when the milestone closes while the entry is still there', () => {
    // Given, every task of M0 ticked with the debt outstanding. This is the rule that makes the
    // expiry real: a milestone cannot be declared done over a budget it never met.
    const exceptions = [SOUND];

    // When
    const issues = checkBudgetExceptions(
      exceptions,
      context({ milestones: [milestone('M0', true)] }),
    );

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['milestone-closed']);
    expect(issues[0]?.message).toContain('T011-R');
  });

  it('should fail on an entry whose budget is inside its limit again', () => {
    // Given, the fix landed and the entry stayed. A stale entry is not coverage, it is a debt
    // recorded as unpaid after it was paid, and it hides the next real one.
    const exceptions = [SOUND];

    // When
    const issues = checkBudgetExceptions(exceptions, context({ overBudgetIds: [] }));

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['stale']);
  });

  it('should refuse a budget id SPEC 20 does not set, rather than excusing a typo', () => {
    // Given
    const exceptions = [{ ...SOUND, budget: 'ttl' }];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['unknown-budget']);
  });

  it('should refuse two entries for one budget, since which terms apply would be a guess', () => {
    // Given
    const exceptions = [SOUND, { ...SOUND, target: '300 ms' }];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['duplicate']);
  });

  it('should refuse an entry with no figure, no target or no diagnosis', () => {
    // Given, an entry that says nothing is a raised threshold with a comment on it.
    const exceptions = [{ ...SOUND, measured: '', target: ' ', diagnosis: '' }];

    // When
    const issues = checkBudgetExceptions(exceptions, context());

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['incomplete', 'incomplete', 'incomplete']);
  });
});

describe('the committed exception list', () => {
  it('should name only budgets SPEC 20 sets', () => {
    // Given
    const ids = new Set(SPEC_20_BUDGET_IDS);

    // When
    const unknown = BUDGET_EXCEPTIONS.filter((entry) => !ids.has(entry.budget));

    // Then
    expect(unknown).toEqual([]);
  });

  it('should hold exactly the debt the browser study recorded, and no budget that passes', () => {
    // Given, the list was asked to cover `tti` and the served document. The served document
    // measures 29.0 KB against 64 KB, so an entry for it would record a debt that does not
    // exist and the staleness rule would fail the build for saying so.
    const budgets = BUDGET_EXCEPTIONS.map((entry) => entry.budget);

    // When
    const servedDocument = budgets.includes('served-document');

    // Then
    expect(budgets).toEqual(['tti']);
    expect(servedDocument).toBe(false);
  });

  it('should describe an entry with its figure, its owners and its expiry on one line', () => {
    // Given
    const entry = BUDGET_EXCEPTIONS[0];

    // When
    const line = entry === undefined ? '' : describeException(entry);

    // Then
    expect(line).toContain('213.9 ms');
    expect(line).toContain('150 ms');
    expect(line).toContain('T011-R');
    expect(line).toContain('must clear by M0');
  });
});

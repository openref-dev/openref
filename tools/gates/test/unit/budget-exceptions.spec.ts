import { describe, expect, it } from 'vitest';
import { BUDGET_EXCEPTIONS, BUDGET_EXCEPTION_HISTORY, SPEC_20_BUDGET_IDS } from '../../src/config';
import {
  checkBudgetExceptions,
  checkExceptionHistory,
  describeClosedException,
  describeException,
  type BudgetException,
  type BudgetExceptionContext,
  type ClosedException,
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

const CLOSED: ClosedException = {
  ...SOUND,
  closedAt: '2026-08-10',
  closedBecause: 'the budget it excused is no longer gated',
};

describe('checkExceptionHistory', () => {
  it('should accept a closed entry that names when and why', () => {
    // Given
    // When
    // Then
    expect(checkExceptionHistory([CLOSED], [], ['tti'])).toEqual([]);
  });

  it('should refuse an entry that is closed and live at once', () => {
    // Given, because then which terms apply is a guess
    // When
    const issues = checkExceptionHistory([CLOSED], [SOUND], ['tti']);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['closed-and-live']);
  });

  it('should refuse a closure with no reason and no date', () => {
    // Given, because a closed entry that says nothing is a deleted entry with extra steps, and
    // the whole point of keeping it is telling a debt that was paid from one somebody stopped
    // counting
    const empty = [
      { ...CLOSED, closedBecause: '   ' },
      { ...CLOSED, closedAt: '' },
    ];

    // When
    const issues = checkExceptionHistory(empty, [], ['tti']);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual([
      'closed-without-reason',
      'closed-without-reason',
    ]);
  });

  it('should refuse a closed entry for a budget SPEC 20 no longer sets', () => {
    // Given a budget renamed out from under the record
    // When
    const issues = checkExceptionHistory([CLOSED], [], ['theme-css']);

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['closed-unknown-budget']);
  });

  it('should be checked by the main entry point, so an empty live list is not an unread record', () => {
    // Given, the day the last live entry goes away is exactly the day the history would
    // otherwise stop being read
    // When
    const issues = checkBudgetExceptions([], {
      ...context(),
      history: [{ ...CLOSED, closedAt: '' }],
    });

    // Then
    expect(issues.map((issue) => issue.rule)).toEqual(['closed-without-reason']);
  });
});

describe('the committed exception list', () => {
  it('should name only budgets SPEC 20 sets, live and closed alike', () => {
    // Given
    const ids = new Set(SPEC_20_BUDGET_IDS);

    // When
    const unknown = [...BUDGET_EXCEPTIONS, ...BUDGET_EXCEPTION_HISTORY].filter(
      (entry) => !ids.has(entry.budget),
    );

    // Then
    expect(unknown).toEqual([]);
  });

  it('should hold one live entry and the two that closed, and confuse none for another', () => {
    // Given three entries ended or living differently. `tti` was the first and it closed on
    // 2026-08-10 because SPEC 20 stopped gating elapsed time, which is neither a debt paid nor
    // a debt dropped, and the record is what keeps those three apart. `page-bytes` is the
    // second, live since 2026-08-11: T020 through T023 took the page to 199,612 bytes against
    // 198,656 on the same input, so the cap stayed and the debt got a name. `client-js-raw`
    // was the third, filed at TX-GUTTER on 2026-08-14 and CLOSED the same day by TX-ADOPT
    // paying 10,314 raw bytes and the cap being re-derived from the artefact that remains,
    // which is the third kind of ending: paid by the payer the entry named. The served
    // document was named alongside `tti` when the list was first asked for and has never
    // entered either, because listing a budget that passes records a debt that does not exist.
    const live = BUDGET_EXCEPTIONS.map((entry) => entry.budget);
    const closed = BUDGET_EXCEPTION_HISTORY.map((entry) => entry.budget);

    // When
    const servedDocument = [...live, ...closed].includes('served-document');
    const pageBytes = BUDGET_EXCEPTIONS.find((entry) => entry.budget === 'page-bytes');
    const clientJs = BUDGET_EXCEPTION_HISTORY.find((entry) => entry.budget === 'client-js-raw');

    // Then
    expect(live).toEqual(['page-bytes']);
    expect(closed).toEqual(['tti', 'client-js-raw']);
    expect(servedDocument).toBe(false);

    // And the terms, which are what make it an exception rather than a raised threshold. The
    // owner is a task the plan carries and the expiry is a milestone that has not closed, both
    // of which `checkBudgetExceptions` enforces against the real files; what is pinned here is
    // that they are the ones the maintainer decided on, and that the closed entry still names
    // the payer that paid it.
    expect(pageBytes?.owners).toEqual(['T012-R4']);
    expect(pageBytes?.clearBy).toBe('M2');
    expect(clientJs?.owners).toEqual(['TX-ADOPT']);
    expect(clientJs?.closedBecause).toContain('10,314');
  });

  it('should say in the entry itself that the six marks are not what pays it back', () => {
    // Given the failure mode this entry is one step away from: 1,224 of the 1,716 bytes the
    // stylesheet grew are the six rules that give provenance and severity an edge style, so the
    // cheapest kilobyte on the page is the one that makes the levels of SPEC 6.1 and SPEC 7.2
    // legible with no colour seen at all. An entry that recorded only the number would read to
    // the next person as an instruction to find bytes wherever they are cheapest.
    const entry = BUDGET_EXCEPTIONS.find((budget) => budget.budget === 'page-bytes');

    // When
    const line = entry === undefined ? '' : describeException(entry);

    // Then
    expect(line).toContain('1,224');
    expect(line).toContain('not an instruction to delete them');
  });

  it('should describe the closed entry with its figure and the reason it ended', () => {
    // Given
    const entry = BUDGET_EXCEPTION_HISTORY[0];

    // When
    const line = entry === undefined ? '' : describeClosedException(entry);

    // Then
    expect(line).toContain('213.9 ms');
    expect(line).toContain('150 ms');
    expect(line).toContain('closed 2026-08-10');
    expect(line).toContain('NO LONGER EXISTS IN GATED FORM');
  });

  it('should still describe a live entry with its owners and its expiry, for the next one', () => {
    // Given, the list is empty today and the format is what a future entry is printed with
    // When
    const line = describeException(SOUND);

    // Then
    expect(line).toContain('T011-R');
    expect(line).toContain('must clear by M0');
  });
});

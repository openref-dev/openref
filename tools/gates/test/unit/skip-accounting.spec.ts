import { describe, expect, it } from 'vitest';
import { accountForSkips, SKIP_REASONS, skipAccountingFailed } from '../../src/lib/skip-accounting';
import { GATES } from '../../src/run';
import type { GateResult, SkipReasonId } from '../../src/types';

/** A result of the shape a gate returns, with only the fields the accounting reads. */
function result(id: string, status: GateResult['status'], skipReason?: SkipReasonId): GateResult {
  return {
    id,
    title: id,
    status,
    findings: [],
    ...(skipReason === undefined ? {} : { skipReason }),
  };
}

const WITHOUT_DOCS = { aiDocsPresent: false };
const WITH_DOCS = { aiDocsPresent: true };

/** The three readers that cannot run without the documents, all skipping as they should. */
const FORCED_SKIPS = [
  result('build-manifest', 'skip', 'ai-docs-absent'),
  result('claims', 'skip', 'ai-docs-absent'),
  result('theme-motion', 'skip', 'ai-docs-absent'),
];

describe('accountForSkips', () => {
  it('should be silent about a run where nothing skipped', () => {
    // Given
    const results = [result('licenses', 'pass'), result('csp', 'pass')];

    // When
    const findings = accountForSkips(results, WITH_DOCS);

    // Then
    expect(findings).toEqual([]);
    expect(skipAccountingFailed(findings)).toBe(false);
  });

  it('should accept the three readers skipping on a checkout with no documents', () => {
    // Given, which is every clone of this repository and therefore every CI run
    // When
    const findings = accountForSkips(FORCED_SKIPS, WITHOUT_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(false);
    expect(findings.map((finding) => finding.level)).toEqual(['info', 'info', 'info']);
    expect(findings[0]?.message).toContain('UNVALIDATED build-manifest');
    expect(findings[0]?.message).toContain('ai-docs-absent');
  });

  it('should fail a skip that names no reason at all', () => {
    // Given a gate written to skip without saying why, which the compiler admits
    const results = [result('csp', 'skip')];

    // When
    const findings = accountForSkips(results, WITH_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(true);
    expect(findings[0]?.message).toContain('named no reason');
  });

  it('should fail a gate that cites absent documents on a checkout that has them', () => {
    // Given, THE CASE THIS EXISTS FOR: a skip for the right reason and a skip for a wrong one
    // print identically, so the cause is tested rather than trusted
    const results = [result('claims', 'skip', 'ai-docs-absent')];

    // When
    const findings = accountForSkips(results, WITH_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(true);
    expect(findings[0]?.message).toContain('HAS ai-docs/');
  });

  it('should fail a gate naming a reason that was not declared for it', () => {
    // Given a literal copied from one gate into another, which is how a reason spreads
    const results = [result('licenses', 'skip', 'ai-docs-absent')];

    // When
    const findings = accountForSkips(results, WITH_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(true);
    expect(findings[0]?.message).toContain('declared for');
  });

  it('should fail a reader that passed while the documents it reads are absent', () => {
    // Given the failure the whole mechanism is against: an absence coming out as coverage
    const results = [
      result('build-manifest', 'pass'),
      result('claims', 'skip', 'ai-docs-absent'),
      result('theme-motion', 'skip', 'ai-docs-absent'),
    ];

    // When
    const findings = accountForSkips(results, WITHOUT_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(true);
    expect(
      findings.some((finding) => finding.message.includes('build-manifest reported pass')),
    ).toBe(true);
  });

  it('should say nothing about a forced reader that did not run in this selection', () => {
    // Given `pnpm gates licenses`, which runs one gate and must not be judged for the thirteen
    // it did not run
    const results = [result('licenses', 'pass')];

    // When
    const findings = accountForSkips(results, WITHOUT_DOCS);

    // Then
    expect(findings).toEqual([]);
  });

  it('should let the conditional fourth reader pass with no documents present', () => {
    // Given, per its own gate: with an empty exception list there is no plan to validate, so it
    // checks the record of what closed and passes rather than skipping
    const results = [...FORCED_SKIPS, result('budget-exceptions', 'pass')];

    // When
    const findings = accountForSkips(results, WITHOUT_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(false);
  });

  it('should accept the same fourth reader skipping once the list is not empty', () => {
    // Given the state the next exception entry restores
    const results = [...FORCED_SKIPS, result('budget-exceptions', 'skip', 'ai-docs-absent')];

    // When
    const findings = accountForSkips(results, WITHOUT_DOCS);

    // Then
    expect(skipAccountingFailed(findings)).toBe(false);
    expect(findings).toHaveLength(4);
  });
});

describe('SKIP_REASONS', () => {
  it('should name only gates that exist, so a renamed gate cannot leave a reason behind', () => {
    // Given
    const known = new Set(GATES.map((gate) => gate.id));

    // When
    const named = SKIP_REASONS.flatMap((reason) => [...reason.permitted, ...reason.forced]);

    // Then
    expect(named.filter((id) => !known.has(id))).toEqual([]);
  });

  it('should force only gates it also permits', () => {
    // Given, since a gate required to skip for a cause it may not name would be red always
    // When
    const contradictions = SKIP_REASONS.flatMap((reason) =>
      reason.forced.filter((id) => !reason.permitted.includes(id)),
    );

    // Then
    expect(contradictions).toEqual([]);
  });
});

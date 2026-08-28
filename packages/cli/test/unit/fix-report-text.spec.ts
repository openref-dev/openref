import { describe, expect, it } from 'vitest';
import { renderFixSummary } from '../../src/cli/api/commands/fix-report-text';
import { decoratorFor } from '../../src/cli/domain/fix-plan';
import type { FixRun } from '../../src/cli/application/services/fix.service';
import type { PlannedEdit, SkippedFinding } from '../../src/cli/domain/fix-plan';

/**
 * The summary, which `ai-docs/REMEDIATION.md` section 4 calls the point of the whole mode.
 *
 * THE ASSERTIONS ARE ABOUT WHAT A READER CAN ACT ON. A run that fixed three of forty is useful
 * only if the other thirty seven are named with their reasons, so these tests check that every
 * skipped finding reaches the text and that the counts beside the reasons add up, rather than
 * snapshotting a shape nobody reads.
 */

/** One applied edit. */
function edit(): PlannedEdit {
  const decorator = decoratorFor({ kind: 'operation-id', operationId: 'list' });
  if (decorator === undefined) throw new Error('the fixture asked for an unwritable assertion');

  return {
    rule: 'missing-operation-id',
    code: 'DX030',
    confidence: 'declared',
    subject: 'GET /orders',
    file: 'src/orders.controller.ts',
    controller: 'OrdersController',
    handler: 'list',
    decorator,
  };
}

/** One skipped finding with the reason given. */
function skipped(overrides: Partial<SkippedFinding> = {}): SkippedFinding {
  return {
    rule: 'security-drift',
    code: 'RT010',
    subject: 'GET /orders',
    reason: 'contradiction',
    detail: 'neither side is known to be wrong',
    ...overrides,
  };
}

/** A run with the applied and skipped lists given. */
function runOf(overrides: Partial<FixRun> = {}): FixRun {
  return { applied: [], left: [], files: [], written: true, ...overrides };
}

describe('renderFixSummary', () => {
  it('should say what was applied, where, and at what confidence the fact behind it stood', () => {
    // Given
    const run = runOf({
      applied: [edit()],
      files: [{ file: 'src/orders.controller.ts', before: '', after: '' }],
    });

    // When
    const text = renderFixSummary(run);

    // Then
    expect(text).toContain('Applied 1 finding in 1 file.');
    expect(text).toContain("+ @ApiOperation({ operationId: 'list' })");
    expect(text).toContain('missing-operation-id, declared, src/orders.controller.ts');
  });

  it('should count every reason a finding was left, so the shape of the rest is visible at a glance', () => {
    // Given
    const run = runOf({
      left: [
        skipped(),
        skipped({ reason: 'manual', detail: 'confidence-starvation: inferred' }),
        skipped({ reason: 'manual', detail: 'no-observed-fact: nothing observed' }),
        skipped({ reason: 'unconfigured-mapping', detail: 'no mapping' }),
      ],
    });

    // When
    const text = renderFixSummary(run);

    // Then
    expect(text).toContain(
      'Left 4 findings alone: 1 contradiction, 2 manual, 1 unconfigured mapping.',
    );
  });

  it('should name every left finding individually, because a count alone is not something to act on', () => {
    // Given
    const run = runOf({
      left: [
        skipped({ subject: 'GET /a' }),
        skipped({ subject: 'GET /b', reason: 'existing-decorator', detail: 'already carries one' }),
      ],
    });

    // When
    const text = renderFixSummary(run);

    // Then
    expect(text).toContain('RT010  GET /a  [contradiction]');
    expect(text).toContain('RT010  GET /b  [existing decorator]');
    expect(text).toContain('already carries one');
  });

  it('should say nothing was written on a dry run, and say how to write it', () => {
    // Given
    const run = runOf({
      applied: [edit()],
      files: [{ file: 'src/orders.controller.ts', before: '', after: '' }],
      written: false,
    });

    // When
    const text = renderFixSummary(run);

    // Then
    expect(text).toContain('Would apply 1 finding in 1 file.');
    expect(text).toContain('Nothing was written. Run without --dry-run to apply these edits.');
  });

  it('should report a clean run as nothing applied rather than printing an empty block', () => {
    // Given
    const run = runOf();

    // When
    const text = renderFixSummary(run);

    // Then
    expect(text).toBe('Applied 0 findings in 0 files.');
  });
});

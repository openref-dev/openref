import { describe, expect, it } from 'vitest';
import { planFixes } from '../../src/cli/domain/fix-plan';
import type { IRDoctorFinding, IRDoctorReport, IRDriftClassification } from '@openref/core';

/**
 * The pure half of `doctor --fix`: what may be written, decided from the report and nothing else.
 *
 * EVERY CASE HERE IS A REFUSAL EXCEPT THE FIRST TWO, and that ratio is the design of SPEC 7.4
 * rather than an accident of the fixtures. A rewriter that writes a wrong edit is worse than no
 * rewriter, so the interesting question is never "does it apply the fix" but "what does it refuse
 * and does it say so", and a finding left with no named reason reads as an absence.
 */

/** Which optional fields a fixture wants absent, since `undefined` is not the same as absent. */
type Absent = 'source' | 'assertion';

/** One finding, with the fields a plan reads and defaults for the rest. */
function finding(
  overrides: Partial<IRDoctorFinding> = {},
  absent: readonly Absent[] = [],
): IRDoctorFinding {
  const base: IRDoctorFinding = {
    rule: 'missing-operation-id',
    code: 'DX030',
    severity: 'warning',
    classification: { bucket: 'silence' },
    confidence: 'declared',
    subject: 'GET /orders',
    message: 'no operationId',
    suggestion: "add @ApiOperation({ operationId: 'list' })",
    assertion: { kind: 'operation-id', operationId: 'list' },
    source: { controller: 'OrdersController', handler: 'list', file: 'src/orders.controller.ts' },
    ...overrides,
  };

  // AN ABSENT FIELD AND A FIELD SET TO `undefined` ARE DIFFERENT THINGS UNDER
  // `exactOptionalPropertyTypes`, and the planner reads absence, so the fixtures produce absence.
  const kept = Object.entries(base).filter(([key]) => !absent.includes(key as Absent));

  return Object.fromEntries(kept) as unknown as IRDoctorFinding;
}

/** A report carrying exactly the findings given, in the order given. */
function reportOf(findings: readonly IRDoctorFinding[]): IRDoctorReport {
  return { version: 1, score: 50, operationCount: 1, checks: [], findings };
}

describe('planFixes', () => {
  it('should turn a silence at declared confidence into the decorator its assertion names', () => {
    // Given
    const report = reportOf([finding()]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.skipped).toHaveLength(0);
    expect(plan.edits).toHaveLength(1);
    expect(plan.edits[0]?.decorator.text).toBe("@ApiOperation({ operationId: 'list' })");
    expect(plan.edits[0]?.decorator.importName).toBe('ApiOperation');
    expect(plan.edits[0]?.confidence).toBe('declared');
    expect(plan.edits[0]?.file).toBe('src/orders.controller.ts');
  });

  it('should write a rate limit response as a status and a description, both from the assertion', () => {
    // Given
    const report = reportOf([
      finding({
        rule: 'ratelimit-undocumented',
        code: 'RT030',
        confidence: 'derived',
        assertion: { kind: 'response-status', status: 429, description: 'Too Many Requests' },
      }),
    ]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits[0]?.decorator.text).toBe(
      "@ApiResponse({ status: 429, description: 'Too Many Requests' })",
    );
  });

  it('should leave a contradiction alone and say that is what it was', () => {
    // Given
    const report = reportOf([finding({ classification: { bucket: 'contradiction' } })]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('contradiction');
  });

  it('should name which kind of manual a manual finding is, since the three age differently', () => {
    // Given
    const reasons = ['structural-ambiguity', 'confidence-starvation', 'no-observed-fact'] as const;
    const report = reportOf(
      reasons.map((reason) =>
        finding({ classification: { bucket: 'manual', reason } as IRDriftClassification }),
      ),
    );

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.skipped.map((entry) => entry.reason)).toEqual(['manual', 'manual', 'manual']);
    for (const [index, reason] of reasons.entries()) {
      expect(plan.skipped[index]?.detail).toContain(reason);
    }
  });

  it('should report an inferred finding rather than omit it, because a silent skip reads as an absence', () => {
    // Given
    const report = reportOf([
      finding({
        classification: { bucket: 'manual', reason: 'confidence-starvation' },
        confidence: 'inferred',
      }),
    ]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]?.detail).toContain('inferred');
  });

  it('should call an unmapped guard an unconfigured mapping rather than a missing fact', () => {
    // Given
    const report = reportOf([
      finding({
        rule: 'security-drift',
        code: 'RT010',
        confidence: 'derived',
        assertion: { kind: 'unnameable', reason: 'unconfigured-mapping' },
      }),
    ]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('unconfigured-mapping');
    expect(plan.skipped[0]?.detail).toContain('guardSecuritySchemes');
  });

  it('should refuse a finding with no file to write to and say which half is missing', () => {
    // Given
    const noSource = finding({}, ['source']);
    const noFile = finding({ source: { controller: 'OrdersController', handler: 'list' } });
    const report = reportOf([noSource, noFile]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped.map((entry) => entry.reason)).toEqual([
      'no-source-location',
      'no-source-location',
    ]);
    expect(plan.skipped[0]?.detail).toContain('no source collector');
    expect(plan.skipped[1]?.detail).toContain('outside a repository');
  });

  it('should refuse a value it cannot write as a literal rather than escape it cleverly', () => {
    // Given
    const report = reportOf([
      finding({ assertion: { kind: 'operation-id', operationId: "list'); drop()" } }),
    ]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('no-mechanical-edit');
    expect(plan.skipped[0]?.detail).toContain('literal');
  });

  it('should refuse a fixable finding whose rule named no assertion, rather than invent one', () => {
    // Given
    const report = reportOf([
      finding(
        {
          rule: 'header-requiredness-drift',
          code: 'SP011',
          confidence: 'derived',
        },
        ['assertion'],
      ),
    ]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits).toHaveLength(0);
    expect(plan.skipped[0]?.reason).toBe('no-mechanical-edit');
  });

  it('should keep the report order across edits and skips, since dry run prints the same order', () => {
    // Given
    const report = reportOf([
      finding({ subject: 'GET /a' }),
      finding({ subject: 'GET /b', classification: { bucket: 'contradiction' } }),
      finding({ subject: 'GET /c' }),
    ]);

    // When
    const plan = planFixes(report);

    // Then
    expect(plan.edits.map((edit) => edit.subject)).toEqual(['GET /a', 'GET /c']);
    expect(plan.skipped.map((entry) => entry.subject)).toEqual(['GET /b']);
  });
});

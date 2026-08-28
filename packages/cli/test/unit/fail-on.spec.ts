import { describe, expect, it } from 'vitest';
import type { IRDriftSeverity } from '@openref/core';
import { FAIL_ON_LEVELS, isFailOnLevel, meetsFailOnThreshold } from '../../src/cli/domain/fail-on';

describe('isFailOnLevel', () => {
  it('should accept every SPEC 17 value', () => {
    // Given / When / Then
    for (const level of FAIL_ON_LEVELS) expect(isFailOnLevel(level)).toBe(true);
  });

  it('should reject a value SPEC 17 does not list', () => {
    // Given / When / Then
    expect(isFailOnLevel('catastrophe')).toBe(false);
  });
});

describe('meetsFailOnThreshold', () => {
  it('should count only error severity at the error level', () => {
    // Given / When / Then
    expect(meetsFailOnThreshold('error', 'error')).toBe(true);
    expect(meetsFailOnThreshold('warning', 'error')).toBe(false);
    expect(meetsFailOnThreshold('info', 'error')).toBe(false);
  });

  it('should count error and warning severity at the warn level', () => {
    // Given / When / Then
    expect(meetsFailOnThreshold('error', 'warn')).toBe(true);
    expect(meetsFailOnThreshold('warning', 'warn')).toBe(true);
    expect(meetsFailOnThreshold('info', 'warn')).toBe(false);
  });

  it('should count every severity at the drift level', () => {
    // Given / When / Then
    expect(meetsFailOnThreshold('error', 'drift')).toBe(true);
    expect(meetsFailOnThreshold('warning', 'drift')).toBe(true);
    expect(meetsFailOnThreshold('info', 'drift')).toBe(true);
  });

  /**
   * The property the three cases above cannot state, added by the pre-M4 review.
   *
   * They pin nine answers for the three severities that exist today, and a severity added
   * tomorrow would make all nine still pass while landing wherever the implementation happened to
   * put it. The record below is total over `IRDriftSeverity`, so a new severity does not compile
   * until it is listed here, and the assertion then holds the thresholds to their own ordering:
   * whatever the strictest level counts, the looser ones count too. A `critical` dropped by
   * `--fail-on=error` fails this case; it passed every case above.
   */
  it('should keep the thresholds ordered for every severity the union carries', () => {
    // Given every severity, spelled out once
    const everySeverity: Record<IRDriftSeverity, true> = { error: true, warning: true, info: true };

    for (const severity of Object.keys(everySeverity) as IRDriftSeverity[]) {
      // When
      const atError = meetsFailOnThreshold(severity, 'error');
      const atWarn = meetsFailOnThreshold(severity, 'warn');
      const atDrift = meetsFailOnThreshold(severity, 'drift');

      // Then counting at a stricter level implies counting at every looser one
      expect(atError && !atWarn, `${severity} counted at error but not at warn`).toBe(false);
      expect(atWarn && !atDrift, `${severity} counted at warn but not at drift`).toBe(false);
      expect(atDrift, `${severity} not counted at drift, which counts everything`).toBe(true);
    }
  });
});

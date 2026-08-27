import { describe, expect, it } from 'vitest';
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
});

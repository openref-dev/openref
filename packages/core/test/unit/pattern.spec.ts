import { describe, expect, it } from 'vitest';
import { isSafePattern, matchesPattern, sampleFromPattern } from '../../src/index';

describe('isSafePattern', () => {
  it('should accept a pattern with no nested quantifier', () => {
    // Given
    const pattern = '^[A-Z]{3}$';

    // When
    const safe = isSafePattern(pattern);

    // Then
    expect(safe).toBe(true);
  });

  it('should refuse a quantified group that itself quantifies, the shape that backtracks', () => {
    // Given
    const pattern = '^(a+)+$';

    // When
    const safe = isSafePattern(pattern);

    // Then
    expect(safe).toBe(false);
  });

  it('should refuse a pattern longer than the cap rather than analysing it', () => {
    // Given
    const pattern = `^${'a'.repeat(400)}$`;

    // When
    const safe = isSafePattern(pattern);

    // Then
    expect(safe).toBe(false);
  });

  it('should refuse an unbalanced group', () => {
    // Given
    const pattern = '^(abc$';

    // When
    const safe = isSafePattern(pattern);

    // Then
    expect(safe).toBe(false);
  });
});

describe('matchesPattern', () => {
  it('should report a match for a safe pattern', () => {
    // Given
    const pattern = '^[a-z]+$';

    // When
    const matches = matchesPattern(pattern, 'abc');

    // Then
    expect(matches).toBe(true);
  });

  it('should report no match for an unsafe pattern, whatever the candidate', () => {
    // Given
    const pattern = '^(a+)+$';

    // When
    const matches = matchesPattern(pattern, 'aaa');

    // Then
    expect(matches).toBe(false);
  });

  it('should report no match for a pattern that does not compile', () => {
    // Given
    const pattern = '[unclosed';

    // When
    const matches = matchesPattern(pattern, 'anything');

    // Then
    expect(matches).toBe(false);
  });
});

describe('sampleFromPattern', () => {
  it('should build a literal pattern verbatim', () => {
    // Given
    const pattern = '^order$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBe('order');
  });

  it('should build a fixed length character class', () => {
    // Given
    const pattern = '^[A-Z]{3}$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBe('AAA');
  });

  it('should build a digit shorthand with a separator', () => {
    // Given
    const pattern = '^\\d{4}-\\d{2}$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBe('0000-00');
  });

  it('should emit nothing for a star quantifier, whose shortest match is empty', () => {
    // Given
    const pattern = '^[a-z]*$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBe('');
  });

  it('should emit one character for a plus quantifier', () => {
    // Given
    const pattern = '^[a-z]+$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBe('a');
  });

  it('should refuse alternation, which is not trivially satisfiable', () => {
    // Given
    const pattern = '^(a|b)+$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBeUndefined();
  });

  it('should refuse a negated character class', () => {
    // Given
    const pattern = '^[^a]{2}$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBeUndefined();
  });

  it('should refuse a repetition count that would exceed the sample cap', () => {
    // Given
    const pattern = '^[a-z]{500}$';

    // When
    const sample = sampleFromPattern(pattern);

    // Then
    expect(sample).toBeUndefined();
  });

  it('should return a sample the pattern actually accepts, every time', () => {
    // Given
    const patterns = ['^order$', '^[A-Z]{3}$', '^\\d{4}-\\d{2}$', '^[a-z]+$', '^v\\d\\.\\d$'];

    // When
    const samples = patterns.map((pattern) => sampleFromPattern(pattern));

    // Then
    expect(
      samples.every(
        (sample, index) => sample !== undefined && matchesPattern(patterns[index] ?? '', sample),
      ),
    ).toBe(true);
  });
});

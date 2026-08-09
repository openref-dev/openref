import { describe, expect, it } from 'vitest';
import { evaluateBudget, formatBytes, gzipSizeOf } from '../../src/lib/budgets';

describe('gzipSizeOf', () => {
  it('should compress repetitive content well below its raw size', () => {
    // Given
    const content = Buffer.from('a'.repeat(10_000), 'utf8');

    // When
    const compressed = gzipSizeOf(content);

    // Then
    expect(compressed).toBeLessThan(content.byteLength / 10);
  });

  it('should be deterministic for the same input', () => {
    // Given
    const content = Buffer.from('.oref-root { color: var(--oref-color-fg); }', 'utf8');

    // When
    const sizes = [gzipSizeOf(content), gzipSizeOf(content)];

    // Then
    expect(sizes[0]).toBe(sizes[1]);
  });
});

describe('evaluateBudget', () => {
  it('should pass when the summed gzip size sits on the limit', () => {
    // Given
    const measurements = [
      { path: 'a.js', rawBytes: 100, gzipBytes: 60 },
      { path: 'b.js', rawBytes: 100, gzipBytes: 40 },
    ];

    // When
    const evaluation = evaluateBudget(100, measurements);

    // Then
    expect(evaluation.ok).toBe(true);
    expect(evaluation.overBy).toBe(0);
  });

  it('should fail and report the overshoot when the limit is exceeded', () => {
    // Given
    const measurements = [{ path: 'a.js', rawBytes: 100, gzipBytes: 101 }];

    // When
    const evaluation = evaluateBudget(100, measurements);

    // Then
    expect(evaluation.ok).toBe(false);
    expect(evaluation.overBy).toBe(1);
  });

  it('should treat an empty artifact set as zero bytes', () => {
    // Given
    const measurements: { path: string; rawBytes: number; gzipBytes: number }[] = [];

    // When
    const evaluation = evaluateBudget(100, measurements);

    // Then
    expect(evaluation.totalGzipBytes).toBe(0);
  });
});

describe('formatBytes', () => {
  it('should print bytes below one kilobyte', () => {
    // Given
    const bytes = 512;

    // When
    const formatted = formatBytes(bytes);

    // Then
    expect(formatted).toBe('512 B');
  });

  it('should print binary kilobytes above one kilobyte', () => {
    // Given
    const bytes = 100 * 1024;

    // When
    const formatted = formatBytes(bytes);

    // Then
    expect(formatted).toBe('100.0 KB');
  });
});

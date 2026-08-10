import { describe, expect, it } from 'vitest';
import { SIZE_BUDGETS } from '../../src/config';
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
    expect(evaluation.totalBytes).toBe(0);
  });

  it('should sum the transferred bytes when the budget names transfer', () => {
    // Given, the same files under the two quantities. The gap is what SPEC 0 records: a gate
    // may read the right artifact and still measure the wrong thing.
    const measurements = [
      { path: 'tokens.css', rawBytes: 13_094, gzipBytes: 2077 },
      { path: 'theme.css', rawBytes: 19_761, gzipBytes: 2954 },
    ];

    // When
    const evaluation = evaluateBudget(15 * 1024, measurements, 'transfer');

    // Then
    expect(evaluation.quantity).toBe('transfer');
    expect(evaluation.totalBytes).toBe(5031);
    expect(evaluation.ok).toBe(true);
  });

  it('should sum the decoded bytes when the budget names parse, and can fail where transfer passes', () => {
    // Given, the same two files.
    const measurements = [
      { path: 'tokens.css', rawBytes: 13_094, gzipBytes: 2077 },
      { path: 'theme.css', rawBytes: 19_761, gzipBytes: 2954 },
    ];

    // When
    const evaluation = evaluateBudget(15 * 1024, measurements, 'parse');

    // Then, six and a half times the figure, over a limit the transfer quantity clears easily.
    expect(evaluation.quantity).toBe('parse');
    expect(evaluation.totalBytes).toBe(32_855);
    expect(evaluation.ok).toBe(false);
    expect(evaluation.overBy).toBe(32_855 - 15 * 1024);
  });

  it('should measure transfer when no quantity is named, since that is what every budget was', () => {
    // Given
    const measurements = [{ path: 'a.css', rawBytes: 1000, gzipBytes: 100 }];

    // When
    const evaluation = evaluateBudget(500, measurements);

    // Then
    expect(evaluation.quantity).toBe('transfer');
    expect(evaluation.totalBytes).toBe(100);
  });
});

describe('the two caps on the theme stylesheets', () => {
  const themeCss = SIZE_BUDGETS.filter((budget) => budget.id.startsWith('theme-css'));

  it('should bound the identical file set, so the two are one artifact seen twice', () => {
    // Given, two budgets over different file sets would read as two views of one thing and be
    // two different things, which is the failure the pair exists to prevent.
    const [transfer, parse] = themeCss;

    // When
    const roots = themeCss.map((budget) => budget.roots.join(','));

    // Then
    expect(themeCss).toHaveLength(2);
    expect(roots[0]).toBe(roots[1]);
    expect(transfer?.extensions).toEqual(parse?.extensions);
  });

  it('should name one quantity each, and not the same one twice', () => {
    // Given
    const quantities = themeCss.map((budget) => budget.quantity);

    // When
    const distinct = new Set(quantities);

    // Then
    expect(quantities).toEqual(['transfer', 'parse']);
    expect(distinct.size).toBe(2);
  });

  it('should say raw in the id of every budget that measures raw, and only those', () => {
    // Given, SPEC 0: a gate may read the right artifact and still measure the wrong thing. Two
    // budgets over one file set are only readable if the id says which quantity each one is.
    const mismatched = SIZE_BUDGETS.filter(
      (budget) => budget.id.endsWith('-raw') !== (budget.quantity === 'parse'),
    );

    // When
    const ids = mismatched.map((budget) => `${budget.id} measures ${budget.quantity}`);

    // Then
    expect(ids).toEqual([]);
    expect(SIZE_BUDGETS.some((budget) => budget.quantity === 'parse')).toBe(true);
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

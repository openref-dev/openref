import { describe, expect, it } from 'vitest';
import { BROWSER_CEILINGS } from '../../src/config';
import {
  checkCeilings,
  compareToBaseline,
  readBaseline,
  readBrowserBaseline,
  recordedFigure,
  type BrowserBaseline,
} from '../../src/lib/browser-baseline';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

const spread = (median: number, standardDeviation = 10) => ({
  samples: 25,
  median,
  min: median - standardDeviation,
  max: median + standardDeviation,
  standardDeviation,
});

function baseline(overrides: Partial<BrowserBaseline> = {}): BrowserBaseline {
  return {
    recordedAt: '2026-08-10',
    commit: 'abc123',
    environment: { id: 'github-actions/ubuntu24/X64', label: 'runner', cpuModel: 'x', cpuCount: 4 },
    browser: { version: '150.0.0.1', major: 150 },
    chromeArgs: ['--no-sandbox'],
    throttleRate: 4,
    throttleRatio: spread(4.2, 0.05),
    ttiMs: spread(120, 20),
    ttiPhaseMs: { transfer: 1, parse: 60, script: 50, firstContentfulPaint: 90 },
    peakHeapBytes: spread(4 * 1024 * 1024, 1024),
    externalRequests: 0,
    cspViolations: 0,
    servedDocumentBytes: 30_000,
    overBudget: [],
    ...overrides,
  };
}

const measured = {
  environmentId: 'github-actions/ubuntu24/X64',
  browserMajor: 150,
  ttiMedianMs: 120,
  peakHeapMedianBytes: 4 * 1024 * 1024,
  externalRequests: 0,
  cspViolations: 0,
};

describe('readBaseline', () => {
  it('should refuse a record that carries no machine and no browser', () => {
    // Given, because a baseline that parsed to defaults would pass every ceiling while
    // describing nothing
    // When
    // Then
    expect(() => readBaseline({ ttiMs: spread(1) })).toThrow(/names no machine/);
    expect(() => readBaseline(null)).toThrow(/not an object/);
  });

  it('should refuse a record whose figures are not figures', () => {
    // Given
    const broken = { ...baseline(), ttiMs: { samples: 25 } };

    // When
    // Then
    expect(() => readBaseline(broken)).toThrow(/ttiMs/);
  });
});

describe('checkCeilings', () => {
  it('should be silent when every figure is inside SPEC 20', () => {
    // Given
    // When
    // Then
    expect(checkCeilings(baseline())).toEqual([]);
  });

  it('should report a TTI over the ceiling, with where the time went', () => {
    // Given the state this repository is in today
    const record = baseline({ ttiMs: spread(213.9, 145) });

    // When
    const issues = checkCeilings(record);

    // Then the finding carries the diagnosis, because a number alone says nothing to do
    expect(issues).toHaveLength(1);
    expect(issues[0]?.budget).toBe('tti');
    expect(issues[0]?.message).toContain('213.9');
    expect(issues[0]?.message).toContain('interactive document');
  });

  it('should report a heap, a request and a document over their ceilings', () => {
    // Given
    const record = baseline({
      peakHeapBytes: spread(BROWSER_CEILINGS.peakHeapBytes + 1),
      externalRequests: 2,
      servedDocumentBytes: BROWSER_CEILINGS.servedDocumentBytes + 1,
    });

    // When
    const issues = checkCeilings(record);

    // Then
    expect(issues.map((issue) => issue.budget).sort()).toEqual([
      'client-memory',
      'external-requests',
      'served-document',
    ]);
  });
});

describe('compareToBaseline', () => {
  it('should be silent when a study repeats the recorded figure', () => {
    // Given
    // When
    // Then
    expect(compareToBaseline(baseline(), measured)).toEqual([]);
  });

  it('should report a jump beyond the spread the measurement varies by', () => {
    // Given a study on the same machine and the same browser, slower by more than one standard
    // deviation of the recorded samples
    const study = { ...measured, ttiMedianMs: 145 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('over-budget');
    expect(issues[0]?.message).toContain('change to the product');
  });

  it('should not fire on a movement inside the spread', () => {
    // Given, because a check that fires on noise is a check everyone learns to ignore
    const study = { ...measured, ttiMedianMs: 138 };

    // When
    // Then
    expect(compareToBaseline(baseline(), study)).toEqual([]);
  });

  it('should report a browser major that moved as stale rather than as a regression', () => {
    // Given the day the runner image ships a new Chrome
    const study = { ...measured, browserMajor: 151, ttiMedianMs: 149 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then the figures are printed and the relative check does not fire
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('stale');
    expect(issues[0]?.message).toContain('re-record');
  });

  it('should still check the ceiling when the baseline is stale', () => {
    // Given, because a new browser being slower than SPEC 20 allows is still a page a reader
    // waits for
    const study = { ...measured, browserMajor: 151, ttiMedianMs: 400 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(issues.filter((issue) => issue.kind === 'over-budget')).toHaveLength(1);
  });

  it('should refuse to compare across machines', () => {
    // Given a study taken on a workstation against a record from the runner
    const study = { ...measured, environmentId: 'local/darwin/arm64', ttiMedianMs: 400 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then it says so, and it still checks the ceiling
    expect(issues.some((issue) => issue.kind === 'stale')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'over-budget')).toBe(true);
  });

  it('should report a policy violation and an external request as budget failures', () => {
    // Given, because both are SPEC 20 numbers and both are zero
    const study = { ...measured, externalRequests: 1, cspViolations: 2 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(issues.map((issue) => issue.budget).sort()).toEqual(['csp', 'external-requests']);
  });
});

describe('the committed baseline', () => {
  it('should be readable, and should say what it is over', () => {
    // Given the real file, which is what the budgets gate reads
    const { baseline: record, reason } = readBrowserBaseline(repoRoot);

    // Then
    expect(reason).toBeUndefined();
    if (record === null) throw new Error('no baseline');

    // The record and the check have to agree about what is over budget. A file claiming
    // nothing is over while the ceilings say otherwise is the record lying to its reader.
    expect([...record.overBudget].sort()).toEqual(
      checkCeilings(record)
        .map((issue) => issue.budget)
        .sort(),
    );
  });

  it('should carry a figure for every budget the gate says it measures', () => {
    // Given
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    // Then
    for (const id of ['tti', 'client-memory', 'external-requests', 'served-document']) {
      expect(recordedFigure(record, id)).not.toBeNull();
    }

    expect(recordedFigure(record, 'prerender')).toBeNull();
  });
});

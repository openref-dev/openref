import { describe, expect, it } from 'vitest';
import { BROWSER_CEILINGS, MEASURED_BUDGETS } from '../../src/config';
import {
  ASSERTED_FIGURES,
  RECORDED_NOT_ASSERTED,
  checkCeilings,
  compareToBaseline,
  pageBytesOf,
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
    mainThreadMs: spread(150, 20),
    longTaskCount: spread(2, 0.5),
    parsedBytes: { documentBytes: 30_000, cssBytes: 32_000, jsBytes: 100_000 },
    peakHeapBytes: spread(4 * 1024 * 1024, 1024),
    externalRequests: 0,
    cspViolations: 0,
    overBudget: [],
    ...overrides,
  };
}

const measured = {
  environmentId: 'github-actions/ubuntu24/X64',
  cpuModel: 'x',
  browserMajor: 150,
  ttiMedianMs: 120,
  peakHeapMedianBytes: 4 * 1024 * 1024,
  externalRequests: 0,
  cspViolations: 0,
  longTaskMedian: 2,
  parsedBytes: { documentBytes: 30_000, cssBytes: 32_000, jsBytes: 100_000 },
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

  it('should refuse a record with no gated figure in it', () => {
    // Given a record written before the two counts became budgets. It would otherwise read as a
    // study whose long task count and byte columns were both zero, which is the fastest page
    // ever measured and is nothing at all.
    const { longTaskCount: _tasks, ...withoutTasks } = baseline();
    const { parsedBytes: _bytes, ...withoutBytes } = baseline();

    // When
    // Then
    expect(() => readBaseline(withoutTasks)).toThrow(/longTaskCount/);
    expect(() => readBaseline(withoutBytes)).toThrow(/parsedBytes/);
  });
});

describe('checkCeilings', () => {
  it('should be silent when every figure is inside SPEC 20', () => {
    // Given
    // When
    // Then
    expect(checkCeilings(baseline())).toEqual([]);
  });

  it('should read the policy violations the record carries', () => {
    // Given the defect found on 2026-08-10: the field was recorded from the day this file was
    // written and no committed check read it, so a baseline carrying violations passed
    // `pnpm gates` in silence while the same figure failed the study job.
    const record = baseline({ cspViolations: 1 });

    // When
    const issues = checkCeilings(record);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.budget).toBe('csp-violations');
    expect(issues[0]?.kind).toBe('over-budget');
    expect(issues[0]?.message).toContain('SPEC 19.2');
  });

  it('should report one long task more than the ceiling allows', () => {
    // Given, the count read 2 on six studies across five processors, so 3 is a stall the page
    // did not have before
    const record = baseline({ longTaskCount: spread(BROWSER_CEILINGS.longTaskCount + 1, 0.5) });

    // When
    const issues = checkCeilings(record);

    // Then
    expect(issues.map((issue) => issue.budget)).toEqual(['long-tasks']);
    expect(issues[0]?.message).toContain('over 50 ms');
  });

  it('should sum the three byte columns and refuse a page frame sized addition', () => {
    // Given the derivation the cap was chosen by: measured 195,783 bytes with 2,873 of room, so
    // another region of `theme.css` the size of the page frame, 3,287 bytes, has to fail
    const record = baseline({
      parsedBytes: { documentBytes: 65_326, cssBytes: 32_606 + 3_287, jsBytes: 98_193 },
    });

    // When
    const issues = checkCeilings(record);

    // Then
    expect(issues.map((issue) => issue.budget)).toEqual(['page-bytes']);
    expect(issues[0]?.message).toContain('document');
  });

  it('should let a navigation sized addition through, which is the room ordinary work gets', () => {
    // Given, the same allowance `theme-css-raw` was derived with
    const record = baseline({
      parsedBytes: { documentBytes: 65_326, cssBytes: 32_606 + 2_520, jsBytes: 98_193 },
    });

    // When
    // Then
    expect(checkCeilings(record)).toEqual([]);
  });

  it('should report a heap, a request and a document over their ceilings', () => {
    // Given
    const record = baseline({
      peakHeapBytes: spread(BROWSER_CEILINGS.peakHeapBytes + 1),
      externalRequests: 2,
      parsedBytes: {
        documentBytes: BROWSER_CEILINGS.servedDocumentBytes + 1,
        cssBytes: 1_000,
        jsBytes: 1_000,
      },
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

  it('should never fail on the wall clock, which SPEC 20 records and does not gate', () => {
    // Given a TTI far past the 150 ms SPEC 20 still names as the intention. Six studies of one
    // commit on five processors read 163.7 to 216.1 ms, so a build that stopped on this number
    // would stop on the machine the pool handed out.
    const record = baseline({ ttiMs: spread(400, 20), mainThreadMs: spread(500, 20) });

    // When
    // Then
    expect(checkCeilings(record)).toEqual([]);
  });
});

describe('compareToBaseline', () => {
  it('should be silent when a study repeats the recorded figure', () => {
    // Given
    // When
    // Then
    expect(compareToBaseline(baseline(), measured)).toEqual([]);
  });

  it('should report a jump beyond the spread as a report rather than a failure', () => {
    // Given a study on the same machine and the same browser, slower by more than one standard
    // deviation of the recorded samples. It is worth printing and it stops nothing: the
    // quantity is not one this machinery can gate.
    const study = { ...measured, ttiMedianMs: 145 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('report');
    expect(issues[0]?.message).toContain('a line to read');
  });

  it('should not fire on a movement inside the spread', () => {
    // Given, because a check that fires on noise is a check everyone learns to ignore
    const study = { ...measured, ttiMedianMs: 138 };

    // When
    // Then
    expect(compareToBaseline(baseline(), study)).toEqual([]);
  });

  it('should fail a fresh study on the two counts, which do not move with the machine', () => {
    // Given, the half of the pair that gates: these are what a regression has to trip
    const study = {
      ...measured,
      longTaskMedian: 3,
      parsedBytes: { documentBytes: 65_326, cssBytes: 32_264, jsBytes: 120_000 },
    };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(
      issues.filter((issue) => issue.kind === 'over-budget').map((issue) => issue.budget),
    ).toEqual(['long-tasks', 'page-bytes']);
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

  it('should still check the ceilings when the baseline is stale', () => {
    // Given, because a page that stalls three times is a page that stalls three times whichever
    // browser measured it
    const study = { ...measured, browserMajor: 151, longTaskMedian: 4 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(issues.filter((issue) => issue.kind === 'over-budget')).toHaveLength(1);
    expect(issues.filter((issue) => issue.kind === 'stale')).toHaveLength(1);
  });

  it('should refuse to compare across machines', () => {
    // Given a study taken on a workstation against a record from the runner
    const study = { ...measured, environmentId: 'local/darwin/arm64', longTaskMedian: 9 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then it says so, and it still checks the ceiling
    expect(issues.some((issue) => issue.kind === 'stale')).toBe(true);
    expect(issues.some((issue) => issue.kind === 'over-budget')).toBe(true);
  });

  it('should refuse to compare across processors that share an environment id', () => {
    // Given the run of 2026-08-10, replayed. The environment id and the Chrome major were
    // identical and the runner pool had swapped an AMD EPYC 9V74 for a 9V45, so the relative
    // check compared two machines and read 66 ms of hardware as 66 ms of product.
    const record = baseline({
      environment: {
        id: 'github-actions/ubuntu24/X64',
        label: 'runner',
        cpuModel: 'AMD EPYC 9V74 80-Core Processor',
        cpuCount: 4,
      },
      ttiMs: spread(213.9, 15),
    });
    const study = {
      ...measured,
      cpuModel: 'AMD EPYC 9V45 96-Core Processor',
      ttiMedianMs: 148.2,
    };

    // When
    const issues = compareToBaseline(record, study);

    // Then it says the baseline is stale and does not report a 66 ms improvement
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('stale');
    expect(issues[0]?.message).toContain('9V45');
    expect(issues[0]?.message).toContain('not attributable to the product');
  });

  it('should report a policy violation and an external request as budget failures', () => {
    // Given, because both are SPEC 20 numbers and both are zero
    const study = { ...measured, externalRequests: 1, cspViolations: 2 };

    // When
    const issues = compareToBaseline(baseline(), study);

    // Then
    expect(issues.map((issue) => issue.budget).sort()).toEqual([
      'csp-violations',
      'external-requests',
    ]);
  });
});

describe('what the record asserts and what it only carries', () => {
  it('should account for every field of the committed baseline, one way or the other', () => {
    // Given the real file. This is the defect class SPEC 0 calls measured but never asserted:
    // `cspViolations` sat in this record for two sessions, was read by the study job and by
    // nothing committed, and the field being there read as coverage. A field that is neither
    // checked nor listed as unchecked is the next one of those.
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    const unaccounted = Object.keys(record).filter(
      (field) =>
        ASSERTED_FIGURES[field] === undefined && RECORDED_NOT_ASSERTED[field] === undefined,
    );
    const both = Object.keys(ASSERTED_FIGURES).filter(
      (field) => RECORDED_NOT_ASSERTED[field] !== undefined,
    );

    // Then
    expect(unaccounted).toEqual([]);
    expect(both).toEqual([]);
  });

  it('should give every unchecked field a reason, since nobody got round to it is the failure', () => {
    // Given
    // When
    const empty = Object.entries(RECORDED_NOT_ASSERTED).filter(([, why]) => why.trim().length < 20);

    // Then
    expect(empty).toEqual([]);
  });

  it('should have a check that fires for every field it calls asserted', () => {
    // Given a record over every ceiling at once, so an entry in ASSERTED_FIGURES that no branch
    // of `checkCeilings` reads is visible as a budget id that never appears
    const record = baseline({
      longTaskCount: spread(9, 1),
      parsedBytes: { documentBytes: 200_000, cssBytes: 200_000, jsBytes: 200_000 },
      peakHeapBytes: spread(BROWSER_CEILINGS.peakHeapBytes * 2),
      externalRequests: 3,
      cspViolations: 3,
    });

    // When
    const budgets = new Set(checkCeilings(record).map((issue) => issue.budget));

    // Then every asserted field named a budget, and every budget it named is one SPEC 20 sets
    expect([...budgets].sort()).toEqual([
      'client-memory',
      'csp-violations',
      'external-requests',
      'long-tasks',
      'page-bytes',
      'served-document',
    ]);

    const ids = new Set(MEASURED_BUDGETS.map((budget) => budget.id));
    expect([...budgets].filter((budget) => !ids.has(budget))).toEqual([]);
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
    for (const id of [
      'tti',
      'main-thread-work',
      'long-tasks',
      'page-bytes',
      'client-memory',
      'external-requests',
      'csp-violations',
      'served-document',
    ]) {
      expect(recordedFigure(record, id)).not.toBeNull();
    }

    expect(recordedFigure(record, 'prerender')).toBeNull();
  });

  it('should hold the figures the three gated caps are judged against', () => {
    // Given, so the derivation in `config.ts` is checked against the record rather than
    // remembered. The cap was derived on 2026-08-11 from the representative input of T016
    // finding F10, at 196,125 bytes with 2,531 of headroom. THE HEADROOM IS GONE AND THE CAP HAS
    // NOT MOVED: T020 through T023 took the record to 199,612 on the same input, so what this
    // now pins is a deficit rather than a margin, and the deficit is what `BUDGET_EXCEPTIONS`
    // carries. A cap recomputed to restore the margin would be the forbidden move, because here
    // the artefact changed and the input did not.
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    const bytes = pageBytesOf(record.parsedBytes);

    // Then, 203,654 against 198,656, over by 4,998 since the T033 re-record: the recorded work
    // of T026 through T033, measured identically to the byte on the three studies of that
    // dispatch and on the workstation. The deficit is what BUDGET_EXCEPTIONS carries, owned by
    // T012-R4.
    expect(bytes).toBe(203_654);
    expect(BROWSER_CEILINGS.pageBytes - bytes).toBe(-4_998);

    // And the served document, 64,741 with 8,987 of headroom, DOWN 493 from the record this
    // replaced: T005-R1's honest recursion stops are smaller than the null skeletons they
    // replaced. It is derived loosely on purpose: the regression it exists to catch is the
    // navigation blob returning, and this document's is 546,162 bytes, so a fifth of it fails
    // this cap twice over.
    expect(record.parsedBytes.documentBytes).toBe(64_741);
    expect(BROWSER_CEILINGS.servedDocumentBytes - record.parsedBytes.documentBytes).toBe(8_987);

    // And the count that has run out of room without going over. It is pinned to what the record
    // says and checked against the cap, rather than asserted equal to it: the two have been the
    // same number and have been different, and reading either as the contract would fail the
    // build for a page that got better. The recorded study reads 1, and the note says what a
    // median hides, which is that four of the six studies read 2 against a cap of 2.
    expect(record.longTaskCount.median).toBe(1);
    expect(record.longTaskCount.max).toBeLessThanOrEqual(BROWSER_CEILINGS.longTaskCount);
  });
});

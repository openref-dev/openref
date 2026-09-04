import { describe, expect, it } from 'vitest';
import { BROWSER_CEILINGS, MEASURED_BUDGETS } from '../../src/config';
import {
  ASSERTED_FIGURES,
  BASELINE_ANSWERED_BUDGET_IDS,
  BASELINE_INPUT_PATHS,
  RECORDED_NOT_ASSERTED,
  baselineFreshness,
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

/**
 * The three regions the `page-bytes` property is stated in, as SPEC 20 has written them since the
 * cap was first derived.
 *
 * THEY ARE THE PROPERTY AND NOT AN ILLUSTRATION OF IT. The cap is not the measurement plus a
 * percentage: it is the whole KB step under which an addition the size of the navigation region
 * still fits while one the size of the page frame or of the try-it console goes over. Every
 * derivation this row has had was taken that way, which `derivesTheRecordedCaps` below checks by
 * reproducing all four of them from their own measurements.
 */
const NAVIGATION_REGION_BYTES = 2_520;
const PAGE_FRAME_REGION_BYTES = 3_287;
const TRY_IT_CONSOLE_REGION_BYTES = 3_669;

/**
 * The whole KB step the `page-bytes` property picks for one measurement.
 *
 * @param measuredBytes - What the page handed the main thread
 * @returns The cap in whole kilobytes
 * @throws {Error} When no whole KB step keeps both halves of the property
 */
function pageBytesStepFor(measuredBytes: number): number {
  for (let kilobytes = 1; kilobytes <= 4096; kilobytes += 1) {
    const step = kilobytes * 1024;
    if (
      measuredBytes + NAVIGATION_REGION_BYTES <= step &&
      measuredBytes + PAGE_FRAME_REGION_BYTES > step &&
      measuredBytes + TRY_IT_CONSOLE_REGION_BYTES > step
    ) {
      return kilobytes;
    }
  }

  throw new Error('no whole KB step keeps the property');
}

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
    // Given the derivation the cap was chosen by, re-derived 2026-09-04 from the workstation
    // measurement of 223,327: another region of `theme.css` the size of the page frame, 3,287
    // bytes, has to fail
    const record = baseline({
      parsedBytes: {
        documentBytes: 48_089,
        cssBytes: 62_594 + PAGE_FRAME_REGION_BYTES,
        jsBytes: 112_644,
      },
    });

    // When
    const issues = checkCeilings(record);

    // Then
    expect(issues.map((issue) => issue.budget)).toEqual(['page-bytes']);
    expect(issues[0]?.message).toContain('document');
  });

  it('should refuse a try-it console sized addition, which is the other half of the property', () => {
    // Given the second region the derivation names, larger than the first and asserted separately
    // so that a cap keeping only the cheaper half could not read as keeping the property
    const record = baseline({
      parsedBytes: {
        documentBytes: 48_089,
        cssBytes: 62_594 + TRY_IT_CONSOLE_REGION_BYTES,
        jsBytes: 112_644,
      },
    });

    // When
    // Then
    expect(checkCeilings(record).map((issue) => issue.budget)).toEqual(['page-bytes']);
  });

  it('should let a navigation sized addition through, which is the room ordinary work gets', () => {
    // Given, the same allowance `theme-css-raw` was derived with, over the same re-derived base
    const record = baseline({
      parsedBytes: {
        documentBytes: 48_089,
        cssBytes: 62_594 + NAVIGATION_REGION_BYTES,
        jsBytes: 112_644,
      },
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
    // The JS column is taken off the ceiling rather than written down, so this case says one byte
    // over whatever the cap is instead of one byte over whatever it was when the case was written.
    const study = {
      ...measured,
      longTaskMedian: 3,
      parsedBytes: {
        documentBytes: 65_326,
        cssBytes: 32_264,
        jsBytes: BROWSER_CEILINGS.pageBytes - 65_326 - 32_264 + 1,
      },
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

describe('baselineFreshness', () => {
  it('should call the record current when no commit touching its inputs has landed past it', () => {
    // Given
    const record = baseline({ commit: '74510c54d971199afe3442d9d177421b0f4a08c8' });

    // When
    const freshness = baselineFreshness(record, 0);

    // Then
    expect(freshness.state).toBe('current');
    expect(freshness.message).toContain('74510c54d971');
  });

  it('should name a stale record with the commit, the count and the way back', () => {
    // Given the failure this exists for, twice over: nine tasks shipped on the T023 record, the
    // TX chain shipped on the T033 one, and both times the figure being read described a page
    // that no longer existed. There is no failing distance, because any N > 0 admits N sessions
    // of exactly that silence; what there is instead is this line on every run.
    const record = baseline({ commit: '53027c9e6d367c1c667eabe50db6fd351dd208f2' });

    // When
    const freshness = baselineFreshness(record, 9);

    // Then
    expect(freshness.state).toBe('stale');
    expect(freshness.message).toContain('BASELINE STALE');
    expect(freshness.message).toContain('53027c9e6d36');
    expect(freshness.message).toContain('9 commits');
    expect(freshness.message).toContain('re-record');
    for (const path of BASELINE_INPUT_PATHS) {
      expect(freshness.message).toContain(path);
    }
  });

  it('should speak of one commit in the singular, since the first stale session is the class', () => {
    // Given
    // When
    const freshness = baselineFreshness(baseline(), 1);

    // Then
    expect(freshness.state).toBe('stale');
    expect(freshness.message).toContain('1 commit touching');
    expect(freshness.message).toContain('has landed');
  });

  it('should say it cannot tell rather than defaulting to current, when git cannot answer', () => {
    // Given a tarball, a shallow clone, or a rewritten history. A null count reading as
    // "current" would be the record claiming freshness with no evidence, which is the exact
    // shape of the defect the mechanism exists for.
    // When
    const freshness = baselineFreshness(baseline(), null, 'fatal: not a git repository');

    // Then
    expect(freshness.state).toBe('unknown');
    expect(freshness.message).toContain('could not be told');
    expect(freshness.message).toContain('not a git repository');
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
    // Given the one home the recorded set has: `recordedFigure` prints these ids and the
    // `budget-exceptions` gate requires a live entry over one of them to carry the commit its
    // figure was measured at. This holds the list to the function in both directions, so a
    // budget added to one and not the other fails here rather than slipping the commit rule.
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    // Then
    for (const id of BASELINE_ANSWERED_BUDGET_IDS) {
      expect(recordedFigure(record, id)).not.toBeNull();
    }

    for (const budget of MEASURED_BUDGETS) {
      if (BASELINE_ANSWERED_BUDGET_IDS.includes(budget.id)) continue;
      expect(recordedFigure(record, budget.id)).toBeNull();
    }
  });

  it('should hold the figures the three gated caps are judged against', () => {
    // Given, so the derivation in `config.ts` is checked against the record rather than remembered.
    // The record is the workstation study of 2026-09-04 at commit df41de0, and the cap is 221 KB,
    // re-derived by the maintainer's ruling from a measurement taken again rather than reused. IT
    // REPLACES THE RECORD OF 2026-08-14, the close-of-M2 study at 74510c5 whose 204,818 stood while
    // 69 commits touching `packages/` or `tools/browser-budget/src` landed past it and the gate
    // printed FROM A STALE RECORD beside every browser row. The deficit era, 2026-08-11 to the close
    // of M2 with the cap standing at 194 KB, is recorded in the closed `page-bytes` entry of
    // `BUDGET_EXCEPTION_HISTORY`.
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    const bytes = pageBytesOf(record.parsedBytes);

    // Then, 223,327 against 226,304 with 2,977 of headroom: enough for a navigation sized addition
    // of 2,520, not enough for a page frame sized region of 3,287 nor a console sized one of 3,669,
    // which is the property every derivation of this cap has kept and the ceiling cases above hold.
    expect(bytes).toBe(223_327);
    expect(BROWSER_CEILINGS.pageBytes - bytes).toBe(2_977);
    expect(record.recordedAt).toBe('2026-09-04');

    // And the served document, 48,089 with 25,639 of headroom. It is derived loosely on purpose:
    // the regression it exists to catch is the navigation blob returning, and this document's is
    // 546,162 bytes, so a fifth of it fails this cap twice over.
    expect(record.parsedBytes.documentBytes).toBe(48_089);
    expect(BROWSER_CEILINGS.servedDocumentBytes - record.parsedBytes.documentBytes).toBe(25_639);

    // And the count, pinned to what the record says and checked against the cap rather than
    // asserted equal to it: the two have been the same number and have been different, and reading
    // either as the contract would fail the build for a page that got better. This study read a
    // median of 0 over twenty navigations on a workstation, where the runner record read 1.
    expect(record.longTaskCount.median).toBe(0);
    expect(record.longTaskCount.max).toBeLessThanOrEqual(BROWSER_CEILINGS.longTaskCount);
  });

  it('should be the cap this row own property picks, on this record and on every earlier one', () => {
    // Given the record and the three measurements the earlier derivations of this cap were taken
    // from. ONE MEASUREMENT AND ONE CAP AGREE WITH ANY RULE THAT HAPPENS TO HIT THAT NUMBER ONCE,
    // which is why the earlier three are here: what the maintainer ruled was that this row
    // re-derives by ITS OWN property, so a rule that chose 221 today and disagreed with any of the
    // recorded three would not be the rule this row has ever been derived by.
    const { baseline: record } = readBrowserBaseline(repoRoot);
    if (record === null) throw new Error('no baseline');

    // When
    const fromTheRecord = pageBytesStepFor(pageBytesOf(record.parsedBytes));

    // Then, 159 KB from the T011-R measurement of 160,070, 194 from T016's 195,783 on the input it
    // replaced the fixture with, 203 from the close-of-M2 runner figure of 204,818, and 221 now
    expect([160_070, 195_783, 204_818].map(pageBytesStepFor)).toEqual([159, 194, 203]);
    expect(fromTheRecord).toBe(221);
    expect(BROWSER_CEILINGS.pageBytes).toBe(221 * 1024);
  });
});

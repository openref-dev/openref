import { describe, expect, it } from 'vitest';
import {
  aggregateByPackage,
  checkCoverageFloors,
  type CoverageEntry,
  type CoverageSummary,
} from '../../src/lib/coverage';

function entry(linesCovered: number, linesTotal: number): CoverageEntry {
  const metric = {
    total: linesTotal,
    covered: linesCovered,
    skipped: 0,
    pct: linesTotal === 0 ? 100 : (linesCovered / linesTotal) * 100,
  };
  return { lines: metric, statements: metric, functions: metric, branches: metric };
}

describe('aggregateByPackage', () => {
  it('should roll per file coverage up to the package that owns the file', () => {
    // Given
    const summary: CoverageSummary = {
      total: entry(0, 0),
      '/repo/packages/core/src/a.ts': entry(9, 10),
      '/repo/packages/core/src/nested/b.ts': entry(1, 10),
      '/repo/packages/runner/src/c.ts': entry(5, 10),
    };

    // When
    const result = aggregateByPackage(summary, ['core', 'runner']);

    // Then
    expect(result[0]).toMatchObject({ packageDir: 'core', fileCount: 2, linesPct: 50 });
    expect(result[1]).toMatchObject({ packageDir: 'runner', fileCount: 1, linesPct: 50 });
  });

  it('should ignore test files that sit outside the package src directory', () => {
    // Given
    const summary: CoverageSummary = {
      '/repo/packages/core/test/unit/a.spec.ts': entry(0, 10),
      '/repo/packages/core/src/a.ts': entry(10, 10),
    };

    // When
    const result = aggregateByPackage(summary, ['core']);

    // Then
    expect(result[0]).toMatchObject({ fileCount: 1, linesPct: 100 });
  });

  it('should roll a package with no measured files up to 100 percent over zero files', () => {
    // Given, and the file count is the half that matters: the percentage of an empty roll up is
    // arithmetic, and `checkCoverageFloors` is where a floor refuses it. Until the pre-M4 review
    // nothing refused it anywhere, so a package whose files went unmeasured cleared a 90 percent
    // floor at 100 percent.
    const summary: CoverageSummary = { '/repo/packages/core/src/a.ts': entry(10, 10) };

    // When
    const result = aggregateByPackage(summary, ['theme']);

    // Then
    expect(result[0]).toMatchObject({ packageDir: 'theme', fileCount: 0, linesPct: 100 });
  });

  it('should normalize windows path separators before matching', () => {
    // Given
    const summary: CoverageSummary = { 'C:\\repo\\packages\\core\\src\\a.ts': entry(8, 10) };

    // When
    const result = aggregateByPackage(summary, ['core']);

    // Then
    expect(result[0]).toMatchObject({ fileCount: 1, linesPct: 80 });
  });
});

describe('checkCoverageFloors', () => {
  it('should pass a package that sits exactly on its floor', () => {
    // Given
    const coverage = [{ packageDir: 'core', fileCount: 1, linesPct: 90, statementsPct: 90 }];

    // When
    const findings = checkCoverageFloors(coverage, { core: 90 });

    // Then
    expect(findings).toEqual([]);
  });

  it('should report both metrics when a package is below its floor', () => {
    // Given
    const coverage = [{ packageDir: 'core', fileCount: 1, linesPct: 80, statementsPct: 85 }];

    // When
    const findings = checkCoverageFloors(coverage, { core: 90 });

    // Then
    expect(findings.map((finding) => finding.metric)).toEqual(['lines', 'statements']);
  });

  it('should refuse a package with a floor and no measured file at all', () => {
    // Given the shape a broken path marker, a renamed source directory or a lost suite produces:
    // nothing measured, so the roll up reads as complete coverage
    const coverage = [{ packageDir: 'core', fileCount: 0, linesPct: 100, statementsPct: 100 }];

    // When
    const findings = checkCoverageFloors(coverage, { core: 90 });

    // Then it is one finding naming the cause, not two naming percentages that are not real
    expect(findings).toEqual([{ packageDir: 'core', metric: 'files', actualPct: 0, floorPct: 90 }]);
  });

  it('should leave a package with no floor and no files alone', () => {
    // Given a package the floors do not name, which is not this gate's business either way
    const coverage = [{ packageDir: 'theme', fileCount: 0, linesPct: 100, statementsPct: 100 }];

    // When
    const findings = checkCoverageFloors(coverage, { core: 90 });

    // Then
    expect(findings).toEqual([]);
  });

  it('should skip a package that has no floor yet', () => {
    // Given
    const coverage = [{ packageDir: 'theme', fileCount: 1, linesPct: 0, statementsPct: 0 }];

    // When
    const findings = checkCoverageFloors(coverage, { core: 90 });

    // Then
    expect(findings).toEqual([]);
  });
});

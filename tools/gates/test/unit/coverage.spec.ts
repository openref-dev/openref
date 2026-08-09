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

  it('should report a package with no measured files as fully covered', () => {
    // Given
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

  it('should skip a package that has no floor yet', () => {
    // Given
    const coverage = [{ packageDir: 'theme', fileCount: 1, linesPct: 0, statementsPct: 0 }];

    // When
    const findings = checkCoverageFloors(coverage, { core: 90 });

    // Then
    expect(findings).toEqual([]);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COVERAGE_FLOORS, STANDARDS_FILE } from '../../src/config';
import {
  aggregateByPackage,
  checkCoverageFloors,
  checkFloorTable,
  parseFloorTable,
  type CoverageEntry,
  type CoverageSummary,
} from '../../src/lib/coverage';

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/** STANDARDS 9.1 as this document actually writes it, so the parser is tested on the real shape. */
const STANDARDS_9_1 = [
  '### 9.1 Coverage targets',
  '',
  '| Package | Target |',
  '|---------|--------|',
  '| core | 90%+ |',
  '| runner | 85%+ |',
  '',
  'Some prose about the table.',
  '',
  '### 9.2 Style',
  '',
  '| Package | Target |',
  '| nest | 80%+ |',
].join('\n');

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

describe('parseFloorTable', () => {
  it('should read the rows of section 9.1 and stop at the next section', () => {
    // Given a document whose 9.2 also holds a table, which is what a greedy read would swallow
    // When
    const floors = parseFloorTable(STANDARDS_9_1);

    // Then
    expect(floors).toEqual({ core: 90, runner: 85 });
  });

  it('should answer null when section 9.1 is not there, rather than an empty agreement', () => {
    // Given the state a renamed or renumbered section produces. An empty record would reconcile
    // with every floor in the configuration, which is a proof of absence passing because the
    // subject was absent.
    // When
    const floors = parseFloorTable('## 9 Testing\n\n| core | 90%+ |\n');

    // Then
    expect(floors).toBeNull();
  });

  it('should answer null when the section is there and carries no readable row', () => {
    // Given
    const floors = parseFloorTable('### 9.1 Coverage targets\n\nThe targets moved elsewhere.\n');

    // When, Then
    expect(floors).toBeNull();
  });
});

describe('checkFloorTable', () => {
  it('should say nothing when the document and the configuration agree exactly', () => {
    // Given
    const messages = checkFloorTable({ core: 90, vue: 70 }, { core: 90, vue: 70 });

    // When, Then
    expect(messages).toEqual([]);
  });

  it('should report a row of the table that no floor enforces', () => {
    // Given the state `packages/federation` was in for the whole of M4: a governed table promising
    // a number, and a configuration measuring nothing against it
    const messages = checkFloorTable({ core: 90, federation: 90 }, { core: 90 });

    // When, Then
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[floor-unenforced]');
    expect(messages[0]).toContain('federation');
  });

  it('should report a floor the governed table does not carry', () => {
    // Given the other direction, which is a threshold applied that nobody wrote down
    const messages = checkFloorTable({ core: 90 }, { core: 90, search: 80 });

    // When, Then
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[floor-undocumented]');
    expect(messages[0]).toContain('search');
  });

  it('should report a number that moved on one side only', () => {
    // Given the shape a lowered floor makes, which ABSOLUTE RULES 3 forbids and which this cannot
    // itself refuse: what it can do is stop the two copies disagreeing quietly
    const messages = checkFloorTable({ core: 90 }, { core: 80 });

    // When, Then
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('[floor-disagrees]');
    expect(messages[0]).toContain('90');
    expect(messages[0]).toContain('80');
  });

  it('should agree with the real STANDARDS 9.1 where this checkout has it', () => {
    // Given the actual document, which is the case the gate runs. `ai-docs/` is git excluded, so
    // this reads it only where it is there and says so rather than passing on an absent file.
    let standards: string | null;
    try {
      standards = readFileSync(join(repoRoot, STANDARDS_FILE), 'utf8');
    } catch {
      standards = null;
    }

    if (standards === null) {
      expect(standards).toBeNull();
      return;
    }

    // When
    const documented = parseFloorTable(standards);

    // Then the parser reads the real table, and the two copies say the same thing. The parse is
    // asserted non empty first, because a parser that read nothing agrees with nothing.
    expect(documented, `${STANDARDS_FILE} section 9.1 was not readable`).not.toBeNull();
    expect(Object.keys(documented ?? {}).length).toBeGreaterThan(3);
    expect(checkFloorTable(documented ?? {}, COVERAGE_FLOORS)).toEqual([]);
  });
});

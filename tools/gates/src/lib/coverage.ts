/**
 * Coverage floor evaluation over an Istanbul style `coverage-summary.json`.
 *
 * The gate owns the floors. They are not duplicated in the Vitest configuration, so there
 * is exactly one place a floor could be lowered, and lowering it is forbidden.
 */

/** One coverage metric as emitted by the json-summary reporter. */
export interface CoverageMetric {
  readonly total: number;
  readonly covered: number;
  readonly skipped: number;
  readonly pct: number;
}

/** Coverage of one file, or the `total` entry. */
export interface CoverageEntry {
  readonly lines: CoverageMetric;
  readonly statements: CoverageMetric;
  readonly functions: CoverageMetric;
  readonly branches: CoverageMetric;
}

/** Parsed `coverage-summary.json`, keyed by absolute file path plus a `total` entry. */
export type CoverageSummary = Record<string, CoverageEntry>;

/** Coverage rolled up for one package. */
export interface PackageCoverage {
  readonly packageDir: string;
  readonly fileCount: number;
  readonly linesPct: number;
  readonly statementsPct: number;
}

/** A package whose coverage is below its floor, or whose coverage was never measured. */
export interface CoverageFinding {
  readonly packageDir: string;
  readonly metric: 'lines' | 'statements' | 'files';
  readonly actualPct: number;
  readonly floorPct: number;
}

/**
 * A ratio as a percentage, with nothing measured reading as everything covered.
 *
 * THE ZERO OVER ZERO ANSWER IS 100 AND THAT IS ONLY SAFE BECAUSE OF `files` BELOW. It is the
 * arithmetic a rolled up empty set has to produce for a package with no executable lines, and it
 * is also exactly the answer that let a package with no measured files at all clear a 90 percent
 * floor. The pre-M4 review named that as SPEC 0's class of a proof of absence passing because the
 * subject was absent: rename a source directory, break the path marker below, or lose a package's
 * suite entirely, and this returned 100 for it. The number stays; what changed is that a package
 * with a floor and no files is now a finding of its own, so nothing reaches this function's empty
 * case and passes.
 */
function percentage(covered: number, total: number): number {
  if (total === 0) return 100;
  return (covered / total) * 100;
}

/**
 * Rolls per file coverage up to per package coverage.
 *
 * A file belongs to a package when its path contains `packages/<dir>/src/`.
 *
 * @param summary - Parsed `coverage-summary.json`
 * @param packageDirs - Package directory names to roll up
 * @returns One entry per requested package, in the order requested
 */
export function aggregateByPackage(
  summary: CoverageSummary,
  packageDirs: readonly string[],
): PackageCoverage[] {
  return packageDirs.map((packageDir) => {
    const marker = `packages/${packageDir}/src/`;
    let lineTotal = 0;
    let lineCovered = 0;
    let statementTotal = 0;
    let statementCovered = 0;
    let fileCount = 0;

    for (const [filePath, entry] of Object.entries(summary)) {
      if (filePath === 'total') continue;
      if (!filePath.replace(/\\/g, '/').includes(marker)) continue;

      fileCount += 1;
      lineTotal += entry.lines.total;
      lineCovered += entry.lines.covered;
      statementTotal += entry.statements.total;
      statementCovered += entry.statements.covered;
    }

    return {
      packageDir,
      fileCount,
      linesPct: percentage(lineCovered, lineTotal),
      statementsPct: percentage(statementCovered, statementTotal),
    };
  });
}

/**
 * Compares rolled up coverage against the floors.
 *
 * @param coverage - Per package coverage
 * @param floors - Floor percentage per package directory
 * @returns One finding per metric below its floor
 */
export function checkCoverageFloors(
  coverage: readonly PackageCoverage[],
  floors: Readonly<Record<string, number>>,
): CoverageFinding[] {
  const findings: CoverageFinding[] = [];

  for (const entry of coverage) {
    const floorPct = floors[entry.packageDir];
    if (floorPct === undefined) continue;

    // A FLOOR OVER NOTHING IS NOT A FLOOR MET. A package named in the floors and contributing no
    // measured file rolls up to zero over zero, which reads as 100 percent, so the strictest floor
    // in the project was cleared by the run that measured none of it. Reported before the two
    // percentages so the sentence a reader sees names the cause rather than the symptom.
    if (entry.fileCount === 0) {
      findings.push({ packageDir: entry.packageDir, metric: 'files', actualPct: 0, floorPct });
      continue;
    }

    if (entry.linesPct < floorPct) {
      findings.push({
        packageDir: entry.packageDir,
        metric: 'lines',
        actualPct: entry.linesPct,
        floorPct,
      });
    }

    if (entry.statementsPct < floorPct) {
      findings.push({
        packageDir: entry.packageDir,
        metric: 'statements',
        actualPct: entry.statementsPct,
        floorPct,
      });
    }
  }

  return findings;
}

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
  /**
   * Which fact this finding is about.
   *
   * `lines` and `statements` are measurements under a floor. `files` is a package that was rolled
   * up and contributed no file. `undetermined` is a floor with no roll up at all, which is a fact
   * the run could not establish rather than a measurement.
   */
  readonly metric: 'lines' | 'statements' | 'files' | 'undetermined';
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
 * THE LOOP OVER THE ROLL UP IS NOT THE WHOLE COMPARISON AND USED TO BE. `aggregateByPackage` maps
 * over the package directories it is handed, which the gate reads off the disk, so a floor naming a
 * directory that is not there produced no roll up entry and this function iterated past it: the
 * floor was compared with nothing and the run went green. Executed against the real library, floors
 * of `{core, ghost}` over directories of `['core']` returned `failed: false` on a green suite and
 * named `ghost` nowhere. The STANDARDS 9.1 reconciliation would have caught it in the other
 * direction, but that half needs `ai-docs/`, which is git excluded and no clone restores, so on a
 * clone nothing anywhere named it. It is the same class as the zero over zero reading below and one
 * step earlier: a package with no files at least reached a comparison.
 *
 * A FLOOR WITH NOTHING TO MEASURE IS UNDETERMINED AND UNDETERMINED FAILS. The two are reported
 * separately because they have two causes: `files` is a directory that was rolled up and gave
 * nothing, `undetermined` is a directory that was never rolled up at all, and a message naming the
 * wrong one sends a reader to the wrong place.
 *
 * @param coverage - Per package coverage
 * @param floors - Floor percentage per package directory
 * @returns One finding per metric below its floor, and one per floor nothing measured
 */
export function checkCoverageFloors(
  coverage: readonly PackageCoverage[],
  floors: Readonly<Record<string, number>>,
): CoverageFinding[] {
  const findings: CoverageFinding[] = [];
  const rolledUp = new Set(coverage.map((entry) => entry.packageDir));

  for (const packageDir of Object.keys(floors).sort()) {
    if (rolledUp.has(packageDir)) continue;

    findings.push({
      packageDir,
      metric: 'undetermined',
      actualPct: 0,
      floorPct: floors[packageDir] ?? 0,
    });
  }

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

/**
 * One finding as the line a reader gets, with the three causes told apart.
 *
 * THE THIRD LINE IS THE ONE THAT DID NOT EXIST. A floor over a directory nothing rolled up says so
 * in the word the rule uses: a check that cannot determine a fact reports it as undetermined and
 * never defaults to the answer that means success.
 *
 * @param violation - The finding
 * @returns The line
 */
function messageFor(violation: CoverageFinding): string {
  if (violation.metric === 'undetermined') {
    return (
      `${violation.packageDir}: its floor of ${String(violation.floorPct)}% is UNDETERMINED, not ` +
      `met: no packages/${violation.packageDir}/ directory was rolled up by this run, so nothing ` +
      `was compared with the floor at all`
    );
  }

  if (violation.metric === 'files') {
    return (
      `${violation.packageDir}: no file was measured at all, so its floor of ` +
      `${String(violation.floorPct)}% was met by measuring none of it`
    );
  }

  return (
    `${violation.packageDir}: ${violation.metric} ${violation.actualPct.toFixed(2)}% is ` +
    `below the floor of ${String(violation.floorPct)}%`
  );
}

/** What one run of the suite under coverage left behind. */
export interface CoverageRun {
  /** Whether every case passed. */
  readonly suitePassed: boolean;
  /** What the suite printed, for the line that reports a failure. */
  readonly output: string;
  /** The summary this run wrote, or null when this run wrote none. */
  readonly summary: CoverageSummary | null;
}

/** What the coverage half of the gate has to say about one run. */
export interface CoverageVerdict {
  /** Lines that report a measurement, printed whether or not anything failed. */
  readonly notes: readonly string[];
  /** Lines that fail the gate. */
  readonly errors: readonly string[];
  /** Whether this half found anything. */
  readonly failed: boolean;
}

/**
 * Everything one coverage run establishes: the failure if there was one, the coverage it measured,
 * and every floor that is under.
 *
 * THIS FUNCTION EXISTS BECAUSE THE GATE USED TO RETURN BEFORE ANY OF THE SECOND AND THIRD. A run
 * with one red case reported that one red case and nothing else: the summary was never read, the
 * per package percentages were never printed, and no floor was compared with anything. So one red
 * budget case blinded every coverage floor in the repository at once, and the gate went quiet at
 * exactly the moment something was wrong, which is this project's own worst defect class. A red
 * suite and a floor under water are two different facts and a run can carry both.
 *
 * THE SUITE WAS ALSO WITHHOLDING THE DATA, WHICH IS THE HALF AN EARLY RETURN HID. Vitest's
 * `coverage.reportOnFailure` defaults to false, so a failing run writes no `coverage-summary.json`
 * at all: even a gate that read the file after a failure would have found the previous run's
 * numbers or none. The caller passes the flag that turns that off, and this function is given the
 * summary or null rather than a path, so a caller that cannot prove the file belongs to this run
 * hands over null instead of reading whatever is on disk.
 *
 * @param run - What the run did and what it wrote
 * @param packageDirs - Package directory names to roll coverage up by
 * @param floors - Floor percentage per package directory
 * @param summaryPath - Repository relative path of the summary, named in the message when absent
 * @returns The measurement, the violations and the failure, all three of them
 */
export function reportCoverageRun(
  run: CoverageRun,
  packageDirs: readonly string[],
  floors: Readonly<Record<string, number>>,
  summaryPath: string,
): CoverageVerdict {
  const notes: string[] = [];
  const errors: string[] = [];

  if (!run.suitePassed) {
    errors.push(`test run with coverage failed: ${run.output}`);
  }

  if (run.summary === null) {
    errors.push(
      `${summaryPath} was not written by this run, so NO FLOOR WAS CHECKED AGAINST THIS TREE. ` +
        (run.suitePassed
          ? 'The suite passed, so the json-summary reporter is not configured'
          : 'The suite failed before the reporter ran, so the failure above is the only thing ' +
            'this run establishes and the coverage of every package is unknown rather than met'),
    );

    return { notes, errors, failed: true };
  }

  const perPackage = aggregateByPackage(run.summary, packageDirs);
  const violations = checkCoverageFloors(perPackage, floors);

  for (const entry of perPackage) {
    const floor = floors[entry.packageDir];
    const floorText = floor === undefined ? 'no floor yet' : `floor ${String(floor)}%`;
    notes.push(
      `${entry.packageDir}: lines ${entry.linesPct.toFixed(2)}%, statements ` +
        `${entry.statementsPct.toFixed(2)}%, ${String(entry.fileCount)} file(s), ${floorText}`,
    );
  }

  for (const violation of violations) {
    errors.push(messageFor(violation));
  }

  return { notes, errors, failed: !run.suitePassed || violations.length > 0 };
}

/**
 * The floors STANDARDS 9.1 states in prose, read out of its own table.
 *
 * THE TABLE IS FOUND BY ITS HEADING AND THE ROWS BY THEIR CELLS, which is how the document writes
 * them: a `### 9.1` heading, a two column table of package against target, and each target a
 * percentage with a trailing `+`. Returning `null` rather than an empty record when the section or
 * its table is not there is the whole point of the shape: an unreadable table would otherwise
 * reconcile with everything, which is a proof of absence passing because the subject was absent.
 *
 * @param standards - Full text of `ai-docs/00-overview/PROJECT-STANDARDS.md`
 * @returns The floors by package directory, or null when section 9.1 has no readable table
 */
export function parseFloorTable(standards: string): Record<string, number> | null {
  const heading = /^### 9\.1 /m.exec(standards);
  if (heading === null) return null;

  const rest = standards.slice(heading.index + heading[0].length);
  const end = /^#{2,3} /m.exec(rest);
  const body = end === null ? rest : rest.slice(0, end.index);

  const floors: Record<string, number> = {};
  for (const line of body.split('\n')) {
    const row = /^\|\s*([A-Za-z0-9@/-]+)\s*\|\s*(\d+)%\+?\s*\|/.exec(line.trim());
    if (row === null) continue;

    floors[row[1] ?? ''] = Number(row[2]);
  }

  return Object.keys(floors).length === 0 ? null : floors;
}

/**
 * STANDARDS 9.1 and the committed floors, reconciled in both directions.
 *
 * WHY BOTH DIRECTIONS AND NOT ONLY THE ONE THAT LOOKS DANGEROUS. A floor in the configuration with
 * no row in the document is a threshold nobody agreed to, and a row in the document with no entry
 * in the configuration is a promise nothing enforces; the second is the one that already happened,
 * for the length of a whole milestone, to `packages/federation`. Comparing one direction would have
 * been green through it.
 *
 * @param documented - The table as STANDARDS 9.1 writes it
 * @param floors - What the gate enforces
 * @returns One message per disagreement, empty when the two agree exactly
 */
export function checkFloorTable(
  documented: Readonly<Record<string, number>>,
  floors: Readonly<Record<string, number>>,
  publishedDirs: readonly string[] = [],
): string[] {
  const messages: string[] = [];

  // THE THIRD DIRECTION, ADDED AT `T065`, AND IT IS THE ONE THAT WOULD HAVE CAUGHT THE DEFECT THAT
  // MADE THE OTHER TWO WORTH HAVING. The two loops below reconcile the table with the constant and
  // the constant with the table, and both are silent about a package that is in neither. That is
  // how `@openref/theme-telltale` shipped publishable for five milestones at the lowest coverage of
  // any published package with nothing able to notice: the gate printed `no floor yet` beside it
  // and passed. Governing a package is still a decision and this does not take it; what it refuses
  // is taking it by not looking.
  for (const packageDir of [...publishedDirs].sort()) {
    if (floors[packageDir] !== undefined || documented[packageDir] !== undefined) continue;

    messages.push(
      `[floor-ungoverned] ${packageDir} is published and neither STANDARDS 9.1 nor ` +
        `COVERAGE_FLOORS carries it, so it ships governed by nothing. Give it a row and an entry, ` +
        `or record in STANDARDS 9.1 why it is declined`,
    );
  }

  for (const [packageDir, target] of Object.entries(documented).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const floor = floors[packageDir];

    if (floor === undefined) {
      messages.push(
        `[floor-unenforced] STANDARDS 9.1 gives ${packageDir} a target of ${String(target)}% and ` +
          `COVERAGE_FLOORS has no entry for it, so the table promises a floor nothing measures`,
      );
      continue;
    }

    if (floor !== target) {
      messages.push(
        `[floor-disagrees] STANDARDS 9.1 gives ${packageDir} a target of ${String(target)}% and ` +
          `COVERAGE_FLOORS enforces ${String(floor)}%`,
      );
    }
  }

  for (const packageDir of Object.keys(floors).sort()) {
    if (documented[packageDir] !== undefined) continue;

    messages.push(
      `[floor-undocumented] COVERAGE_FLOORS enforces ${String(floors[packageDir])}% on ` +
        `${packageDir} and STANDARDS 9.1 has no row for it, so a threshold is applied that the ` +
        `governed table does not carry`,
    );
  }

  return messages;
}

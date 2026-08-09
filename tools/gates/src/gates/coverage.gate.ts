import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE_FLOORS, PACKAGE_DIRS } from '../config.js';
import { aggregateByPackage, checkCoverageFloors, type CoverageSummary } from '../lib/coverage.js';
import { runCommand } from '../lib/exec.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

const SUMMARY_PATH = 'coverage/coverage-summary.json';

/**
 * Runs the suite with coverage and checks the per package floors from STANDARDS 9.1.
 *
 * Coverage is produced here rather than reused from a previous run so that the gate can
 * never pass on stale data.
 */
export const coverageGate: Gate = {
  id: 'coverage',
  title: 'Coverage floors',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];

    const run = runCommand(
      'pnpm',
      ['exec', 'vitest', 'run', '--coverage', '--silent', '--reporter=dot'],
      context.repoRoot,
    );

    if (!run.ok) {
      findings.push({
        level: 'error',
        message: `test run with coverage failed: ${`${run.stdout}${run.stderr}`.trim().slice(-4000)}`,
      });

      return Promise.resolve({
        id: coverageGate.id,
        title: coverageGate.title,
        status: 'fail',
        findings,
      });
    }

    const summaryPath = join(context.repoRoot, SUMMARY_PATH);
    if (!existsSync(summaryPath)) {
      findings.push({
        level: 'error',
        message: `${SUMMARY_PATH} was not produced; the json-summary reporter is not configured`,
      });

      return Promise.resolve({
        id: coverageGate.id,
        title: coverageGate.title,
        status: 'fail',
        findings,
      });
    }

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as CoverageSummary;
    const perPackage = aggregateByPackage(summary, PACKAGE_DIRS);
    const violations = checkCoverageFloors(perPackage, COVERAGE_FLOORS);

    for (const entry of perPackage) {
      const floor = COVERAGE_FLOORS[entry.packageDir];
      const floorText = floor === undefined ? 'no floor yet' : `floor ${String(floor)}%`;
      findings.push({
        level: 'info',
        message: `${entry.packageDir}: lines ${entry.linesPct.toFixed(2)}%, statements ${entry.statementsPct.toFixed(2)}%, ${String(entry.fileCount)} file(s), ${floorText}`,
      });
    }

    for (const violation of violations) {
      findings.push({
        level: 'error',
        message: `${violation.packageDir}: ${violation.metric} ${violation.actualPct.toFixed(2)}% is below the floor of ${String(violation.floorPct)}%`,
      });
    }

    return Promise.resolve({
      id: coverageGate.id,
      title: coverageGate.title,
      status: violations.length > 0 ? 'fail' : 'pass',
      findings,
    });
  },
};

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE_FLOORS, STANDARDS_FILE } from '../config.js';
import { AI_DOCS_DIR, aiDocsPresent } from '../lib/ai-docs.js';
import {
  aggregateByPackage,
  checkCoverageFloors,
  checkFloorTable,
  parseFloorTable,
  type CoverageSummary,
} from '../lib/coverage.js';
import { runCommand } from '../lib/exec.js';
import { readPackageDirs } from '../lib/package-dirs.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

const SUMMARY_PATH = 'coverage/coverage-summary.json';

/**
 * STANDARDS 9.1's table and `COVERAGE_FLOORS`, reconciled where the document is on the machine.
 *
 * ADDED BY THE POST-`T054` REVIEW, WHICH FOUND TWO COPIES OF ONE TABLE AND NO RUNNER OVER EITHER.
 * `T054` wrote a `federation` row into both in one change, correctly and by hand, and nothing
 * anywhere would have failed had it written one. That is the shape the claims gate exists for on
 * SPEC 20's numbers, one document short of a check.
 *
 * @param repoRoot - Absolute repository root
 * @returns The findings, and whether the document was there to read at all
 */
function reconcileWithStandards(repoRoot: string): {
  readonly read: boolean;
  readonly findings: GateFinding[];
  readonly errors: string[];
} {
  const path = join(repoRoot, STANDARDS_FILE);
  if (!aiDocsPresent(repoRoot) || !existsSync(path))
    return { read: false, findings: [], errors: [] };

  const documented = parseFloorTable(readFileSync(path, 'utf8'));

  // A CHECK THAT CANNOT DETERMINE ITS FACT SAYS SO RATHER THAN PASSING, which is the reader-pages
  // rule and the reason `parseFloorTable` answers null instead of an empty record: a renamed
  // section would otherwise reconcile with every floor in the configuration.
  if (documented === null) {
    return {
      read: true,
      findings: [],
      errors: [
        `[floor-table-unreadable] ${STANDARDS_FILE} carries no readable section 9.1 coverage ` +
          `table, so neither direction of this reconciliation could be checked at all`,
      ],
    };
  }

  return {
    read: true,
    findings: [
      {
        level: 'info',
        message:
          `STANDARDS 9.1 states ${String(Object.keys(documented).length)} floor(s): ` +
          Object.entries(documented)
            .map(([packageDir, target]) => `${packageDir} ${String(target)}%`)
            .join(', '),
      },
    ],
    errors: checkFloorTable(documented, COVERAGE_FLOORS),
  };
}

/**
 * Runs the suite with coverage and checks the per package floors from STANDARDS 9.1.
 *
 * Coverage is produced here rather than reused from a previous run so that the gate can
 * never pass on stale data.
 *
 * THE FLOORS ARE ENFORCED WHEREVER THIS RUNS AND RECONCILED ONLY WHERE THE DOCUMENT IS. The
 * measurement, the floors and every violation need no `ai-docs/`, so they happen on a clone and
 * fail there; what needs the directory is the comparison with the governed table STANDARDS 9.1
 * carries. So this reports `skip` exactly as `reader-pages` and `static-suites` do, when the
 * enforcing half is clean and the document half alone went unread, and the message says which
 * half that was.
 */
export const coverageGate: Gate = {
  id: 'coverage',
  title: 'Coverage floors, reconciled with STANDARDS 9.1',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];

    // THE DOCUMENT HALF GOES FIRST, AND THAT ORDER IS THE FIX FOR A DEFECT THIS GATE SHIPPED WITH.
    // It ran last, after two early returns, so a failing suite or an absent summary took the gate
    // red before the reconciliation was reached and its result was never printed: proving the
    // desync red needed the suite made green first, which is a check that reports only when
    // nothing else is wrong. It reads one file and starts no process, so nothing is paid for
    // running it here, and both failures can now be reported from one run.
    const reconciliation = reconcileWithStandards(context.repoRoot);
    findings.push(...reconciliation.findings);

    if (!reconciliation.read) {
      findings.push({
        level: 'warning',
        message:
          `SKIPPED, NOT PASSED, AND THE SKIP COVERS THE STANDARDS 9.1 HALF ONLY: ${AI_DOCS_DIR}/ ` +
          `is not present, so ${STANDARDS_FILE}'s coverage table was not compared with ` +
          `COVERAGE_FLOORS and this run proves nothing about that document. The half that needs ` +
          `no document still ran and can still fail: the suite was measured with coverage and ` +
          `every committed floor was enforced against it, which is what the errors below or ` +
          `their absence report. ${AI_DOCS_DIR}/ is excluded from git in .git/info/exclude and ` +
          `no clone restores it, so a checkout without it is expected rather than broken.`,
      });
    }

    for (const message of reconciliation.errors) findings.push({ level: 'error', message });

    /**
     * The result, with the reconciliation's own verdict folded in whichever way the run ended.
     *
     * @param failed - Whether the coverage half found something
     * @returns The gate result
     */
    const resultOf = (failed: boolean): GateResult => ({
      id: coverageGate.id,
      title: coverageGate.title,
      ...(failed || reconciliation.errors.length > 0
        ? { status: 'fail' as const }
        : reconciliation.read
          ? { status: 'pass' as const }
          : { status: 'skip' as const, skipReason: 'ai-docs-absent' as const }),
      findings,
    });

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

      return Promise.resolve(resultOf(true));
    }

    const summaryPath = join(context.repoRoot, SUMMARY_PATH);
    if (!existsSync(summaryPath)) {
      findings.push({
        level: 'error',
        message: `${SUMMARY_PATH} was not produced; the json-summary reporter is not configured`,
      });

      return Promise.resolve(resultOf(true));
    }

    const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as CoverageSummary;
    const perPackage = aggregateByPackage(summary, readPackageDirs(context.repoRoot));
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
        message:
          violation.metric === 'files'
            ? `${violation.packageDir}: no file was measured at all, so its floor of ${String(violation.floorPct)}% was met by measuring none of it`
            : `${violation.packageDir}: ${violation.metric} ${violation.actualPct.toFixed(2)}% is below the floor of ${String(violation.floorPct)}%`,
      });
    }

    return Promise.resolve(resultOf(violations.length > 0));
  },
};

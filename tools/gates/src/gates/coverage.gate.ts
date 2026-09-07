import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { COVERAGE_FLOORS, PUBLISHED_PACKAGES, STANDARDS_FILE } from '../config.js';
import { AI_DOCS_DIR, aiDocsPresent } from '../lib/ai-docs.js';
import {
  checkFloorTable,
  parseFloorTable,
  reportCoverageRun,
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
    errors: checkFloorTable(documented, COVERAGE_FLOORS, publishedPackageDirs()),
  };
}

/**
 * Runs the suite with coverage and checks the per package floors from STANDARDS 9.1.
 *
 * Coverage is produced here rather than reused from a previous run so that the gate can
 * never pass on stale data. Since the maintainer's ruling of 2026-09-04 it is also produced when
 * the run is red, and reported beside the failure.
 *
 * A RED CASE USED TO BLIND EVERY FLOOR IN THE REPOSITORY AT ONCE, and the maintainer called that
 * worse than any of the seven defects the same pass found, because it is a gate that goes quiet
 * exactly when something is wrong. One failing case anywhere returned here with the suite's output
 * and nothing else: no summary was read, no percentage was printed and no floor was compared with
 * anything, so `core` at 40 percent and `core` at 95 read identically for as long as one unrelated
 * case stayed red. THE CAUSE WAS IN TWO PLACES AND BOTH ARE FIXED HERE. The early return is one.
 * The other is that `coverage.reportOnFailure` defaults to false in Vitest, so the summary did not
 * exist to be read: a control flow fix alone would have printed that the file was missing.
 *
 * THE FLOORS ARE ENFORCED WHEREVER THIS RUNS AND RECONCILED ONLY WHERE THE DOCUMENT IS. The
 * measurement, the floors and every violation need no `ai-docs/`, so they happen on a clone and
 * fail there; what needs the directory is the comparison with the governed table STANDARDS 9.1
 * carries. So this reports `skip` exactly as `reader-pages` and `static-suites` do, when the
 * enforcing half is clean and the document half alone went unread, and the message says which
 * half that was.
 */
/**
 * The directory name of every published package, which is what the floor table is keyed by.
 *
 * `openref` IS `packages/cli`, WHICH IS WHY THIS IS A FUNCTION AND NOT A `map`. The published set
 * is npm names and the floor table is directory names, and the one that does not follow the scope
 * stripping rule is the one the CLI ships under.
 */
function publishedPackageDirs(): readonly string[] {
  return PUBLISHED_PACKAGES.map((name) =>
    name === 'openref' ? 'cli' : name.replace('@openref/', ''),
  );
}

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

    // THE SUMMARY GOES BEFORE THE RUN SO THAT ITS PRESENCE AFTERWARDS IS A PROOF AND NOT A GUESS.
    // The file is derived output and this gate produces it rather than reusing it, for the reason
    // the header states: a summary left by an earlier run reads exactly like one this run wrote,
    // and a gate that reported an older tree's percentages beside this tree's failure would be
    // worse than the one that reported nothing.
    const summaryPath = join(context.repoRoot, SUMMARY_PATH);
    rmSync(summaryPath, { force: true });

    // `--coverage.reportOnFailure` IS THE HALF OF THIS DEFECT THAT NO CONTROL FLOW COULD HAVE
    // FIXED. Vitest defaults it to false, so a run with one red case writes no summary at all: the
    // gate's early return threw away a measurement that had, in fact, never been taken. Passing it
    // here rather than in `vitest.config.ts` keeps it where the command that needs it lives, and it
    // relaxes nothing: it makes the report exist on exactly the runs that used to have none.
    const run = runCommand(
      'pnpm',
      [
        'exec',
        'vitest',
        'run',
        '--coverage',
        '--coverage.reportOnFailure',
        '--silent',
        '--reporter=dot',
      ],
      context.repoRoot,
    );

    // AND THE COVERAGE HALF NOW RUNS WHICHEVER WAY THE SUITE ENDED. A red case and a floor under
    // water are two facts, one run can carry both, and reporting only the first is a gate going
    // quiet at the moment something is wrong.
    const verdict = reportCoverageRun(
      {
        suitePassed: run.ok,
        output: `${run.stdout}${run.stderr}`.trim().slice(-4000),
        summary: existsSync(summaryPath)
          ? (JSON.parse(readFileSync(summaryPath, 'utf8')) as CoverageSummary)
          : null,
      },
      readPackageDirs(context.repoRoot),
      COVERAGE_FLOORS,
      SUMMARY_PATH,
    );

    for (const message of verdict.notes) findings.push({ level: 'info', message });
    for (const message of verdict.errors) findings.push({ level: 'error', message });

    return Promise.resolve(resultOf(verdict.failed));
  },
};

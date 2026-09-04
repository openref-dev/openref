import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { M6_MILESTONE, M6_MILESTONE_CLAUSES, M6_SUITE_COVERAGE, M6_SUITE_ROWS } from '../config.js';
import { readSpecHalf } from '../lib/projected-spec.js';
import { runCommand } from '../lib/exec.js';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkMilestoneClauses,
  checkStaticCoverage,
  type StaticSuiteIssue,
} from '../lib/static-suites.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The four SPEC 21 rows M6 closes and the M6 definition of done, run rather than described.
 *
 * IT IS THE `static-suites` MECHANISM POINTED AT FOUR ROWS AT ONCE, and four rather than one for a
 * reason `T059` states in its own sentence: "socket, bridge, samples and agent suites wired into
 * `pnpm gates`, including the bridge soak test". The three gates before this one each answer a
 * milestone that built one thing. M6 built four, and four gates reporting one milestone would put a
 * reader in front of four titles for one failure.
 *
 * THE ROWS ARE READ OUT OF THE SPECIFICATION AND RECONCILED IN BOTH DIRECTIONS, which is the rule
 * SPEC 21 itself states: a coverage a row names and no suite answers fails, and a coverage answered
 * here that no row names fails as well. Three of the four rows were written by `T059` before this
 * wiring existed; the fourth, `Bridge`, was written with the table and had no runner until now.
 *
 * THE SUITES ARE RUN, WHICH IS THE HALF THAT MAKES A GREEN GATE MEAN SOMETHING. Everything named in
 * the coverage list is a unit or integration suite that needs no browser and no broker, the soak
 * included, because the soak's producer is a loop and its clock is virtual.
 *
 * THE MILESTONE CLAUSES ARE CHECKED AND NOT RUN, per `checkMilestoneClauses` and for the reason the
 * M3, M4 and M5 clauses are held that way: every case they name is already run, either by the
 * coverage above or by `pnpm test:integration`, and running them again would report one red twice.
 */
export function runM6SuitesGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const issues: StaticSuiteIssue[] = [];

  const files = [...new Set(M6_SUITE_COVERAGE.flatMap((coverage) => coverage.files))].sort();

  const half = readSpecHalf(context.repoRoot, {
    rows: M6_SUITE_ROWS,
    milestone: M6_MILESTONE,
    coverageNames: M6_SUITE_COVERAGE.map((coverage) => coverage.spec),
    clauseNames: M6_MILESTONE_CLAUSES.map((clause) => clause.spec),
  });
  const haveSpec = half.read;
  const repository = {
    exists: (path: string): boolean => existsSync(join(context.repoRoot, path)),
    casesIn: (path: string): readonly string[] => {
      try {
        return caseTitlesIn(readFileSync(join(context.repoRoot, path), 'utf8'));
      } catch {
        return [];
      }
    },
    assertionlessIn: (path: string): readonly string[] => {
      try {
        return assertionlessCaseTitlesIn(readFileSync(join(context.repoRoot, path), 'utf8'));
      } catch {
        return [];
      }
    },
  };

  // EVERY ROW IS READ AND THE FOUR ARE THEN COMPARED WITH THE WIRING AS ONE SET. A per row
  // comparison would let a coverage move from one row to another without anything going red, and
  // "this coverage is on the Bridge row" is exactly the kind of fact the specification owns.
  //
  // A ROW THE TABLE DOES NOT CARRY IS AN ERROR AND NOT AN EMPTY LIST, which is the difference
  // between a check that failed and a check that could not run: `suiteRowOf` answers null for a
  // missing row and an empty array for a row with an empty cell, and reading the first as the
  // second would pass a specification that had lost the row entirely.
  const rowNames: string[] = [];
  const missingRows: string[] = [];
  if (haveSpec) {
    for (const row of M6_SUITE_ROWS) {
      const names = half.rows.get(row) ?? null;
      if (names === null) missingRows.push(row);
      else rowNames.push(...names);
    }
  }

  for (const row of missingRows) {
    findings.push({ level: 'error', message: `SPEC 21 has no ${row} row` });
  }

  issues.push(
    ...checkStaticCoverage(M6_SUITE_COVERAGE, {
      specNames: rowNames,
      row: M6_SUITE_ROWS.join(', '),
      ...repository,
      compareWithSpec: haveSpec && missingRows.length === 0,
    }),
  );

  issues.push(
    ...checkMilestoneClauses(M6_MILESTONE_CLAUSES, {
      milestone: M6_MILESTONE,
      clauses: haveSpec ? half.clauses : [],
      specNames: [],
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  if (haveSpec) {
    findings.push({
      level: 'info',
      message: `SPEC 21 rows ${M6_SUITE_ROWS.join(', ')} state ${String(rowNames.length)} coverage(s): ${rowNames.join(', ')}`,
    });

    const clauses = half.clauses;
    findings.push({
      level: 'info',
      message:
        clauses === null
          ? `SPEC 22 states no definition of done for ${M6_MILESTONE}`
          : `SPEC 22 ${M6_MILESTONE} is done when ${String(clauses.length)} clause(s) hold, each answered by named cases: ${clauses.join(' | ')}`,
    });
  }

  for (const message of half.errors) findings.push({ level: 'error', message });

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  // RUN ONLY WHEN THE WIRING READS, the Static gate's rule: running suites over a list already
  // known to be wrong reports a second failure about the first one.
  if (!findings.some((finding) => finding.level === 'error')) {
    const run = runCommand(
      'pnpm',
      ['exec', 'vitest', 'run', '--silent', '--reporter=dot', ...files],
      context.repoRoot,
    );

    if (!run.ok) {
      findings.push({
        level: 'error',
        message: `the SPEC 21 M6 suites failed: ${`${run.stdout}${run.stderr}`.trim().slice(-4000)}`,
      });
    } else {
      for (const coverage of M6_SUITE_COVERAGE) {
        findings.push({
          level: 'info',
          message: `${coverage.id} (${coverage.spec}): ${String(coverage.cases.length)} named case(s) over ${String(coverage.files.length)} suite(s), green`,
        });
      }
    }
  }

  const failed = findings.some((finding) => finding.level === 'error');

  return {
    id: m6SuitesGate.id,
    title: m6SuitesGate.title,
    status: failed ? 'fail' : 'pass',
    findings,
  };
}

export const m6SuitesGate: Gate = {
  id: 'm6-suites',
  title: 'The four SPEC 21 rows M6 closes have runners, and M6 has one for its definition of done',

  run(context): Promise<GateResult> {
    return Promise.resolve(runM6SuitesGate(context));
  },
};

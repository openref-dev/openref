import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MILESTONE_CLAUSE_COVERAGE,
  MILESTONE_UNDER_GATE,
  STATIC_BUDGET_JOB,
  STATIC_SUITE_COVERAGE,
  STATIC_SUITE_ROW,
} from '../config.js';
import { readSpecHalf } from '../lib/projected-spec.js';
import { runCommand } from '../lib/exec.js';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkBudgetJob,
  checkMilestoneClauses,
  checkStaticCoverage,
  type StaticSuiteIssue,
} from '../lib/static-suites.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The Static row of SPEC 21, run rather than described.
 *
 * FOUR COVERAGES WERE WRITTEN AND NONE OF THEM WAS WIRED. T039 and T040 built determinism,
 * incrementality, SEO markup and proxy config suites, and the only thing tying those four to the
 * four words SPEC 21 states was a person reading two documents at once. A suite renamed, deleted or
 * emptied left the table promising a coverage that had stopped existing, which is the same shape as
 * every stale list this repository has already had to fix.
 *
 * SO THIS GATE DOES THREE THINGS AND THE FIRST IS THE ONE THAT MATTERS. It reads the coverage names
 * out of SPEC 21 itself and matches them against the wiring in both directions, so the gate's
 * subject is the specification rather than a copy of it kept beside it. It requires each coverage's
 * named cases to be present, so a suite emptied of everything but its filename fails. And it runs
 * the suites, so a green gate run means the four coverages passed on this tree rather than that
 * their files exist.
 *
 * THE FOURTH THING IS ABOUT A MACHINE AND NOT A SUITE. SPEC 20 bounds the static build of 1000
 * nodes on four cores at sixty seconds, and until T042 that assertion ran wherever the suite landed,
 * which T039 recorded as making it a hang catcher rather than a budget. The elapsed figure now
 * certifies only where the runner size is declared, and this checks the job that declares it, since
 * a deleted job would otherwise turn certification off with nothing anywhere saying so.
 *
 * AND THE FIFTH IS THE MILESTONE ITSELF. M3's definition of done in SPEC 22 is three clauses, and
 * one of them had a case naming the clause it answers while the other two were answered by suites
 * nobody had tied to the milestone: they ran in CI, they proved the right things, and renaming
 * either would have left SPEC 22 promising a proof with nothing behind it. The clauses are read out
 * of SPEC 22 and reconciled with the wiring in both directions, exactly as the row is. They are not
 * run here, and the reason is written on `checkMilestoneClauses`: they are `packages/cli` suites
 * that `pnpm test` and `pnpm test:integration` already run, and what was missing was the tie.
 */
export function runStaticSuitesGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const issues: StaticSuiteIssue[] = [];

  const files = [...new Set(STATIC_SUITE_COVERAGE.flatMap((coverage) => coverage.files))].sort();

  const half = readSpecHalf(context.repoRoot, {
    rows: [STATIC_SUITE_ROW],
    milestone: MILESTONE_UNDER_GATE,
    coverageNames: STATIC_SUITE_COVERAGE.map((coverage) => coverage.spec),
    clauseNames: MILESTONE_CLAUSE_COVERAGE.map((clause) => clause.spec),
  });
  const haveSpec = half.read;
  const names = half.rows.get(STATIC_SUITE_ROW) ?? null;
  const clauses = half.clauses;
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

  // THE ROW HALF NEEDS `ai-docs/` AND THE OTHER THREE DO NOT, which is why they are separate rather
  // than skipped together. A checkout with no private documents can still be told that a named
  // suite has gone, that a named case has gone, that the budget job has gone, or that the four
  // suites are red, and each of those is a failure there as much as here.
  issues.push(
    ...checkStaticCoverage(STATIC_SUITE_COVERAGE, {
      specNames: haveSpec ? names : [],
      ...repository,
      // With no specification to read, the row half is not answered here and says so below rather
      // than reporting four coverages nobody stated.
      compareWithSpec: haveSpec,
    }),
  );

  // AND THE MILESTONE'S OWN DEFINITION OF DONE, SINCE T042, for the reason the row half exists.
  // T042's done-when is that CI proves the M3 DoD without manual steps, and M3 is done when three
  // sentences hold. One of them had a case naming the clause it answers and the other two were
  // answered by suites nothing tied to the milestone, so a rename would have been silent.
  issues.push(
    ...checkMilestoneClauses(MILESTONE_CLAUSE_COVERAGE, {
      milestone: MILESTONE_UNDER_GATE,
      clauses: haveSpec ? clauses : [],
      specNames: [],
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  if (haveSpec) {
    findings.push({
      level: 'info',
      message:
        names === null
          ? `SPEC 21 has no ${STATIC_SUITE_ROW} row`
          : `SPEC 21 row ${STATIC_SUITE_ROW} states ${String(names.length)} coverage(s): ${names.join(', ')}`,
    });
    findings.push({
      level: 'info',
      message:
        clauses === null
          ? `SPEC 22 states no definition of done for ${MILESTONE_UNDER_GATE}`
          : `SPEC 22 ${MILESTONE_UNDER_GATE} is done when ${String(clauses.length)} clause(s) hold, each answered by named cases: ${clauses.join(' | ')}`,
    });
  }

  for (const message of half.errors) findings.push({ level: 'error', message });

  const workflowPath = join(context.repoRoot, STATIC_BUDGET_JOB.workflow);
  if (existsSync(workflowPath)) {
    issues.push(...checkBudgetJob(readFileSync(workflowPath, 'utf8'), STATIC_BUDGET_JOB));
  } else {
    issues.push({
      rule: 'workflow-missing',
      message: `${STATIC_BUDGET_JOB.workflow} is not in the repository, so nothing runs the SPEC 20 elapsed budget on a declared machine`,
    });
  }

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  // THE SUITES ARE RUN ONLY WHEN THE WIRING READS, deliberately. Running them over a list already
  // known to be wrong would report a second failure about the first one, and the file a reader has
  // to open is named by the wiring finding rather than by a vitest summary.
  if (issues.length === 0) {
    const run = runCommand(
      'pnpm',
      ['exec', 'vitest', 'run', '--silent', '--reporter=dot', ...files],
      context.repoRoot,
    );

    if (!run.ok) {
      findings.push({
        level: 'error',
        message: `the SPEC 21 Static suites failed: ${`${run.stdout}${run.stderr}`.trim().slice(-4000)}`,
      });
    } else {
      for (const coverage of STATIC_SUITE_COVERAGE) {
        findings.push({
          level: 'info',
          message: `${coverage.id} (${coverage.spec}): ${String(coverage.cases.length)} named case(s) over ${String(coverage.files.length)} suite(s), green`,
        });
      }

      findings.push({
        level: 'info',
        message: `${String(files.length)} static suite file(s) ran here, and the elapsed budget of SPEC 20 certifies in the ${STATIC_BUDGET_JOB.job} job on a ${String(STATIC_BUDGET_JOB.cores)} core runner`,
      });
    }
  }

  const failed = findings.some((finding) => finding.level === 'error');

  return {
    id: staticSuitesGate.id,
    title: staticSuitesGate.title,
    status: failed ? 'fail' : 'pass',
    findings,
  };
}

export const staticSuitesGate: Gate = {
  id: 'static-suites',
  title: 'The SPEC 21 Static row has a runner, and the elapsed budget has a machine',

  run(context): Promise<GateResult> {
    return Promise.resolve(runStaticSuitesGate(context));
  },
};

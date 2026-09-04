import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FEDERATION_BUDGET_SUITE,
  FEDERATION_MILESTONE,
  FEDERATION_MILESTONE_CLAUSES,
  FEDERATION_SUITE_COVERAGE,
  FEDERATION_SUITE_ROW,
} from '../config.js';
import { readSpecHalf } from '../lib/projected-spec.js';
import { runCommand } from '../lib/exec.js';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkMilestoneClauses,
  checkStaticCoverage,
  checkSuiteFiles,
  type StaticSuiteIssue,
} from '../lib/static-suites.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The Federation row of SPEC 21 and the M4 definition of done, run rather than described.
 *
 * IT IS THE `static-suites` MECHANISM POINTED AT THE ROW M4 CLOSES, and it is a gate of its own
 * rather than a second half of that one because the two rows belong to two milestones: the Static
 * row is M3's and stays exactly as it was, and a row failing here has to name federation in the
 * summary rather than arrive under a title about static builds.
 *
 * WHAT `T047` ASKS FOR IS "FEDERATION SUITES WIRED INTO `pnpm gates`", AND WIRING BY FILE PATH IS
 * THE THING THIS REPOSITORY HAS ALREADY FOUND TO BE WORTH LESS THAN IT READS. A list of paths
 * proves the files exist. What SPEC 21 states is three coverages, so the subject of the check is
 * that row, read out of the specification and reconciled with the wiring in both directions: a
 * coverage the table names and no suite answers fails, and a coverage answered here that the table
 * does not name fails as well.
 *
 * THE SUITES ARE RUN, WHICH IS THE HALF THAT MAKES A GREEN GATE MEAN SOMETHING. The federation
 * suites are unit and integration files that need no built artefact and no browser, so a gate run
 * proves the three coverages passed on this tree rather than that their files are present.
 *
 * THE MILESTONE CLAUSE IS CHECKED AND NOT RUN, per `checkMilestoneClauses`: it is answered by a
 * `packages/nest` integration suite that boots the three service demo, which `pnpm test:integration`
 * already runs, and booting it again here would report one red twice. The tripled budget suite of
 * `T047` is held the same way, through `FEDERATION_BUDGET_SUITE`, because no specification
 * sentence names it and nothing else would have noticed it gone.
 */
export function runFederationSuitesGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const issues: StaticSuiteIssue[] = [];

  const files = [
    ...new Set(FEDERATION_SUITE_COVERAGE.flatMap((coverage) => coverage.files)),
  ].sort();

  const half = readSpecHalf(context.repoRoot, {
    rows: [FEDERATION_SUITE_ROW],
    milestone: FEDERATION_MILESTONE,
    coverageNames: FEDERATION_SUITE_COVERAGE.map((coverage) => coverage.spec),
    clauseNames: FEDERATION_MILESTONE_CLAUSES.map((clause) => clause.spec),
  });
  const haveSpec = half.read;
  const names = half.rows.get(FEDERATION_SUITE_ROW) ?? null;
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

  // THE ROW HALF NEEDS `ai-docs/` AND THE SUITE HALF DOES NOT, which is why they are separate here
  // as they are in the Static gate. A checkout with no private documents can still be told that a
  // named suite has gone, that a named case has gone, or that the suites are red.
  issues.push(
    ...checkStaticCoverage(FEDERATION_SUITE_COVERAGE, {
      specNames: haveSpec ? names : [],
      row: FEDERATION_SUITE_ROW,
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  issues.push(
    ...checkMilestoneClauses(FEDERATION_MILESTONE_CLAUSES, {
      milestone: FEDERATION_MILESTONE,
      clauses: haveSpec ? clauses : [],
      specNames: [],
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  // THE TRIPLED BUDGET SUITE IS THE GATE'S OWN AND HAS NO SPEC HALF: no SPEC 21 name and no SPEC
  // 22 clause states it, so it is held by the repository check alone, which is what makes its
  // deletion, a renamed case or a gutted case go red instead of leaving `pnpm gates` green.
  issues.push(...checkSuiteFiles(FEDERATION_BUDGET_SUITE, { specNames: [], ...repository }));

  if (haveSpec) {
    findings.push({
      level: 'info',
      message:
        names === null
          ? `SPEC 21 has no ${FEDERATION_SUITE_ROW} row`
          : `SPEC 21 row ${FEDERATION_SUITE_ROW} states ${String(names.length)} coverage(s): ${names.join(', ')}`,
    });
    findings.push({
      level: 'info',
      message:
        clauses === null
          ? `SPEC 22 states no definition of done for ${FEDERATION_MILESTONE}`
          : `SPEC 22 ${FEDERATION_MILESTONE} is done when ${String(clauses.length)} clause(s) hold, each answered by named cases: ${clauses.join(' | ')}`,
    });
  }

  for (const message of half.errors) findings.push({ level: 'error', message });

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  // RUN ONLY WHEN THE WIRING READS, the Static gate's rule: running suites over a list already
  // known to be wrong reports a second failure about the first one.
  if (issues.length === 0) {
    const run = runCommand(
      'pnpm',
      ['exec', 'vitest', 'run', '--silent', '--reporter=dot', ...files],
      context.repoRoot,
    );

    if (!run.ok) {
      findings.push({
        level: 'error',
        message: `the SPEC 21 ${FEDERATION_SUITE_ROW} suites failed: ${`${run.stdout}${run.stderr}`.trim().slice(-4000)}`,
      });
    } else {
      for (const coverage of FEDERATION_SUITE_COVERAGE) {
        findings.push({
          level: 'info',
          message: `${coverage.id} (${coverage.spec}): ${String(coverage.cases.length)} named case(s) over ${String(coverage.files.length)} suite(s), green`,
        });
      }

      for (const suite of FEDERATION_BUDGET_SUITE) {
        findings.push({
          level: 'info',
          message: `${suite.id} (${suite.spec}): ${String(suite.cases.length)} named case(s) present and asserting, checked here and run by pnpm test:integration`,
        });
      }
    }
  }

  const failed = findings.some((finding) => finding.level === 'error');

  return {
    id: federationSuitesGate.id,
    title: federationSuitesGate.title,
    status: failed ? 'fail' : 'pass',
    findings,
  };
}

export const federationSuitesGate: Gate = {
  id: 'federation-suites',
  title: 'The SPEC 21 Federation row has a runner, and M4 has one for its definition of done',

  run(context): Promise<GateResult> {
    return Promise.resolve(runFederationSuitesGate(context));
  },
};

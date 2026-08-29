import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EVENTS_MILESTONE,
  EVENTS_MILESTONE_CLAUSES,
  EVENTS_SUITE_COVERAGE,
  EVENTS_SUITE_ROW,
  SPEC_FILE,
} from '../config.js';
import { AI_DOCS_DIR, aiDocsPresent } from '../lib/ai-docs.js';
import { runCommand } from '../lib/exec.js';
import {
  assertionlessCaseTitlesIn,
  caseTitlesIn,
  checkMilestoneClauses,
  checkStaticCoverage,
  milestoneClausesOf,
  suiteRowOf,
  type StaticSuiteIssue,
} from '../lib/static-suites.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The Events row of SPEC 21 and the M5 definition of done, run rather than described.
 *
 * IT IS THE `static-suites` MECHANISM POINTED AT THE ROW M5 CLOSES, the third time, and it is a
 * gate of its own for the reason `federation-suites` is: the rows belong to three milestones, and
 * a coverage failing here has to name events in the summary rather than arrive under a title about
 * static builds or about federation.
 *
 * WHAT `T054` ASKS FOR IS "EVENT CORPUS, CHANNEL RENDERING, COLLECTOR AND TOPOLOGY SUITES WIRED
 * INTO `pnpm gates`", AND WIRING BY FILE PATH IS WORTH LESS THAN IT READS. A list of paths proves
 * the files exist. So SPEC 21 gained an `Events` row in the same slice, before this wiring, and
 * the subject of the check is that row, read out of the specification and reconciled with this
 * list in both directions: a coverage the table names and no suite answers fails, and a coverage
 * answered here that the table does not name fails as well.
 *
 * THE SUITES ARE RUN, WHICH IS THE HALF THAT MAKES A GREEN GATE MEAN SOMETHING. Every file named
 * is a unit or integration suite that needs no browser, so a gate run proves the four coverages
 * passed on this tree rather than that their files are present.
 *
 * THE MILESTONE CLAUSES ARE CHECKED AND NOT RUN, per `checkMilestoneClauses`: they are answered by
 * `packages/nest` integration suites that `pnpm test:integration` already runs, and booting an
 * application twice would report one red twice.
 */
export function runEventsSuitesGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const issues: StaticSuiteIssue[] = [];

  const files = [...new Set(EVENTS_SUITE_COVERAGE.flatMap((coverage) => coverage.files))].sort();

  const specPath = join(context.repoRoot, SPEC_FILE);
  const haveSpec = aiDocsPresent(context.repoRoot) && existsSync(specPath);
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
  // as they are in the two gates this one follows. A checkout with no private documents can still
  // be told that a named suite has gone, that a named case has gone, or that the suites are red.
  issues.push(
    ...checkStaticCoverage(EVENTS_SUITE_COVERAGE, {
      specNames: haveSpec ? suiteRowOf(readFileSync(specPath, 'utf8'), EVENTS_SUITE_ROW) : [],
      row: EVENTS_SUITE_ROW,
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  issues.push(
    ...checkMilestoneClauses(EVENTS_MILESTONE_CLAUSES, {
      milestone: EVENTS_MILESTONE,
      clauses: haveSpec ? milestoneClausesOf(readFileSync(specPath, 'utf8'), EVENTS_MILESTONE) : [],
      specNames: [],
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  if (haveSpec) {
    const spec = readFileSync(specPath, 'utf8');
    const names = suiteRowOf(spec, EVENTS_SUITE_ROW);
    const clauses = milestoneClausesOf(spec, EVENTS_MILESTONE);
    findings.push({
      level: 'info',
      message:
        names === null
          ? `SPEC 21 has no ${EVENTS_SUITE_ROW} row`
          : `SPEC 21 row ${EVENTS_SUITE_ROW} states ${String(names.length)} coverage(s): ${names.join(', ')}`,
    });
    findings.push({
      level: 'info',
      message:
        clauses === null
          ? `SPEC 22 states no definition of done for ${EVENTS_MILESTONE}`
          : `SPEC 22 ${EVENTS_MILESTONE} is done when ${String(clauses.length)} clause(s) hold, each answered by named cases: ${clauses.join(' | ')}`,
    });
  } else {
    findings.push({
      level: 'warning',
      message:
        `SKIPPED, NOT PASSED, AND THE SKIP COVERS THE SPEC HALF ONLY: ${AI_DOCS_DIR}/ is not ` +
        `present, so the SPEC 21 ${EVENTS_SUITE_ROW} row and the SPEC 22 ${EVENTS_MILESTONE} ` +
        `definition of done were not compared with this wiring, and this run proves nothing ` +
        `about either document. The suite half still ran and can still fail: every named suite ` +
        `file must be there, every named case must be present and assert something, and the ` +
        `coverage suites are run. ${AI_DOCS_DIR}/ is excluded from git in .git/info/exclude and ` +
        `no clone restores it, so a checkout without it is expected rather than broken. AWAITING ` +
        `THE MAINTAINER'S DECISION on how ${AI_DOCS_DIR}/ is versioned; until it is made, the ` +
        `document half can only run where the documents already are.`,
    });
  }

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
        message: `the SPEC 21 ${EVENTS_SUITE_ROW} suites failed: ${`${run.stdout}${run.stderr}`.trim().slice(-4000)}`,
      });
    } else {
      for (const coverage of EVENTS_SUITE_COVERAGE) {
        findings.push({
          level: 'info',
          message: `${coverage.id} (${coverage.spec}): ${String(coverage.cases.length)} named case(s) over ${String(coverage.files.length)} suite(s), green`,
        });
      }
    }
  }

  const failed = findings.some((finding) => finding.level === 'error');

  return {
    id: eventsSuitesGate.id,
    title: eventsSuitesGate.title,
    ...(failed
      ? { status: 'fail' as const }
      : haveSpec
        ? { status: 'pass' as const }
        : { status: 'skip' as const, skipReason: 'ai-docs-absent' as const }),
    findings,
  };
}

export const eventsSuitesGate: Gate = {
  id: 'events-suites',
  title: 'The SPEC 21 Events row has a runner, and M5 has one for its definition of done',

  run(context): Promise<GateResult> {
    return Promise.resolve(runEventsSuitesGate(context));
  },
};

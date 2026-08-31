import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  M7_DECLINED_SECTION,
  M7_DECLINED_TASK,
  M7_MILESTONE,
  M7_MILESTONE_CLAUSES,
  M7_SUITE_COVERAGE,
  M7_SUITE_ROWS,
  M7_TASKS,
  SPEC_FILE,
} from '../config.js';
import { AI_DOCS_DIR, aiDocsPresent } from '../lib/ai-docs.js';
import { parseAmendmentSections, parseMilestones, splitLines } from '../lib/build-manifest.js';
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
 * The SPEC 21 row M7 closes, the M7 definition of done, and the count of what M7 closes over.
 *
 * IT IS THE `static-suites` MECHANISM AGAIN, POINTED AT THE LAST MILESTONE BEFORE THE RELEASE
 * BLOCK. The row is written in the specification first, this gate reads it there rather than
 * beside the code, and the two are reconciled in both directions: a coverage the row names and no
 * suite answers fails, and a coverage answered here that no row names fails as well.
 *
 * AND IT COUNTS THE MILESTONE'S OWN BOXES, WHICH NO EARLIER GATE OF THIS FAMILY HAD TO DO. M7 is
 * `T061` and `T062`. `T060` is out of scope by the SPEC 10.2 decision of 2026-08-14, and BUILD.md
 * cannot lose a line, so its row stands unticked forever; the open `T060` section in
 * `ai-docs/BUILD-AMENDMENTS.md` is what makes the drop a mechanism rather than a memory. A gate
 * that read three unfinished tasks would report a fact it had misread, and one that quietly
 * counted two would be the silent weakening this repository refuses. So the reading is stated in
 * the output, and it fails if the section that justifies it is gone: the exclusion has to be
 * carried by a document, not by this file.
 *
 * THE SUITES ARE RUN. All eleven coverages are unit or integration suites that need no browser and
 * no broker; the heaviest, `nuxt-parity.spec.ts`, runs a real `nuxt generate` and a real server and
 * takes about fifteen seconds, which is the price of the one claim M7 is finished by.
 */
export function runM7SuitesGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const issues: StaticSuiteIssue[] = [];

  const files = [...new Set(M7_SUITE_COVERAGE.flatMap((coverage) => coverage.files))].sort();

  const specPath = join(context.repoRoot, SPEC_FILE);
  const haveSpec = aiDocsPresent(context.repoRoot) && existsSync(specPath);
  const spec = haveSpec ? readFileSync(specPath, 'utf8') : '';
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

  const rowNames: string[] = [];
  const missingRows: string[] = [];
  if (haveSpec) {
    for (const row of M7_SUITE_ROWS) {
      const names = suiteRowOf(spec, row);
      if (names === null) missingRows.push(row);
      else rowNames.push(...names);
    }
  }

  for (const row of missingRows) {
    findings.push({ level: 'error', message: `SPEC 21 has no ${row} row` });
  }

  issues.push(
    ...checkStaticCoverage(M7_SUITE_COVERAGE, {
      specNames: rowNames,
      row: M7_SUITE_ROWS.join(', '),
      ...repository,
      compareWithSpec: haveSpec && missingRows.length === 0,
    }),
  );

  issues.push(
    ...checkMilestoneClauses(M7_MILESTONE_CLAUSES, {
      milestone: M7_MILESTONE,
      clauses: haveSpec ? milestoneClausesOf(spec, M7_MILESTONE) : [],
      specNames: [],
      ...repository,
      compareWithSpec: haveSpec,
    }),
  );

  findings.push(...milestoneScope(context));

  if (haveSpec) {
    findings.push({
      level: 'info',
      message: `SPEC 21 row ${M7_SUITE_ROWS.join(', ')} states ${String(rowNames.length)} coverage(s): ${rowNames.join(', ')}`,
    });

    const clauses = milestoneClausesOf(spec, M7_MILESTONE);
    findings.push({
      level: 'info',
      message:
        clauses === null
          ? `SPEC 22 states no definition of done for ${M7_MILESTONE}`
          : `SPEC 22 ${M7_MILESTONE} is done when ${String(clauses.length)} clause(s) hold, each answered by named cases: ${clauses.join(' | ')}`,
    });
  } else {
    findings.push({
      level: 'warning',
      message:
        `SKIPPED, NOT PASSED, AND THE SKIP COVERS THE SPEC HALF ONLY: ${AI_DOCS_DIR}/ is not ` +
        `present, so the SPEC 21 ${M7_SUITE_ROWS.join(', ')} row and the SPEC 22 ${M7_MILESTONE} ` +
        `definition of done were not compared with this wiring, and this run proves nothing about ` +
        `either document. The suite half still ran and can still fail: every named suite file must ` +
        `be there, every named case must be present and assert something, and the coverage suites ` +
        `are run, the real Nuxt build among them. ${AI_DOCS_DIR}/ is excluded from git in ` +
        `.git/info/exclude and no clone restores it, so a checkout without it is expected rather ` +
        `than broken. AWAITING THE MAINTAINER'S DECISION on how ${AI_DOCS_DIR}/ is versioned; ` +
        `until it is made, the document half can only run where the documents are.`,
    });
  }

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  if (!findings.some((finding) => finding.level === 'error')) {
    const run = runCommand(
      'pnpm',
      ['exec', 'vitest', 'run', '--silent', '--reporter=dot', ...files],
      context.repoRoot,
    );

    if (!run.ok) {
      findings.push({
        level: 'error',
        message: `the SPEC 21 M7 suites failed: ${`${run.stdout}${run.stderr}`.trim().slice(-4000)}`,
      });
    } else {
      for (const coverage of M7_SUITE_COVERAGE) {
        findings.push({
          level: 'info',
          message: `${coverage.id} (${coverage.spec}): ${String(coverage.cases.length)} named case(s) over ${String(coverage.files.length)} suite(s), green`,
        });
      }
    }
  }

  const failed = findings.some((finding) => finding.level === 'error');

  return {
    id: m7SuitesGate.id,
    title: m7SuitesGate.title,
    ...(failed
      ? { status: 'fail' as const }
      : haveSpec
        ? { status: 'pass' as const }
        : { status: 'skip' as const, skipReason: 'ai-docs-absent' as const }),
    findings,
  };
}

/**
 * States what M7 closes over, and refuses to state it without the document that says so.
 *
 * THE THREE THINGS CHECKED, AND EACH IS A WAY THE READING COULD GO STALE. The milestone must be in
 * BUILD.md and must carry exactly the tasks this file names plus the declined one, because a task
 * added to M7 later would otherwise be silently outside every count; the declined task must still
 * be unticked, because a tick would mean the decision was reversed and nothing here would notice;
 * and an open section addressed to it must still be in `ai-docs/BUILD-AMENDMENTS.md`, because that
 * open box is the whole enforcement and this gate must not become the reason it looks unnecessary.
 *
 * @param context - The gate context
 * @returns Findings, one of them the reading itself
 */
function milestoneScope(context: GateContext): GateFinding[] {
  const buildPath = join(context.repoRoot, BUILD_FILE);
  const amendmentsPath = join(context.repoRoot, BUILD_AMENDMENTS_FILE);

  if (!aiDocsPresent(context.repoRoot) || !existsSync(buildPath) || !existsSync(amendmentsPath)) {
    return [
      {
        level: 'warning',
        message:
          `the ${M7_MILESTONE} scope was not read: ${BUILD_FILE} or ${BUILD_AMENDMENTS_FILE} is ` +
          `not present in this checkout, so this run says nothing about which tasks ${M7_MILESTONE} ` +
          'closes over. It is not a pass on that question',
      },
    ];
  }

  const milestone = parseMilestones(splitLines(readFileSync(buildPath, 'utf8'))).find(
    (candidate) => candidate.id === M7_MILESTONE,
  );

  if (milestone === undefined) {
    return [
      { level: 'error', message: `${BUILD_FILE} carries no ${M7_MILESTONE} milestone at all` },
    ];
  }

  const findings: GateFinding[] = [];
  const carried = milestone.tasks.map((task) => task.id);
  const expected = [...M7_TASKS, M7_DECLINED_TASK].sort();

  if ([...carried].sort().join(',') !== expected.join(',')) {
    findings.push({
      level: 'error',
      message: `${BUILD_FILE} lists ${carried.join(', ')} under ${M7_MILESTONE}, and this gate is written for ${expected.join(', ')}. A task moved into or out of the milestone changes what its gates close over, so the reading is stated here rather than assumed`,
    });
  }

  const declined = milestone.tasks.find((task) => task.id === M7_DECLINED_TASK);
  if (declined?.done === true) {
    findings.push({
      level: 'error',
      message: `${M7_DECLINED_TASK} is ticked in ${BUILD_FILE}, and it is the task SPEC 10.2 declined on 2026-08-14. A tick there is a reversal of that decision, which is not something a gate may read as ordinary progress`,
    });
  }

  // THE TITLE IS PART OF THE MATCH, AND THE REASON IS A RED RUN THAT CAME OUT GREEN. `T060` has
  // more than one open section, so looking for any of them let the L3 one be closed with this gate
  // still passing, which is the silence it exists against.
  const section = parseAmendmentSections(splitLines(readFileSync(amendmentsPath, 'utf8'))).find(
    (candidate) =>
      candidate.taskId === M7_DECLINED_TASK &&
      !candidate.done &&
      candidate.title.startsWith(M7_DECLINED_SECTION),
  );

  if (section === undefined) {
    findings.push({
      level: 'error',
      message: `no open section addressed to ${M7_DECLINED_TASK} and titled "${M7_DECLINED_SECTION}..." is in ${BUILD_AMENDMENTS_FILE}, and that open box is what keeps the L3 decision a mechanism rather than a memory. Without it this gate would be excluding a task on its own authority`,
    });
  }

  findings.push({
    level: 'info',
    message: `${M7_MILESTONE} closes over ${M7_TASKS.join(' and ')}; ${M7_DECLINED_TASK} is not counted, and the reason is the open section at ${BUILD_AMENDMENTS_FILE} L${String(section?.line ?? 0)}: "${section?.title ?? ''}"`,
  });

  return findings;
}

export const m7SuitesGate: Gate = {
  id: 'm7-suites',
  title:
    'The SPEC 21 row M7 closes has a runner, M7 has one for its definition of done, and the milestone closes over two tasks',

  run(context): Promise<GateResult> {
    return Promise.resolve(runM7SuitesGate(context));
  },
};

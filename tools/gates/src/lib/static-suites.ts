/**
 * The Static row of SPEC 21, wired to the suites that answer it and to the job that times it.
 *
 * WHAT SPEC 21 IS AND WHY A ROW OF IT NEEDS A RUNNER. The table names, per subject, what a set has
 * to cover. `Static` names four: determinism, incrementality, SEO markup and proxy configs. T039
 * and T040 wrote suites for all four and nothing anywhere tied the four names to the four suites,
 * so a coverage could have been deleted, renamed or quietly emptied and the only thing that would
 * have noticed is a person reading two documents side by side.
 *
 * THE LIST IS COMPARED WITH THE SPECIFICATION RATHER THAN WRITTEN BESIDE IT. A gate whose subject
 * is a list it also declares proves that the copy agrees with itself. So the coverage names are
 * read out of SPEC 21's own row and matched against this list in both directions: a coverage the
 * table names and this list does not is a hole, and one this list names and the table does not is
 * a check nobody asked for.
 *
 * AND THE BUDGET IS NOT A SUITE PROPERTY BUT A MACHINE PROPERTY. SPEC 20 bounds the static build
 * of 1000 nodes on four cores at sixty seconds. A suite that runs anywhere measures whatever
 * hardware it landed on, which is a number with no meaning against a threshold stated for a
 * machine, so the runner size is declared by the job and asserted by the suite, and this checks
 * the job is there and says what it must say.
 */

import { parse } from 'yaml';

/** One coverage the SPEC 21 Static row names, and what answers it. */
export interface StaticCoverage {
  /** Short id used in findings. */
  readonly id: string;
  /**
   * The words SPEC 21's Static cell uses, verbatim.
   *
   * The tie between the two documents. It is the specification's Russian, because the row is
   * Russian and a translation here would be a second thing to keep in step.
   */
  readonly spec: string;
  /** Repository relative suite files that hold it. Each must exist and each is run. */
  readonly files: readonly string[];
  /**
   * Case titles that must be present, one per property the row's word stands for.
   *
   * A FILE THAT EXISTS PROVES NOTHING, which is the same limit the claim map states about itself.
   * What a title can show is that the property still has a case with its name on it, so emptying a
   * suite while leaving the file fails here rather than passing as coverage.
   */
  readonly cases: readonly string[];
}

/** Something wrong with the wiring. */
export interface StaticSuiteIssue {
  readonly rule: string;
  readonly message: string;
}

/**
 * The coverage names one row of the SPEC 21 table states.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @param label - The first cell of the row, such as `Static`
 * @returns The comma separated names of the second cell, or null when the row is absent
 */
export function suiteRowOf(spec: string, label: string): string[] | null {
  const section = /^## 21\. /m.exec(spec);
  if (section === null) return null;

  const rest = spec.slice(section.index);
  const end = /^## \d+\. /m.exec(rest.slice(section[0].length));
  const body = end === null ? rest : rest.slice(0, section[0].length + end.index);

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) continue;

    const cells = trimmed
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim());
    if (cells[0] !== label) continue;

    return (cells[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
  }

  return null;
}

/**
 * The prefix SPEC 22 writes a milestone's definition of done behind.
 *
 * The specification's own words, so the parser reads the document rather than a paraphrase of it.
 */
export const DONE_WHEN_PREFIX = '**Готово, когда:**';

/**
 * The clauses one milestone's definition of done states, in the order it states them.
 *
 * WHY A MILESTONE'S DONE-WHEN NEEDS THE SAME TREATMENT AS A SPEC 21 ROW. T042's own done-when is
 * "CI proves the M3 DoD without manual steps", and M3's definition of done is three clauses in one
 * sentence. One of them got a named case and the other two were answered by suites that happened
 * to exist and carried no clause name, so renaming either of them would have left the milestone
 * claiming a proof with nothing behind it, which is the shape this file already refuses for a row
 * of the test table.
 *
 * SPLIT ON THE SEMICOLON BECAUSE THAT IS HOW THE DOCUMENT SEPARATES THEM. A clause added, removed
 * or reworded there moves this list, and the reconciliation below is what says so.
 *
 * @param spec - Full text of `ai-docs/SPEC.md`
 * @param milestone - Milestone id as its heading spells it, such as `M3`
 * @returns The clauses, or null when the milestone or its done-when line is absent
 */
export function milestoneClausesOf(spec: string, milestone: string): string[] | null {
  const heading = new RegExp(`^### ${milestone}\\b.*$`, 'm').exec(spec);
  if (heading === null) return null;

  const rest = spec.slice(heading.index + heading[0].length);
  const next = /^### /m.exec(rest);
  const body = next === null ? rest : rest.slice(0, next.index);

  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(DONE_WHEN_PREFIX)) continue;

    return trimmed
      .slice(DONE_WHEN_PREFIX.length)
      .replace(/\.\s*$/u, '')
      .split(';')
      .map((clause) => clause.trim())
      .filter((clause) => clause !== '');
  }

  return null;
}

/** Every `it(...)` title one suite file declares. */
export function caseTitlesIn(source: string): string[] {
  const titles: string[] = [];

  // The two spellings a suite uses here, `it('...')` and `it.skipIf(...)('...')`, and the
  // multiline form where the title is on its own line after the opening parenthesis.
  for (const match of source.matchAll(
    /\bit(?:\.\w+\([^)]*\))?\(\s*\n?\s*(['"])((?:[^\\]|\\.)*?)\1/g,
  )) {
    titles.push(match[2] ?? '');
  }

  return titles;
}

/** What the coverage check needs from outside. */
export interface StaticSuiteContext {
  /** The coverage names SPEC 21's Static row states, or null when the row could not be read. */
  readonly specNames: readonly string[] | null;
  /** Whether a repository relative path exists. */
  readonly exists: (path: string) => boolean;
  /** Case titles of one suite file, empty when it could not be read. */
  readonly casesIn: (path: string) => readonly string[];
  /**
   * Whether the specification was available to compare against at all.
   *
   * False on a checkout with no `ai-docs/`, where the row half is not answered rather than
   * answered as four coverages nobody stated. The caller says so in its own words; this only
   * declines to invent a verdict, which is the difference between a skip and a pass.
   */
  readonly compareWithSpec?: boolean;
}

/**
 * Checks that every coverage SPEC 21 names has a suite, and every suite named is there.
 *
 * @param coverages - The declared wiring
 * @param context - The specification's own row and a way to look at the repository
 * @returns Issues, empty when the two documents and the repository agree
 */
export function checkStaticCoverage(
  coverages: readonly StaticCoverage[],
  context: StaticSuiteContext,
): StaticSuiteIssue[] {
  const issues: StaticSuiteIssue[] = [];

  if (context.compareWithSpec === false) {
    // The row half is not answered here, and the caller says so. Nothing is added, because a
    // verdict invented from an absent document is exactly what this file refuses elsewhere.
  } else if (context.specNames === null) {
    // A CHECK THAT CANNOT READ ITS SUBJECT SAYS SO. Reporting the wiring as sound against a row
    // nobody found would be the absence defect this repository keeps naming.
    issues.push({
      rule: 'spec-row-missing',
      message:
        'SPEC 21 has no Static row, so what this gate is wiring up could not be read. Either the ' +
        'table moved or the row was deleted, and in both cases the four suites below are ' +
        'answering a requirement nothing states',
    });
  } else {
    const declared = new Set(coverages.map((coverage) => coverage.spec));

    for (const name of context.specNames) {
      if (declared.has(name)) continue;

      issues.push({
        rule: 'coverage-unwired',
        message: `SPEC 21's Static row requires "${name}" and no suite here answers it. A row of that table with no runner is a requirement nobody checks`,
      });
    }

    const stated = new Set(context.specNames);
    for (const coverage of coverages) {
      if (stated.has(coverage.spec)) continue;

      issues.push({
        rule: 'coverage-unstated',
        message: `${coverage.id} is wired to "${coverage.spec}", which SPEC 21's Static row does not state. Either the row was reworded and this list was not, or this gate is checking something nobody asked for`,
      });
    }
  }

  issues.push(...checkSuiteFiles(coverages, context));

  return issues;
}

/**
 * The half that is about the repository rather than about the specification.
 *
 * SHARED BY THE TWO LISTS BECAUSE THE RULE IS ONE RULE. A SPEC 21 coverage and a SPEC 22 milestone
 * clause are answered the same way, by named files holding named cases, and the failure is the same
 * failure: a suite renamed away, or a suite emptied of everything but its filename. Two copies of
 * this loop is how one of them would come to accept what the other rejects.
 *
 * @param coverages - The declared wiring
 * @param context - A way to look at the repository
 * @returns Issues, empty when every named file is there with every named case in it
 */
export function checkSuiteFiles(
  coverages: readonly StaticCoverage[],
  context: StaticSuiteContext,
): StaticSuiteIssue[] {
  const issues: StaticSuiteIssue[] = [];

  for (const coverage of coverages) {
    if (coverage.files.length === 0) {
      issues.push({
        rule: 'coverage-empty',
        message: `${coverage.id} names no suite file, so it can never fail`,
      });
      continue;
    }

    const titles = new Set<string>();

    for (const file of coverage.files) {
      if (!context.exists(file)) {
        issues.push({
          rule: 'suite-missing',
          message: `${coverage.id} is answered by ${file}, which is not in the repository. A renamed suite leaves the coverage unproved and this list saying otherwise`,
        });
        continue;
      }

      for (const title of context.casesIn(file)) titles.add(title);
    }

    for (const expected of coverage.cases) {
      if (titles.has(expected)) continue;

      issues.push({
        rule: 'case-missing',
        message: `${coverage.id}: no case titled "${expected}" is in ${coverage.files.join(', ')}. The file being there is not the property being covered`,
      });
    }
  }

  return issues;
}

/** What the milestone clause check needs from outside. */
export interface MilestoneClauseContext extends StaticSuiteContext {
  /** The clauses SPEC 22 states for the milestone, or null when they could not be read. */
  readonly clauses: readonly string[] | null;
  /** Milestone id, named in findings. */
  readonly milestone: string;
}

/**
 * Checks that every clause of a milestone's definition of done has a runner with its name on it.
 *
 * THE SAME DOCTRINE AS THE SPEC 21 ROW, APPLIED TO SPEC 22. The clauses are read out of the
 * specification and reconciled with this wiring in both directions, so the subject of the check is
 * the document rather than a copy kept beside the code. What is different is what happens next: the
 * suites are not run here. They are the ordinary unit and integration suites of `packages/cli`,
 * which `pnpm test` and `pnpm test:integration` already run in CI, and running them a second time
 * inside a gate would need the built binary and the built example and would report a red suite
 * twice. The hole this closes is the tie, not the running: before T042 two of the three clauses
 * were answered by cases that carried no clause name, so a rename would have gone unnoticed.
 *
 * @param clauses - The declared wiring, one entry per clause
 * @param context - The specification's clauses and a way to look at the repository
 * @returns Issues, empty when the document, the wiring and the repository agree
 */
export function checkMilestoneClauses(
  clauses: readonly StaticCoverage[],
  context: MilestoneClauseContext,
): StaticSuiteIssue[] {
  const issues: StaticSuiteIssue[] = [];

  if (context.compareWithSpec === false) {
    // The document half is not answered here, and the caller says so.
  } else if (context.clauses === null) {
    issues.push({
      rule: 'milestone-missing',
      message:
        `SPEC 22 states no definition of done for ${context.milestone}, so what these suites are ` +
        'answering could not be read. Either the milestone moved or its done-when line was ' +
        'deleted, and in both cases the clauses below answer a requirement nothing states',
    });
  } else {
    const declared = new Set(clauses.map((clause) => clause.spec));

    for (const stated of context.clauses) {
      if (declared.has(stated)) continue;

      issues.push({
        rule: 'clause-unwired',
        message: `${context.milestone} is done when "${stated}", and no suite here answers that clause. A milestone judged on a sentence nothing runs is a milestone that closes on a reading`,
      });
    }

    const spoken = new Set(context.clauses);
    for (const clause of clauses) {
      if (spoken.has(clause.spec)) continue;

      issues.push({
        rule: 'clause-unstated',
        message: `${clause.id} is wired to "${clause.spec}", which the ${context.milestone} definition of done does not state. Either the sentence was reworded and this list was not, or this gate is holding the milestone to something nobody asked for`,
      });
    }
  }

  issues.push(...checkSuiteFiles(clauses, context));

  return issues;
}

/** What the elapsed budget job has to declare for its figure to mean anything. */
export interface BudgetJobExpectation {
  /** Workflow file, repository relative, named in findings. */
  readonly workflow: string;
  /** The job key inside it. */
  readonly job: string;
  /** The suite whose figure the job produces. */
  readonly suite: string;
  /** The environment variable the job sets to declare the runner size. */
  readonly coresVariable: string;
  /** The core count SPEC 20 states the budget for. */
  readonly cores: number;
}

/** One job of a workflow, reduced to what this check reads. */
interface WorkflowJob {
  readonly 'runs-on'?: unknown;
  readonly steps?: unknown;
  readonly env?: unknown;
}

/**
 * Checks that CI runs the elapsed budget on a declared runner size.
 *
 * WHY THE JOB IS PART OF THE GATE. SPEC 20's static build row states sixty seconds for 1000 nodes
 * on four cores. Run anywhere, the suite measures the machine it landed on, and a figure with no
 * machine beside it cannot be compared with a threshold that names one. So a job pins the runner,
 * declares its size to the suite, and the suite refuses to certify against a machine of another
 * size. This is what keeps the job from being deleted, since the suite would then simply stop
 * certifying and nothing would say so.
 *
 * @param workflow - Full text of the workflow file
 * @param expectation - What the job must be and must declare
 * @returns Issues, empty when the job is there and says what it must
 */
export function checkBudgetJob(
  workflow: string,
  expectation: BudgetJobExpectation,
): StaticSuiteIssue[] {
  const issues: StaticSuiteIssue[] = [];

  let parsed: unknown;
  try {
    parsed = parse(workflow) as unknown;
  } catch (error) {
    return [
      {
        rule: 'workflow-unreadable',
        message: `${expectation.workflow} is not readable as YAML, so nothing here knows what CI runs: ${error instanceof Error ? error.message : String(error)}`,
      },
    ];
  }

  const jobs = (parsed as { jobs?: Record<string, unknown> } | null)?.jobs;
  const job = jobs?.[expectation.job] as WorkflowJob | undefined;

  if (job === undefined) {
    return [
      {
        rule: 'budget-job-missing',
        message:
          `${expectation.workflow} has no job "${expectation.job}", so the SPEC 20 elapsed budget ` +
          'is measured on whatever machine happens to run the suite. A threshold stated for four ' +
          'cores and checked on an undeclared machine is a number that means nothing',
      },
    ];
  }

  if (typeof job['runs-on'] !== 'string' || job['runs-on'].trim() === '') {
    issues.push({
      rule: 'runner-unpinned',
      message: `${expectation.workflow}: job "${expectation.job}" does not pin a single runner label, so the machine the figure comes from is undecided`,
    });
  }

  const steps = Array.isArray(job.steps) ? job.steps : [];
  const text = JSON.stringify({ env: job.env, steps });

  if (!text.includes(expectation.suite)) {
    issues.push({
      rule: 'suite-not-run',
      message: `${expectation.workflow}: job "${expectation.job}" never runs ${expectation.suite}, so the job exists and the budget is still unmeasured in CI`,
    });
  }

  if (!text.includes(expectation.coresVariable)) {
    issues.push({
      rule: 'cores-undeclared',
      message:
        `${expectation.workflow}: job "${expectation.job}" does not set ${expectation.coresVariable}, ` +
        'so the suite cannot tell whether it is on the machine the budget is stated for and will ' +
        'decline to certify',
    });
    return issues;
  }

  if (
    !new RegExp(`${expectation.coresVariable}["'\\s:=]+${String(expectation.cores)}\\b`).test(text)
  ) {
    issues.push({
      rule: 'cores-mismatch',
      message:
        `${expectation.workflow}: job "${expectation.job}" declares ${expectation.coresVariable} as ` +
        `something other than ${String(expectation.cores)}, which is the core count SPEC 20 states ` +
        'the budget for',
    });
  }

  return issues;
}

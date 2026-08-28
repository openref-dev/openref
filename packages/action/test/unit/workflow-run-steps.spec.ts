import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * Every workflow and action file in this repository, held to one rule: a `run:` step interpolates
 * nothing.
 *
 * WHY THE RULE, IN THE WORDS OF WHAT GOES WRONG. GitHub expands `${{ ... }}` into the body of a
 * `run:` step before bash is started, so the expansion is not a value the script reads, it is text
 * the script is made of. An input, a title, a branch name or a comment body containing a shell
 * metacharacter is then executed. Passing the same value through `env:` and reading `"$NAME"` in
 * the script has the value arrive as data, which is the shape the rest of this tree already uses.
 *
 * WHY THE RULE NEEDED A RUNNER OF ITS OWN. The rule was written in three docstrings and checked in
 * exactly one file, `.github/workflows/api-review.yml`, so `browser-budget-study.yml` carried an
 * interpolated `run:` step for as long as it existed and every gate stayed green. A reviewer found
 * it, which is the mechanism this project keeps saying it will not rely on. This walks the whole
 * tree instead, so the next such step fails a suite rather than waiting for the next reviewer.
 *
 * WHAT THIS CANNOT ESTABLISH, SAID PLAINLY. GitHub is the only place the expansion itself can be
 * observed. Nothing here runs a workflow, so nothing here can show that `${{ }}` in a `run:` body
 * really becomes script, that `env:` really keeps a value out of the script text, or that a hostile
 * input really executes. Those are facts about GitHub's runner, read from its documentation. What
 * is proved below is the property this repository can hold itself to: that no file in it is written
 * in the shape that would have that effect.
 */

/** The workspace root, from this file. */
const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

/** Directories a walk never descends into: build output, dependencies and the git database. */
const SKIPPED = new Set(['node_modules', 'dist', 'coverage', '.git', '.pnpm-store']);

/** One file the walk found, with its text. */
interface YamlFile {
  /** Repository relative path, so a failure names the file a reader has to open. */
  readonly path: string;
  readonly text: string;
}

/**
 * Whether one file is a workflow definition or an action definition.
 *
 * BOTH SHAPES COUNT, because both carry `run:` steps and both are executed by GitHub. A workflow
 * lives under `.github/workflows`; an action is any file named `action.yml` or `action.yaml`, which
 * is how GitHub finds a composite action wherever it sits.
 */
function isWorkflowOrAction(path: string, name: string): boolean {
  if (name === 'action.yml' || name === 'action.yaml') return true;
  const inWorkflows = path.includes(join('.github', 'workflows'));
  return inWorkflows && (name.endsWith('.yml') || name.endsWith('.yaml'));
}

/** Every workflow and action file under one directory, walked rather than listed. */
function walk(directory: string): YamlFile[] {
  const found: YamlFile[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED.has(entry.name)) continue;
      found.push(...walk(path));
      continue;
    }
    if (!entry.isFile() || !isWorkflowOrAction(path, entry.name)) continue;

    found.push({ path: relative(REPO_ROOT, path), text: readFileSync(path, 'utf8') });
  }

  return found;
}

/** One `run:` step, with enough context for a failure to be actionable. */
interface RunStep {
  readonly file: string;
  readonly job: string;
  readonly name: string;
  readonly run: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Every step of a parsed file, whichever of the two shapes it is.
 *
 * A workflow holds its steps under `jobs.<id>.steps`; a composite action holds them under
 * `runs.steps`. Reading only the first is how an action definition would slip past this.
 */
function stepsOf(parsed: unknown, file: string): RunStep[] {
  const document = asRecord(parsed);
  const steps: RunStep[] = [];

  const collect = (list: unknown, job: string): void => {
    if (!Array.isArray(list)) return;
    for (const raw of list) {
      const step = asRecord(raw);
      const run = step.run;
      if (typeof run !== 'string') continue;
      steps.push({ file, job, name: typeof step.name === 'string' ? step.name : '(unnamed)', run });
    }
  };

  for (const [id, job] of Object.entries(asRecord(document.jobs))) {
    collect(asRecord(job).steps, id);
  }
  collect(asRecord(document.runs).steps, 'runs');

  return steps;
}

const FILES = walk(REPO_ROOT);
const STEPS = FILES.flatMap((file) => stepsOf(parse(file.text), file.path));

describe('every workflow and action file in the repository', () => {
  it('should be found by the walk at all, so the rule below is not vacuously true', () => {
    // Given: a walk that found nothing would pass every assertion after it. The two counts are
    // asserted as floors rather than as exact numbers, because a workflow added later is not a
    // failure of this rule; a walk that stopped finding them is.
    // When / Then
    expect(FILES.length).toBeGreaterThanOrEqual(5);
    expect(STEPS.length).toBeGreaterThanOrEqual(10);
    expect(FILES.map((file) => file.path)).toContain(join('packages', 'action', 'action.yml'));
    expect(FILES.map((file) => file.path)).toContain(
      join('.github', 'workflows', 'browser-budget-study.yml'),
    );
  });

  it('should parse as yaml, since a file GitHub cannot read is a step that never runs', () => {
    // When / Then
    for (const file of FILES) {
      expect(() => {
        parse(file.text);
      }, file.path).not.toThrow();
    }
  });

  it('should interpolate no expression into any run step, in any file', () => {
    // Given: GitHub expands the expression into the script body, so the value becomes code.
    // Measured before this walk existed: browser-budget-study.yml had one, and the only check of
    // this rule read a single other file.
    // When
    const offenders = STEPS.filter((step) => step.run.includes('${{')).map(
      (step) => `${step.file} -> ${step.job} -> ${step.name}`,
    );

    // Then: the value belongs on the step's env block, read as "$NAME" by the script
    expect(offenders).toEqual([]);
  });

  it('should see a planted interpolation, which is what makes the empty list above a finding', () => {
    // Given a step written the way the rule forbids, parsed by the same reader
    const planted = `
jobs:
  study:
    steps:
      - name: Study
        run: node cli.js --runs=\${{ inputs.runs }}
`;

    // When
    const steps = stepsOf(parse(planted), 'planted.yml');

    // Then
    expect(steps).toHaveLength(1);
    expect(steps.filter((step) => step.run.includes('${{'))).toHaveLength(1);
  });

  it('should see a planted interpolation in a composite action too, not only in a workflow', () => {
    // Given: an action definition holds its steps in a different place, and reading only the
    // workflow shape is how one would slip past
    const planted = `
runs:
  using: composite
  steps:
    - shell: bash
      run: 'echo \${{ inputs.spec }}'
`;

    // When
    const steps = stepsOf(parse(planted), 'planted-action.yml');

    // Then
    expect(steps).toHaveLength(1);
    expect(steps[0]?.job).toBe('runs');
    expect(steps.filter((step) => step.run.includes('${{'))).toHaveLength(1);
  });
});

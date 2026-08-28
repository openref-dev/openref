import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { ACTION_PACKAGE_ROOT, readActionDefinition } from '../../src/index';

/**
 * The workflow that runs this repository's own action on this repository's own pull requests.
 *
 * WHY IT HAS A TEST AT ALL, WHICH IS THE SAME REASON THE ACTION DOES. A workflow file is code
 * nothing in this repository runs, so it can be wrong in every way and every gate stays green.
 * T041's done when clause was unmet for exactly that reason: nothing under `.github/workflows/`
 * called `packages/action`, and no assertion anywhere would have said so.
 *
 * WHAT THIS FILE CAN ESTABLISH: that the workflow parses, that it triggers on `pull_request` and
 * never on `pull_request_target`, that it asks for two permissions and no more, that it passes
 * only inputs the action declares, that no `run:` step interpolates an expression into a shell,
 * and that it pulls in no third party action this repository was not already using.
 *
 * WHAT ONLY GITHUB CAN ESTABLISH, said here rather than implied by a green run: that GitHub reads
 * `on: pull_request` the way this reads it, that `uses: ./packages/action` resolves to the local
 * composite action, that `permissions:` actually narrows the token, that a fork pull request
 * really receives a read only token, and that the comment appears on the pull request. None of
 * those is reachable without a real GitHub, and no assertion below should be read as covering one.
 */

/** The workspace root, from this file. */
const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

/** The workflow under test. */
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'api-review.yml');

/** The suite of workflows this repository already had, for the third party comparison. */
const EXISTING_WORKFLOWS: readonly string[] = ['ci.yml', 'release-license-audit.yml'];

const source = readFileSync(WORKFLOW_PATH, 'utf8');
const workflow = parse(source) as Record<string, unknown>;
const definition = readActionDefinition(ACTION_PACKAGE_ROOT);

/** Every step of every job of a parsed workflow. */
function stepsOf(parsed: Record<string, unknown>): Record<string, unknown>[] {
  const jobs = parsed.jobs;
  if (typeof jobs !== 'object' || jobs === null) return [];

  const steps: Record<string, unknown>[] = [];
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (typeof job !== 'object' || job === null) continue;
    const list = (job as { steps?: unknown }).steps;
    if (!Array.isArray(list)) continue;
    for (const step of list) {
      if (typeof step === 'object' && step !== null) steps.push(step as Record<string, unknown>);
    }
  }
  return steps;
}

/** Every `uses:` of a workflow file on disk. */
function usesIn(file: string): string[] {
  const parsed = parse(readFileSync(join(REPO_ROOT, '.github', 'workflows', file), 'utf8')) as
    Record<string, unknown> | undefined;
  if (parsed === undefined) return [];
  return stepsOf(parsed)
    .map((step) => (typeof step.uses === 'string' ? step.uses : ''))
    .filter((value) => value !== '');
}

describe('the workflow that dogfoods the action', () => {
  it('should exist and parse as yaml', () => {
    // When / Then
    expect(source.length).toBeGreaterThan(0);
    expect(typeof workflow).toBe('object');
  });

  it('should run on pull_request and never on pull_request_target', () => {
    // Given: `on` is read defensively, because a YAML 1.1 reader would give the key as `true`
    const triggers = workflow.on ?? workflow.true;

    // When: the parsed document rather than the file text, so the prose above the triggers can
    // name the event it refuses without failing the assertion that it is not used
    const parsed = JSON.stringify(workflow);

    // Then
    expect(triggers).toBe('pull_request');
    expect(parsed).not.toContain('pull_request_target');
  });

  it('should ask for exactly the two permissions the action needs and no others', () => {
    // Given: least privilege, written where a reader copies it from
    // When
    const permissions = workflow.permissions;

    // Then
    expect(permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });

  it('should call this repository own action rather than a published copy of it', () => {
    // When
    const calls = stepsOf(workflow).filter((step) => step.uses === './packages/action');

    // Then: this is the assertion the done when clause of T041 was missing entirely
    expect(calls).toHaveLength(1);
  });

  it('should pass only inputs the action declares', () => {
    // Given
    const declared = new Set(definition.inputs.map((input) => input.name));
    const call = stepsOf(workflow).find((step) => step.uses === './packages/action');
    const passed = call?.with;

    // When
    const names = typeof passed === 'object' && passed !== null ? Object.keys(passed) : [];

    // Then
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(declared).toContain(name);
  });

  it('should name a spec that is a file this repository actually holds', () => {
    // Given: a workflow pointing at a document that is not there would report a usage error on
    // every pull request, which reads from the outside exactly like an action that is broken
    const call = stepsOf(workflow).find((step) => step.uses === './packages/action');
    const passed = call?.with as Record<string, unknown> | undefined;
    const spec = passed?.spec;

    // When
    const path = typeof spec === 'string' ? join(REPO_ROOT, spec) : '';

    // Then
    expect(typeof spec).toBe('string');
    expect(() => readFileSync(path, 'utf8')).not.toThrow();
  });

  it('should interpolate nothing into any run step', () => {
    // Given: a `${{ }}` inside `run:` is evaluated into the script before bash sees it
    // When
    const runs = stepsOf(workflow)
      .map((step) => (typeof step.run === 'string' ? step.run : ''))
      .join('\n');

    // Then: no secret reaches a shell, and none is named anywhere in the parsed document either
    expect(runs).not.toContain('${{');
    expect(JSON.stringify(workflow)).not.toContain('secrets.');
  });

  it('should pull in no third party action this repository was not already using', () => {
    // Given the actions the existing workflows already depend on
    const already = new Set(EXISTING_WORKFLOWS.flatMap((file) => usesIn(file)));

    // When
    const used = usesIn('api-review.yml').filter((value) => !value.startsWith('./'));

    // Then: pinning somebody else's sha is a guarantee nothing here can verify, so the set does
    // not grow. The local `./packages/action` is excluded above because it is this repository's.
    expect(used.length).toBeGreaterThan(0);
    for (const value of used) expect(already).toContain(value);
  });

  it('should fetch the whole history, since the base side is read through git show', () => {
    // Given: a shallow clone has no object for `git show <base>:<path>` to read
    const checkout = stepsOf(workflow).find((step) => step.uses === 'actions/checkout@v4');
    const options = checkout?.with as Record<string, unknown> | undefined;

    // When / Then
    expect(options?.['fetch-depth']).toBe(0);
  });

  it('should build before it reviews, because the binary it runs is a build output', () => {
    // Given: `openref-bin` names a workspace link that does not exist until the build made it
    const steps = stepsOf(workflow);
    const buildIndex = steps.findIndex(
      (step) => typeof step.run === 'string' && step.run.includes('run build'),
    );
    const reviewIndex = steps.findIndex((step) => step.uses === './packages/action');

    // When / Then
    expect(buildIndex).toBeGreaterThanOrEqual(0);
    expect(reviewIndex).toBeGreaterThan(buildIndex);
  });
});

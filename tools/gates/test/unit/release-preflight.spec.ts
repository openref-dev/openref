import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runCommand } from '../../src/lib/exec';

/**
 * The step that refuses a release at the placeholder version.
 *
 * WHAT IT IS ABOUT. Every publishable manifest here says `0.0.0`, which is not a version but the
 * placeholder for "never released", and `.changeset/` holds no changeset. A `v*` tag would have run
 * `changeset publish` over all eleven at `0.0.0` and put that on the registry with nothing red,
 * because `0.0.0` is a valid semantic version and the gate suite asks what publishes rather than at
 * what version. The done-when clause "a fresh consumer installs from npm" was therefore unverified.
 *
 * WHY IT IS NOT A GATE. On any ordinary day the correct answer is "still at the placeholder", so a
 * gate asserting otherwise would be red on every green day. It is a release precondition and runs
 * where a release runs.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SCRIPT = join(repoRoot, 'tools', 'release-preflight.mjs');
const WORKFLOW = join(repoRoot, '.github', 'workflows', 'release.yml');

let temporary = '';

afterEach(() => {
  if (temporary !== '') rmSync(temporary, { recursive: true, force: true });
  temporary = '';
});

/**
 * Builds a repository tree the script can be pointed at.
 *
 * @param packages - Manifest fields per workspace directory
 * @param changesets - Changeset file names to write under `.changeset/`
 * @returns The absolute root of the tree
 */
function treeWith(
  packages: readonly {
    readonly directory: string;
    readonly name: string;
    readonly version?: string;
    readonly isPrivate?: boolean;
  }[],
  changesets: readonly string[] = [],
): string {
  temporary = mkdtempSync(join(tmpdir(), 'openref-preflight-'));

  for (const entry of packages) {
    const directory = join(temporary, 'packages', entry.directory);
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({
        name: entry.name,
        ...(entry.version === undefined ? {} : { version: entry.version }),
        ...(entry.isPrivate === true ? { private: true } : {}),
      }),
    );
  }

  const changesetDirectory = join(temporary, '.changeset');
  mkdirSync(changesetDirectory, { recursive: true });
  writeFileSync(join(changesetDirectory, 'config.json'), '{}');
  writeFileSync(join(changesetDirectory, 'README.md'), 'Changesets live here.\n');

  for (const name of changesets) {
    writeFileSync(
      join(changesetDirectory, name),
      "---\n'@openref/core': patch\n---\n\nA change.\n",
    );
  }

  return temporary;
}

/**
 * Runs the preflight against a tree.
 *
 * @param root - Absolute root to check
 * @returns Exit code and combined output
 */
function preflight(root: string): { readonly code: number; readonly output: string } {
  const result = runCommand('node', [SCRIPT, '--root', root], repoRoot);

  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

describe('the release preflight', () => {
  it('should be a step of the publish job, before the publish itself', () => {
    // Given, a check the release does not run is a check that cannot refuse anything.
    const workflow = readFileSync(WORKFLOW, 'utf8');

    // When
    // The step is looked for by its `uses:` line rather than by the action's name, which the file
    // header also mentions while explaining what publishes.
    const preflightAt = workflow.indexOf('run: node tools/release-preflight.mjs');
    const publishAt = workflow.indexOf('uses: changesets/action');

    // Then
    expect(preflightAt).toBeGreaterThan(-1);
    expect(publishAt).toBeGreaterThan(-1);
    expect(preflightAt).toBeLessThan(publishAt);
  });

  it('should refuse this repository as it stands today, which is the whole point', () => {
    // Given, no falsification is needed for this one: the tree really is at the placeholder with
    // no changeset, and this case goes green again on the day a real release is prepared.
    // When
    const result = preflight(repoRoot);

    // Then
    expect(result.code).toBe(1);
    expect(result.output).toContain('still at 0.0.0');
    expect(result.output).toContain('Refusing to publish');
  });

  it('should name every package it refuses, so the message is actionable', () => {
    // When
    const result = preflight(repoRoot);

    // Then
    expect(result.output).toContain('@openref/nest (packages/nest) is at 0.0.0');
    expect(result.output).toContain('openref (packages/cli) is at 0.0.0');
  });

  it('should say there is no changeset to raise the versions with, when there is none', () => {
    // Given
    const root = treeWith([{ directory: 'core', name: '@openref/core', version: '0.0.0' }]);

    // When
    const result = preflight(root);

    // Then
    expect(result.code).toBe(1);
    expect(result.output).toContain('There is no pending changeset either');
  });

  it('should say the pending changesets have not been applied, when some are waiting', () => {
    // Given, a different failure with a different remedy: the changeset exists and the version
    // pull request it produces has not landed, so this commit is the wrong one to tag.
    const root = treeWith(
      [{ directory: 'core', name: '@openref/core', version: '0.0.0' }],
      ['brave-pans-shout.md'],
    );

    // When
    const result = preflight(root);

    // Then
    expect(result.code).toBe(1);
    expect(result.output).toContain('brave-pans-shout.md');
    expect(result.output).toContain('have not been');
  });

  it('should pass a tree whose publishable packages carry released versions', () => {
    // Given, the green direction, so the refusal above is a decision and not a constant.
    const root = treeWith([
      { directory: 'core', name: '@openref/core', version: '1.4.0' },
      { directory: 'nest', name: '@openref/nest', version: '1.4.0' },
      { directory: 'render', name: '@openref/render', version: '0.0.0', isPrivate: true },
    ]);

    // When
    const result = preflight(root);

    // Then
    expect(result.code).toBe(0);
    expect(result.output).toContain('every publishable package carries a released version');
  });

  it('should refuse a manifest that declares no version at all', () => {
    // Given
    const root = treeWith([{ directory: 'core', name: '@openref/core' }]);

    // When
    const result = preflight(root);

    // Then
    expect(result.code).toBe(1);
    expect(result.output).toContain('declares no version at all');
  });

  it('should refuse a tree it found no publishable package in, rather than reading it as clean', () => {
    // Given, a reading that found nothing reports what a clean one does, which is the failure this
    // repository keeps removing.
    const root = treeWith([
      { directory: 'render', name: '@openref/render', version: '1.0.0', isPrivate: true },
    ]);

    // When
    const result = preflight(root);

    // Then
    expect(result.code).toBe(1);
    expect(result.output).toContain('nothing was checked and nothing was proved');
  });
});

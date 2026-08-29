import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OpenRefError } from '@openref/core';
import { readWorkingTree } from '../../src/cli/infrastructure/adapters/working-tree.adapter';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * What git is asked before `--fix` writes anything, over a real repository rather than a mock.
 *
 * A MOCKED GIT WOULD PROVE THE MOCK. The whole question is whether this reads what git actually
 * reports, on a real tree, including the untracked file that a `--porcelain` run without the right
 * flag would silently omit, so the fixture is a repository.
 */

const execFileAsync = promisify(execFile);

let root = '';

/** Runs one git command in the temporary repository. */
async function git(...args: readonly string[]): Promise<void> {
  await execFileAsync(
    'git',
    [
      '-c',
      'user.email=t@openref.test',
      '-c',
      'user.name=openref test',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root },
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openref-tree-'));
  await git('init', '--quiet');
  await writeFile(join(root, 'committed.txt'), 'first\n', 'utf8');
  await git('add', '-A');
  await git('commit', '--quiet', '-m', 'first');
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('readWorkingTree', () => {
  it(
    'should report a committed tree as clean and name its root',
    async () => {
      // When
      const tree = await readWorkingTree(root);

      // Then
      expect(tree.dirty).toEqual([]);
      // macOS resolves the temporary directory through a symlink, so the root git reports is the
      // real path of the one asked about rather than the string that was passed.
      expect(tree.root.endsWith(root.replace('/private', ''))).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should report a modified file as dirty, which is a refusal rather than a warning upstream',
    async () => {
      // Given
      await writeFile(join(root, 'committed.txt'), 'second\n', 'utf8');

      // When
      const tree = await readWorkingTree(root);

      // Then
      expect(tree.dirty).toHaveLength(1);
      expect(tree.dirty[0]).toContain('committed.txt');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should count an untracked file as dirty, since a fix diff would arrive mixed with it',
    async () => {
      // Given
      await writeFile(join(root, 'scratch.txt'), 'notes\n', 'utf8');

      // When
      const tree = await readWorkingTree(root);

      // Then
      expect(tree.dirty).toHaveLength(1);
      expect(tree.dirty[0]).toContain('scratch.txt');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse a directory that is in no repository rather than answer for the one above it',
    async () => {
      // Given
      const elsewhere = await mkdtemp(join(tmpdir(), 'openref-no-repo-'));

      // When
      const failure = await readWorkingTree(elsewhere).catch((error: unknown) => error);

      // Then
      expect(failure).toBeInstanceOf(OpenRefError);
      expect((failure as OpenRefError).message).toContain('could not find the repository root');
      await rm(elsewhere, { recursive: true, force: true });
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

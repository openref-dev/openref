import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { repositoryRelative } from '../../src/runtime/domain/repository-path';
import {
  findRepositoryRoot,
  resetRepositoryCache,
} from '../../src/runtime/infrastructure/adapters/repository.adapter';

/**
 * The path half of T018, which is the half that leaks a build machine if it is wrong.
 *
 * THE MONOREPO CASE IS THE ONE THE TASK NAMES AND IT IS NOT THE OBVIOUS ONE. A handler in
 * `packages/api` is served by a process whose working directory is anything at all, and its link
 * has to carry the whole path from the root of the repository rather than from the package or
 * from the process. So the root is found per file, by walking up from the file itself.
 */

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openref-repo-'));
  resetRepositoryCache();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  resetRepositoryCache();
});

/**
 * Writes a file under the fake repository, creating its directories.
 *
 * @param relativePath - Path from the fake root
 * @param content - What to write
 * @returns The absolute path
 */
function write(relativePath: string, content = ''): string {
  const absolute = join(root, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, content, 'utf8');

  return absolute;
}

describe('repositoryRelative', () => {
  it('should express a monorepo path from the repository root, not from the package', () => {
    // Given the shape this repository itself has
    const file = '/home/ada/work/acme/packages/api/src/orders.controller.ts';

    // When
    const result = repositoryRelative(file, '/home/ada/work/acme');

    // Then
    expect(result).toBe('packages/api/src/orders.controller.ts');
  });

  it('should never return an absolute path, which would name the build machine', () => {
    // Given. `/home/ada` is a person, `work/acme` is a client, and both would be served to every
    // reader of the documentation if this returned what it was given.
    const file = '/home/ada/work/acme/src/a.ts';

    // When
    const result = repositoryRelative(file, '/home/ada/work/acme');

    // Then
    expect(result).not.toContain('/home/ada');
    expect(result?.startsWith('/')).toBe(false);
  });

  it('should refuse a file outside the repository rather than linking up out of it', () => {
    // Given a handler in a linked package that lives beside the repository, which pnpm and a
    // file: dependency both produce. `../../shared/src/a.ts` is not a path any forge resolves.
    const file = '/home/ada/work/shared/src/a.ts';

    // When
    const result = repositoryRelative(file, '/home/ada/work/acme');

    // Then
    expect(result).toBeUndefined();
  });

  it('should refuse the root itself, which is a directory rather than a file', () => {
    // Given
    // When
    const result = repositoryRelative('/home/ada/work/acme', '/home/ada/work/acme');

    // Then
    expect(result).toBeUndefined();
  });

  it('should refuse when either path is empty rather than producing a relative link', () => {
    // Given
    // When, Then
    expect(repositoryRelative('', '/home/ada')).toBeUndefined();
    expect(repositoryRelative('/home/ada/a.ts', '')).toBeUndefined();
  });
});

describe('findRepositoryRoot', () => {
  it('should walk up from a file to the directory holding .git', () => {
    // Given a monorepo: the git directory is three levels above the source file
    mkdirSync(join(root, '.git'), { recursive: true });
    const file = write('packages/api/src/orders.controller.ts');

    // When
    const found = findRepositoryRoot(file);

    // Then
    expect(found).toBe(root);
  });

  it('should accept a .git file, since a worktree and a submodule both have one', () => {
    // Given. A check for a directory would walk straight past the root of either and land on
    // whatever repository contained it, or on nothing at all.
    write('.git', 'gitdir: /elsewhere/.git/worktrees/feature\n');
    const file = write('src/a.ts');

    // When
    const found = findRepositoryRoot(file);

    // Then
    expect(found).toBe(root);
  });

  it('should stop rather than run out of parents when there is no repository', () => {
    // Given a tree with no `.git` anywhere in it. The walk reaches the filesystem root, where
    // `dirname` returns its own argument, and has to notice.
    const file = write('src/a.ts');

    // When
    const found = findRepositoryRoot(file);

    // Then it either found nothing or found a repository above the temporary directory, and
    // either way it terminated, which is the property under test.
    expect(found === undefined || file.startsWith(found)).toBe(true);
  });

  it('should take the nearest repository when one is nested inside another', () => {
    // Given a vendored checkout inside a checkout, which is what a submodule looks like on disk.
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, 'vendor', 'inner', '.git'), { recursive: true });
    const file = write('vendor/inner/src/a.ts');

    // When
    const found = findRepositoryRoot(file);

    // Then the inner one, because that is the repository the file is committed to
    expect(found).toBe(join(root, 'vendor', 'inner'));
  });
});

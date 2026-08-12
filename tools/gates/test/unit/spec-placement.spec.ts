import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findSpecFiles, findUncollectedSpecs, isCollected } from '../../src/lib/spec-placement.js';

/**
 * Every test file is somewhere a runner looks, and a file that is not is reported.
 *
 * THE FAILURE THIS PREVENTS IS SILENCE. `vitest.shared.ts` collects `test/unit/**` and
 * `test/integration/**` and nothing else, so a `.spec.ts` written one directory out is never
 * run, never reported, and never distinguishable from a suite that passes. The rule has been in
 * STANDARDS and in `CLAUDE.md` since the beginning; what was missing was anything that could go
 * red when it was broken. Noted in session 29, written on 2026-08-11.
 *
 * PLANTED BOTH WAYS on a synthetic tree, because a check that only reads the real repository is
 * a check that today is clean.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/**
 * Builds a tree with the given repository relative files in it.
 *
 * @param paths - Repository relative paths to create, each an empty file
 * @returns Absolute root of the synthetic tree
 */
function tree(paths: readonly string[]): string {
  const created = mkdtempSync(join(tmpdir(), 'oref-specs-'));
  root = created;

  for (const path of paths) {
    const absolute = join(created, path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, '');
  }

  return created;
}

describe('spec file placement', () => {
  it('should accept the two directories the runner collects', () => {
    // Given
    const collected = [
      'packages/core/test/unit/canonical.spec.ts',
      'packages/nest/test/integration/source-links.spec.ts',
      'tools/gates/test/unit/licenses.spec.ts',
      'examples/nest-minimal/test/unit/app.spec.ts',
    ];

    // Then
    for (const path of collected) expect(isCollected(path)).toBe(true);
  });

  it('should refuse every place a spec file can hide', () => {
    // Given the shapes this actually happens in: beside the code it tests, one level above the
    // two collected directories, and in a package root.
    const hidden = [
      'packages/core/src/normalizer/test/normalizer.spec.ts',
      'packages/core/test/canonical.spec.ts',
      'packages/core/test/e2e/canonical.spec.ts',
      'packages/core/canonical.spec.ts',
      'tools/gates/src/lib/walk.spec.ts',
    ];

    // Then
    for (const path of hidden) expect(isCollected(path)).toBe(false);
  });

  it('should find a misplaced file on a tree that has one', () => {
    // Given, the plant: one file where the runner looks and one beside the code
    const created = tree([
      'packages/core/test/unit/canonical.spec.ts',
      'packages/core/src/normalizer/test/normalizer.spec.ts',
    ]);

    // When
    const found = findUncollectedSpecs(created);

    // Then
    expect(findSpecFiles(created)).toHaveLength(2);
    expect(found).toEqual(['packages/core/src/normalizer/test/normalizer.spec.ts']);
  });

  it('should report nothing on a tree where every file is collected', () => {
    // Given
    const created = tree([
      'packages/core/test/unit/canonical.spec.ts',
      'packages/render/test/integration/try-it.spec.ts',
    ]);

    // Then
    expect(findUncollectedSpecs(created)).toEqual([]);
  });

  it('should hold over this repository, on a set that is not empty', () => {
    // Given the real checkout. The count is asserted to be substantial because an empty walk
    // would satisfy the rule by finding nothing at all, which is the failure mode SPEC 0 names.
    const all = findSpecFiles(repoRoot);

    // Then
    expect(all.length).toBeGreaterThan(100);
    expect(findUncollectedSpecs(repoRoot)).toEqual([]);
  });
});

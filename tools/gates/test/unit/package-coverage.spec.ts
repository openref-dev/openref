import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cspScanRoots, readPackageDirs } from '../../src/lib/package-dirs.js';

/**
 * The check that the boundary rules govern every package there is, planted both ways.
 *
 * WHY THIS FILE EXISTS: THE SET OF PACKAGES WAS A HAND WRITTEN ARRAY IN TWO FILES AND NOTHING
 * COMPARED EITHER TO THE DISK. `boundary()` built each rule's `to` path by filtering that array,
 * so a package missing from it was governed by no rule in either direction. Measured on
 * 2026-08-11: `packages/probe2` created, imported by `packages/core/src`, cruised, and the report
 * read `no dependency violations found`. `core` reached a new package and all eight boundary rules
 * stayed green. The same array drove the CSP scan roots, so a ninth package's built output was
 * never opened while that gate printed a file count and passed. Filed as F23 and fixed here.
 *
 * A CHECK GIVEN ITS MATERIAL BY HAND INHERITS THE ACCURACY OF THE HAND. That is the whole finding,
 * and it is why the set is read from `packages/` now and why the one thing left by hand, what a
 * package may depend on, is reconciled against the disk in both directions. The reverse direction
 * is not a smaller case: an entry naming a package that was deleted governs nothing, cannot fail,
 * and is indistinguishable from coverage until someone looks.
 *
 * THE TREE IS SYNTHETIC AND THE BUILDER IS COMMITTED, which is the arrangement `dependency-rules.
 * spec.ts` arrived at for the same reason. What failed was the configuration rather than any rule
 * logic, so a second copy of the rules written for a test would prove nothing. `buildConfig` takes
 * a root so that the committed builder can be pointed at a tree with a ninth package in it, which
 * is the one thing that cannot be planted in the real `packages/` without breaking every test that
 * cruises the repository in parallel.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

const requireFrom = createRequire(import.meta.url);

/** The committed builder, which is the thing under test. */
const rules = requireFrom(join(repoRoot, 'tools', 'dependency-rules.cjs')) as {
  BOUNDARIES: Record<string, readonly string[]>;
  readPackageDirs(root: string): string[];
  reconcile(diskDirs: readonly string[]): string[];
  buildConfig(root: string): { forbidden: { name: string; to: { path?: string } }[] };
};

/** The depcruise binary, called directly so that no workspace linking happens. */
const BINARY = join(repoRoot, 'node_modules', '.bin', 'depcruise');

/** Where a synthetic tree is built, replaced per test. */
let root: string | undefined;

/**
 * The declared package taken away by the tests that check the stale direction.
 *
 * Read out of the declaration rather than named, so that renaming a package does not turn this
 * file into a test of a package that is no longer there.
 *
 * @returns One declared package directory name
 * @throws {Error} When nothing is declared at all
 */
function someDeclaredPackage(): string {
  const [first] = Object.keys(rules.BOUNDARIES);
  if (first === undefined) throw new Error('BOUNDARIES declares no package at all');

  return first;
}

/**
 * Builds a tree with one empty directory per named package.
 *
 * @param packages - Directory names to create under `packages/`
 * @returns Absolute path of the tree root
 */
function plantTree(packages: readonly string[]): string {
  root = mkdtempSync(join(tmpdir(), 'openref-packages-'));

  for (const name of packages) {
    mkdirSync(join(root, 'packages', name, 'src'), { recursive: true });
  }

  return root;
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('reconcile', () => {
  it('should refuse a package that is on disk and in no boundary declaration', () => {
    // Given the exact probe that found F23: a ninth package beside the eight that are declared.
    // Before the fix this was invisible to every rule and the cruise reported a clean graph.
    const tree = plantTree([...Object.keys(rules.BOUNDARIES), 'probe2']);

    // When, Then
    expect(() => rules.buildConfig(tree)).toThrow(/packages\/probe2 exists on disk/);
  });

  it('should refuse a boundary declaration whose package is not on disk', () => {
    // Given the reverse, which reads as coverage rather than as an error: an entry for a package
    // that is not there governs nothing and can never fail.
    const removed = someDeclaredPackage();
    const tree = plantTree(Object.keys(rules.BOUNDARIES).filter((name) => name !== removed));

    // When, Then
    expect(() => rules.buildConfig(tree)).toThrow(new RegExp(`BOUNDARIES declares "${removed}"`));
  });

  it('should report both directions at once rather than the first one it meets', () => {
    // Given a tree that has lost one package and gained another, which is what a rename looks
    // like. Reporting one would send the next session round the loop twice.
    const removed = someDeclaredPackage();
    const problems = rules.reconcile([
      ...Object.keys(rules.BOUNDARIES).filter((name) => name !== removed),
      'probe2',
    ]);

    // When, Then
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/probe2 exists on disk/);
    expect(problems.join('\n')).toMatch(new RegExp(`declares "${removed}"`));
  });
});

describe('buildConfig', () => {
  it('should put every other package on disk in each boundary rule to path', () => {
    // Given the repository as it is. This is the property F23 broke: a package absent from the
    // array was absent from every `to` path, so nothing could be caught reaching it.
    const config = rules.buildConfig(repoRoot);
    const onDisk = rules.readPackageDirs(repoRoot);

    // When
    const boundaries = config.forbidden.filter((rule) => rule.name.startsWith('boundary-'));

    // Then
    expect(boundaries.map((rule) => rule.name.slice('boundary-'.length)).sort()).toEqual(
      [...onDisk].sort(),
    );

    for (const rule of boundaries) {
      const pkg = rule.name.slice('boundary-'.length);
      const declared = rules.BOUNDARIES[pkg];
      if (declared === undefined) throw new Error(`boundary-${pkg} has no BOUNDARIES entry`);

      const allowed = new Set([pkg, ...declared]);

      for (const other of onDisk) {
        if (allowed.has(other)) continue;
        expect(rule.to.path).toContain(other);
      }
    }
  });

  it('should produce rules that a cruise actually fires, over a tree it has never seen', () => {
    // Given a synthetic tree holding the declared packages and one import that crosses a boundary.
    // The builder is the committed one and only the tree is made up, so what is checked here is
    // the configuration rather than a restatement of the rule.
    const tree = plantTree(Object.keys(rules.BOUNDARIES));

    writeFileSync(
      join(tree, 'tsconfig.json'),
      `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } })}\n`,
      'utf8',
    );
    writeFileSync(
      join(tree, 'cruiser.cjs'),
      `module.exports = require(${JSON.stringify(join(repoRoot, 'tools', 'dependency-rules.cjs'))}).buildConfig(__dirname);\n`,
      'utf8',
    );
    writeFileSync(join(tree, 'packages', 'theme', 'src', 'token.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(tree, 'packages', 'core', 'src', 'plant.ts'),
      "import { a } from '../../theme/src/token';\nexport const b = a;\n",
      'utf8',
    );

    // When
    const fired = cruise(tree);

    // Then
    expect(fired).toContain('boundary-core');
  });
});

describe('readPackageDirs', () => {
  it('should give the gates the same set the dependency graph is built from', () => {
    // Given. THIS IS THE RECONCILIATION THE TWO COPIES NEVER HAD. The gates and the cruiser held
    // separate arrays and nothing compared them; there is one derivation now, and this is what
    // says so out loud rather than leaving it to the next reader to notice.
    // When
    const fromGates = readPackageDirs(repoRoot);

    // Then
    expect([...fromGates]).toEqual(rules.readPackageDirs(repoRoot));
  });

  it('should count a directory with no manifest, because an import can still reach it', () => {
    // Given. A `package.json` test would read as tighter and is looser: the F23 probe was reached
    // by a relative path into `packages/probe2/src`, which resolves whether or not anything
    // declares that directory a package.
    const tree = plantTree(['core', 'probe2']);
    rmSync(join(tree, 'packages', 'probe2', 'src'), { recursive: true });

    // When, Then
    expect(rules.readPackageDirs(tree)).toEqual(['core', 'probe2']);
  });

  it('should give the CSP scan a root for every package on disk', () => {
    // Given the other half of F23, which had nothing to do with the dependency graph: the same
    // array drove the scan roots, so a ninth package's `dist` was never opened.
    // When
    const roots = cspScanRoots(repoRoot);

    // Then
    expect([...roots]).toEqual(readPackageDirs(repoRoot).map((dir) => `packages/${dir}/dist`));
  });
});

/**
 * Cruises one tree with the config file written into it.
 *
 * depcruise exits non zero when it finds a violation, which is the point of the test that uses
 * this, so the exit code is ignored and the report is read from stdout either way.
 *
 * @param cwd - The tree to cruise
 * @returns Every rule that reported a violation
 */
function cruise(cwd: string): readonly string[] {
  let stdout: string;
  try {
    stdout = execFileSync(
      BINARY,
      ['packages', '--config', 'cruiser.cjs', '--output-type', 'json'],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
  } catch (error) {
    const captured = (error as { stdout?: string }).stdout;
    if (captured === undefined) throw error;
    stdout = captured;
  }

  const summary = (JSON.parse(stdout) as { summary?: { violations?: unknown } }).summary;
  const raw = Array.isArray(summary?.violations) ? summary.violations : [];

  return raw.map((entry) => {
    const name = (entry as { rule?: { name?: unknown } }).rule?.name;

    return typeof name === 'string' ? name : '';
  });
}

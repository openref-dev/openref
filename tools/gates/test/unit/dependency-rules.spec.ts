import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * The two dependency rules that key on `dependencyTypes`, checked by planting a violation.
 *
 * WHY THIS FILE EXISTS: BOTH RULES WERE UNREACHABLE FROM THE DAY THEY WERE WRITTEN, and nothing
 * said so. `options.exclude` in `.dependency-cruiser.cjs` carried `node_modules/`, which deletes
 * an npm package from the graph rather than declining to walk into it, so the edge these rules
 * judge did not exist and the cruise reported a clean graph every time. Filed as F22, fixed on
 * 2026-08-11 by moving that path to `doNotFollow`, where it already was.
 *
 * A rule scoped out of the material it governs is indistinguishable from a rule that passes.
 * That is the whole finding, and it is why every test here plants a violation and requires it to
 * be reported. Asserting that the repository is clean is what the gate already does, and a clean
 * line was the symptom rather than the evidence.
 *
 * THE COMMITTED CONFIG IS THE THING UNDER TEST AND IT IS READ FROM ITS REAL PATH. What failed was
 * the configuration rather than the rule logic, so a second copy of the rules written for a test
 * would prove nothing about the one the gate runs. Only the tree is synthetic: a probe package
 * under a temporary root, laid out as `packages/<name>/src` so that the same path anchors apply.
 *
 * THE TREE IS SYNTHETIC BECAUSE THE FIRST VERSION PLANTED INTO `packages/` AND BROKE THE SUITE.
 * Vitest runs files in parallel, `gates.spec.ts` cruises the real repository, and a probe package
 * with a deliberate violation sitting in `packages/` for the second the plant lived made that
 * integration test fail. A test that dirties the tree other tests read is a flake with a schedule.
 */

/** Where the probe root is built, replaced per test. */
let root: string;

/** The `node_modules` the probe borrows, which already has the two packages named below. */
const BORROWED_MODULES = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'nest',
  'node_modules',
);

/** The committed configuration, which is the whole point of this file. */
const CONFIG = join(import.meta.dirname, '..', '..', '..', '..', '.dependency-cruiser.cjs');

/** The depcruise binary, called directly so that no workspace linking happens. */
const BINARY = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'node_modules',
  '.bin',
  'depcruise',
);

/** One file of a probe package, relative to the probe package root. */
interface ProbeFile {
  readonly path: string;
  readonly source: string;
}

/**
 * Builds a one package tree, cruises it with the committed config, and reports the rules that fired.
 *
 * @param manifest - The probe's `package.json`, as an object
 * @param files - Sources to write under the probe package
 * @returns The name of every rule that reported a violation
 */
function cruiseProbe(
  manifest: Record<string, unknown>,
  files: readonly ProbeFile[],
): readonly string[] {
  root = mkdtempSync(join(tmpdir(), 'openref-depcruise-'));

  const probe = join(root, 'packages', 'probe');
  mkdirSync(join(probe, 'src'), { recursive: true });

  // `tsPreCompilationDeps` needs a tsconfig at the cruise root, and this one only has to make the
  // TypeScript sources readable. Nothing in these tests depends on a compiler option.
  writeFileSync(
    join(root, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' } }, null, 2)}\n`,
    'utf8',
  );

  writeFileSync(join(probe, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // THE PROBE BORROWS AN INSTALLED TREE RATHER THAN ASKING FOR ONE. Without a `node_modules` its
  // imports resolve to nothing, the only rule that fires is `not-to-unresolvable`, and the rules
  // under test never see an npm edge, which is the very condition this file exists to detect.
  // Running an install to fix that would be a unit test writing a lockfile.
  symlinkSync(BORROWED_MODULES, join(probe, 'node_modules'));

  for (const file of files) {
    const absolute = join(probe, file.path);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, file.source, 'utf8');
  }

  return rulesThatFired(cruise(root));
}

/**
 * Runs the committed cruise over one root.
 *
 * depcruise exits non zero when it finds a violation, which is what most of these tests are about,
 * so the exit code is ignored and the report is read from stdout either way.
 *
 * @param cwd - The root to cruise, which the config's `^packages/` anchors are relative to
 * @returns The parsed report
 */
function cruise(cwd: string): unknown {
  try {
    return JSON.parse(
      execFileSync(BINARY, ['packages', '--config', CONFIG, '--output-type', 'json'], {
        cwd,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout === undefined) throw error;

    return JSON.parse(stdout);
  }
}

/**
 * Reads the rule names out of a report without trusting its shape.
 *
 * @param report - Whatever depcruise printed
 * @returns Every rule that reported a violation, in report order
 */
function rulesThatFired(report: unknown): readonly string[] {
  const summary = (report as { summary?: { violations?: unknown } }).summary;
  const raw = Array.isArray(summary?.violations) ? summary.violations : [];

  return raw.map((entry) => {
    const name = (entry as { rule?: { name?: unknown } }).rule?.name;

    return typeof name === 'string' ? name : '';
  });
}

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('no-dev-dep-in-src', () => {
  it('should report a devDependency imported by published source', () => {
    // Given the exact plant that found F22: a package declaring jsdom as a devDependency, and a
    // file under its src importing it. Before the fix this cruised with zero dependencies.
    const fired = cruiseProbe(
      {
        name: 'probe',
        version: '0.0.0',
        private: true,
        type: 'module',
        devDependencies: { jsdom: '30.0.1' },
      },
      [
        {
          path: 'src/plant.ts',
          source: "import { JSDOM } from 'jsdom';\nexport const a = JSDOM;\n",
        },
      ],
    );

    // When, Then
    expect(fired).toContain('no-dev-dep-in-src');
  });

  it('should report a type-only import too, because that one reaches the published types', () => {
    // Given. The JavaScript is erased, so this is not a consumer's install breaking, it is their
    // typecheck breaking on a `.d.ts` naming a package they were never told to have.
    const fired = cruiseProbe(
      {
        name: 'probe',
        version: '0.0.0',
        private: true,
        type: 'module',
        devDependencies: { jsdom: '30.0.1' },
      },
      [
        {
          path: 'src/plant.ts',
          source: "import type { JSDOM } from 'jsdom';\nexport type A = JSDOM;\n",
        },
      ],
    );

    // When, Then
    expect(fired).toContain('no-dev-dep-in-src');
  });

  it('should allow a peer that is also a devDependency, which is how a peer is tested', () => {
    // Given the shape `packages/nest` actually has, and the reason the rule carries an exception
    // at all: the peer is declared to the consumer, and the devDependency is how this repository
    // gets a copy to build and test against. Pinned so that removing the exception, or widening it
    // until it swallows the two cases above, is a test failure rather than a quiet change.
    const fired = cruiseProbe(
      {
        name: 'probe',
        version: '0.0.0',
        private: true,
        type: 'module',
        peerDependencies: { jsdom: '^30.0.0' },
        devDependencies: { jsdom: '30.0.1' },
      },
      [
        {
          path: 'src/plant.ts',
          source: "import { JSDOM } from 'jsdom';\nexport const a = JSDOM;\n",
        },
      ],
    );

    // When, Then
    expect(fired).toEqual([]);
  });
});

describe('no-duplicate-dep-types', () => {
  it('should report a package declared in dependencies and devDependencies at once', () => {
    // Given the defect this rule is for: two declarations of one package, after which which copy
    // a consumer ends up with is the resolver's choice rather than anybody's decision.
    const fired = cruiseProbe(
      {
        name: 'probe',
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: { marked: '18.0.9' },
        devDependencies: { marked: '18.0.9' },
      },
      [
        {
          path: 'src/plant.ts',
          source: "import { marked } from 'marked';\nexport const a = marked;\n",
        },
      ],
    );

    // When, Then
    expect(fired).toContain('no-duplicate-dep-types');
  });

  it('should not report a peer that is also a devDependency', () => {
    // Given the same sanctioned pattern seen from the other rule: two groups, one declaration,
    // two audiences. Read from a test path, so the sibling rule is not what keeps this empty.
    const fired = cruiseProbe(
      {
        name: 'probe',
        version: '0.0.0',
        private: true,
        type: 'module',
        peerDependencies: { marked: '^18.0.0' },
        devDependencies: { marked: '18.0.9' },
      },
      [
        {
          path: 'test/plant.ts',
          source: "import { marked } from 'marked';\nexport const a = marked;\n",
        },
      ],
    );

    // When, Then
    expect(fired).toEqual([]);
  });
});

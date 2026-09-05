import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BROWSER_BASELINE_FILE,
  BUDGET_EXCEPTIONS,
  BROWSER_CEILINGS,
  BUDGET_EXCEPTION_HISTORY,
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  CLIENT_JS_GESTURES,
  FONT_BUDGETS,
  SHIPPED_CLIENT_BUNDLES,
  SPEC_20_BUDGET_IDS,
  FONT_STYLESHEETS,
  LICENSE_ATTESTATIONS,
  PUBLISHED_PACKAGES,
  THEME_TOKEN_STYLESHEETS,
} from '../../src/config';
import { budgetExceptionsGate } from '../../src/gates/budget-exceptions.gate';
import { budgetsGate } from '../../src/gates/budgets.gate';
import { buildManifestGate } from '../../src/gates/build-manifest.gate';
import { claimsGate } from '../../src/gates/claims.gate';
import { dependencyGraphGate } from '../../src/gates/dependency-graph.gate';
import { enginesFloorGate } from '../../src/gates/engines-floor.gate';
import { fixtureLicensesGate } from '../../src/gates/fixture-licenses.gate';
import { licensesGate } from '../../src/gates/licenses.gate';
import { publishListGate } from '../../src/gates/publish-list.gate';
import { themeFontsGate } from '../../src/gates/theme-fonts.gate';
import { themeMotionGate } from '../../src/gates/theme-motion.gate';
import { AI_DOCS_DIR, aiDocsPresent } from '../../src/lib/ai-docs';
import { projectionRequest } from '../../src/lib/projection-request';
import { projectFromDisk, writeProjection } from '../../src/lib/projection';
import { checkBudgetExceptions } from '../../src/lib/budget-exceptions';
import { parseContents, parseMilestones, splitLines } from '../../src/lib/build-manifest';
import { runCommand } from '../../src/lib/exec';
import {
  detectLicenseFromText,
  flattenLicenseReport,
  hashLicenseText,
  type PnpmLicenseReport,
} from '../../src/lib/licenses';
import { partitionByGesture, partitionModuleGraph } from '../../src/lib/module-graph';
import { RUNNER_CODE_MARKERS } from '../../src/lib/runner-binding';
import { collectFiles } from '../../src/lib/walk';
import { readWorkspaceManifests, resolveShippedPackages } from '../../src/lib/workspace';
import { GATES, selectGates } from '../../src/run';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/**
 * Whether the maintainer's private documents are on this machine.
 *
 * Four cases below drive a gate against the real `ai-docs/` and assert it passes. On a clone
 * that has no such directory the gate skips, correctly and loudly, and the case read that
 * correct skip as a failure. THE SKIP ITSELF IS NOT WEAKENED BY THIS: the two cases at the foot
 * of this file prove the skip happens and that an empty `ai-docs/` still fails, and both run
 * everywhere. What the runner enforces without the directory is that no gate skipped for any
 * other reason, which is `accountForSkips`.
 */
const HAVE_AI_DOCS = aiDocsPresent(repoRoot);

/**
 * A file planted inside `core` that imports from `vue`, which the graph forbids.
 * It is removed again in `afterEach` so the repository is restored to green.
 */
const PROBE_PATH = join(repoRoot, 'packages', 'core', 'src', 'deps-boundary.probe.ts');

const PROBE_SOURCE = `// Temporary probe written by the dependency graph gate test. Removed by the same test.
export { PACKAGE_NAME as PROBE } from '../../vue/src/index';
`;

afterEach(() => {
  rmSync(PROBE_PATH, { force: true });
});

describe('buildManifestGate', () => {
  it('should pass on the committed BUILD.md, wherever this runs', async () => {
    // Given, and it runs everywhere now: the line addressing is read out of the committed
    // projection, so a clone with no `ai-docs/` answers this too. It was skipped there before.
    const context = { repoRoot };

    // When
    const result = await buildManifestGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
  });

  it('should run before every other gate', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(buildManifestGate.id);

    // Then
    expect(position).toBe(0);
  });
});

describe('dependencyGraphGate', () => {
  it(
    'should pass on the committed dependency graph',
    async () => {
      // Given
      const context = { repoRoot };

      // When
      const result = await dependencyGraphGate.run(context);

      // Then
      expect(result.status).toBe('pass');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should fail when core is made to depend on vue',
    async () => {
      // Given
      writeFileSync(PROBE_PATH, PROBE_SOURCE, 'utf8');

      // When
      const result = await dependencyGraphGate.run({ repoRoot });

      // Then
      expect(result.status).toBe('fail');
      expect(result.findings.map((finding) => finding.message).join('\n')).toContain(
        'boundary-core',
      );
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should return to green once the violation is removed',
    async () => {
      // Given
      writeFileSync(PROBE_PATH, PROBE_SOURCE, 'utf8');
      rmSync(PROBE_PATH, { force: true });

      // When
      const result = await dependencyGraphGate.run({ repoRoot });

      // Then
      expect(result.status).toBe('pass');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('enginesFloorGate', () => {
  it(
    'should pass on the committed manifests and the committed closure',
    async () => {
      // Given
      const context = { repoRoot };

      // When
      const result = await enginesFloorGate.run(context);

      // Then
      const errors = result.findings.filter((finding) => finding.level === 'error');
      expect(errors).toEqual([]);
      expect(result.status).toBe('pass');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should read a range from a real package rather than reporting on an empty set',
    async () => {
      // Given, a check that found no declared range anywhere would pass in silence, which is the
      // shape of failure this gate was built to remove rather than to reproduce.
      const context = { repoRoot };

      // When
      const result = await enginesFloorGate.run(context);
      const summary = result.findings.find((finding) => finding.level === 'info')?.message ?? '';

      // Then
      expect(summary).toMatch(/is a subset of the \d+ declared range\(s\)/);
      expect(summary).not.toContain('subset of the 0 declared');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('licensesGate', () => {
  it(
    'should pass on the committed dependency tree',
    async () => {
      // Given
      const context = { repoRoot };

      // When
      const result = await licensesGate.run(context);

      // Then
      const errors = result.findings.filter((finding) => finding.level === 'error');
      expect(errors).toEqual([]);
      expect(result.status).toBe('pass');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should scope the production zone to the published packages and the ones they bundle', () => {
    // Given
    const manifests = readWorkspaceManifests(repoRoot);

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    // THE THREE ECOSYSTEM COLLECTORS JOINED THE LIST IN T019, per SPEC 4, and they are published
    // rather than bundled on purpose: each exists to read a third party library, so an edge from
    // `@openref/nest` would put that library in the closure of every consumer. They bundle nothing
    // themselves and take `@openref/core` and `@openref/nest` as peers.
    // AND THE SIXTH PUBLISHED PACKAGE ARRIVED IN T032. `@openref/theme-telltale` is the second
    // theme, and SPEC 4 lists it beside the first: a theme is published because a consumer chooses
    // it, which is the same reason `@openref/theme` is.
    // AND TWO MORE ARRIVED AT T064, each answering a section addressed to it. `@openref/theme-kit`
    // is published because the theme contract of SPEC 10.4 is frozen public API and `assertTheme`
    // is what makes it enforceable where themes are actually written; `@openref/runner` because a
    // host can drive the serialization matrix of SPEC 14.2 outside a page, which was proved by
    // compiling `@openref/core` to `@openref/vue`'s `runnerOperationOf` to `createRunner().send`.
    // A third, `@openref/nuxt`, was decided the same way and then reversed by measurement: it
    // drags Nuxt's build toolchain into SPEC 0's zone 1 through a resolved peer dependency, and
    // five licences there are outside the allowlist. SPEC 4 carries all three.
    // AND A FOURTH ECOSYSTEM COLLECTOR ARRIVED AT `TX-REDISX-RATELIMIT`, which is the twelfth name
    // and the first collector written against the frozen contract rather than alongside it.
    // `@openref/collector-redisx-rate-limit` reads `@nestjs-redisx/rate-limit`, which is MIT with
    // no runtime dependency of its own and is an optional peer, so it enlarges the production zone
    // by nothing.
    expect(result.published).toEqual([
      '@openref/collector-access-control',
      '@openref/collector-casl',
      '@openref/collector-redisx-rate-limit',
      '@openref/collector-throttler',
      '@openref/core',
      '@openref/nest',
      '@openref/runner',
      '@openref/theme',
      '@openref/theme-kit',
      '@openref/theme-telltale',
      '@openref/vue',
      'openref',
    ]);
    // `@openref/theme-kit` JOINED THE BUNDLED SET IN T032 WITHOUT BEING BUNDLED, WHICH WAS THIS
    // HEURISTIC'S FIRST COUNTEREXAMPLE, AND AT T064 IT LEFT BY BEING PUBLISHED RATHER THAN BY THE
    // HEURISTIC CHANGING. `resolveShippedPackages` reads any edge from a published package to a
    // private workspace one as bundling, and says why: an internal package sits in
    // `devDependencies` precisely because it is inlined rather than installed.
    // `@openref/theme-telltale` named theme-kit there to run the conformance checker over itself in
    // a test, and its `tsup.config` never bundled it. Now that theme-kit is published the edge runs
    // between two published packages, which this function does not read at all, so the
    // counterexample is gone rather than tolerated. THE RULE IS STILL DELIBERATELY WIDE AND SPEC 4
    // SAYS SO: widening only ever over reports, and a package wrongly called shipped is checked
    // more strictly than it needs to be while one wrongly called unshipped is not checked at all.
    // `@openref/runner` left the bundled set at T064 for a different reason: it is published, so
    // per SPEC 4 `@openref/nest` stopped inlining it and declares it instead.
    // `@openref/static` JOINED THE SET AT T039, and it is the ordinary case rather than the
    // counterexample above: it is private, `openref` names it in `dependencies`, and the CLI's
    // `tsup.config` inlines it by name, so a consumer of the CLI receives it as bytes and its
    // licence closure belongs in the production zone.
    // `@openref/federation` JOINED THE SET AT T046, the ordinary case again: it is private,
    // `@openref/nest` names it in `devDependencies`, and the server build's `tsup.config`
    // inlines it by name, so a consumer of the module receives the merge engine and the remote
    // lifecycle as bytes and their licence closure belongs in the production zone.
    // `@openref/agent` JOINED THE SET AT T058, the ordinary case a third time and by the same
    // three facts: it is private, `@openref/nest` names it in `devDependencies`, and the server
    // build's `tsup.config` inlines it by name, so a consumer of the module receives the agent
    // surface of SPEC 18.1 as bytes. Its own dependency closure is `core` and `render`, both
    // already in this list or published, so the production zone gains no third party licence.
    // `@openref/samples` JOINED THE SET AT `TX-PAGE-SAMPLES`, the ordinary case a fourth time and
    // by the same three facts: it is private, `@openref/nest` and `openref` both name it in
    // `devDependencies`, and both builds' `tsup.config` inline it by name, so a consumer of either
    // receives the sample generator of SPEC 18 as bytes. Its own dependency closure is `core` and
    // `runner`, both already published, so the production zone gains no third party licence.
    expect(result.bundled).toEqual([
      '@openref/agent',
      '@openref/federation',
      '@openref/render',
      '@openref/samples',
      '@openref/search',
      '@openref/static',
    ]);
    expect(result.shipped).not.toContain('@openref/gates');
  });

  it(
    'should keep the browser driver out of the published closure, measured rather than assumed',
    () => {
      // Given, the confirmation T015 owes: `playwright-core` is a devDependency and SPEC 0 zone 2
      // applies, and both zones allow Apache-2.0, so no licence check can tell whether it shipped.
      // The published closure is asked directly, and the development tree is asked too, because a
      // check that found the driver in neither would pass while proving nothing.
      const manifests = readWorkspaceManifests(repoRoot);
      const { shipped } = resolveShippedPackages(manifests);

      // When
      const production = runCommand(
        'pnpm',
        ['licenses', 'list', '--json', '--prod', ...shipped.flatMap((name) => ['--filter', name])],
        repoRoot,
      );
      const everything = runCommand('pnpm', ['licenses', 'list', '--json'], repoRoot);

      const namesIn = (stdout: string): string[] =>
        flattenLicenseReport(JSON.parse(stdout.trim()) as PnpmLicenseReport).map(
          (entry) => entry.name,
        );

      // Then
      const shippedNames = namesIn(production.stdout);
      expect(shippedNames).not.toContain('playwright-core');
      expect(shippedNames.filter((name) => /playwright|puppeteer|chromium/.test(name))).toEqual([]);
      expect(namesIn(everything.stdout)).toContain('playwright-core');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should hold a recorded license reading that still matches the text on disk', () => {
    // Given
    const recorded = LICENSE_ATTESTATIONS.find(
      (attestation) => attestation.package === 'spawndamnit@3.0.1',
    );
    const path = join(
      repoRoot,
      'node_modules/.pnpm/spawndamnit@3.0.1/node_modules/spawndamnit',
      recorded?.file ?? 'LICENSE',
    );

    // When
    const actual = hashLicenseText(readFileSync(path, 'utf8'));

    // Then
    expect(recorded?.sha256).toBe(actual);
    expect(detectLicenseFromText(readFileSync(path, 'utf8'))).toBe(recorded?.license);
  });
});

describe('publishListGate', () => {
  it(
    'should pass on this repository',
    async () => {
      // Given, the gate shells out to `pnpm publish --dry-run` with the registry pointed at an
      // address nothing answers on, so this case runs the whole thing end to end and is also the
      // proof that the run needs no registry: a run that reached for one would fail here.
      const context = { repoRoot };

      // When
      const result = await publishListGate.run(context);

      // Then it passes wherever it runs, because SPEC 4's three lists are lists of package names
      // and travel in the committed projection. It skipped on every clone before that.
      expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
      expect(result.status).toBe('pass');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should read the dry run rather than reporting on an empty list',
    async () => {
      // Given, a dry run that named nothing would satisfy every set comparison below it for free,
      // so the count is asserted before anything is concluded from it.
      const context = { repoRoot };

      // When
      const result = await publishListGate.run(context);
      const summary = result.findings.find((finding) =>
        finding.message.includes('the publish dry run names exactly'),
      );

      // Then
      expect(summary?.message).toContain(`exactly the ${String(PUBLISHED_PACKAGES.length)}`);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should warn rather than fail when CLAUDE.md is not in the checkout',
    async () => {
      // Given, CLAUDE.md is excluded from git in `.git/info/exclude` exactly as `ai-docs/` is, so a
      // clone has neither and an error here would fail every checkout but the maintainer's. The
      // content is held rather than moved, so it is restored even if an assertion throws, and a
      // checkout that already lacks the file is the condition itself rather than a case to set up.
      const path = join(repoRoot, 'CLAUDE.md');
      const present = existsSync(path);
      const held = present ? readFileSync(path, 'utf8') : '';
      let result;

      // When
      try {
        if (present) rmSync(path);
        result = await publishListGate.run({ repoRoot });
      } finally {
        if (present) writeFileSync(path, held, 'utf8');
      }

      // Then, unread and saying so, rather than a pass or a defect in the code.
      const warnings = result.findings.filter((finding) => finding.level === 'warning');
      expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
      expect(warnings.map((finding) => finding.message).join('\n')).toContain(
        'the fourth hand written copy of the published set went unread',
      );
      expect(existsSync(path)).toBe(present);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should compare the manifests against the repository this checkout came from',
    async () => {
      // Given, the expected repository is derived rather than typed, so the gate reports which one
      // it used and where it read it. A literal here would be the drift this replaced.
      const context = { repoRoot };

      // When
      const result = await publishListGate.run(context);
      const summary = result.findings.find((finding) =>
        finding.message.includes('published packages carry the licence text'),
      );

      // Then
      expect(summary?.message).toMatch(/naming \S+\/\S+, which is where this build runs/);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('fixtureLicensesGate', () => {
  it('should pass on the committed corpus', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await fixtureLicensesGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
  }, 120_000);

  it('should attribute every corpus document in the NOTICE that sits beside it', () => {
    // Given
    const base = join(repoRoot, 'packages/core/test/corpus');
    const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as {
      documents: { file: string; copyrightHolder: string; license: string }[];
    };
    const notice = readFileSync(join(base, 'NOTICE'), 'utf8');

    // When
    const missing = manifest.documents.filter(
      (document) =>
        !notice.includes(document.file) ||
        !notice.includes(document.copyrightHolder) ||
        !notice.includes(document.license),
    );

    // Then, an empty manifest attributes every document in it, per SPEC 0
    expect(manifest.documents.length).toBeGreaterThan(0);
    expect(missing.map((document) => document.file)).toEqual([]);
  });

  it('should cover 3.0, 3.1 and 3.2 with at least fifteen documents, per SPEC 21', () => {
    // Given
    const base = join(repoRoot, 'packages/core/test/corpus');
    const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as {
      documents: { file: string }[];
    };

    // When
    const versions = new Set(
      manifest.documents.map((document) => {
        const text = readFileSync(join(base, 'documents', document.file), 'utf8');
        return /openapi["']?\s*:\s*["']?(\d+\.\d+)/.exec(text)?.[1] ?? 'unknown';
      }),
    );

    // Then
    expect(manifest.documents.length).toBeGreaterThanOrEqual(15);
    expect([...versions].sort()).toEqual(['3.0', '3.1', '3.2']);
  }, 60_000);
});

describe('themeMotionGate', () => {
  it('should pass on all five committed theme stylesheets', async () => {
    // Given, three reference designs and the two shipped themes. Three of the five are documents
    // rather than code, and a check that saw only the code would report conformance for a fraction
    // of the problem. It was four until T032 shipped the second theme. The three under `ai-docs/`
    // arrive through the committed projection, so this runs on a clone as well.
    const context = { repoRoot };

    // When
    const result = await themeMotionGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(THEME_TOKEN_STYLESHEETS.map((sheet) => sheet.theme)).toEqual([
      'vernier, as shipped',
      'telltale, as shipped',
      'vernier, as designed',
      'telltale, as designed',
      'forge',
    ]);
  });

  it('should fail on a stylesheet it was told about and cannot read', async () => {
    // Given, a theme this cannot read is a theme nothing checks, so absence is an error and
    // never a skip. `ai-docs/` IS PLANTED AND IT IS THE POINT OF THE FIXTURE: three of the four
    // themes live under it, so a checkout without the directory is a different condition from a
    // theme that lost its tokens, and this case is the second one.
    const context = { repoRoot: mkdtempSync(join(tmpdir(), 'openref-motion-')) };
    mkdirSync(join(context.repoRoot, AI_DOCS_DIR), { recursive: true });
    writeProjection(context.repoRoot, projectFromDisk(context.repoRoot, projectionRequest()));

    // When
    const result = await themeMotionGate.run(context);
    rmSync(context.repoRoot, { recursive: true, force: true });

    // Then, one finding per file rather than per theme: the shipped theme loads two, and both
    // are named, because a theme half read is a theme unchecked either way. The three under
    // `ai-docs/` are named by the artefact that carries no reading of them and the two shipped
    // ones by the disk, and both sentences say the theme went unchecked.
    const files = THEME_TOKEN_STYLESHEETS.reduce((count, sheet) => count + sheet.files.length, 0);
    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(files);
    expect(result.findings.map((finding) => finding.message).join(' ')).toContain(
      'so this theme is unchecked',
    );
  });
});

describe('themeFontsGate', () => {
  it('should pass on both committed stylesheets and the fonts beside them', async () => {
    // Given, the ranges were rewritten by hand after the defect of 2026-08-10, and this is what
    // stops them being written by hand again without anything noticing. Two themes ship faces
    // since T032, and the count below is what makes the second one's absence a failure here.
    const context = { repoRoot };

    // When
    const result = await themeFontsGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.findings[0]?.message).toContain('16 face(s)');
    expect(result.findings[0]?.message).toContain('2 stylesheet(s)');
  });

  it('should fail on a stylesheet it was told about and cannot read', async () => {
    // Given, the same rule the motion gate follows: absence is an error, never a skip.
    const context = { repoRoot: mkdtempSync(join(tmpdir(), 'openref-fonts-')) };

    // When
    const result = await themeFontsGate.run(context);
    rmSync(context.repoRoot, { recursive: true, force: true });

    // Then
    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(FONT_STYLESHEETS.length);
    expect(result.findings[0]?.message).toContain('is not there, so its faces are unchecked');
  });

  it('should fail on a stylesheet that declares nothing it can check', async () => {
    // Given, a stylesheet with no @font-face passes every textual check ever written about it.
    const root = mkdtempSync(join(tmpdir(), 'openref-fonts-'));
    const target = join(root, FONT_STYLESHEETS[0]?.file ?? '');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, ':root { --oref-font-family-sans: sans-serif; }\n');

    // When
    const result = await themeFontsGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });

    // Then
    expect(result.status).toBe('fail');
    expect(result.findings[0]?.message).toContain('declares no @font-face');
  });
});

describe('budgetsGate, the three font budgets', () => {
  /**
   * Builds a repository root holding one theme's font directory and a browser baseline.
   *
   * The size budgets then find no artifacts and print SKIP, which is what they are supposed to
   * do, and the font budgets are measured on files this test controls the bytes of.
   *
   * THE BASELINE IS PLANTED TOO, and it is not decoration. The gate reads the committed browser
   * study and fails when there is none, per T001's rule that a missing artifact never reads as
   * a pass. A fixture root with no baseline is a repository that never took the measurement,
   * which is a different failure from the one each of these cases is about.
   */
  function plantFonts(files: Readonly<Record<string, number>>): string {
    const root = mkdtempSync(join(tmpdir(), 'openref-budgets-'));
    const directory = join(root, FONT_BUDGETS[0]?.directory ?? '');
    mkdirSync(directory, { recursive: true });

    for (const [name, bytes] of Object.entries(files)) {
      // Random bytes so gzip cannot compress them away and the measurement is the size asked
      // for rather than the compressibility of whatever filler was chosen.
      writeFileSync(join(directory, name), randomBytes(bytes));
    }

    const baselineFile = join(root, BROWSER_BASELINE_FILE);
    mkdirSync(dirname(baselineFile), { recursive: true });
    writeFileSync(baselineFile, `${JSON.stringify(plantedBaseline())}\n`);

    return root;
  }

  /** A study whose every figure is inside SPEC 20, so only the fonts decide these cases. */
  function plantedBaseline(): Record<string, unknown> {
    const spread = { samples: 25, median: 100, min: 90, max: 110, standardDeviation: 5 };

    return {
      recordedAt: '2026-08-10',
      commit: 'planted',
      environment: { id: 'planted', label: 'planted', cpuModel: 'planted', cpuCount: 4 },
      browser: { version: '150.0.0.0', major: 150 },
      chromeArgs: [],
      throttleRate: 4,
      throttleRatio: { ...spread, median: 4, min: 4, max: 4, standardDeviation: 0 },
      ttiMs: spread,
      ttiPhaseMs: { transfer: 1, parse: 50, script: 40, firstContentfulPaint: 80 },
      mainThreadMs: { ...spread, median: 150, min: 140, max: 160 },
      longTaskCount: { ...spread, median: 2, min: 1, max: 3, standardDeviation: 0.5 },
      parsedBytes: { documentBytes: 30_000, cssBytes: 32_000, jsBytes: 100_000 },
      peakHeapBytes: { ...spread, median: 4_000_000, min: 4_000_000, max: 4_000_000 },
      externalRequests: 0,
      cspViolations: 0,
      overBudget: [],
    };
  }

  it('should measure the first paint pair, the latin files and the whole directory apart', async () => {
    // Given, ten small files under the names the budget lists.
    const budget = FONT_BUDGETS[0];
    const named = [...(budget?.latin ?? []), 'Extra-latin-ext.woff2'];
    const root = plantFonts(Object.fromEntries(named.map((file) => [file, 1024])));

    // When
    const result = await budgetsGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });
    const ids = result.findings
      .map((finding) => /^OK (fonts-[a-z-]+)/.exec(finding.message)?.[1])
      .filter((id) => id !== undefined);

    // Then the three font budgets are measured over the files this root holds
    expect(ids).toEqual(['fonts-first-paint', 'fonts-latin', 'fonts-total']);

    // AND THE GATE SKIPS RATHER THAN PASSES, WHICH THIS CASE ASSERTED THE OTHER WAY UNTIL THE
    // PRE-M4 REVIEW. The root holds committed fonts and nothing a build produced, and the gate
    // decided its verdict on how many budgets were weighed at all, a count these fonts keep above
    // zero. So a tree with the client bundle removed, or with every `dist` removed, printed twelve
    // SKIP lines and returned `pass`, measured on a mirror of the repository twice. The figure that
    // answers "did I see a build" existed already, was added at `T042` for the debt gate, and was
    // never wired into the gate that owns the measurement. The assertion here was the defect
    // written as a requirement, which is why it moved rather than the code.
    expect(result.status).toBe('skip');
    expect(result.skipReason).toBe('artifact-absent');
  });

  it('should skip rather than pass when nothing a build produces is there to weigh', async () => {
    // Given a root carrying the committed fonts and no build output at all
    const budget = FONT_BUDGETS[0];
    const root = plantFonts(Object.fromEntries((budget?.latin ?? []).map((file) => [file, 1024])));

    // When
    const result = await budgetsGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });

    // Then the size budgets say what they did not read, and the verdict is not a pass
    expect(result.status).toBe('skip');
    expect(result.findings.map((finding) => finding.message).join('\n')).toContain(
      'SKIP client-js-raw: no artifacts under',
    );
  });

  it('should fail when a named latin file is absent rather than measuring it as zero', async () => {
    // Given, every file but one of the five the latin budget names. A budget that silently
    // measures an absent file as zero passes by being wrong rather than by being small, which
    // is the only way either of the two named budgets could go green while shipping more.
    const budget = FONT_BUDGETS[0];
    const present = (budget?.latin ?? []).slice(0, -1);
    const root = plantFonts(Object.fromEntries(present.map((file) => [file, 1024])));

    // When
    const result = await budgetsGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });

    // Then
    expect(result.status).toBe('fail');
    expect(result.findings.filter((finding) => finding.level === 'error')).toHaveLength(1);
    expect(result.findings.map((finding) => finding.message).join('\n')).toContain(
      'fonts-latin, @openref/theme: names 5 file(s) and found 4',
    );
  });

  it('should fail a budget that is over, naming the overshoot', async () => {
    // Given, a first paint pair well past 60 KB.
    const budget = FONT_BUDGETS[0];
    const files = Object.fromEntries(
      (budget?.latin ?? []).map((file) => [
        file,
        (budget?.firstPaint ?? []).includes(file) ? 40 * 1024 : 1024,
      ]),
    );
    const root = plantFonts(files);

    // When
    const result = await budgetsGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });
    const over = result.findings.filter((finding) => finding.message.startsWith('OVER'));

    // Then
    expect(result.status).toBe('fail');
    expect(over.map((finding) => finding.message.split(',')[0])).toEqual([
      'OVER fonts-first-paint',
    ]);
  });
});

describe('the deferred half of the shipped bundle, divided by gesture', () => {
  /**
   * Walks the real built bundle and divides its deferred side the way the budgets do.
   *
   * @returns The division, or null when the bundle has not been built on this machine
   */
  function divide(): ReturnType<typeof partitionByGesture> | null {
    const bundle = SHIPPED_CLIENT_BUNDLES[0];
    if (bundle === undefined) return null;

    const present = bundle.roots.flatMap((root) =>
      collectFiles(join(repoRoot, root), ['.js', '.mjs'], repoRoot),
    );
    if (present.length === 0) return null;

    return partitionByGesture(
      repoRoot,
      partitionModuleGraph(repoRoot, bundle.file, present),
      CLIENT_JS_GESTURES,
    );
  }

  it('should put the runner where the Send budget says it is, and in no other gesture', () => {
    // Given the one attribution in this division that the module graph cannot make. The entry
    // hands the renderer a `loadRunner` function, so `import('@openref/runner')` is written in
    // the entry and the runner reads as a dynamic root beside the three components, while the
    // only caller is the console's loader. The declaration says Send pays for it; this reads the
    // built files and asks whether the runner is actually there.
    const divided = divide();
    if (divided === null) return;

    const marker = RUNNER_CODE_MARKERS[0]?.literal ?? '';
    const carries = (files: readonly string[]): boolean =>
      files.some((file) => readFileSync(join(repoRoot, file), 'utf8').includes(marker));

    // When
    const send = divided.byGesture.get('send')?.files ?? [];
    const others = [...divided.byGesture]
      .filter(([id]) => id !== 'send')
      .map(([, split]) => split.files);

    // Then
    expect(carries(send)).toBe(true);
    for (const files of others) expect(carries(files)).toBe(false);
  });

  it('should leave no deferred chunk that no gesture downloads', () => {
    // Given the property that replaced the single cap over the union: the three gestures have to
    // cover the deferred side between them, or a chunk is behind a dynamic import with no budget
    // over it at all, which is what one cap used to prevent by accident.
    const divided = divide();
    if (divided === null) return;

    // Then
    expect(divided.unclaimed).toEqual([]);
    for (const [, split] of divided.byGesture) {
      expect(split.missingRoots).toEqual([]);
      expect(split.ambiguousRoots).toEqual([]);
      expect(split.files.length).toBeGreaterThan(0);
    }
  });
});

describe('budgetExceptionsGate', () => {
  it(
    'should pass on an empty list and print every debt that ever closed',
    async () => {
      // Given the state at the close of M2: no live entry for the first time since 2026-08-11,
      // and three closed ones. Each is printed on every run with the reason it ended, because an
      // entry that simply vanished would leave a reader unable to tell a debt that was paid from
      // a debt somebody stopped counting, and none of these three ended the same way.
      const context = { repoRoot };

      // When
      const result = await budgetExceptionsGate.run(context);
      const printed = result.findings.map((finding) => finding.message).join('\n');

      // Then
      expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
      expect(result.status).toBe('pass');
      expect(printed).toContain('no budget is excepted');

      // And the closed entries are still there with the reasons they ended: retired, paid, and
      // paid-then-re-derived, each with its figure. The page-bytes closure carries the commit its
      // recorded figure was taken at, per the freshness rule the stale record earned twice.
      expect(printed).toContain('CLOSED tti');
      expect(printed).toContain('NO LONGER EXISTS IN GATED FORM');
      expect(printed).toContain('CLOSED client-js-raw');
      expect(printed).toContain('CLOSED page-bytes');
      expect(printed).toContain('at commit 53027c9');
      expect(printed).toContain('RE-DERIVATION');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should run immediately after the budgets, so the figure is read before the terms', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(budgetExceptionsGate.id);

    // Then
    expect(order[position - 1]).toBe(budgetsGate.id);
  });

  it(
    'should print no budget as over, now that the last entry closed with the milestone',
    async () => {
      // Given the state at the close of M2: the page is inside the re-derived cap on the runner
      // study the close required, the exception list is empty, and the history holds all three
      // entries this repository has written. What must stay true is that nothing is over without
      // terms: a budget going over from here prints without an EXCEPTED half and fails the gate,
      // which is the property that makes an exception a named debt rather than a hole.
      const context = { repoRoot };

      // When
      const result = await budgetsGate.run(context);
      const over = result.findings.filter((finding) => finding.message.startsWith('OVER'));
      const reports = result.findings.filter((finding) =>
        finding.message.includes('RECORDED AND NOT GATED'),
      );

      // Then
      expect(BUDGET_EXCEPTIONS).toEqual([]);
      expect(BUDGET_EXCEPTION_HISTORY.map((entry) => entry.budget)).toEqual([
        'tti',
        'client-js-raw',
        'page-bytes',
      ]);
      expect(over).toEqual([]);
      expect(result.status).toBe('pass');
      // And the two rows SPEC 20 records without gating say so on the line, because a printed
      // figure that reads like a checked one is the defect class SPEC 0 names.
      expect(reports.map((finding) => finding.message.split(':')[0]).sort()).toEqual([
        'MEASURED main-thread-work',
        'MEASURED tti',
      ]);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!HAVE_AI_DOCS)(
    'should keep every owner it ever named a task the plan actually carries',
    () => {
      // Given, the check that caught this list on its first run: both owners were named before
      // either retrofit was filed, and the gate refused them until they were. It applies to the
      // closed entry too, so the record cannot come to point at a task that was renamed away.
      const build = readFileSync(join(repoRoot, BUILD_FILE), 'utf8');
      const amendments = readFileSync(join(repoRoot, BUILD_AMENDMENTS_FILE), 'utf8');
      const owners = [...BUDGET_EXCEPTIONS, ...BUDGET_EXCEPTION_HISTORY].flatMap(
        (entry) => entry.owners,
      );

      // When
      const filed = owners.filter(
        (owner) =>
          parseContents(splitLines(build)).some((entry) => entry.id === owner) ||
          new RegExp(`^### \\[[ x]\\] \`${owner}\``, 'm').test(amendments),
      );

      // Then
      expect(owners.length).toBeGreaterThan(0);
      expect(filed).toEqual(owners);
    },
  );

  it.skipIf(!HAVE_AI_DOCS)('should refuse to let M0 close while an entry is still there', () => {
    // Given, the real BUILD.md with every M0 box ticked, which is what the last M0 task does,
    // and a planted entry standing where `tti` stood until it closed. The rule is what makes an
    // expiry real, so it is proved against a planted entry rather than allowed to lapse with
    // the list: T016 is the task that would close the milestone, and the next entry written
    // will be judged by exactly this.
    const build = readFileSync(join(repoRoot, BUILD_FILE), 'utf8');
    const milestones = parseMilestones(splitLines(build));
    const m0 = milestones.find((milestone) => milestone.id === 'M0');
    const closed = (m0?.tasks ?? []).map((task) => ({ ...task, done: true }));
    // The planted budget is `long-tasks` because it is the one gated browser budget with no
    // closed entry in the history: a plant sharing a budget with a closed entry would trip
    // `closed-and-live` and prove the wrong rule.
    const planted = [
      {
        budget: 'long-tasks',
        measured: '3, as a median of 25 navigations',
        measuredAtCommit: 'f457f52',
        target: '2',
        owners: ['T011-R'],
        clearBy: 'M0',
        recordedAt: '2026-08-10',
        diagnosis: 'planted, so the expiry rule is proved rather than remembered',
      },
    ];

    // When
    const issues = checkBudgetExceptions(planted, {
      budgetIds: SPEC_20_BUDGET_IDS,
      recordedBudgetIds: ['long-tasks'],
      overBudgetIds: ['long-tasks'],
      taskIds: ['T011-R'],
      milestones: [{ id: 'M0', label: 'M0 - REFERENCE', tasks: closed }],
      history: BUDGET_EXCEPTION_HISTORY,
    });

    // Then
    expect(m0?.tasks.some((task) => task.id === 'T016')).toBe(true);
    expect(issues.map((issue) => issue.rule)).toEqual(['milestone-closed']);
    expect(issues[0]?.message).toContain('T011-R');
  });

  it(
    'should print the two counts M0 exited on, both inside their caps again',
    async () => {
      // Given the exit condition M0 closed against: `long-tasks` and `page-bytes` inside their
      // caps on a study taken on the runner, both true on 2026-08-11 when T016 was ticked. The
      // second spent M2 over its cap under a filed entry, which the T016 clause allows, and is
      // inside again at the close of M2 on the study that close required: TX-ADOPT paid the page
      // down and the cap was re-derived for the sanctioned stylesheet arrivals. It was re-derived
      // again on 2026-09-04 against a measurement taken afresh, which is when this case stopped
      // being able to hold the count as a literal. What this pins is that the figures are still
      // read from the record and printed on every run, which is what the exit rested on, and that
      // the baseline's freshness is named beside them.
      const context = { repoRoot };

      // When
      const result = await budgetsGate.run(context);
      const lines = result.findings.map((finding) => finding.message);

      // Then the count is printed and inside its cap, WHICH IS READ OFF THE RECORD RATHER THAN
      // WRITTEN DOWN. A literal here would fail the build for a page that got better: the runner
      // record read 1 and the workstation record reads 0, and both are inside a cap of 2.
      const longTasks = lines.find((line) => line.startsWith('MEASURED long-tasks: '));
      const median = Number(/^MEASURED long-tasks: (\d+) of (\d+)/.exec(longTasks ?? '')?.[1]);
      const cap = Number(/^MEASURED long-tasks: (\d+) of (\d+)/.exec(longTasks ?? '')?.[2]);
      expect(longTasks).toContain('as a median of 25 navigations');
      expect(cap).toBe(BROWSER_CEILINGS.longTaskCount);
      expect(median).toBeLessThanOrEqual(cap);

      // And the bytes are inside and printed as measured, not silently absent.
      expect(lines.some((line) => line.startsWith('MEASURED page-bytes'))).toBe(true);
      expect(lines.some((line) => line.startsWith('OVER BUDGET, EXCEPTED page-bytes'))).toBe(false);

      // And the record is dated against the tree on the same run: current, stale or unknown, the
      // line is there, because a record nobody dates is how nine tasks shipped on a page that no
      // longer existed.
      expect(
        lines.some(
          (line) =>
            line.includes('is current: no commit touching') ||
            line.includes('BASELINE STALE') ||
            line.includes('could not be told'),
        ),
      ).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the gates that read ai-docs', () => {
  /**
   * The three gates that could not run without the maintainer's private documents, and now can.
   *
   * `ai-docs/` is excluded from git, so a fresh clone has none of it and these three skipped there,
   * loudly, on every CI run this repository has ever had. What they read now is the committed
   * projection of those documents, so they report a verdict wherever the gates run. THE CASE THAT
   * MATTERS IS THE ONE BELOW IT: with no artefact either, a gate must fail rather than skip, since
   * the artefact is committed and a checkout without one is a defect in the tree.
   */
  const readers = [buildManifestGate, claimsGate, themeMotionGate];

  it(
    'should fail rather than skip when neither the directory nor the artefact is there',
    async () => {
      // Given a checkout with no ai-docs and no committed projection, which is a tree that lost
      // the file rather than a clone: a clone has the artefact, because it is committed.
      const root = mkdtempSync(join(tmpdir(), 'openref-nodocs-'));

      // When
      const results = await Promise.all(readers.map((gate) => gate.run({ repoRoot: root })));
      rmSync(root, { recursive: true, force: true });

      // Then, a failure and never a skip: nothing was checked and the message says which file
      // was missing and how to make it.
      for (const result of results) {
        expect(result.status).toBe('fail');
        expect(result.skipReason).toBeUndefined();
        const printed = result.findings.map((finding) => finding.message).join(' ');
        expect(printed).toContain('projection-unreadable');
        expect(printed).toContain('pnpm gates:projection');
      }

      // And the one that still reads a document, which is conditional on more than the cause.
      // With an entry live it has terms to validate and no plan to validate them against, so it
      // skips there and says UNVALIDATED rather than printing the entry as if it had been
      // checked. That branch is unreachable while the list is empty, exactly as it was before
      // 2026-08-11, because the gate reads the committed list rather than an injected one.
      //
      // WITH THE LIST EMPTY THE GATE NEEDS NO PLAN, WHICH IS WHY IT IS PERMITTED THIS REASON AND
      // NOT FORCED BY IT, AND SINCE T042 THAT IS NOT THE SAME AS NEEDING NOTHING. This case used to
      // run the gate over an empty temporary directory and assert it passed, which is the hole T035
      // filed: the empty list branch returned before anything was weighed, so a run with no build
      // in it reported that every SPEC 20 budget was inside its limit having weighed none of them.
      // The two directions are apart now. Over the repository, where the artefacts are, the empty
      // list still passes with no plan consulted; over a directory with nothing in it, it fails and
      // says it looked at nothing.
      const exceptions = await budgetExceptionsGate.run({ repoRoot });
      const printed = exceptions.findings.map((finding) => finding.message).join('\n');

      expect(exceptions.status).toBe('pass');
      expect(printed).toContain('no budget is excepted');

      const empty = mkdtempSync(join(tmpdir(), 'openref-nodocs-'));
      const unweighed = await budgetExceptionsGate.run({ repoRoot: empty });
      rmSync(empty, { recursive: true, force: true });

      expect(unweighed.status).toBe('fail');
      expect(unweighed.findings.map((finding) => finding.message).join('\n')).toContain(
        'looked at nothing rather than finding nothing wrong',
      );

      // And the record of what closed is still printed and still checked, because neither depends
      // on a document outside this package. It was dropped on this branch until 2026-08-11, when
      // the first entry since `tti` made the branch reachable and the omission visible.
      expect(printed).toContain('CLOSED tti');
      expect(printed).toContain('CLOSED page-bytes');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it('should go on failing on a missing document when the directory is there', async () => {
    // Given, the distinction the skip rests on. A directory with nothing in it is a document
    // that went missing, which is the failure these gates exist for, and a plant proving the
    // skip did not quietly disable them.
    const root = mkdtempSync(join(tmpdir(), 'openref-emptydocs-'));
    mkdirSync(join(root, AI_DOCS_DIR), { recursive: true });
    writeProjection(root, projectFromDisk(root, projectionRequest()));

    // When
    const result = await buildManifestGate.run({ repoRoot: root });
    rmSync(root, { recursive: true, force: true });

    // Then
    expect(result.status).toBe('fail');
    expect(result.findings.some((finding) => finding.message.includes('is missing'))).toBe(true);
  });
});

describe('selectGates', () => {
  it('should return the licenses gate on its own for the release job', () => {
    // Given
    const ids = ['licenses'];

    // When
    const selected = selectGates(ids);

    // Then
    expect(selected.map((gate) => gate.id)).toEqual(['licenses']);
  });

  it('should refuse an unknown gate id rather than running nothing', () => {
    // Given
    const ids = ['licences'];

    // When
    const act = (): unknown => selectGates(ids);

    // Then
    expect(act).toThrow(/unknown gate/);
  });
});

import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BROWSER_BASELINE_FILE,
  BUDGET_EXCEPTIONS,
  BUDGET_EXCEPTION_HISTORY,
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  FONT_BUDGETS,
  SPEC_20_BUDGET_IDS,
  FONT_STYLESHEETS,
  LICENSE_ATTESTATIONS,
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
import { themeFontsGate } from '../../src/gates/theme-fonts.gate';
import { themeMotionGate } from '../../src/gates/theme-motion.gate';
import { AI_DOCS_DIR, aiDocsPresent } from '../../src/lib/ai-docs';
import { checkBudgetExceptions } from '../../src/lib/budget-exceptions';
import { parseContents, parseMilestones, splitLines } from '../../src/lib/build-manifest';
import { runCommand } from '../../src/lib/exec';
import {
  detectLicenseFromText,
  flattenLicenseReport,
  hashLicenseText,
  type PnpmLicenseReport,
} from '../../src/lib/licenses';
import { readWorkspaceManifests, resolveShippedPackages } from '../../src/lib/workspace';
import { GATES, selectGates } from '../../src/run';

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
  it.skipIf(!HAVE_AI_DOCS)('should pass on the committed BUILD.md', async () => {
    // Given
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
  it('should pass on the committed dependency graph', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await dependencyGraphGate.run(context);

    // Then
    expect(result.status).toBe('pass');
  }, 180_000);

  it('should fail when core is made to depend on vue', async () => {
    // Given
    writeFileSync(PROBE_PATH, PROBE_SOURCE, 'utf8');

    // When
    const result = await dependencyGraphGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(result.findings.map((finding) => finding.message).join('\n')).toContain('boundary-core');
  }, 180_000);

  it('should return to green once the violation is removed', async () => {
    // Given
    writeFileSync(PROBE_PATH, PROBE_SOURCE, 'utf8');
    rmSync(PROBE_PATH, { force: true });

    // When
    const result = await dependencyGraphGate.run({ repoRoot });

    // Then
    expect(result.status).toBe('pass');
  }, 180_000);
});

describe('enginesFloorGate', () => {
  it('should pass on the committed manifests and the committed closure', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await enginesFloorGate.run(context);

    // Then
    const errors = result.findings.filter((finding) => finding.level === 'error');
    expect(errors).toEqual([]);
    expect(result.status).toBe('pass');
  }, 180_000);

  it('should read a range from a real package rather than reporting on an empty set', async () => {
    // Given, a check that found no declared range anywhere would pass in silence, which is the
    // shape of failure this gate was built to remove rather than to reproduce.
    const context = { repoRoot };

    // When
    const result = await enginesFloorGate.run(context);
    const summary = result.findings.find((finding) => finding.level === 'info')?.message ?? '';

    // Then
    expect(summary).toMatch(/is a subset of the \d+ declared range\(s\)/);
    expect(summary).not.toContain('subset of the 0 declared');
  }, 180_000);
});

describe('licensesGate', () => {
  it('should pass on the committed dependency tree', async () => {
    // Given
    const context = { repoRoot };

    // When
    const result = await licensesGate.run(context);

    // Then
    const errors = result.findings.filter((finding) => finding.level === 'error');
    expect(errors).toEqual([]);
    expect(result.status).toBe('pass');
  }, 180_000);

  it('should scope the production zone to the published packages and the ones they bundle', () => {
    // Given
    const manifests = readWorkspaceManifests(repoRoot);

    // When
    const result = resolveShippedPackages(manifests);

    // Then
    expect(result.published).toEqual([
      '@openref/core',
      '@openref/nest',
      '@openref/theme',
      '@openref/vue',
      'openref',
    ]);
    expect(result.bundled).toEqual(['@openref/render', '@openref/runner', '@openref/search']);
    expect(result.shipped).not.toContain('@openref/gates');
  });

  it('should keep the browser driver out of the published closure, measured rather than assumed', () => {
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
  }, 180_000);

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

    // Then
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
  it.skipIf(!HAVE_AI_DOCS)('should pass on all four committed theme stylesheets', async () => {
    // Given, three reference themes and the shipped one. Only one of them is code, and a check
    // that saw only that one would report conformance for a third of the problem.
    const context = { repoRoot };

    // When
    const result = await themeMotionGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(THEME_TOKEN_STYLESHEETS.map((sheet) => sheet.theme)).toEqual([
      'vernier, as shipped',
      'vernier, as designed',
      'telltale',
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

    // When
    const result = await themeMotionGate.run(context);
    rmSync(context.repoRoot, { recursive: true, force: true });

    // Then, one finding per file rather than per theme: the shipped theme loads two, and both
    // are named, because a theme half read is a theme unchecked either way.
    const files = THEME_TOKEN_STYLESHEETS.reduce((count, sheet) => count + sheet.files.length, 0);
    expect(result.status).toBe('fail');
    expect(result.findings).toHaveLength(files);
    expect(result.findings[0]?.message).toContain('is not there, so this theme is unchecked');
  });
});

describe('themeFontsGate', () => {
  it('should pass on the committed stylesheet and the fonts beside it', async () => {
    // Given, the ranges were rewritten by hand after the defect of 2026-08-10, and this is what
    // stops them being written by hand again without anything noticing.
    const context = { repoRoot };

    // When
    const result = await themeFontsGate.run(context);

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.findings[0]?.message).toContain('10 face(s)');
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

    // Then
    expect(ids).toEqual(['fonts-first-paint', 'fonts-latin', 'fonts-total']);
    expect(result.status).toBe('pass');
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

describe('budgetExceptionsGate', () => {
  it('should pass on an empty list and still print what the list used to hold', async () => {
    // Given, the list is empty since 2026-08-10 and its one entry is in the history. An entry
    // that simply vanished would leave a reader unable to tell a debt that was paid from a debt
    // somebody stopped counting, and this one was neither.
    const context = { repoRoot };

    // When
    const result = await budgetExceptionsGate.run(context);
    const printed = result.findings.map((finding) => finding.message).join('\n');

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
    expect(printed).toContain('no budget is excepted');
    expect(printed).toContain('CLOSED tti');
    expect(printed).toContain('NO LONGER EXISTS IN GATED FORM');
  }, 180_000);

  it('should run immediately after the budgets, so the figure is read before the terms', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(budgetExceptionsGate.id);

    // Then
    expect(order[position - 1]).toBe(budgetsGate.id);
  });

  it('should have nothing for the budgets gate to except, and no budget over', async () => {
    // Given, the state the closure rests on: with an empty list, an over budget stops the build
    // again, so a budget that is over and unexcused cannot hide behind this gate passing.
    const context = { repoRoot };

    // When
    const result = await budgetsGate.run(context);
    const over = result.findings.filter((finding) => finding.message.startsWith('OVER'));
    const reports = result.findings.filter((finding) =>
      finding.message.includes('RECORDED AND NOT GATED'),
    );

    // Then
    expect(BUDGET_EXCEPTIONS).toEqual([]);
    expect(over).toEqual([]);
    expect(result.status).toBe('pass');
    // And the two rows SPEC 20 records without gating say so on the line, because a printed
    // figure that reads like a checked one is the defect class SPEC 0 names.
    expect(reports.map((finding) => finding.message.split(':')[0]).sort()).toEqual([
      'MEASURED main-thread-work',
      'MEASURED tti',
    ]);
  }, 180_000);

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
    const planted = [
      {
        budget: 'page-bytes',
        measured: '200 KB',
        target: '172 KB',
        owners: ['T011-R'],
        clearBy: 'M0',
        recordedAt: '2026-08-10',
        diagnosis: 'planted, so the expiry rule is proved rather than remembered',
      },
    ];

    // When
    const issues = checkBudgetExceptions(planted, {
      budgetIds: SPEC_20_BUDGET_IDS,
      overBudgetIds: ['page-bytes'],
      taskIds: ['T011-R'],
      milestones: [{ id: 'M0', label: 'M0 - REFERENCE', tasks: closed }],
      history: BUDGET_EXCEPTION_HISTORY,
    });

    // Then
    expect(m0?.tasks.some((task) => task.id === 'T016')).toBe(true);
    expect(issues.map((issue) => issue.rule)).toEqual(['milestone-closed']);
    expect(issues[0]?.message).toContain('T011-R');
  });

  it('should hold M0 to the two counts that replaced the entry', async () => {
    // Given the exit condition as it stands after the closure: nothing is excused, so M0 closes
    // only if `long-tasks` and `page-bytes` are inside their caps on the committed record.
    const context = { repoRoot };

    // When
    const result = await budgetsGate.run(context);
    const lines = result.findings.map((finding) => finding.message);

    // Then
    expect(
      lines.some((line) =>
        line.startsWith('MEASURED long-tasks: 2 of 2, as a median of 25 navigations'),
      ),
    ).toBe(true);
    expect(
      lines.some((line) => line.startsWith('MEASURED page-bytes: 191.2 KB raw of 194 KB')),
    ).toBe(true);
  }, 180_000);
});

describe('the gates that read ai-docs', () => {
  /**
   * The three gates that cannot run without the maintainer's private documents.
   *
   * `ai-docs/` is excluded from git, so a fresh clone has none of it and these three would
   * report the absence as a defect in the code. They skip loudly instead. A fourth gate,
   * `budget-exceptions`, joins them only when the list is not empty, because an exception it
   * cannot validate is a raised threshold. THE LIST IS EMPTY SINCE 2026-08-10, so it is not in
   * this array today: with nothing to validate there is nothing it needs the plan for, and the
   * case below proves it passes rather than skips. The next entry written puts it back.
   */
  const readers = [buildManifestGate, claimsGate, themeMotionGate];

  it('should skip loudly rather than fail when the directory is not there', async () => {
    // Given, a checkout with no ai-docs at all, which is what every clone of this repository is.
    const root = mkdtempSync(join(tmpdir(), 'openref-nodocs-'));

    // When
    const results = await Promise.all(readers.map((gate) => gate.run({ repoRoot: root })));
    rmSync(root, { recursive: true, force: true });

    // Then, a skip and never a pass: nothing was checked and the message says so.
    for (const result of results) {
      expect(result.status).toBe('skip');
      expect(result.findings[0]?.level).toBe('warning');
      expect(result.findings[0]?.message).toContain('SKIPPED, NOT PASSED');
      expect(result.findings[0]?.message).toContain("AWAITING THE MAINTAINER'S DECISION");
    }

    // And the fourth: with an empty list it needs no plan to validate, so it passes on a
    // checkout with no ai-docs rather than skipping. What it still does there is check the
    // record of what closed, which depends on nothing outside this package.
    const empty = mkdtempSync(join(tmpdir(), 'openref-nodocs-'));
    const exceptions = await budgetExceptionsGate.run({ repoRoot: empty });
    rmSync(empty, { recursive: true, force: true });

    expect(exceptions.status).toBe('pass');
    expect(exceptions.findings.map((finding) => finding.message).join('\n')).toContain(
      'CLOSED tti',
    );
  }, 180_000);

  it('should go on failing on a missing document when the directory is there', async () => {
    // Given, the distinction the skip rests on. A directory with nothing in it is a document
    // that went missing, which is the failure these gates exist for, and a plant proving the
    // skip did not quietly disable them.
    const root = mkdtempSync(join(tmpdir(), 'openref-emptydocs-'));
    mkdirSync(join(root, AI_DOCS_DIR), { recursive: true });

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

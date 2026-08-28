import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { builtCliProblem, BUILT_CLI_BIN } from '../../../../vitest.built-cli.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * `doctor --fix` against a real NestJS application, compiled, booted, rewritten and compiled again.
 *
 * THE FIXTURE IS THE DEMO APPLICATION AND NOT A DOCUMENT BUILT TO AGREE. Everything in the loop is
 * real: `tsc` compiles the source, `@nestjs/swagger` generates the document from the decorators
 * that are in it, the runtime pass observes the guards the application actually registers, and the
 * second document is generated from the source the first run rewrote. An idempotence suite over a
 * hand built report would prove that the planner returns an empty list when handed an empty list,
 * which is a property of the fixture rather than of the tool.
 *
 * TWO LINES OF THE COPY DIFFER FROM THE EXAMPLE, AND BOTH ARE HOST CONFIGURATION RATHER THAN
 * FIXTURE ARRANGEMENT. `security-drift` is fixable only with a guard to scheme mapping configured,
 * per SPEC 7.4, so an application that configures none cannot exercise the clause at all: the copy
 * configures `runtime.guardSecuritySchemes`, which SPEC 13.2 defines for exactly this, and names
 * the scheme it maps to on the document builder so the scheme it asserts exists. Nothing about the
 * controller, its decorators or its drift is touched.
 *
 * THE FOUR CASES BELOW RUN IN ORDER AND THE LAST TWO SHARE STATE, deliberately. Compiling the
 * application takes seconds, so the writing case and the second run case are one sequence rather
 * than two setups, and each says in its own name which half of the sequence it is.
 */

const execFileAsync = promisify(execFile);

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const EXAMPLE = join(REPO, 'examples', 'nest-minimal');

/** The temporary repository the whole suite works in. */
let root = '';

/** Where the copied application lives inside it. */
let app = '';

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the built CLI as a process, from a working directory, without throwing on a failure. */
async function runCli(args: readonly string[], cwd: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BUILT_CLI_BIN, ...args], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

/** Runs one git command in the temporary repository. */
async function git(args: readonly string[]): Promise<void> {
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

/** Compiles the copied application with its own TypeScript, the way its own build script does. */
async function compile(): Promise<void> {
  await execFileAsync(join(app, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
    cwd: app,
  });
}

/** The lines of a fix summary that name an edit, which is what a dry run and a write must share. */
function editLines(output: string): readonly string[] {
  return output.split('\n').filter((line) => line.trimStart().startsWith('+ '));
}

beforeAll(async () => {
  const problem = builtCliProblem();
  if (problem !== undefined) throw new Error(problem);

  root = await mkdtemp(join(tmpdir(), 'openref-fix-app-'));
  app = join(root, 'app');

  await cp(join(EXAMPLE, 'src'), join(app, 'src'), { recursive: true });
  await cp(join(EXAMPLE, 'tsconfig.json'), join(app, 'tsconfig.json'));
  await cp(join(EXAMPLE, 'package.json'), join(app, 'package.json'));

  // THE DEPENDENCIES ARE THE EXAMPLE'S OWN, REACHED BY SYMLINK RATHER THAN INSTALLED. A second
  // install would take minutes and would resolve a different tree from the one the workspace
  // built, so the application under test would stop being the application that ships.
  await symlink(join(EXAMPLE, 'node_modules'), join(app, 'node_modules'));
  await symlink(join(REPO, 'node_modules'), join(root, 'node_modules'));
  await writeFile(join(root, '.gitignore'), 'node_modules\ndist\n', 'utf8');

  const module = join(app, 'src', 'app.module.ts');
  const source = await readFile(module, 'utf8');
  await writeFile(
    module,
    source.replace(
      '      runtime: {',
      "      runtime: {\n        guardSecuritySchemes: { ScopesGuard: 'bearer' },",
    ),
    'utf8',
  );

  const main = join(app, 'src', 'main.ts');
  const entry = await readFile(main, 'utf8');
  await writeFile(
    main,
    entry.replace(
      ".addTag('orders')",
      ".addTag('orders')\n      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer')",
    ),
    'utf8',
  );

  await git(['init', '--quiet']);
  await git(['add', '-A']);
  await git(['commit', '--quiet', '-m', 'the application before any fix']);

  await compile();
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(async () => {
  if (root !== '') await rm(root, { recursive: true, force: true });
});

describe('openref doctor --fix', () => {
  it(
    'should refuse to run outside a git repository, since there is no root to resolve a finding against',
    async () => {
      // Given
      const elsewhere = await mkdtemp(join(tmpdir(), 'openref-no-repo-'));

      // When
      const result = await runCli(
        ['doctor', '--from-nest', join(app, 'dist', 'main.js'), '--fix'],
        elsewhere,
      );

      // Then
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('runs inside a git repository');
      await rm(elsewhere, { recursive: true, force: true });
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse a dirty working tree rather than warn, and write nothing while refusing',
    async () => {
      // Given
      const controller = join(app, 'src', 'orders.controller.ts');
      const before = await readFile(controller, 'utf8');
      await writeFile(join(root, 'uncommitted.txt'), 'somebody was working here\n', 'utf8');

      // When
      const result = await runCli(
        ['doctor', '--from-nest', join(app, 'dist', 'main.js'), '--fix'],
        root,
      );

      // Then
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('this is a refusal');
      expect(result.stderr).toContain('uncommitted.txt');
      expect(await readFile(controller, 'utf8')).toBe(before);
      await rm(join(root, 'uncommitted.txt'));
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should print on a dry run exactly the edits the writing run then makes, and write nothing first',
    async () => {
      // Given
      const controller = join(app, 'src', 'orders.controller.ts');
      const before = await readFile(controller, 'utf8');

      // When
      const dry = await runCli(
        ['doctor', '--from-nest', join(app, 'dist', 'main.js'), '--fix', '--dry-run'],
        root,
      );
      const untouched = await readFile(controller, 'utf8');
      const wet = await runCli(
        ['doctor', '--from-nest', join(app, 'dist', 'main.js'), '--fix'],
        root,
      );
      const after = await readFile(controller, 'utf8');

      // Then
      expect(dry.stdout).toContain('Would apply 8 findings in 1 file.');
      expect(untouched).toBe(before);
      expect(wet.stdout).toContain('Applied 8 findings in 1 file.');
      expect(editLines(dry.stdout)).toEqual(editLines(wet.stdout));
      expect(after).not.toBe(before);
      expect(after.split("@ApiSecurity('bearer')")).toHaveLength(9);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should leave every line it did not add byte identical, which is what makes the run reviewable',
    async () => {
      // When
      const { stdout } = await execFileAsync('git', ['diff', '--numstat'], { cwd: root });

      // Then
      const [added, removed, file] = (stdout.trim().split('\n')[0] ?? '').split('\t');
      expect(file).toBe('app/src/orders.controller.ts');
      expect(removed).toBe('0');
      expect(added).toBe('9');
      expect(stdout.trim().split('\n')).toHaveLength(1);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should find nothing left to apply on a second run over the application it rewrote',
    async () => {
      // Given
      await git(['add', '-A']);
      await git(['commit', '--quiet', '-m', 'the fixes of the first run']);
      await compile();

      // When
      const result = await runCli(
        ['doctor', '--from-nest', join(app, 'dist', 'main.js'), '--fix', '--json'],
        root,
      );
      const parsed: unknown = JSON.parse(result.stdout);
      const report = parsed as { readonly findings: readonly { readonly rule: string }[] };

      // Then
      expect(result.stderr).toContain('Applied 0 findings in 0 files.');
      expect(report.findings.some((finding) => finding.rule === 'security-drift')).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should print the fix summary on stderr under --json, so stdout stays the report and nothing else',
    async () => {
      // When
      const result = await runCli(
        ['doctor', '--from-nest', join(app, 'dist', 'main.js'), '--fix', '--dry-run', '--json'],
        root,
      );

      // Then
      expect(() => {
        JSON.parse(result.stdout);
      }).not.toThrow();
      expect(result.stdout).not.toContain('Would apply');
      expect(result.stderr).toContain('Would apply 0 findings');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

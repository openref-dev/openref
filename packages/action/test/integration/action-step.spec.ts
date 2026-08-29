import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTION_PACKAGE_ROOT,
  readActionDefinition,
  resolveStepEnvironment,
  resolveStepWorkingDirectory,
  substituteExpressions,
  type ActionStep,
} from '../../src/index';
import { builtCliProblem, BUILT_CLI_BIN as CLI_BIN } from '../../../../vitest.built-cli.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The action's own step, executed.
 *
 * THE POINT OF THIS FILE IS THAT NOTHING ELSE RUNS A WORKFLOW FILE. Everything else about
 * `action.yml` is an assertion over parsed data, and an assertion over data cannot tell you that
 * the literal in `run:` starts a process, that the environment block reaches the command, that
 * `working-directory` decides where it runs, or that the command reads the variables the block
 * sets. So the `run:` string is taken from the file, the environment is computed from the file's
 * own `env:` block, and the directory is computed from the file's own `working-directory:`, rather
 * than any of the three being written out here a second time.
 *
 * WHAT REMAINS GITHUB'S, in the words of this test: GitHub runs the step, expands
 * `${{ inputs.* }}`, applies `working-directory`, and collects `$GITHUB_OUTPUT` into the step's
 * outputs. This file reproduces the first three closely enough to run the command and reads the
 * output file directly. None of that proves GitHub does it; it proves the command survives being
 * driven that way.
 *
 * IT NEVER SKIPS. The binary the step runs is `packages/cli/dist/bin.js`; when it is missing or
 * older than the sources it is built from, this suite fails and says so, because a skipped run and
 * a passing run are indistinguishable from the outside. See `vitest.built-cli.ts` at the root.
 */

const execFileAsync = promisify(execFile);

const definition = readActionDefinition(ACTION_PACKAGE_ROOT);

function theStep(): ActionStep {
  const step = definition.steps[0];
  if (step === undefined) throw new Error('action.yml declares no step at all');
  return step;
}

const SPEC = {
  openapi: '3.0.3',
  info: { title: 'Orders', version: '1.0.0' },
  paths: {
    '/orders': { get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } } },
  },
};

/** The head document of most cases: the base plus one operation. */
function specWithExtraOperation(): unknown {
  const head = structuredClone(SPEC) as typeof SPEC & { paths: Record<string, unknown> };
  head.paths['/orders/{id}'] = {
    get: { operationId: 'getOrder', responses: { '200': { description: 'ok' } } },
  };
  return head;
}

interface Workspace {
  readonly dir: string;
  readonly outputPath: string;
  readonly summaryPath: string;
}

/**
 * A repository with one commit, a modified working tree, and a shim standing in for the binary a
 * consumer would have installed.
 *
 * @param head - The working tree content of `openapi.json` at the root
 * @param subdirectory - When given, a second copy of the document lives there with this head, and
 *   the root document is left at its base content instead
 */
async function makeWorkspace(
  head: unknown,
  subdirectory?: { readonly name: string; readonly head: unknown },
): Promise<Workspace> {
  const dir = await mkdtemp(join(tmpdir(), 'openref-action-'));
  const git = async (args: readonly string[]): Promise<void> => {
    await execFileAsync('git', [...args], { cwd: dir });
  };

  // `openref-bin` is a path to an executable, which is what a package manager puts in
  // node_modules/.bin. The built entry point is a script, so the shim is what makes it one.
  const writeShim = async (at: string): Promise<void> => {
    await writeFile(at, `#!/bin/sh\nexec "${process.execPath}" "${CLI_BIN}" "$@"\n`, 'utf8');
    await chmod(at, 0o755);
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'test']);
  await git(['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'openapi.json'), JSON.stringify(SPEC, null, 2), 'utf8');

  if (subdirectory !== undefined) {
    await mkdir(join(dir, subdirectory.name), { recursive: true });
    await writeFile(
      join(dir, subdirectory.name, 'openapi.json'),
      JSON.stringify(SPEC, null, 2),
      'utf8',
    );
  }

  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'base']);

  if (subdirectory === undefined) {
    await writeFile(join(dir, 'openapi.json'), JSON.stringify(head, null, 2), 'utf8');
  } else {
    // THE ROOT DOCUMENT IS LEFT AT ITS BASE CONTENT ON PURPOSE. A run at the root therefore
    // reports no changes, and only a run inside the subdirectory can see the added operation, so
    // the assertion below is about where the command ran and about nothing else.
    await writeFile(
      join(dir, subdirectory.name, 'openapi.json'),
      JSON.stringify(subdirectory.head, null, 2),
      'utf8',
    );
    await writeShim(join(dir, subdirectory.name, 'openref-shim'));
  }

  await writeShim(join(dir, 'openref-shim'));

  const outputPath = join(dir, 'github-output');
  const summaryPath = join(dir, 'github-summary');
  await writeFile(outputPath, '', 'utf8');
  await writeFile(summaryPath, '', 'utf8');

  return { dir, outputPath, summaryPath };
}

interface StepResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Where the step actually ran, so a case can assert the directory as well as the output. */
  readonly cwd: string;
}

/**
 * Runs the action's own `run:` string, with the environment its own `env:` block produces, in the
 * directory its own `working-directory:` names.
 *
 * @param workspace - Where it runs
 * @param values - What a workflow passed in `with:`
 * @param extra - What the runner itself contributes
 */
async function runStep(
  workspace: Workspace,
  values: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>>,
): Promise<StepResult> {
  const step = theStep();
  const env = resolveStepEnvironment(step, definition, values);
  // RESOLVED FROM THE FILE, NOT FROM THIS TEST. Deleting `working-directory:` from `action.yml`,
  // or pointing it at something else, changes where this runs and fails the case below.
  const cwd = resolveStepWorkingDirectory(step, definition, workspace.dir, values);
  // SUBSTITUTED THE WAY GITHUB SUBSTITUTES, so the injection case below tests the run string
  // rather than bash's opinion of an unexpanded `${{`. The committed file has no expression in
  // it, so today this is the identity; the day one appears, this is what carries it into bash.
  const command = substituteExpressions(step.run ?? '', definition, values);

  try {
    const { stdout, stderr } = await execFileAsync('bash', ['-c', command], {
      cwd,
      env: { PATH: process.env.PATH ?? '', ...env, ...extra },
    });
    return { code: 0, stdout, stderr, cwd };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      cwd,
    };
  }
}

describe('the composite step, executed', () => {
  let workspace: Workspace | undefined;

  beforeAll(() => {
    // NOT A SKIP. The message names the artifact and the command that produces it.
    const problem = builtCliProblem();
    if (problem !== undefined) throw new Error(problem);
  });

  beforeEach(async () => {
    workspace = await makeWorkspace(specWithExtraOperation());
  }, SPAWNED_PROCESS_TIMEOUT_MS);

  afterEach(async () => {
    if (workspace !== undefined) await rm(workspace.dir, { recursive: true, force: true });
    workspace = undefined;
  });

  it(
    'should be running against a built and current CLI rather than skipping itself',
    () => {
      // Given: the whole file's meaning rests on this, so it is asserted rather than assumed
      // When / Then
      expect(builtCliProblem()).toBeUndefined();
      expect(existsSync(CLI_BIN)).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should run the command the definition names and print the SPEC 17.2 comment',
    async () => {
      // Given the workspace above, driven only through the action's declared inputs
      const current = workspace;
      if (current === undefined) throw new Error('no workspace');

      // When
      const result = await runStep(
        current,
        {
          spec: 'openapi.json',
          base: 'HEAD',
          'dry-run': 'true',
          'openref-bin': './openref-shim',
        },
        { GITHUB_OUTPUT: current.outputPath },
      );

      // Then
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('<!-- openref:api-review -->');
      expect(result.stdout).toContain('+ GET /orders/{id}');

      // And the outputs a workflow reads were written by the run rather than by this test
      const outputs = await readFile(current.outputPath, 'utf8');
      expect(outputs).toContain('breaking-count=0');
      expect(outputs).toContain('change-count=1');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should run in the directory working-directory names, not in the workspace root',
    async () => {
      // Given a repository whose root document did not change and whose subdirectory document
      // gained an operation. Both directories hold the shim, so the binary resolves either way
      // and the only thing the assertions can be about is where the command ran.
      const current = await makeWorkspace(SPEC, {
        name: 'service',
        head: specWithExtraOperation(),
      });
      workspace = current;

      // When
      const result = await runStep(
        current,
        {
          spec: 'openapi.json',
          base: 'HEAD',
          'dry-run': 'true',
          'openref-bin': './openref-shim',
          'working-directory': 'service',
          out: 'preview',
        },
        {},
      );

      // Then: the document it read is the one that only exists from there
      expect(result.cwd).toBe(join(current.dir, 'service'));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('+ GET /orders/{id}');

      // And the relative --out it was given landed under that directory and nowhere else, which
      // is a file the run wrote rather than a document it read
      expect(existsSync(join(current.dir, 'service', 'preview', 'index.html'))).toBe(true);
      expect(existsSync(join(current.dir, 'preview'))).toBe(false);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should default working-directory to the workspace root when a workflow passes none',
    () => {
      // Given: the declared default is `.`, and the resolver has to mean the workspace by it
      const current = workspace;
      if (current === undefined) throw new Error('no workspace');

      // When
      const resolved = resolveStepWorkingDirectory(theStep(), definition, current.dir, {});

      // Then
      expect(resolved).toBe(current.dir);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should turn the fail-on-breaking input into a non zero step',
    async () => {
      // Given a head that removes an operation
      const removed = { ...SPEC, paths: {} };
      const current = await makeWorkspace(removed);
      workspace = current;

      // When
      const result = await runStep(
        current,
        {
          spec: 'openapi.json',
          base: 'HEAD',
          'dry-run': 'true',
          'fail-on-breaking': 'true',
          'openref-bin': './openref-shim',
        },
        { GITHUB_OUTPUT: current.outputPath },
      );

      // Then
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('1 breaking change detected');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should refuse pull_request_target rather than run with a write scoped token on a foreign head',
    async () => {
      // Given
      const current = workspace;
      if (current === undefined) throw new Error('no workspace');

      // When
      const result = await runStep(
        current,
        { spec: 'openapi.json', base: 'HEAD', 'openref-bin': './openref-shim' },
        { GITHUB_EVENT_NAME: 'pull_request_target' },
      );

      // Then
      expect(result.code).toBe(2);
      expect(result.stderr).toContain('pull_request_target');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should keep a shell metacharacter in an input out of the shell',
    async () => {
      // Given an input written to look like a command. The run string holds no substitution, so
      // bash never sees this value as script; the command receives it as a path and fails to
      // read it. The file the injection would have created is what proves the difference.
      const current = workspace;
      if (current === undefined) throw new Error('no workspace');
      const planted = join(current.dir, 'injected');

      // When
      const result = await runStep(
        current,
        {
          spec: `openapi.json; touch ${planted}`,
          base: 'HEAD',
          'dry-run': 'true',
          'openref-bin': './openref-shim',
        },
        {},
      );

      // Then
      expect(existsSync(planted)).toBe(false);
      expect(result.code).toBe(2);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

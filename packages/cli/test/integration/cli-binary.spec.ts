import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { builtCliProblem, BUILT_CLI_BIN } from '../../../../vitest.built-cli.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The built binary, spawned as a real process, for the two claims nothing in-process can prove:
 * that the process really carries the exit code out, and that a hung `close()` really cannot
 * keep the process alive past its timeout. `process.exit` inside a vitest worker would kill the
 * worker, so the force close path in particular has no in-process equivalent.
 *
 * REQUIRES `packages/cli` BUILT FIRST, AND SAYS SO RATHER THAN SKIPPING. This suite used to skip
 * itself in silence when `dist/bin.js` was absent, and it looked at absence alone, so a green run
 * here could mean the suite ran, mean it never existed, or mean it ran against a bundle older than
 * the sources it was built from. All three are now distinguishable: see `vitest.built-cli.ts`.
 */
const execFileAsync = promisify(execFile);
const BIN_PATH = BUILT_CLI_BIN;
const MOCKS = fileURLToPath(new URL('../mocks/', import.meta.url));
const FIXTURES = fileURLToPath(new URL('../mocks/from-nest/', import.meta.url));
const DEMO_ENTRY = fileURLToPath(
  new URL('../../../../examples/nest-minimal/dist/main.js', import.meta.url),
);

interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runCliBinary(args: readonly string[]): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [BIN_PATH, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

describe('the built openref binary', () => {
  beforeAll(() => {
    // NOT A SKIP. The message names the artifact and the command that produces it.
    const problem = builtCliProblem();
    if (problem !== undefined) throw new Error(problem);
  });

  it('should be running against a built and current binary rather than skipping itself', () => {
    // Given: every case below spawns this file, so its provenance is asserted, not assumed
    // When / Then
    expect(builtCliProblem()).toBeUndefined();
    expect(existsSync(BIN_PATH)).toBe(true);
  });

  it('should exit 2 and print usage on stderr with no arguments, never throwing raw', async () => {
    // When
    const result = await runCliBinary([]);

    // Then
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('a command is required');
    expect(result.stderr).not.toContain('at ');
  });

  it('should exit 0 and print usage on stdout for --help', async () => {
    // When
    const result = await runCliBinary(['--help']);

    // Then
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('openref build');
  });

  it('should exit 0 for build --spec against a real file on disk', async () => {
    // Given: `--out` is required since T039, because a build has no defensible default
    // directory and picking one would write files somewhere the caller never named.
    const spec = resolve(MOCKS, 'mini-spec.json');
    const out = await mkdtemp(join(tmpdir(), 'openref-binary-build-'));

    // When
    const result = await runCliBinary(['build', `--spec=${spec}`, `--out=${out}`]);

    // Then
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Built 5 pages');
    expect(await readFile(join(out, 'get-ping', 'index.html'), 'utf8')).toContain(
      '<!DOCTYPE html>',
    );
    await rm(out, { recursive: true, force: true });
  });

  it('should carry exit code 1 out of the process for a diff with breaking changes', async () => {
    // Given the pair built to produce the SPEC 17.1 example. The unit suite proves the outcome
    // object; only a spawned process proves the 1 actually reaches a pipeline, and no other
    // case in this suite exits 1.
    const older = resolve(MOCKS, 'diff-old.json');
    const newer = resolve(MOCKS, 'diff-new.json');

    // When
    const result = await runCliBinary(['diff', older, newer]);

    // Then
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('BREAKING');
    expect(result.stdout).toContain('DELETE /users/{id}');
  });

  it.skipIf(!existsSync(DEMO_ENTRY))(
    'should exit 0 for doctor --from-nest against the real demo application',
    async () => {
      // When
      const result = await runCliBinary(['doctor', `--from-nest=${DEMO_ENTRY}`]);

      // Then
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Orders 1.0.0');
    },
    // Booting the real demo application in a spawned node is the class the constant names:
    // under full suite load this case has missed the five second default while passing alone.
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should force close and exit after the application does not close in time, and say so',
    async () => {
      // Given
      const entry = resolve(FIXTURES, 'hangs-on-close.mjs');
      const started = Date.now();

      // When
      const result = await runCliBinary(['doctor', `--from-nest=${entry}`]);
      const elapsedMs = Date.now() - started;

      // Then
      expect(result.stdout).toContain('Hangy 1.0.0');
      expect(result.stderr).toContain('did not close within 5000ms and is being terminated');
      expect(result.code).toBe(0);
      // Proves the process did not hang forever on the open handle: bounded well under the
      // spawned-process budget, comfortably above the 5000ms the fixture is built to miss.
      expect(elapsedMs).toBeGreaterThanOrEqual(5000);
      expect(elapsedMs).toBeLessThan(SPAWNED_PROCESS_TIMEOUT_MS);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

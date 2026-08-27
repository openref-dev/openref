import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * The built binary, spawned as a real process, for the two claims nothing in-process can prove:
 * that the process really carries the exit code out, and that a hung `close()` really cannot
 * keep the process alive past its timeout. `process.exit` inside a vitest worker would kill the
 * worker, so the force close path in particular has no in-process equivalent.
 *
 * REQUIRES `packages/cli` BUILT FIRST. Skipped rather than failed when it is not, the same way
 * the demo-backed adapter test is, since neither is this repository's job to trigger a build.
 */
const execFileAsync = promisify(execFile);
const BIN_PATH = fileURLToPath(new URL('../../dist/bin.js', import.meta.url));
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

describe.skipIf(!existsSync(BIN_PATH))('the built openref binary', () => {
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
    // Given
    const spec = resolve(MOCKS, 'mini-spec.json');

    // When
    const result = await runCliBinary(['build', `--spec=${spec}`]);

    // Then
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Mini 1.0.0');
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

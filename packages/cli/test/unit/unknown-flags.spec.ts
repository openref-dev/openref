import { readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, unknownFlagRefusal } from '../../src/cli/api/argv';
import { runCli } from '../../src/cli/application/services/run-cli.service';
import type { CommandOutcome } from '../../src/cli/domain/command.types';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';

/**
 * The `T043` finding that a gate can be turned off by a typo.
 *
 * SPEC 17 HAS NAMED AN INVALID FLAG A USAGE ERROR SINCE `T036`, and no command checked for one.
 * Measured before the fix: `doctor --from-nest <app with an error finding> --failon=error` exited
 * 0, so a pipeline that believed it was gated was not, and nothing anywhere said so. The value of
 * the flag was already validated; only its name was not.
 */

const NEST_FIXTURE = 'packages/cli/test/mocks/from-nest/error-drift.mjs';

/**
 * Where the `build` case points its output.
 *
 * OUTSIDE THE CHECKOUT ON PURPOSE. The refusal under test happens before any file is written, so
 * nothing should land here at all; naming a path inside the repository would mean that removing
 * the guard, which is how this test is proved able to fail, writes a whole site into the working
 * tree. Measured once, and fixed here rather than remembered.
 */
const OUT_OF_TREE = join(tmpdir(), 'openref-unknown-flags-out');

/** One run of the whole CLI, with its output captured. */
async function run(args: readonly string[]): Promise<{
  readonly outcome: CommandOutcome;
  readonly err: string;
}> {
  const err: string[] = [];
  const outcome = await runCli(args, {
    stdout: () => undefined,
    stderr: (line) => err.push(line),
  });

  return { outcome, err: err.join('') };
}

describe('parseArgs, flags a command does not have', () => {
  it('should report an undeclared flag rather than keeping it in the map alone', () => {
    // Given
    const args = ['--from-nest', 'app.mjs', '--failon=error'];

    // When
    const { unknown } = parseArgs(args, ['from-nest', 'fail-on'], ['json']);

    // Then
    expect(unknown).toEqual(['failon']);
  });

  it('should report a declared flag as known in both spellings', () => {
    // Given
    const args = ['--fail-on=error', '--json', '--help'];

    // When
    const { unknown } = parseArgs(args, ['fail-on'], ['json']);

    // Then
    expect(unknown).toEqual([]);
  });

  it('should name every unknown flag, not the first', () => {
    // Given
    const unknown = ['failon', 'outt'];

    // When
    const refusal = unknownFlagRefusal('doctor', unknown);

    // Then
    expect(refusal).toBe('openref doctor: unknown flags --failon, --outt');
  });

  it('should have nothing to say when every flag was declared', () => {
    // Given
    const unknown: readonly string[] = [];

    // When
    const refusal = unknownFlagRefusal('doctor', unknown);

    // Then
    expect(refusal).toBeUndefined();
  });
});

describe('the CLI, a gate flag that no command has', () => {
  it('should exit 2 rather than 0 for doctor --failon=error, the typo that silenced the gate', async () => {
    // Given the fixture whose findings include one of severity error

    // When
    const { outcome, err } = await run(['doctor', '--from-nest', NEST_FIXTURE, '--failon=error']);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err).toContain('unknown flag --failon');
  });

  it('should exit 2 for a flag that belongs to another command', async () => {
    // Given `--fail-on-breaking` is `pr`'s flag, not `doctor`'s

    // When
    const { outcome } = await run(['doctor', '--from-nest', NEST_FIXTURE, '--fail-on-breaking']);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
  });

  it('should still exit 1 for the flag spelled correctly, so the gate itself still works', async () => {
    // Given

    // When
    const { outcome } = await run(['doctor', '--from-nest', NEST_FIXTURE, '--fail-on=error']);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.FINDINGS);
  });

  it.each([
    [
      'build',
      [
        'build',
        '--spec',
        'packages/cli/test/mocks/mini-spec.json',
        '--out',
        OUT_OF_TREE,
        '--nonsense',
      ],
    ],
    ['lint', ['lint', 'packages/cli/test/mocks/clean-spec.json', '--nonsense']],
    ['preview', ['preview', '--spec', 'packages/cli/test/mocks/mini-spec.json', '--nonsense']],
    [
      'diff',
      [
        'diff',
        'packages/cli/test/mocks/mini-spec.json',
        'packages/cli/test/mocks/mini-spec-two.json',
        '--nonsense',
      ],
    ],
  ])('should exit 2 for an unknown flag on %s', async (command, args) => {
    // Given the arguments above

    // When
    const { outcome, err } = await run(args);

    // Then
    expect(outcome.exitCode).toBe(EXIT_CODE.USAGE_ERROR);
    expect(err).toContain(`openref ${command}: unknown flag --nonsense`);
  });
});

/**
 * SPEC 19.1's runner, which looks for a boundary nobody thought of.
 *
 * PINNING THE FOUR CALL SITES WE KNOW IS WHAT FAILED. The first cut of the plain text rule put
 * the filter on four renderers, and `openref preview` printed a document's title straight to a
 * terminal because it used none of them. This asserts the shape instead: exactly one module in
 * this package touches a process stream, so a command added later cannot get its own unfiltered
 * way out.
 */
describe('the CLI, where output leaves this package', () => {
  it('should touch a process stream in exactly one module, the one that filters', () => {
    // Given every source file of this package
    const root = resolve(import.meta.dirname, '..', '..', 'src');
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    };
    walk(root);

    // When each is asked whether it writes to a stream of the process itself
    const writers = files
      .filter((path) =>
        /process\.(stdout|stderr)\.write|console\.(log|error|warn|info)/.test(
          readFileSync(path, 'utf8'),
        ),
      )
      .map((path) => relative(root, path).replaceAll('\\', '/'));

    // Then: the walk found the package, and only the filtering boundary writes.
    expect(files.length).toBeGreaterThan(20);
    expect(writers).toEqual(['cli/application/services/run-cli.service.ts']);
  });
});

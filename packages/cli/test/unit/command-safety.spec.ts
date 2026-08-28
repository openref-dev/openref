import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../../src/cli/api/commands/registry';
import { EXIT_CODE } from '../../src/cli/domain/exit-code.constants';
import type { CommandIo } from '../../src/cli/domain/command.types';

/**
 * T036's own test list: "every command runs with --help and no arguments without throwing".
 * Every registered command, driven both ways, rather than one spot check per command file.
 */

function fakeIo(): CommandIo {
  return { stdout: () => undefined, stderr: () => undefined };
}

describe('every command, with --help and with no arguments', () => {
  for (const [name, command] of COMMANDS) {
    it(`"${name}" should not throw on --help, and should succeed`, async () => {
      // Given
      const context = { args: ['--help'], ...fakeIo() };

      // When
      const outcome = await command.run(context);

      // Then
      expect(outcome.exitCode).toBe(EXIT_CODE.SUCCESS);
    });

    it(`"${name}" should not throw with no arguments`, async () => {
      // Given
      const context = { args: [], ...fakeIo() };

      // When
      const running = command.run(context);

      // Then
      await expect(running).resolves.toMatchObject({ exitCode: expect.any(Number) });
    });
  }

  it('should cover exactly the six commands SPEC 17 names', () => {
    // Given: `pr` joined the surface with T041, per SPEC 17 as amended
    const expected = ['build', 'preview', 'doctor', 'lint', 'diff', 'pr'];

    // When
    const actual = [...COMMANDS.keys()];

    // Then
    expect(actual).toEqual(expected);
  });
});

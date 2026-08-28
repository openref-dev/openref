import { COMMANDS } from '../../api/commands/registry';
import { TOP_LEVEL_USAGE } from '../../api/help';
import type { CommandIo, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';

/** Writes to the real process streams. The only place this package touches them directly. */
const PROCESS_IO: CommandIo = {
  stdout: (line) => {
    process.stdout.write(line);
  },
  stderr: (line) => {
    process.stderr.write(line);
  },
};

/**
 * Parses the top level command name and dispatches to it.
 *
 * NEVER THROWS. Every error a command can produce is caught here or inside the command itself
 * and turned into a message on `io.stderr` and a {@link CommandOutcome.exitCode}, which is what
 * `T036`'s own "every command runs with --help and no arguments without throwing" asks for: this
 * is where that promise is kept for the top level dispatch itself, on top of each command
 * keeping it for its own arguments.
 *
 * @param argv - Arguments after the program name, `process.argv.slice(2)`
 * @param io - Where output goes; defaults to the real process streams
 */
export async function runCli(
  argv: readonly string[],
  io: CommandIo = PROCESS_IO,
): Promise<CommandOutcome> {
  const [name, ...rest] = argv;

  if (name === undefined) {
    io.stderr(`openref: a command is required\n\n${TOP_LEVEL_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  if (name === '--help' || name === '-h') {
    io.stdout(TOP_LEVEL_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const command = COMMANDS.get(name);
  if (command === undefined) {
    io.stderr(`openref: unknown command "${name}"\n\n${TOP_LEVEL_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  try {
    return await command.run({
      args: rest,
      stdout: io.stdout,
      stderr: io.stderr,
      // THE REAL ENVIRONMENT ENTERS EXACTLY HERE, the way the real streams do above: a command
      // handler reads `context.env` and never `process.env`, so a test can fake a platform.
      env: process.env,
    });
  } catch (error) {
    io.stderr(
      `openref: unexpected error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }
}

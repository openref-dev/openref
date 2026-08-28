import { plainArtefactText } from '@openref/core';
import { COMMANDS } from '../../api/commands/registry';
import { TOP_LEVEL_USAGE } from '../../api/help';
import type { CommandIo, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';

/**
 * The one boundary every line this tool prints goes through, per SPEC 19.1 as widened by `T043`.
 *
 * A TERMINAL IS A FORMAT THAT CANNOT ESCAPE, exactly as `llms.txt` is. The first cut of the rule
 * put the filter on the four renderers it knew about, and review drove `openref preview --spec`
 * writing a document's title, NUL, ESC and a bidirectional override included, straight to a
 * terminal that reads ESC as a control sequence; `build`'s own notices went the same way. So the
 * filter sits here, above every command, and covers the ones written later too.
 *
 * IT WRAPS THE CALLER'S STREAMS RATHER THAN ONLY THE PROCESS ONES, so a test that injects its own
 * `stdout` exercises the same guard the process does. A guard only the real streams have is a
 * guard no test can fail.
 *
 * @param io - Where the command's output is meant to go
 * @returns The same, with every control character and bidirectional control removed
 */
function filtered(io: CommandIo): CommandIo {
  return {
    stdout: (line) => {
      io.stdout(plainArtefactText(line));
    },
    stderr: (line) => {
      io.stderr(plainArtefactText(line));
    },
  };
}

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
  raw: CommandIo = PROCESS_IO,
): Promise<CommandOutcome> {
  const io = filtered(raw);
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

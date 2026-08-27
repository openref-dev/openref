import type { ExitCode } from './exit-code.constants';

/** Where a command writes its output, kept apart from `process.stdout` so a test can capture it. */
export interface CommandIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

/** What a command handler is given: its own arguments, already separated from the command name. */
export interface CommandContext extends CommandIo {
  readonly args: readonly string[];
}

/** What running a command produced. */
export interface CommandOutcome {
  readonly exitCode: ExitCode;
  /**
   * True when a loaded application would not close within its timeout and the process must
   * call `process.exit` rather than let Node drain naturally. Absent, meaning false, on every
   * outcome that never loaded one.
   */
  readonly forcedShutdown?: boolean;
}

/** One subcommand: its name, its own usage text, and the function that runs it. */
export interface CommandDefinition {
  readonly name: string;
  readonly usage: string;
  readonly run: (context: CommandContext) => Promise<CommandOutcome>;
}

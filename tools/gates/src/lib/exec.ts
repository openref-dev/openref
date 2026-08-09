import { spawnSync } from 'node:child_process';

/**
 * Result of running a child process.
 */
export interface CommandResult {
  readonly ok: boolean;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a command to completion and captures its output.
 *
 * @param command - Executable name
 * @param args - Arguments, passed without a shell
 * @param cwd - Working directory
 * @returns Captured result; a missing executable is reported as a non zero exit
 */
export function runCommand(command: string, args: readonly string[], cwd: string): CommandResult {
  const result = spawnSync(command, [...args], {
    cwd,
    encoding: 'utf8',
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error !== undefined) {
    return { ok: false, exitCode: 1, stdout: '', stderr: result.error.message };
  }

  const exitCode = result.status ?? 1;

  return {
    ok: exitCode === 0,
    exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

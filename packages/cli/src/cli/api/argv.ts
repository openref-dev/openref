/** One flag's value: a string when given a value, `true` when given as a bare boolean. */
export type FlagValue = string | true;

/** The result of splitting one command's own arguments into flags and positionals. */
export interface ParsedArgs {
  readonly flags: ReadonlyMap<string, FlagValue>;
  readonly positionals: readonly string[];
}

/**
 * Splits a command's own arguments into flags and positionals.
 *
 * `--key=value` AND `--key value` ARE BOTH ACCEPTED, but the second form only for a flag named
 * in `valueFlags`: a flag not listed there is a boolean, so `--watch build.yaml` reads `--watch`
 * as boolean true and `build.yaml` as a positional rather than eating the next argument as its
 * value. `-h` is read as the boolean `help`, alongside the long form.
 *
 * @param args - Arguments after the command name
 * @param valueFlags - Names of flags that take a value when given as `--key value`
 */
export function parseArgs(args: readonly string[], valueFlags: readonly string[] = []): ParsedArgs {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg === '-h') {
      flags.set('help', true);
      continue;
    }

    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const body = arg.slice(2);
    const equals = body.indexOf('=');
    if (equals !== -1) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      continue;
    }

    const next = args[index + 1];
    if (valueFlags.includes(body) && next !== undefined) {
      flags.set(body, next);
      index++;
    } else {
      flags.set(body, true);
    }
  }

  return { flags, positionals };
}

/** Reads a flag as a string, or undefined when it was never given or given as a bare boolean. */
export function stringFlag(
  flags: ReadonlyMap<string, FlagValue>,
  name: string,
): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

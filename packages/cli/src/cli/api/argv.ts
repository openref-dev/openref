/** One flag's value: a string when given a value, `true` when given as a bare boolean. */
export type FlagValue = string | true;

/** The result of splitting one command's own arguments into flags and positionals. */
export interface ParsedArgs {
  readonly flags: ReadonlyMap<string, FlagValue>;
  readonly positionals: readonly string[];
  /**
   * Flags this command does not have, in the order they were written.
   *
   * SEPARATE FROM `flags` RATHER THAN DROPPED, per SPEC 17's exit code contract: an invalid flag
   * is a usage error, and a parser that silently kept it in the map would leave every caller free
   * to ignore it. See {@link unknownFlagRefusal}.
   */
  readonly unknown: readonly string[];
}

/** The flag every command answers, whatever else it takes. */
const HELP_FLAG = 'help';

/**
 * Splits a command's own arguments into flags and positionals.
 *
 * `--key=value` AND `--key value` ARE BOTH ACCEPTED, but the second form only for a flag named
 * in `valueFlags`: a flag not listed there is a boolean, so `--watch build.yaml` reads `--watch`
 * as boolean true and `build.yaml` as a positional rather than eating the next argument as its
 * value. `-h` is read as the boolean `help`, alongside the long form.
 *
 * EVERY FLAG A COMMAND HAS IS DECLARED, and what is not declared comes back in `unknown`. Before
 * `T043` a flag nobody knew was parsed into the map and read by nothing, so `--failon=error` was
 * accepted, `doctor` never applied its gate, and the pipeline that believed it was gated exited
 * 0. SPEC 17 has named an invalid flag a usage error since `T036`; this is the parser half of it.
 *
 * @param args - Arguments after the command name
 * @param valueFlags - Names of flags that take a value when given as `--key value`
 * @param booleanFlags - Names of flags this command takes without a value; `help` is always one
 */
export function parseArgs(
  args: readonly string[],
  valueFlags: readonly string[] = [],
  booleanFlags: readonly string[] = [],
): ParsedArgs {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];
  const known = new Set<string>([HELP_FLAG, ...valueFlags, ...booleanFlags]);
  const unknown: string[] = [];

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
    const name = equals === -1 ? body : body.slice(0, equals);

    if (!known.has(name) && !unknown.includes(name)) unknown.push(name);

    if (equals !== -1) {
      flags.set(name, body.slice(equals + 1));
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

  return { flags, positionals, unknown };
}

/**
 * The refusal one command owes an undeclared flag, or undefined when there is none.
 *
 * IT NAMES EVERY UNKNOWN FLAG RATHER THAN THE FIRST, because a caller who mistyped one flag has
 * usually mistyped the pair, and a refusal that reveals them one run at a time is a refusal that
 * costs a run each time.
 *
 * @param command - The command's own name, for the message
 * @param unknown - What {@link parseArgs} did not recognise
 * @returns The message, or undefined when every flag was declared
 */
export function unknownFlagRefusal(
  command: string,
  unknown: readonly string[],
): string | undefined {
  if (unknown.length === 0) return undefined;

  const named = unknown.map((name) => `--${name}`).join(', ');
  const noun = unknown.length === 1 ? 'flag' : 'flags';

  return `openref ${command}: unknown ${noun} ${named}`;
}

/** Reads a flag as a string, or undefined when it was never given or given as a bare boolean. */
export function stringFlag(
  flags: ReadonlyMap<string, FlagValue>,
  name: string,
): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

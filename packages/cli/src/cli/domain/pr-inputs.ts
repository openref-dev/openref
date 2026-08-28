import type { FlagValue } from '../api/argv';

/**
 * Everything `openref pr` is configured with, and the environment variable each option answers to.
 *
 * THE ENVIRONMENT IS NOT A CONVENIENCE HERE, IT IS THE SECURE PATH. A composite GitHub action
 * that interpolated `${{ inputs.spec }}` into its `run:` would be handing a caller's string to
 * bash as code, which is the standard workflow injection. So `action.yml` puts every input on the
 * step's `env:` and its `run:` is one literal with no substitution in it at all, and this map is
 * the contract between the two. `@openref/action`'s test reads the map from here and the names
 * from `action.yml`, so the two cannot drift apart in silence.
 *
 * A FLAG BEATS THE ENVIRONMENT, so the same command a runner executes is one a person can run by
 * hand with arguments and read the result of.
 *
 * THE TOKEN IS NOT IN THIS MAP AND HAS NO FLAG. It arrives only as `GITHUB_TOKEN`, per SPEC 17.2:
 * a command line argument is visible in `ps` and lands in shell history, and neither is a place a
 * write scoped credential belongs.
 */

/** Option name to the environment variable that supplies it when no flag does. */
export const PR_INPUT_ENV: Readonly<Record<string, string>> = {
  spec: 'OPENREF_PR_SPEC',
  base: 'OPENREF_PR_BASE',
  out: 'OPENREF_PR_OUT',
  'preview-base': 'OPENREF_PR_PREVIEW_BASE',
  'preview-url': 'OPENREF_PR_PREVIEW_URL',
  'fail-on-breaking': 'OPENREF_PR_FAIL_ON_BREAKING',
  'dry-run': 'OPENREF_PR_DRY_RUN',
  repository: 'OPENREF_PR_REPOSITORY',
  'pull-request': 'OPENREF_PR_NUMBER',
};

/** The option names that take a value rather than being bare booleans. */
export const PR_VALUE_FLAGS: readonly string[] = [
  'spec',
  'base',
  'out',
  'preview-base',
  'preview-url',
  'repository',
  'pull-request',
];

/** The two options that are booleans, and are read as such from the environment too. */
export const PR_BOOLEAN_FLAGS: readonly string[] = ['fail-on-breaking', 'dry-run'];

/**
 * Options whose environment value reaches its parser exactly as supplied, with nothing trimmed.
 *
 * THE TRIM WAS A REPAIR, AND ONE VALUE HERE MUST NOT BE REPAIRED. `repository` is the only input
 * that becomes part of a URL a write scoped token is sent to, and `repository-slug.ts` says in so
 * many words that it refuses rather than repairs; trimming its whitespace off before it got there
 * made that false for the environment path alone, so the same value was refused as a flag and
 * accepted as `OPENREF_PR_REPOSITORY`.
 *
 * THE TRIM STAYS FOR THE REST, AND THAT IS ALSO A DECISION. A path, a ref, an address and a number
 * are each re-checked further down by whatever executes them, and a GitHub action input routinely
 * arrives with a trailing newline from a YAML block scalar, so trimming those costs nothing and
 * repairs nothing that matters.
 */
export const PR_EXACT_INPUTS: readonly string[] = ['repository'];

/**
 * The step outputs `openref pr` writes to `GITHUB_OUTPUT`.
 *
 * Declared here rather than in the command, because `action.yml` has to re-declare every one of
 * them to hand it on, and the action's test compares the two lists. An output a workflow reads
 * and nothing writes returns an empty string, which is indistinguishable from a real answer.
 */
export const PR_OUTPUT_NAMES: readonly string[] = [
  'breaking-count',
  'change-count',
  'preview-url',
  'comment-url',
];

/** What one run of `openref pr` was asked to do. */
export interface PrInputs {
  readonly spec: string | undefined;
  readonly base: string | undefined;
  readonly out: string | undefined;
  readonly previewBase: string | undefined;
  readonly previewUrl: string | undefined;
  readonly failOnBreaking: boolean;
  readonly dryRun: boolean;
  readonly repository: string | undefined;
  /**
   * What supplied `repository`, so a refusal can name it.
   *
   * Undefined when nothing did. `GITHUB_REPOSITORY` is not read here: it is the fallback the
   * command applies after these inputs are resolved, and it names itself there.
   */
  readonly repositorySource: string | undefined;
  readonly pullRequest: string | undefined;
}

/** An environment, as `CommandContext.env` carries it. */
export type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Reads a boolean the way a workflow writes one.
 *
 * `true` AND `false` ARE BOTH SPELLED OUT, AND NEITHER IS THE FALLBACK FOR AN UNREADABLE VALUE.
 * A GitHub action input is always a string, and `false` is the string a workflow writes when it
 * means off, so treating any non empty string as true would turn every default into an opt in
 * nobody asked for. Anything that is neither is reported rather than guessed.
 *
 * @param value - The raw value, or undefined when nothing set it
 * @returns The boolean, or a message naming what could not be read
 */
export function readBoolean(value: string | undefined): boolean | { readonly unreadable: string } {
  if (value === undefined) return false;
  const trimmed = value.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'false' || trimmed === '0' || trimmed === 'no') return false;
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') return true;
  return { unreadable: `"${value}" is neither true nor false` };
}

/**
 * Resolves the options of one run: flags first, then the environment.
 *
 * @param flags - What `parseArgs` produced
 * @param env - The process environment
 * @returns The inputs, or the one message that stopped it
 */
export function resolvePrInputs(
  flags: ReadonlyMap<string, FlagValue>,
  env: Environment,
): PrInputs | { readonly usageError: string } {
  const supplied = (
    name: string,
  ): { readonly value: string; readonly source: string } | undefined => {
    const flag = flags.get(name);
    if (typeof flag === 'string' && flag !== '') return { value: flag, source: `--${name}` };

    const variable = PR_INPUT_ENV[name];
    const fromEnv = variable === undefined ? undefined : env[variable];
    if (fromEnv === undefined || variable === undefined) return undefined;

    // AN EMPTY VALUE IS "NOT SET" ON BOTH PATHS, because an action input nobody filled in arrives
    // as the empty string rather than as an absent variable. Whitespace is not emptiness for an
    // exact input: it is a value that is not what the option accepts, and it is refused as one.
    if (PR_EXACT_INPUTS.includes(name)) {
      return fromEnv === '' ? undefined : { value: fromEnv, source: variable };
    }
    return fromEnv.trim() === '' ? undefined : { value: fromEnv.trim(), source: variable };
  };

  const value = (name: string): string | undefined => supplied(name)?.value;

  const booleans: Record<string, boolean> = {};
  for (const name of PR_BOOLEAN_FLAGS) {
    if (flags.get(name) === true) {
      booleans[name] = true;
      continue;
    }
    const variable = PR_INPUT_ENV[name];
    const raw = typeof flags.get(name) === 'string' ? String(flags.get(name)) : env[variable ?? ''];
    const read = readBoolean(raw);
    if (typeof read === 'object') {
      return { usageError: `--${name} ${read.unreadable}` };
    }
    booleans[name] = read;
  }

  const repository = supplied('repository');

  return {
    spec: value('spec'),
    base: value('base'),
    out: value('out'),
    previewBase: value('preview-base'),
    previewUrl: value('preview-url'),
    failOnBreaking: booleans['fail-on-breaking'] === true,
    dryRun: booleans['dry-run'] === true,
    repository: repository?.value,
    repositorySource: repository?.source,
    pullRequest: value('pull-request'),
  };
}

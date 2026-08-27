import { runWithDocument } from '../../application/services/run-with-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import type { DocumentSource } from '../../domain/loaded-document.types';
import { parseArgs, stringFlag, type FlagValue } from '../argv';
import { BUILD_USAGE } from '../help';
import { describeDocument } from './document-summary';

const SOURCE_FLAGS = ['spec', 'config', 'from-nest'] as const;

function resolveSource(flags: ReadonlyMap<string, FlagValue>): DocumentSource | string {
  const given = SOURCE_FLAGS.filter((flagName) => flags.has(flagName));

  if (given.length === 0) {
    return 'one of --spec, --config or --from-nest is required';
  }
  if (given.length > 1) {
    return `only one of --spec, --config or --from-nest may be given, got ${given
      .map((flagName) => `--${flagName}`)
      .join(', ')}`;
  }

  const flagName = given[0];
  if (flagName === undefined) {
    return 'one of --spec, --config or --from-nest is required';
  }

  const value = stringFlag(flags, flagName);
  if (value === undefined) {
    return `--${flagName} needs a path`;
  }

  const kind = flagName === 'from-nest' ? 'from-nest' : flagName === 'config' ? 'config' : 'spec';
  return { kind, path: value };
}

/**
 * `openref build`, T036's slice of it: resolving exactly one document source and loading it.
 *
 * `--out`, `--base` and `--target` ARE PARSED AND VALIDATED AS STRINGS AND ACTED ON NOWHERE YET.
 * The static build they configure is `T039`'s; this task's job is the source the build will
 * read, not the sink it will write to.
 */
export async function runBuild(context: CommandContext): Promise<CommandOutcome> {
  const { flags } = parseArgs(context.args, [
    'spec',
    'config',
    'from-nest',
    'out',
    'base',
    'target',
  ]);

  if (flags.has('help')) {
    context.stdout(BUILD_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const source = resolveSource(flags);
  if (typeof source === 'string') {
    context.stderr(`openref build: ${source}\n\n${BUILD_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  return runWithDocument(source, context, (document) => {
    context.stdout(`${describeDocument(document)}\n`);
    return Promise.resolve({ exitCode: EXIT_CODE.SUCCESS });
  });
}

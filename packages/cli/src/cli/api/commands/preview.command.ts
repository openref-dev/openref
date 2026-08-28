import { runWithDocument } from '../../application/services/run-with-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { parseArgs, stringFlag, unknownFlagRefusal } from '../argv';
import { PREVIEW_USAGE } from '../help';
import { describeDocument } from './document-summary';

/**
 * `openref preview`, T036's slice of it: loading the one source SPEC 17 allows here, `--spec`.
 *
 * `--watch` IS PARSED AND ACTED ON NOWHERE YET. A live rebuilding preview server has no task of
 * its own in BUILD.md; this task's job is the source it would serve.
 */
export async function runPreview(context: CommandContext): Promise<CommandOutcome> {
  const { flags, unknown } = parseArgs(context.args, ['spec'], ['watch']);

  if (flags.has('help')) {
    context.stdout(PREVIEW_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const refusal = unknownFlagRefusal('preview', unknown);
  if (refusal !== undefined) {
    context.stderr(`${refusal}\n\n${PREVIEW_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const spec = stringFlag(flags, 'spec');
  if (spec === undefined) {
    context.stderr(`openref preview: --spec <path> is required\n\n${PREVIEW_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  return runWithDocument({ kind: 'spec', path: spec }, context, (document) => {
    context.stdout(`${describeDocument(document)}\n`);
    return Promise.resolve({ exitCode: EXIT_CODE.SUCCESS });
  });
}

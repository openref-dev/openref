import { loadDocument } from '../../application/services/load-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { parseArgs } from '../argv';
import { DIFF_USAGE } from '../help';
import { describeDocument } from './document-summary';

/**
 * `openref diff <old> <new>`, T036's slice of it: requiring both positionals and loading both.
 *
 * BOTH ARE SPEC FILE PATHS IN THIS TASK. SPEC 17.1's own example, `openref diff main current`,
 * compares two git refs, which is a resolution step this task does not build. Loading two
 * documents by path is what this task's loader already does; comparing them, and resolving a
 * ref to one, is `T038`'s.
 */
export async function runDiff(context: CommandContext): Promise<CommandOutcome> {
  const { flags, positionals } = parseArgs(context.args);

  if (flags.has('help')) {
    context.stdout(DIFF_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const [oldPath, newPath] = positionals;
  if (oldPath === undefined || newPath === undefined) {
    context.stderr(`openref diff: two spec paths are required, <old> <new>\n\n${DIFF_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  try {
    const older = await loadDocument({ kind: 'spec', path: oldPath });
    await older.close();
    const newer = await loadDocument({ kind: 'spec', path: newPath });
    await newer.close();

    context.stdout(`${oldPath}: ${describeDocument(older.document)}\n`);
    context.stdout(`${newPath}: ${describeDocument(newer.document)}\n`);
    return { exitCode: EXIT_CODE.SUCCESS };
  } catch (error) {
    context.stderr(`openref: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }
}

import { existsSync } from 'node:fs';
import { buildDiffReport } from '@openref/core';
import { loadDocument } from '../../application/services/load-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { resolveDiffSides } from '../../domain/diff-side';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { parseArgs, stringFlag, unknownFlagRefusal } from '../argv';
import { DIFF_USAGE } from '../help';
import { renderDiffReport } from './diff-report-text';

/**
 * `openref diff <old> <new>`, per SPEC 17.1: classify the changes between two versions of one
 * specification and exit 1 when any of them is breaking.
 *
 * EITHER SIDE MAY BE A FILE OR A GIT REF SINCE T041, which is what makes SPEC 17.1's own
 * transcript, `openref diff main current`, a command rather than a picture. The whole resolution
 * table is `../../domain/diff-side.ts` and is pure; the disk enters here, once, as `existsSync`.
 *
 * A side that cannot be loaded is a usage error, exit 2, per the T036 contract: exit 1 is
 * reserved for the command having run and found something.
 */
export async function runDiff(context: CommandContext): Promise<CommandOutcome> {
  const { flags, positionals, unknown } = parseArgs(context.args, ['spec']);

  if (flags.has('help')) {
    context.stdout(DIFF_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const refusal = unknownFlagRefusal('diff', unknown);
  if (refusal !== undefined) {
    context.stderr(`${refusal}\n\n${DIFF_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const [oldSide, newSide] = positionals;
  if (oldSide === undefined || newSide === undefined) {
    context.stderr(
      `openref diff: two spec paths or git refs are required, <old> <new>\n\n${DIFF_USAGE}`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const sides = resolveDiffSides(oldSide, newSide, {
    exists: existsSync,
    spec: stringFlag(flags, 'spec'),
  });
  if (!sides.ok) {
    context.stderr(`openref diff: ${sides.usageError}\n\n${DIFF_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  try {
    const older = await loadDocument(sides.older);
    await older.close();
    const newer = await loadDocument(sides.newer);
    await newer.close();

    const report = buildDiffReport(older.document, newer.document);
    context.stdout(`${renderDiffReport(report)}\n`);

    return {
      exitCode: report.breaking.length > 0 ? EXIT_CODE.FINDINGS : EXIT_CODE.SUCCESS,
    };
  } catch (error) {
    context.stderr(`openref: ${error instanceof Error ? error.message : String(error)}\n`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }
}

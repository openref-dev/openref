import { buildDiffReport } from '@openref/core';
import { loadDocument } from '../../application/services/load-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { parseArgs } from '../argv';
import { DIFF_USAGE } from '../help';
import { renderDiffReport } from './diff-report-text';

/**
 * `openref diff <old> <new>`, per SPEC 17.1: classify the changes between two versions of one
 * specification and exit 1 when any of them is breaking.
 *
 * BOTH SIDES ARE SPEC FILE PATHS. SPEC 17.1's own transcript, `openref diff main current`,
 * compares two git refs; resolving a ref to a file is `T041`'s, where the ref exists (a
 * checkout in CI). The classification and the report are all here, in `buildDiffReport` in
 * `@openref/core`, so that consumer needs nothing from this package.
 *
 * A side that cannot be loaded is a usage error, exit 2, per the T036 contract: exit 1 is
 * reserved for the command having run and found something.
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

import { buildDoctorReport, canonicalize, OpenRefError } from '@openref/core';
import { applyFixes } from '../../application/services/fix.service';
import { runWithDocument } from '../../application/services/run-with-document.service';
import { planFixes } from '../../domain/fix-plan';
import {
  readWorkingTree,
  type WorkingTree,
} from '../../infrastructure/adapters/working-tree.adapter';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { FAIL_ON_LEVELS, isFailOnLevel, meetsFailOnThreshold } from '../../domain/fail-on';
import { parseArgs, stringFlag, unknownFlagRefusal } from '../argv';
import { DOCTOR_USAGE } from '../help';
import { renderDoctorFindings, renderDoctorSummary } from './doctor-report-text';
import { renderFixSummary } from './fix-report-text';

/**
 * `openref doctor`: boots a NestJS application, per SPEC 17, and reports on documentation health
 * per SPEC 7.2 and 7.4.
 *
 * `--fail-on` OMITTED MEANS THIS COMMAND NEVER EXITS 1, whatever it finds. It always reports; a
 * team opts into gating explicitly, at whatever threshold it can act on today. See
 * `../../domain/fail-on.ts` for the reasoning and `ai-docs/PROJECT_STATE.md` for the record of the
 * decision.
 *
 * `--fix` DOES NOT CHANGE WHAT `--fail-on` COUNTS. The report is taken before a byte is written
 * and describes the application as it booted, so a run that fixes eight findings still exits on
 * the threshold those eight met. The state after the edits is what the next run reports, and a
 * command that graded itself on its own output would be the one thing a gate must not be.
 */
export async function runDoctor(context: CommandContext): Promise<CommandOutcome> {
  const { flags, unknown } = parseArgs(
    context.args,
    ['from-nest', 'fail-on'],
    ['json', 'fix', 'dry-run'],
  );

  if (flags.has('help')) {
    context.stdout(DOCTOR_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const refusal = unknownFlagRefusal('doctor', unknown);
  if (refusal !== undefined) {
    context.stderr(`${refusal}\n\n${DOCTOR_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const entry = stringFlag(flags, 'from-nest');
  if (entry === undefined) {
    context.stderr(`openref doctor: --from-nest <path> is required\n\n${DOCTOR_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const failOnValue = stringFlag(flags, 'fail-on');
  if (failOnValue !== undefined && !isFailOnLevel(failOnValue)) {
    context.stderr(
      `openref doctor: --fail-on must be one of ${FAIL_ON_LEVELS.join(', ')}, got "${failOnValue}"\n`,
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  // NARROWED BY THE GUARD ABOVE: past this point `failOnValue` is either undefined or a value
  // `isFailOnLevel` has already proven, so `meetsFailOnThreshold` below accepts it as is.
  const failOn = failOnValue;
  const json = flags.has('json');
  const fix = flags.has('fix');
  const dryRun = flags.has('dry-run');

  // A FLAG THAT SILENTLY DOES NOTHING IS THE DEFECT SPEC 17 NAMES AT `T043`. `--dry-run` previews
  // a fix run, so on its own there is nothing for it to preview, and accepting it would let a
  // pipeline believe it had asked for something.
  if (dryRun && !fix) {
    context.stderr(`openref doctor: --dry-run only means something with --fix\n\n${DOCTOR_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const tree = fix ? await readTree(context) : undefined;
  if (fix && tree === undefined) return { exitCode: EXIT_CODE.USAGE_ERROR };

  // THE REFUSAL COMES BEFORE THE APPLICATION IS BOOTED, not after. Booting a host's application to
  // then refuse to use what it produced spends the slowest part of the run on an answer already
  // known.
  if (tree !== undefined && tree.dirty.length > 0 && !dryRun) {
    context.stderr(dirtyTreeRefusal(tree));
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  return runWithDocument({ kind: 'from-nest', path: entry }, context, async (document) => {
    const report = buildDoctorReport(document);

    if (json) {
      context.stdout(`${canonicalize(report)}\n`);
    } else {
      const title = `${document.info.title} ${document.info.version}`;
      context.stdout(`${renderDoctorSummary(report, title, document.runtime?.skipped ?? [])}\n`);
      if (report.findings.length > 0)
        context.stdout(`\n${renderDoctorFindings(report.findings)}\n`);
    }

    if (tree !== undefined) {
      const run = await applyFixes(planFixes(report), { root: tree.root, write: !dryRun });

      // WITH `--json` THE SUMMARY GOES TO STDERR AND NOWHERE ELSE. SPEC 17 promises that `--json`
      // prints the report of SPEC 7.2 and nothing besides, so a consumer can parse stdout whole;
      // a run that wrote to source still has to say so to the person who started it.
      const write = json ? context.stderr : context.stdout;
      if (dryRun && tree.dirty.length > 0) write(`${dirtyTreeNotice(tree)}\n`);
      write(`\n${renderFixSummary(run)}\n`);
    }

    const failing =
      failOn !== undefined &&
      report.findings.some((finding) => meetsFailOnThreshold(finding.severity, failOn));

    return { exitCode: failing ? EXIT_CODE.FINDINGS : EXIT_CODE.SUCCESS };
  });
}

/** The working tree, or undefined after saying on stderr why git could not answer. */
async function readTree(context: CommandContext): Promise<WorkingTree | undefined> {
  try {
    return await readWorkingTree(process.cwd());
  } catch (error) {
    const reason = error instanceof OpenRefError ? error.message : String(error);
    context.stderr(
      `openref doctor --fix: ${reason}\n\n` +
        'Every edit has to be reviewable as a diff, so --fix runs inside a git repository and\n' +
        'nowhere else. A finding names a repository relative path, and without a repository there\n' +
        'is no root to resolve one against.\n',
    );
    return undefined;
  }
}

/** How many paths git reported, named rather than counted when there are few of them. */
function dirtyPathList(tree: WorkingTree): string {
  const shown = tree.dirty.slice(0, 10).map((line) => `  ${line}`);
  const rest = tree.dirty.length - shown.length;

  return rest > 0 ? [...shown, `  ... and ${String(rest)} more`].join('\n') : shown.join('\n');
}

/** The refusal a writing run prints on a dirty tree. */
function dirtyTreeRefusal(tree: WorkingTree): string {
  return (
    'openref doctor --fix: the working tree has uncommitted changes and this is a refusal.\n\n' +
    'A fix run is only worth anything if a person reads it as a diff, and a diff that mixes\n' +
    "this tool's edits with uncommitted work is not reviewable. Commit or stash first, or use\n" +
    '--dry-run to see what would be written.\n\n' +
    `${dirtyPathList(tree)}\n`
  );
}

/** What a dry run says about a tree a writing run would have refused. */
function dirtyTreeNotice(tree: WorkingTree): string {
  return (
    `\nThe working tree has ${String(tree.dirty.length)} uncommitted change(s), so a run without\n` +
    '--dry-run would refuse rather than write these edits.'
  );
}

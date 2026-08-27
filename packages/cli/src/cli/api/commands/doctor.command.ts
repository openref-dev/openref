import { buildDoctorReport, canonicalize } from '@openref/core';
import { runWithDocument } from '../../application/services/run-with-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { FAIL_ON_LEVELS, isFailOnLevel, meetsFailOnThreshold } from '../../domain/fail-on';
import { parseArgs, stringFlag } from '../argv';
import { DOCTOR_USAGE } from '../help';
import { renderDoctorFindings, renderDoctorSummary } from './doctor-report-text';

/**
 * `openref doctor`: boots a NestJS application, per SPEC 17, and reports on documentation health
 * per SPEC 7.2 and 7.4.
 *
 * `--fail-on` OMITTED MEANS THIS COMMAND NEVER EXITS 1, whatever it finds. It always reports; a
 * team opts into gating explicitly, at whatever threshold it can act on today. See
 * `../../domain/fail-on.ts` for the reasoning and `ai-docs/PROJECT_STATE.md` for the record of the
 * decision.
 */
export async function runDoctor(context: CommandContext): Promise<CommandOutcome> {
  const { flags } = parseArgs(context.args, ['from-nest', 'fail-on']);

  if (flags.has('help')) {
    context.stdout(DOCTOR_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
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

  return runWithDocument({ kind: 'from-nest', path: entry }, context, (document) => {
    const report = buildDoctorReport(document);

    if (json) {
      context.stdout(`${canonicalize(report)}\n`);
    } else {
      const title = `${document.info.title} ${document.info.version}`;
      context.stdout(`${renderDoctorSummary(report, title)}\n`);
      if (report.findings.length > 0)
        context.stdout(`\n${renderDoctorFindings(report.findings)}\n`);
    }

    const failing =
      failOn !== undefined &&
      report.findings.some((finding) => meetsFailOnThreshold(finding.severity, failOn));

    return Promise.resolve({ exitCode: failing ? EXIT_CODE.FINDINGS : EXIT_CODE.SUCCESS });
  });
}

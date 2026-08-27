import { buildDoctorReport } from '@openref/core';
import { runWithDocument } from '../../application/services/run-with-document.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import { parseArgs } from '../argv';
import { LINT_USAGE } from '../help';
import { renderDoctorFindings } from './doctor-report-text';

/**
 * `openref lint <spec>`: the quality rules of SPEC 7.1 over a specification with no application,
 * per SPEC 17.
 *
 * NO SUMMARY BANNER, ONLY FINDINGS, AND SILENCE WHEN THERE ARE NONE. `doctor` reads as a health
 * dashboard for an application a reader already knows the name of; `lint` reads as a conventional
 * linter over one file, and a linter that prints a percentage and a title on a clean run is a
 * linter whose successful output gets read once and then piped to `/dev/null` regardless.
 *
 * THE QUALITY RULES ARE NEVER NAMED HERE. A bare specification carries no runtime facts, so every
 * rule needing one is out of scope on every operation, per SPEC 7.1's own scoping; the checks
 * `buildDoctorReport` returns are exactly the four quality rules and nothing filters for that on
 * purpose, the same way `health-report.spec.ts`'s own case proves for `buildHealthReport`.
 */
export async function runLint(context: CommandContext): Promise<CommandOutcome> {
  const { flags, positionals } = parseArgs(context.args);

  if (flags.has('help')) {
    context.stdout(LINT_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const [spec] = positionals;
  if (spec === undefined) {
    context.stderr(`openref lint: a spec path is required\n\n${LINT_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  return runWithDocument({ kind: 'spec', path: spec }, context, (document) => {
    const report = buildDoctorReport(document);

    if (report.findings.length > 0) context.stdout(`${renderDoctorFindings(report.findings)}\n`);

    return Promise.resolve({
      exitCode: report.findings.length > 0 ? EXIT_CODE.FINDINGS : EXIT_CODE.SUCCESS,
    });
  });
}

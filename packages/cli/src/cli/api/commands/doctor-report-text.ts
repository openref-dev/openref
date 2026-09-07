import {
  plainArtefactText,
  type IRDoctorCheck,
  type IRDoctorFinding,
  type IRDoctorReport,
  type IRRuntimeMeta,
} from '@openref/core';

/**
 * The text rendering of the doctor report, in the shape of SPEC 7.2: a title, a health line, an
 * operation count, one line per check, then one block per finding.
 *
 * THE EXACT WORDING IS THIS SESSION'S CHOICE AND NOT A TRANSCRIPTION OF SPEC 7.2'S EXAMPLE. That
 * example mixes a pass count ("127 have response schemas") with a failure count ("18 missing
 * descriptions"), which reads naturally in prose but is two different grammars for the same
 * `passed`/`total` pair. This renderer prints one grammar, `passed/total`, for every check
 * regardless of state, which is unambiguous at a glance and is what `T037`'s own tests snapshot.
 *
 * A CHECK WITH NOTHING TO COUNT DRAWS NO LINE, per SPEC 7.2: `total === 0` means the rule found no
 * subject in scope, and a row for a question nobody could be asked is the instrument talking about
 * itself rather than about the application, the same class of noise F26 removed from the runtime
 * block.
 *
 * NO FINDING IS EVER TRUNCATED HERE. `groupDriftByRule`'s own doc comment states the rule this
 * follows: whatever bounds the output is that renderer's decision to make and to say out loud, and
 * this one makes none. A long report is the honest shape of a real application's first run.
 */

/** ✓ when a check is fully clean, ✗ for an error severity check with a failure, ⚠ otherwise. */
function checkSymbol(check: IRDoctorCheck): string {
  if (check.passed === check.total) return '✓';

  return check.severity === 'error' ? '✗' : '⚠';
}

/** One line of {@link IRDoctorReport.checks}, or nothing for a check with no subject in scope. */
function renderCheck(check: IRDoctorCheck): string | undefined {
  if (check.total === 0) return undefined;

  return `${checkSymbol(check)} ${String(check.passed)}/${String(check.total)}  ${check.label}`;
}

/**
 * The summary block: title, health percentage, operation count, and one line per check.
 *
 * @param report - The report to summarize
 * @param title - The document's own title and version, so a reader knows which application this is
 * @param skipped - Collectors that did not run, from `IRRuntimeMeta.skipped`, with their reasons
 * @returns The block, with no trailing newline
 */
export function renderDoctorSummary(
  report: IRDoctorReport,
  title: string,
  skipped: NonNullable<IRRuntimeMeta['skipped']> = [],
): string {
  const operations = `${String(report.operationCount)} operation${report.operationCount === 1 ? '' : 's'}`;
  const checkLines = report.checks.map(renderCheck).filter((line) => line !== undefined);

  // THE MARKED SCORE AND NEVER THE BARE NUMBER, from the report rather than formatted here. It is
  // the same string the health page prints, which is what lets a reader compare a build log
  // against the reference without wondering whether the two figures mean the same thing.
  const lines = [title, '', `Documentation health: ${report.scoreText}`, operations];
  if (checkLines.length > 0) lines.push('', ...checkLines);

  // THE SUPPRESSED CLASSES ARE PRINTED WITHOUT ANY FLAG, and that is the half that matters. A
  // reader who never types `--show-suppressed` still learns how much is missing from the list in
  // front of them and on whose reason, because a report that hides its own filtering is exactly
  // the report this option exists to stop a host from producing. The flag governs the FINDINGS,
  // which are the volume, and never the fact that they were taken out.
  const suppression = report.suppression;
  if (suppression !== undefined) {
    lines.push('', 'Suppressed by this application:');
    for (const entry of suppression.classes) {
      // `(matched nothing)` IS THE WHOLE OF THE WARNING FOR AN EMPTY CLASS. It did not refuse boot,
      // because a class is legitimately empty on some deployments, so this is the only place a
      // reader finds out before the day it comes back and starts suppressing in silence.
      const empty = entry.matched === 0 ? '  (matched nothing)' : '';
      lines.push(
        `  ${entry.code}  ${entry.rule}  ${String(entry.matched)}  ${entry.reason}${empty}`,
      );
    }
    if (suppression.inverted) {
      lines.push(
        '  One suppressed class is an error, so the health percentage above is the ' +
          'UNSUPPRESSED one and the suppressed figure is in the parenthesis.',
      );
    }
  }

  // THE SKIPPED COLLECTORS ARE PRINTED HERE AND ARE NOT FINDINGS, per SPEC 7.1 as amended by
  // `T054`. `IRRuntimeMeta.skipped` has said "for `doctor` to report" since `T017` and nothing
  // read it, so the `runtime-collectors` line above printed `2/3` and the reason the third did not
  // run was in the document and on no page. It stays out of the findings for the reason
  // `collector-registry.service.ts` records: a collector that could not run is the instrument
  // failing rather than the two sides differing, and it is already counted by that check, so a
  // finding would move the score a second time for one fact.
  if (skipped.length > 0) {
    lines.push('', 'Collectors that did not run:');
    for (const entry of skipped) lines.push(`  ${entry.collector}: ${entry.reason}`);
  }

  return plainArtefactText(lines.join('\n'));
}

/**
 * Where a finding's handler lives, rendered as one line: the resolved link when there is one, the
 * file and line when there is no link, or just the class and method when there is neither.
 *
 * @param finding - The finding
 * @returns The line, or undefined when the finding carries no source location at all
 */
function renderSource(finding: IRDoctorFinding): string | undefined {
  const source = finding.source;
  if (source === undefined) return undefined;

  const name = `${source.controller}.${source.handler}()`;
  const link = finding.sourceLink;
  if (link?.url !== undefined) return `${name}  ${link.url}`;
  if (source.file !== undefined) {
    return source.line === undefined
      ? `${name}  ${source.file}`
      : `${name}  ${source.file}:${String(source.line)}`;
  }

  return name;
}

/**
 * One finding as a block: what rule found it, what the runtime and the specification each say,
 * where the handler is, and the edit that closes it. Every field SPEC 7.2 requires is here, and
 * every one of them is on the block, not folded into a summary line.
 *
 * @param finding - The finding
 * @returns The block, with no trailing newline
 */
export function renderDoctorFinding(finding: IRDoctorFinding): string {
  const lines = [`DRIFT  ${finding.code}  ${finding.subject}`];

  if (finding.runtimeValue !== undefined) lines.push(`  Runtime:  ${finding.runtimeValue}`);
  if (finding.specValue !== undefined) lines.push(`  OpenAPI:  ${finding.specValue}`);

  const source = renderSource(finding);
  if (source !== undefined) lines.push(`  Source:   ${source}`);

  lines.push(`  →  ${finding.suggestion}`);

  return lines.join('\n');
}

/**
 * Every finding, each as its own block, separated by a blank line.
 *
 * @param findings - The findings, in report order
 * @returns The blocks joined together, or the empty string for no findings at all
 */
export function renderDoctorFindings(findings: readonly IRDoctorFinding[]): string {
  return plainArtefactText(findings.map(renderDoctorFinding).join('\n\n'));
}

/**
 * The suppressed findings, for `doctor --show-suppressed`, per SPEC 7.2.
 *
 * THE SAME ANATOMY AS A DRAWN FINDING AND NOT A REDUCED ONE. They are the same findings; a second,
 * shorter shape for the half a host stopped looking at would be a second report, and the reason a
 * host asks for them at all is to decide whether the class is still one they want suppressed,
 * which is a decision that needs the subject, both sides and the suggested edit.
 *
 * IT PRINTS NO HEADING OVER AN EMPTY LIST. `--show-suppressed` on a document with nothing
 * suppressed is not an error and has nothing to say.
 *
 * @param findings - The suppressed findings, in report order
 * @returns The blocks joined together, or the empty string when there are none
 */
export function renderSuppressedFindings(findings: readonly IRDoctorFinding[]): string {
  if (findings.length === 0) return '';

  return plainArtefactText(
    ['Suppressed findings:', '', ...findings.map(renderDoctorFinding)].join('\n\n'),
  );
}

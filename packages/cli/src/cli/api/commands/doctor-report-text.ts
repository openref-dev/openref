import {
  plainArtefactText,
  type IRDoctorCheck,
  type IRDoctorFinding,
  type IRDoctorReport,
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
 * @returns The block, with no trailing newline
 */
export function renderDoctorSummary(report: IRDoctorReport, title: string): string {
  const operations = `${String(report.operationCount)} operation${report.operationCount === 1 ? '' : 's'}`;
  const checkLines = report.checks.map(renderCheck).filter((line) => line !== undefined);

  const lines = [title, '', `Documentation health: ${String(report.score)}%`, operations];
  if (checkLines.length > 0) lines.push('', ...checkLines);

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

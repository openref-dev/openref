import { plainArtefactText } from '@openref/core';
import type { FixRun } from '../../application/services/fix.service';
import type { FixSkipReason, PlannedEdit, SkippedFinding } from '../../domain/fix-plan';

/**
 * The summary `doctor --fix` prints, which `ai-docs/REMEDIATION.md` section 4 calls the point of
 * the whole mode.
 *
 * A RUN THAT FIXES THREE OF FORTY AND SAYS WHAT THE OTHER THIRTY SEVEN ARE IS USEFUL; ONE THAT
 * FIXES FORTY AND SAYS NOTHING IS A LIABILITY. So every finding the run did not write appears
 * here by name, with the reason, and the reasons are counted so a reader can see the shape of what
 * is left without reading every line of it.
 *
 * EVERY APPLIED EDIT CARRIES ITS PROVENANCE ON THE LINE THAT ANNOUNCES IT: the rule that produced
 * it and the confidence of the fact behind it, per SPEC 7.4, so that a reviewer reading the diff
 * afterwards can tell where each new decorator came from.
 */

/** The words each reason is printed under, one per member of the set SPEC 17 enumerates. */
const REASON_LABEL: Readonly<Record<FixSkipReason, string>> = {
  contradiction: 'contradiction',
  manual: 'manual',
  'unconfigured-mapping': 'unconfigured mapping',
  'existing-decorator': 'existing decorator',
  'no-source-location': 'no source location',
  'no-mechanical-edit': 'no mechanical edit',
};

/** One applied edit, as two lines: what was written, and where it came from. */
function renderEdit(edit: PlannedEdit): string {
  return [
    `  ${edit.code}  ${edit.subject}`,
    `    + ${edit.decorator.text}`,
    `      ${edit.rule}, ${edit.confidence}, ${edit.file}  ${edit.controller}.${edit.handler}()`,
  ].join('\n');
}

/** One finding left alone, as two lines: which one, and why. */
function renderSkipped(skipped: SkippedFinding): string {
  return [
    `  ${skipped.code}  ${skipped.subject}  [${REASON_LABEL[skipped.reason]}]`,
    `      ${skipped.detail}`,
  ].join('\n');
}

/** `1 finding` or `n findings`, so no line reads `1 findings`. */
function findings(count: number): string {
  return `${String(count)} finding${count === 1 ? '' : 's'}`;
}

/** How many findings each reason accounts for, in the order the reasons first appear. */
function reasonTally(left: readonly SkippedFinding[]): readonly string[] {
  const counts = new Map<FixSkipReason, number>();
  for (const entry of left) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);

  return [...counts].map(([reason, count]) => `${String(count)} ${REASON_LABEL[reason]}`);
}

/**
 * The whole summary of one `--fix` or `--dry-run` pass.
 *
 * @param run - What the pass applied and left
 * @returns The summary, with no trailing newline
 */
export function renderFixSummary(run: FixRun): string {
  const verb = run.written ? 'Applied' : 'Would apply';
  const fileCount = run.files.length;
  const where = `${String(fileCount)} file${fileCount === 1 ? '' : 's'}`;

  const lines = [`${verb} ${findings(run.applied.length)} in ${where}.`];

  if (run.applied.length > 0) lines.push('', ...run.applied.map(renderEdit));

  if (run.left.length > 0) {
    const tally = reasonTally(run.left);
    lines.push('', `Left ${findings(run.left.length)} alone: ${tally.join(', ')}.`);
    lines.push('', ...run.left.map(renderSkipped));
  }

  if (!run.written && run.applied.length > 0) {
    lines.push('', 'Nothing was written. Run without --dry-run to apply these edits.');
  }

  return plainArtefactText(lines.join('\n'));
}

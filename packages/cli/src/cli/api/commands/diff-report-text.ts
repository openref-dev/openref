import { plainArtefactText, type IRDiffChange, type IRDiffReport } from '@openref/core';

/**
 * The text rendering of the diff report, in the shape of SPEC 17.1.
 *
 * THE GRAMMAR IS THE EXAMPLE'S OWN, EXTENDED WHERE THE EXAMPLE IS SILENT. Where SPEC 17.1 shows
 * a line for a kind, that line is reproduced verbatim: a removed operation prints as its method
 * and path with no verb, exactly as `DELETE /users/{id}` does there, because the section it sits
 * under carries the verdict. Kinds the example does not show use the same verbs plus `NARROWED`
 * and `WIDENED`, the words T038 itself uses for enums, all recorded in SPEC 17.1.
 *
 * A CONSTRAINT CHANGE NAMES ITS KEYWORD AND PRINTS BOTH VALUES, per SPEC 17.1 as amended before
 * M4: `NARROWED maxLength of CreateUser.email: 255 → 32`. The line it replaces was
 * `CHANGED constraints of CreateUser.email`, which was the second way a narrowing stayed
 * invisible. The gate not failing was the first, and a reader unable to tell a tightening from a
 * loosening was the second, so both halves of that finding are fixed in the same place.
 *
 * AN EMPTY SECTION PRINTS NO HEADER, and a report with nothing at all in it prints one line,
 * `No changes.`, so a clean run is distinguishable from a run that never happened. Nothing is
 * grouped, capped or folded, per the same house rule the doctor renderer states.
 */

/** The one line a report with nothing in it prints. */
export const NO_CHANGES_LINE = 'No changes.';

/** One change as its SPEC 17.1 line, without the section indent. */
export function renderDiffChange(change: IRDiffChange): string {
  const values = (change.values ?? []).join(', ');
  const arrow =
    change.oldValue !== undefined && change.newValue !== undefined
      ? `${change.oldValue} → ${change.newValue}`
      : undefined;

  switch (change.kind) {
    case 'operation-removed':
      return change.subject;
    case 'operation-added':
      return `ADDED ${change.subject}`;
    case 'response-field-removed':
      return `REMOVED response field ${change.subject}`;
    case 'property-removed':
      return `REMOVED property ${change.subject}`;
    case 'required-property-added':
      return `ADDED required property ${change.subject}`;
    case 'optional-property-added':
      return `ADDED optional property ${change.subject}`;
    case 'type-changed':
    case 'requiredness-changed':
      return arrow === undefined
        ? `CHANGED ${change.subject}`
        : `CHANGED ${change.subject}  ${arrow}`;
    case 'enum-narrowed':
      return `NARROWED enum ${change.subject}  removed ${values}`;
    case 'enum-widened':
      return `WIDENED enum ${change.subject}  added ${values}`;
    case 'variant-removed':
      return `NARROWED union ${change.subject}  removed ${values}`;
    case 'variant-added':
      return `WIDENED union ${change.subject}  added ${values}`;
    case 'required-parameter-added':
      return `ADDED required ${change.subject}`;
    case 'optional-parameter-added':
      return `ADDED optional ${change.subject}`;
    case 'constraint-narrowed':
    case 'constraint-widened': {
      const verb = change.kind === 'constraint-narrowed' ? 'NARROWED' : 'WIDENED';
      return arrow === undefined
        ? `${verb} ${change.subject}`
        : `${verb} ${change.subject}: ${arrow}`;
    }
    case 'parameter-removed':
    case 'response-removed':
    case 'response-header-removed':
    case 'media-type-removed':
    case 'security-scheme-removed':
    case 'server-removed':
      return `REMOVED ${change.subject}`;
    case 'response-added':
    case 'response-header-added':
    case 'media-type-added':
    case 'security-scheme-added':
    case 'server-added':
      return `ADDED ${change.subject}`;
    case 'security-scheme-changed':
    case 'server-changed':
      return arrow === undefined
        ? `CHANGED ${change.subject}`
        : `CHANGED ${change.subject}  ${arrow}`;
    case 'operation-security-changed':
      return `CHANGED ${change.subject}`;
    case 'constraints-changed':
      return `CHANGED constraints of ${change.subject}`;
    case 'operation-unread':
      return `UNREAD ${change.subject}  declared under a key OpenAPI does not spell that way`;
  }
}

/**
 * The whole report as SPEC 17.1 text.
 *
 * @param report - The report, both sections already in rendering order
 * @returns The text, with no trailing newline
 */
export function renderDiffReport(report: IRDiffReport): string {
  const sections: string[] = [];

  if (report.breaking.length > 0) {
    sections.push(
      ['BREAKING', ...report.breaking.map((change) => `  ${renderDiffChange(change)}`)].join('\n'),
    );
  }
  if (report.nonBreaking.length > 0) {
    sections.push(
      ['NON-BREAKING', ...report.nonBreaking.map((change) => `  ${renderDiffChange(change)}`)].join(
        '\n',
      ),
    );
  }

  return plainArtefactText(sections.length === 0 ? NO_CHANGES_LINE : sections.join('\n\n'));
}

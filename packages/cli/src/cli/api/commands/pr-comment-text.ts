import type { IRDiffChange, IRDiffReport } from '@openref/core';
import { NO_CHANGES_LINE, renderDiffReport } from './diff-report-text';

/**
 * The pull request comment of SPEC 17.2.
 *
 * THE SHAPE IS THE EXAMPLE'S OWN, EXTENDED WHERE THE EXAMPLE IS SILENT, which is the same rule
 * `diff-report-text.ts` states for SPEC 17.1. The example shows three signed lines about
 * operations, a count of breaking changes and a preview address; everything below is what those
 * four things need in order to be true of a real diff rather than of one screenshot.
 *
 * THE MARKER IS THE FIRST LINE AND IT IS WHY THE COMMENT UPDATES INSTEAD OF ACCUMULATING. The
 * next run finds its own comment by it. It is an HTML comment, so a reader never sees it.
 *
 * THE BLOCKS ARE FENCED AS `diff` FOR A REASON A READER FEELS. Without a fence, markdown folds
 * the lines into one paragraph and eats the leading signs, which are the whole content; with
 * this fence GitHub colours the added and removed lines as well.
 *
 * CHANGES THAT NAME NO OPERATION GET THEIR OWN BLOCK RATHER THAN A LINE AMONG THE ROUTES. A
 * removed schema field printed as `- User.email` next to `- DELETE /payments/{id}` reads as a
 * removed endpoint. They are different namespaces and they are shown as two.
 */

/** The first line of every comment this writes, and what the next run searches for. */
export const PR_COMMENT_MARKER = '<!-- openref:api-review -->';

/**
 * The largest body GitHub accepts on an issue comment, in characters.
 *
 * A body over it is rejected by the API with a 422, so a report that grew past it would turn
 * into a failed run rather than into a shorter comment. It is truncated at a line boundary and
 * the truncation says how many lines it removed: a body that just stopped would read as a diff
 * that had nothing more in it.
 */
export const PR_COMMENT_LIMIT = 65_536;

/** What is known about the run, beyond the diff itself. */
export interface PrCommentContext {
  /** The address the preview was published at, when anything knows one. */
  readonly previewUrl?: string | undefined;
  /** The limit to fit the body into; the GitHub limit unless a test narrows it. */
  readonly limit?: number | undefined;
}

/** One line of the signed summary: a sign and a subject. */
export interface PrCommentLine {
  readonly sign: '+' | '-' | '~';
  readonly subject: string;
}

/** The two signed blocks of the comment, before they are rendered. */
export interface PrCommentSummary {
  readonly operations: readonly PrCommentLine[];
  readonly others: readonly PrCommentLine[];
}

/**
 * The operation a change is about, or undefined when it is about something else.
 *
 * SUBJECTS ARE BUILT BY `@openref/core` AS `<what> of <site>`, where the site is either an
 * operation or a named schema, so the candidate is what follows the last ` of `, or the whole
 * subject when there is no ` of ` in it. It is accepted only when it has the shape of an
 * operation, an upper case method and a path, which is a test on the answer rather than a guess
 * about the format: `email of User` produces `User`, fails the test, and is correctly reported
 * as belonging to no operation.
 *
 * @param subject - The subject of one change
 * @returns `METHOD /path`, or undefined
 */
export function operationOf(subject: string): string | undefined {
  const marker = subject.lastIndexOf(' of ');
  const candidate = marker === -1 ? subject : subject.slice(marker + ' of '.length);

  return /^[A-Z]+ \/\S*$/.test(candidate) ? candidate : undefined;
}

/**
 * The sign one change carries in the signed blocks.
 *
 * IT IS READ OFF THE KIND AND NOT OFF THE CLASSIFICATION. The signs of SPEC 17.2 say what
 * happened to the surface, and the breaking count below them says what it costs; making `-` mean
 * breaking would say the same thing twice and would print `-` on an added required property.
 *
 * @param change - The change
 * @returns The sign
 */
export function signOf(change: IRDiffChange): '+' | '-' | '~' {
  if (change.kind.endsWith('-added')) return '+';
  if (change.kind.endsWith('-removed')) return '-';
  return '~';
}

/**
 * The two signed blocks, deduplicated, in the order SPEC 17.2 shows: added, changed, removed.
 *
 * @param report - The whole diff report
 * @returns The lines of both blocks
 */
export function summarizeForComment(report: IRDiffReport): PrCommentSummary {
  const changes = [...report.breaking, ...report.nonBreaking];

  const operations = new Map<string, '+' | '-' | '~'>();
  const others = new Map<string, '+' | '-' | '~'>();

  for (const change of changes) {
    if (change.kind === 'operation-added' || change.kind === 'operation-removed') {
      operations.set(change.subject, change.kind === 'operation-added' ? '+' : '-');
      continue;
    }

    const operation = operationOf(change.subject);
    if (operation === undefined) {
      if (!others.has(change.subject)) others.set(change.subject, signOf(change));
      continue;
    }
    // AN ADDED OR REMOVED OPERATION KEEPS ITS OWN SIGN. A change inside an operation that was
    // just added would otherwise overwrite `+` with `~` and lose the more informative of the two.
    if (!operations.has(operation)) operations.set(operation, '~');
  }

  return { operations: order(operations), others: order(others) };
}

/**
 * The whole comment body.
 *
 * @param report - The diff between the base ref and the head
 * @param context - The preview address and the size limit
 * @returns The markdown body, marker first
 */
export function renderPrComment(report: IRDiffReport, context: PrCommentContext = {}): string {
  const limit = context.limit ?? PR_COMMENT_LIMIT;
  const summary = summarizeForComment(report);
  const empty = summary.operations.length === 0 && summary.others.length === 0;

  const parts: string[] = [PR_COMMENT_MARKER, '### API changes'];

  if (empty) {
    parts.push(NO_CHANGES_LINE);
  } else {
    if (summary.operations.length > 0) parts.push(fenced(summary.operations, true));
    if (summary.others.length > 0) {
      parts.push('Schemas, security and servers:', fenced(summary.others, false));
    }
    parts.push(breakingCountLine(report.breaking.length));
  }

  if (context.previewUrl !== undefined && context.previewUrl !== '') {
    parts.push(`Preview: ${context.previewUrl}`);
  }

  if (!empty) {
    parts.push(
      [
        '<details><summary>Full report</summary>',
        '',
        '```',
        renderDiffReport(report),
        '```',
        '',
        '</details>',
      ].join('\n'),
    );
  }

  return truncateComment(`${parts.join('\n\n')}\n`, limit);
}

/**
 * The body cut down to a limit, at a line boundary, saying what it cut.
 *
 * @param body - The whole body
 * @param limit - The largest body to produce, in characters
 * @returns The body, unchanged when it already fits
 */
export function truncateComment(body: string, limit: number): string {
  if (body.length <= limit) return body;

  const lines = body.split('\n');
  const kept: string[] = [];
  let size = 0;

  // The notice is written first and its own length is reserved, so the result fits the limit
  // including the sentence that explains why it had to.
  const notice = (removed: number): string =>
    `\n_${String(removed)} more line${removed === 1 ? '' : 's'} did not fit in a GitHub comment. Run \`openref diff\` for the whole report._\n`;
  const reserve = notice(lines.length).length;

  for (const line of lines) {
    if (size + line.length + 1 + reserve > limit) break;
    kept.push(line);
    size += line.length + 1;
  }

  return `${kept.join('\n')}${notice(lines.length - kept.length)}`;
}

/** The count line of SPEC 17.2, in the example's own words. */
function breakingCountLine(count: number): string {
  if (count === 0) return 'No breaking changes detected';
  return `${String(count)} breaking change${count === 1 ? '' : 's'} detected`;
}

/** Added first, then changed, then removed: the order of the SPEC 17.2 example. */
function order(entries: ReadonlyMap<string, '+' | '-' | '~'>): PrCommentLine[] {
  const rank: Readonly<Record<'+' | '-' | '~', number>> = { '+': 0, '~': 1, '-': 2 };
  return [...entries]
    .map(([subject, sign]) => ({ sign, subject }))
    .sort((a, b) => rank[a.sign] - rank[b.sign] || a.subject.localeCompare(b.subject));
}

/**
 * One fenced block.
 *
 * `alignMethods` PADS THE METHOD TO THE WIDEST IN THE BLOCK so the paths stand in a column, per
 * SPEC 17.2. It is off for the block that holds schema and security subjects, which have no
 * method to align.
 */
function fenced(lines: readonly PrCommentLine[], alignMethods: boolean): string {
  const width = alignMethods
    ? Math.max(...lines.map((line) => line.subject.split(' ')[0]?.length ?? 0))
    : 0;

  const body = lines.map((line) => {
    if (!alignMethods) return `${line.sign} ${line.subject}`;
    const space = line.subject.indexOf(' ');
    if (space === -1) return `${line.sign} ${line.subject}`;
    const method = line.subject.slice(0, space);
    return `${line.sign} ${method.padEnd(width)} ${line.subject.slice(space + 1)}`;
  });

  return ['```diff', ...body, '```'].join('\n');
}

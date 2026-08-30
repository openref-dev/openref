/**
 * A markdown description as one line of plain text.
 *
 * A DESCRIPTION IN A LINE ORIENTED FILE IS A DESCRIPTION THAT FITS ON A LINE. `llms.txt` is a list
 * of links with a note beside each, so a description carrying a fenced code block, a heading or a
 * blank line would not produce a wrong note, it would produce extra records: the reader of that
 * file splits on newlines and every line after the first becomes a row that names nothing.
 *
 * THIS IS THE SECOND SPELLING OF `plainSummary` IN THIS REPOSITORY AND SPEC 18.1 SAYS SO WITH THE
 * REASON. `@openref/static` carries the first, for the HTML meta description and for the static
 * build's own `llms.txt`, and it cannot be shared without either an edge `static -> agent` or a
 * move into `@openref/render`, whose module graph is bounded by the `client-js-raw` budget. Both
 * are changes to packages `T058` does not name.
 *
 * SO THE TWO ARE HELD TO ONE BEHAVIOUR BY A CASE RATHER THAN BY A SENTENCE, on the
 * `AUDIENCE_EXTENSION` precedent: `packages/nest/test/unit/agent-route.spec.ts` is the one place
 * both functions are visible at once, and it drives the same inputs through both and compares the
 * output. THE FIRST EDITION OF THIS FILE CLAIMED THE AGREEMENT AND DID NOT HOLD IT: the limit here
 * was 200 against the other's 300, measured at 202 characters against 249 on one 249 character
 * input, so one document produced two different notes in two files that describe it. The number is
 * the other one's because the other one has a reason: 300 is the practical ceiling of an HTML meta
 * description and of a share card, which is the second consumer that function serves and this one
 * has none of. What both serve is the note beside a link in `llms.txt`, and two files describing
 * one document must not cut its description in two places.
 *
 * IT DOES NOT REMOVE CONTROL CHARACTERS AND MUST NOT BE ASKED TO. That is `plainArtefactText` in
 * `@openref/core`, applied once at the artefact boundary per SPEC 19.1, and the whole point of that
 * rule is that it is not applied per interpolation.
 */

/**
 * Longest a note may be before it is cut at a word boundary.
 *
 * 300, WHICH IS `DESCRIPTION_LIMIT` IN `@openref/static`, per the header of this file.
 */
export const SUMMARY_LIMIT = 300;

/**
 * One markdown string as a single line of prose.
 *
 * @param markdown - The description as the document wrote it
 * @returns The same text with markdown removed, whitespace collapsed, and cut to the limit
 *
 * @example
 * plainSummary('Returns the `Order`.\n\nSee [docs](https://x).'); // 'Returns the Order. See docs.'
 */
export function plainSummary(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= SUMMARY_LIMIT) return text;

  const cut = text.slice(0, SUMMARY_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trimEnd()}...`;
}

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

/**
 * The two characters a link cannot be opened without, removed rather than escaped.
 *
 * REMOVAL, AND THE CHOICE WAS MEASURED RATHER THAN REASONED, per SPEC 18.1. The first form of this
 * rule backslash-escaped five characters by the letter of CommonMark, and driving it through this
 * repository's own `createMarkdownRenderer` refused it: `- [Order … - \[Ghost\](ghost)](/docs/…)`
 * rendered as `<a href="/docs/…">Order … - </a><a href="ghost">Ghost</a>`, so the renderer closed
 * the outer link early and built the forged one anyway. A rule that holds against the format's
 * specification and not against the renderer this project renders with is not a rule.
 *
 * SO IT TAKES SPEC 19.1'S OWN ANSWER FOR A PLAIN TEXT ARTEFACT: not carrying the character at all.
 * Markup can isolate and JSON can escape; plain text can do neither, which is the reasoning that
 * section already states for control characters. Without an unescaped `[` … `]` pair there is
 * nothing to open an inline link, a reference link or an image with, under any renderer.
 *
 * PARENTHESES AND ANGLE BRACKETS ARE LEFT ALONE, each for its own reason. A parenthesis with no
 * bracket pair before it opens nothing. An angle bracket would close the autolink form, but GFM
 * makes a link of a bare URL without one, and removing it would turn a version like `>=1.0` into
 * something else: a rule that breaks a value to reach a form already covered costs more than it
 * gives.
 */
const LINK_SYNTAX = /[[\]]/gu;

/**
 * One document value as text that cannot create a line or a link of its own.
 *
 * THE HALF `plainSummary` ALREADY DID FOR TWO POSITIONS, EXTENDED TO THE OTHERS, per SPEC 18.1 as
 * `T059` wrote it. Both files are line oriented and their reader splits on newlines, so a value the
 * document wrote that carries one does not produce a mangled line, it produces extra records.
 * Measured before the fix: a document whose `info.title`, `info.version`, `operationId`, first tag
 * and schema name each carried `\nInjected line\n## Operations\n\n- [Ghost](ghost)` produced an
 * `llms.txt` with six `##` headings where the generator writes three, and three `Ghost` rows naming
 * an operation the document does not declare, at an address the reference does not serve.
 *
 * IT IS NOT `plainArtefactText` AND DOES NOT REPLACE IT. That runs once over the finished artefact
 * and removes what a plain text artefact may not carry, deliberately including U+2028 and U+2029
 * because they forge a line; the line feed itself is exempt there because it is the generator's own
 * structure. The exemption is right for the artefact and wrong for a value inside it, so the
 * boundary is the source of the text rather than the character, and this is the per value half.
 *
 * IT IS NOT `plainSummary` EITHER, because these are names and not prose: a title cut at 300
 * characters with an ellipsis would be a title no page shows, and markdown stripped out of an
 * `operationId` would be an identifier that identifies nothing.
 *
 * BOUNDING THE LINE WAS NOT ENOUGH AND THE SECOND HALF ARRIVED WITH THE BLIND REVIEW OF `T059`. A
 * collapsed value still carries link syntax into a line that is itself a link row, and CommonMark
 * does not nest links, so `- [Order … - [Ghost](ghost)](/docs/schema/…)` renders the inner one and
 * drops the outer. Measured with this repository's own `createMarkdownRenderer` rather than
 * reasoned: the forged document produced three `<a href="ghost">` anchors in the rendered
 * `llms.txt`. So a document value is neutralized as well as flattened, and the two happen in one
 * function because a value that reached only one of them is the defect twice.
 *
 * @param value - A value the document wrote
 * @returns The value on one line, with the characters that open a link removed
 *
 * @example
 * oneLine('Orders\n## Operations'); // 'Orders ## Operations'
 * @example
 * oneLine('[Ghost](ghost)'); // 'Ghost(ghost)'
 */
export function oneLine(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/gu, ' ')
    .replace(LINK_SYNTAX, '')
    .trim();
}

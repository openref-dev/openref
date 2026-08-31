/**
 * What a document's text may carry into an artefact that has no syntax to escape into.
 *
 * SPEC 19.1's ISOLATION RULE IS THE MARKUP HALF OF ONE RULE, and this is the other half. A
 * rendered page answers a bidirectional override with `unicode-bidi: isolate` because it has an
 * element to put the property on. `llms.txt` has no element, and neither does the text `doctor`,
 * `lint` and `diff` print, nor the body of a pull request comment; `T043` measured NUL, C0
 * controls, ESC and U+202E travelling out of a specification into `llms.txt` exactly as written.
 * A terminal reads ESC as a control sequence rather than as text, and an override reorders the
 * line it lands on, so a finding about `/v1/attack` can be made to read as one about `/v1/refund`.
 *
 * REMOVAL RATHER THAN ESCAPING, AND THAT IS ABOUT THE FORMAT RATHER THAN ABOUT STRICTNESS. Markup
 * isolates because it can; JSON escapes because it can, and what it escapes is parsed back into a
 * string that reaches markup, which isolates. Plain text can do neither, so it gets the property
 * by not carrying the characters at all.
 */

/**
 * The Unicode bidirectional controls, the whole set.
 *
 * THE SAME TWELVE THE `text-source` GATE NAMES, because the vocabulary for this is one. An
 * unterminated embedding reorders exactly as an override does, and the marks and the isolates are
 * the same invisible character in the same position, so a rule that knew one spelling would let
 * eleven through.
 */
export const BIDI_CONTROL_CODE_POINTS: readonly number[] = [
  0x061c, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
];

/**
 * Everything a plain text artefact will not carry.
 *
 * C0 EXCEPT THE LINE FEED, which every artefact here uses as its own structure, plus DEL and the
 * C1 range, plus the twelve above. The tab is gone with the rest of C0: nothing this project
 * emits writes one, so a tab in an artefact came from a document, and a document that indents a
 * summary is not describing an API.
 *
 * AND U+2028 AND U+2029 WITH THEM, which are not controls and are here anyway. They are the only
 * two characters outside C0 that a text consumer treats as ending a line, so in a line oriented
 * artefact such as `llms.txt` they forge a line exactly as a line feed would, which is the harm
 * this whole function is about.
 */
const REMOVED_CLASS = `[\\u0000-\\u0009\\u000b-\\u001f\\u007f-\\u009f\\u2028\\u2029${BIDI_CONTROL_CODE_POINTS.map(
  (point) => `\\u${point.toString(16).padStart(4, '0')}`,
).join('')}]`;

/** For replacing, so every occurrence goes. */
const REMOVED_ALL = new RegExp(REMOVED_CLASS, 'gu');

/**
 * For asking, and a second object rather than the one above on purpose: a global regular
 * expression carries `lastIndex` between calls, so `test` on a shared one answers about where the
 * previous call stopped rather than about the string it was given.
 */
const REMOVED_ANY = new RegExp(REMOVED_CLASS, 'u');

/**
 * One string as a plain text artefact may carry it.
 *
 * APPLIED AT THE ARTEFACT RATHER THAN AT EACH INTERPOLATION, deliberately. A renderer builds its
 * text out of a dozen document values, and a rule applied a dozen times is a rule that is one
 * forgotten call site away from being false. Applied once to the finished text it covers every
 * value the artefact carries, including the ones added later, and the only characters it can take
 * from the renderer's own structure are ones the renderer does not write.
 *
 * @param text - The artefact's finished text
 * @returns The same text with every control character and bidirectional control removed
 *
 * @example
 * // The override is written as an escape, per SPEC 19.1: a literal one in a source file is
 * // refused by the `text-source` gate, and this file is exactly about why.
 * plainArtefactText(`GET /v1/\u202Edanger`); // 'GET /v1/danger'
 */
export function plainArtefactText(text: string): string {
  return text.replace(REMOVED_ALL, '');
}

/**
 * Whether a string carries anything {@link plainArtefactText} would remove.
 *
 * FOR THE PRESENCE HALF OF A PROOF OF ABSENCE. A test that only checks an artefact is clean
 * cannot tell a rule that worked from an input that never reached it, so the suites assert with
 * this that the document's own strings carry the bytes before asserting the artefact does not.
 *
 * @param text - Any string
 * @returns True when at least one character would be removed
 */
export function carriesControlCharacters(text: string): boolean {
  return REMOVED_ANY.test(text);
}

/**
 * THE PER VALUE HALF OF THIS FILE, MOVED HERE FROM `@openref/agent` BY `T062`.
 *
 * `plainArtefactText` above runs once over a finished artefact and exempts the line feed, because
 * there the line feed is the generator's own structure. Inside a value the document wrote it is
 * not, and the two rules therefore differ by their subject rather than by their character set. It
 * lived in `@openref/agent` because that is where the file that needed it was written; the ruling
 * of SPEC 16.1 and SPEC 18.1 gave the static build's `llms.txt` the same rule, and a second
 * spelling of it in `@openref/static` would be the very duplication that ruling exists to end.
 * `@openref/agent` still exports the name, and reads it from here.
 */

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

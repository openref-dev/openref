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

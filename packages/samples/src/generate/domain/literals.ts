/**
 * String literals, one escaper per family of language, because a sample that will not parse is
 * worse than no sample.
 *
 * WHY THERE IS NO SINGLE ESCAPER. A JSON literal is accepted by four of these languages and not by
 * two. Rust spells a code point escape with braces and rejects the plain four digit form, so a
 * body carrying a control character would not compile. Ruby evaluates an interpolation opener
 * inside a double quoted string, so a body carrying one would send something the reader never
 * wrote. Both failures are silent in the sense that matters: nothing in the generator notices.
 *
 * NON ASCII IS LEFT ALONE, deliberately. Every language here reads UTF-8 source, and turning a
 * name a reader recognises into a run of code point escapes makes a sample they cannot check by
 * eye.
 */

/** Characters every double quoted form escapes the same way. */
const COMMON: ReadonlyMap<string, string> = new Map([
  ['\\', '\\\\'],
  ['"', '\\"'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
]);

/** Whether a character has to be escaped as a code point rather than passed through. */
function isControl(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;

  return code < 0x20 || code === 0x7f;
}

/**
 * A double quoted literal, with the escape for a control character supplied by the caller.
 *
 * @param text - The text to quote
 * @param escapeCode - How this language spells the escape of one code point
 * @param extra - Characters this language escapes beyond the common set
 * @returns The literal, quotes included
 */
function quoteDouble(
  text: string,
  escapeCode: (code: number) => string,
  extra: ReadonlyMap<string, string> = new Map(),
): string {
  let out = '';

  for (const character of text) {
    const mapped = extra.get(character) ?? COMMON.get(character);
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }

    out += isControl(character) ? escapeCode(character.codePointAt(0) ?? 0) : character;
  }

  return `"${out}"`;
}

/** Four hex digits, which is what the plain code point escape takes. */
function hex4(code: number): string {
  return code.toString(16).padStart(4, '0');
}

/**
 * A literal for the languages that spell a code point escape with four hex digits.
 *
 * TypeScript, Python, Go, Java and C# all read that form. The two line terminators never reach it,
 * because they are in the common map above: Java's lexer expands a code point escape before it
 * parses, so a newline written that way would end the literal and break the source.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quoteUnicode(text: string): string {
  return quoteDouble(text, (code) => `\\u${hex4(code)}`);
}

/** Braced hex, which is what Rust demands and what Swift also reads. */
function braced(code: number): string {
  return `\\u{${code.toString(16)}}`;
}

/**
 * A Rust literal.
 *
 * Rust spells a code point escape with braces and rejects the four digit form, so it cannot share
 * the escaper above.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quoteRust(text: string): string {
  return quoteDouble(text, braced);
}

/**
 * A Swift literal.
 *
 * TWO NAMES FOR ONE FORM RATHER THAN ONE NAME FOR TWO LANGUAGES. Swift spells a code point escape
 * with braces exactly as Rust does, so both call {@link braced}; they are separate exports because
 * the day either language's escaping has to move, it moves without touching the other, and a caller
 * reading `quoteRust` inside the Swift emitter would have to check whether that was deliberate.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quoteSwift(text: string): string {
  return quoteDouble(text, braced);
}

/** What Kotlin and Dart escape beyond the common set: the character that opens a template. */
const DOLLAR_EXTRA: ReadonlyMap<string, string> = new Map([['$', '\\$']]);

/**
 * A Kotlin literal.
 *
 * A dollar sign inside a Kotlin string opens a template expression, which is the same failure Ruby
 * has with an interpolation opener: an unescaped one is a sample that sends something the reader
 * never wrote, or does not compile at all. A JSON body carrying a price in dollars reaches this
 * every day.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quoteKotlin(text: string): string {
  return quoteDouble(text, (code) => `\\u${hex4(code)}`, DOLLAR_EXTRA);
}

/**
 * A Dart literal.
 *
 * Dart interpolates on a dollar sign for the same reason Kotlin does, and reads the four digit code
 * point escape, so it shares the extra map and not the escaper's brace form.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quoteDart(text: string): string {
  return quoteDouble(text, (code) => `\\u${hex4(code)}`, DOLLAR_EXTRA);
}

/**
 * A PowerShell single quoted literal.
 *
 * SINGLE QUOTED FOR THE REASON PHP IS. A double quoted PowerShell string expands `$name` and
 * `$(...)`, and a subexpression inside an argument is a command the reader did not ask to run. A
 * single quoted string expands nothing at all and has exactly one escape, the doubled quote.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quotePowerShell(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** What Ruby escapes beyond the common set: the character that opens an interpolation. */
const RUBY_EXTRA: ReadonlyMap<string, string> = new Map([['#', '\\#']]);

/**
 * A Ruby literal.
 *
 * An interpolation inside a double quoted Ruby string is code, so an unescaped opener in a body is
 * a sample that sends something the reader did not write, or does not run at all.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quoteRuby(text: string): string {
  return quoteDouble(text, (code) => `\\u${hex4(code)}`, RUBY_EXTRA);
}

/**
 * A PHP single quoted literal.
 *
 * PHP interpolates variables in a double quoted string and escapes exactly two characters in a
 * single quoted one, so the single quoted form is both safer and shorter here. Newlines are
 * literal inside it, which is legal and is what a JSON body looks like anyway.
 *
 * @param text - The text to quote
 * @returns The literal, quotes included
 */
export function quotePhp(text: string): string {
  return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/**
 * A POSIX shell single quoted word.
 *
 * A single quoted word in `sh` has no escapes at all, so the only thing that can end it is the
 * quote itself, and the standard way out is to close, escape and reopen. Everything else, a
 * newline, a dollar sign, a backtick, is literal, which is why this form and not a double quoted
 * one: a command substitution inside a double quoted argument is a command a reader did not ask to
 * run.
 *
 * @param text - The text to quote
 * @returns The quoted word
 */
export function quoteShell(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

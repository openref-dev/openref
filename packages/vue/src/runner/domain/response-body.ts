/**
 * The bytes a response arrived as, made readable without being made up.
 *
 * WHY A THEME NEEDS THIS AND CANNOT WRITE IT ITSELF. Both shipped themes draw the response body,
 * and both drew it as the raw wire string: a minified JSON object on one line, scrolling
 * sideways, beside a request body example the same page had already indented for the reader.
 * The asymmetry was not a decision, it was the absence of one.
 *
 * IT IS INDENTATION AND NOTHING ELSE, and the two things it must never become are named here
 * because both are reachable from this file. It does not highlight: the highlighter is a server
 * dependency and `client-bundle.spec.ts` reads the built bundle to prove it never crosses. It
 * does not produce markup: the body is a third party string, so it stays a text child that Vue
 * escapes, and `try-it.spec.ts` plants a script tag in a response to prove nothing on this path
 * reaches `innerHTML`.
 *
 * A BODY THAT IS NOT JSON COMES BACK EXACTLY AS IT ARRIVED. HTML, a stack trace, a CSV, a
 * protobuf rendered as mojibake: a formatter that assumed would corrupt the one thing a reader
 * opened the console to see. The parse is the test, and its failure is the answer.
 *
 * WHAT IT DOES CHANGE, SAID RATHER THAN HIDDEN. A JSON body is re-serialized from the value the
 * parse produced, so a number literal that does not survive IEEE 754 does not survive this
 * either: `12345678901234567890` comes back rounded and `1e400` comes back as `null`. That is a
 * real loss of fidelity on a real class of body, and it is written down rather than papered
 * over. The alternative, a whitespace-only walk over the original text, preserves every literal
 * exactly and costs several hundred bytes of a chunk with a cap on it; it is the right answer
 * the day a reader reports it, and this note is what that reader's report will point at.
 */

/**
 * A response body with JSON re-indented and anything else untouched.
 *
 * @param body - The body exactly as the runner received it
 * @returns The body, indented when it is JSON and unchanged when it is not
 *
 * @example
 * prettyResponseBody('{"id":1}'); // '{\n  "id": 1\n}'
 * prettyResponseBody('<html>');   // '<html>'
 */
export function prettyResponseBody(body: string): string {
  // `JSON.parse` throws on anything that is not JSON, and that throw is the whole test. It can
  // never answer `undefined`, so the re-serialization is a string and needs no fallback of its
  // own; the only way out of here with the original text is the catch.
  try {
    return JSON.stringify(JSON.parse(body) as unknown, null, 2);
  } catch {
    return body;
  }
}

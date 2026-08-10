/**
 * Text to markup, in the two places markup is assembled as a string.
 *
 * Vue escapes everything it renders, so these are needed only by the highlighter, which
 * builds token spans, and by the shell, which builds the document around the app. Both are
 * the boundary where a mistake becomes an injection, so they share one implementation
 * rather than each having its own nearly right one.
 */

/**
 * Escapes text for use as element content or as an attribute value.
 *
 * All five characters are escaped in both positions. Splitting the two cases would save
 * nothing and would introduce the question of which function a given call site needs.
 *
 * @param text - Arbitrary text
 * @returns The same text with `&`, `<`, `>`, `"` and `'` replaced by references
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes JSON for embedding in a `script` element.
 *
 * An HTML parser looks for the literal `</script` inside a script element and ends the
 * element there, whatever the JSON grammar thinks. `<` is the same string to a JSON
 * parser and is invisible to the HTML one, so escaping every `<` closes the hole without
 * a special case for the sequence that happens to trigger it today.
 *
 * @param json - Serialized JSON
 * @returns The same JSON with every `<` written as an escape
 */
export function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

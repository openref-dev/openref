/**
 * Which class an HTTP status code takes.
 *
 * ONE HOME, BECAUSE TWO COLUMNS SHOW THE SAME CODE. The responses the specification documents
 * and the error contracts the application declares stand side by side on an operation page, and
 * a 404 that is one colour on the left and another on the right would say the two are different
 * kinds of thing. It lives here rather than in either of them because one caller is the page
 * model, which runs only on the server, and the other is a component, which runs in both places.
 */

/**
 * @param status - Status code as a string, which is how a document writes it
 * @returns The class name, `oref-status-default` for anything that is not 1xx to 5xx
 */
export function statusClass(status: string): string {
  const first = status.slice(0, 1);

  return /^[1-5]$/.test(first) ? `oref-status-${first}xx` : 'oref-status-default';
}

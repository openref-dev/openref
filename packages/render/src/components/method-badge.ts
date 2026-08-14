/**
 * The method badge's class, in one place for the three surfaces that draw it.
 *
 * The rail row, the operation header and the bench head all badge an operation, and since
 * `TX-PARITY-UI` all three draw `SSE` for an operation whose declared responses carry
 * `text/event-stream`: the badge is the design's identity mark, the method stays a fact on
 * the model, and three copies of the class table would disagree the day a method is added.
 */

/** Methods with a class of their own in the theme's vocabulary. */
const KNOWN_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * @param method - Uppercase HTTP method
 * @param sse - Whether the operation declares `text/event-stream`
 * @returns The badge's text and class
 */
export function methodBadge(method: string, sse: boolean): { text: string; className: string } {
  if (sse) return { text: 'SSE', className: 'oref-method-sse' };

  return {
    text: method,
    className: KNOWN_METHODS.includes(method)
      ? `oref-method-${method.toLowerCase()}`
      : 'oref-method-other',
  };
}

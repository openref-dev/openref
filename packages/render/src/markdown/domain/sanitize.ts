/**
 * The one place HTML becomes safe to put into the page.
 *
 * Everything that ends up as `innerHTML` passes through here: prose written in a
 * specification description, and the markup this package produces for a highlighted code
 * block. One sanitizer on one path is the point. A second, "trusted" path would be the
 * place a future change quietly stops sanitizing.
 *
 * The configuration is an allowlist rather than a denylist, per SPEC 19.1. A denylist
 * answers "what do we know is dangerous today", which is a question that ages.
 */

import DOMPurify from 'isomorphic-dompurify';

/**
 * Elements a specification description or a highlighted code block may produce.
 *
 * This is the output set of a markdown renderer plus the two elements the highlighter
 * emits, and nothing else. `style`, `script`, `iframe`, `object`, `embed`, `form` and the
 * whole of SVG and MathML are absent on purpose rather than by omission.
 */
export const ALLOWED_TAGS: readonly string[] = [
  'a',
  'abbr',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'ins',
  'kbd',
  'li',
  'ol',
  'p',
  'pre',
  'q',
  'samp',
  'span',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
  'var',
];

/**
 * Attributes those elements may carry.
 *
 * `style` is absent because a nonce can never authorize a style attribute, which is the
 * constraint the whole project is built around. `target` is absent because a link that
 * opens elsewhere is a decision the document author should not be making for the host
 * page. Data attributes are off wholesale, with the one the highlighter needs named here.
 */
export const ALLOWED_ATTRIBUTES: readonly string[] = [
  'alt',
  'class',
  'colspan',
  'data-oref-lang',
  'dir',
  'href',
  'id',
  'lang',
  'rowspan',
  'scope',
  'src',
  'start',
  'title',
];

/** Elements refused even if some future edit adds them to the allowlist by accident. */
export const FORBIDDEN_TAGS: readonly string[] = [
  'base',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'object',
  'script',
  'style',
  'svg',
  'template',
  'textarea',
];

/** Attributes refused for the same reason, `style` above all. */
export const FORBIDDEN_ATTRIBUTES: readonly string[] = [
  'formaction',
  'ping',
  'srcset',
  'style',
  'target',
];

/**
 * Removes everything a strict policy could not authorize from a fragment of HTML.
 *
 * Whether an image that survives sanitization is actually loaded is a question for the
 * `img-src` directive of the host policy, not for this function. A sanitizer answers "can
 * this execute", and answering "may this reach the network" here would silently make a
 * network policy decision on the operator's behalf.
 *
 * @param html - Untrusted HTML, from a specification document or from our own renderer
 * @returns The same fragment with every disallowed element and attribute removed
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    FORBID_TAGS: [...FORBIDDEN_TAGS],
    FORBID_ATTR: [...FORBIDDEN_ATTRIBUTES],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
    RETURN_DOM: false,
    RETURN_DOM_FRAGMENT: false,
  });
}

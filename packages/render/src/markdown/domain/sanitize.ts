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

import { DOCUMENT_LINK_SCHEMES } from '@openref/core/security';
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
 * The namespace this project's own interface lives in, per SPEC 19.1.
 *
 * Untrusted markup may not enter it. `class` and `id` were on the allowlist above with their
 * values unfiltered, so a description could write `<div class="oref-palette-scrim">` and cover
 * the viewport with an element the theme positions `fixed; inset: 0`, without a script and
 * without an inline style, leaving every existing proof passing. Found as F4.
 */
const INTERFACE_NAMESPACE = 'oref-';

/**
 * The only classes in that namespace untrusted markup may carry.
 *
 * These are what the markdown pipeline of this package puts on a highlighted code block, and
 * one sanitizer runs over both the prose and that output, so they cannot simply be dropped.
 * The set is closed and small because it is the output of one module. It is deliberately NOT a
 * list of the theme's classes: keeping such a list correct would mean auditing every class the
 * theme ever ships, and the two would drift apart in silence.
 */
export const ALLOWED_NAMESPACED_CLASSES: readonly string[] = ['oref-code'];

/** Prefix of the per token classes the highlighter emits, all of them colour or font style. */
export const ALLOWED_NAMESPACED_CLASS_PREFIX = 'oref-hl-';

function keepsClassToken(token: string): boolean {
  if (!token.startsWith(INTERFACE_NAMESPACE)) return true;
  if (ALLOWED_NAMESPACED_CLASSES.includes(token)) return true;
  return token.startsWith(ALLOWED_NAMESPACED_CLASS_PREFIX);
}

/**
 * What this hook needs of a node, structurally.
 *
 * Written out rather than taken from `lib.dom`, because this package builds without the DOM
 * library: it renders on the server as well, and `core` and the render pipeline are checked
 * against a configuration that has no `Element` in it.
 */
interface AttributeCarrier {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Strips this project's namespace out of one element's attributes.
 *
 * Runs as a DOMPurify hook rather than over the output text, so it sees attribute values as
 * the parser understood them rather than as markup that still has to be parsed. Registered
 * once, at import, because there is one sanitizer and it is this module's whole purpose.
 */
function stripInterfaceNamespace(node: unknown): void {
  const element = node as AttributeCarrier;

  const classList = element.getAttribute('class');
  if (classList !== null) {
    const kept = classList
      .split(/\s+/)
      .filter((token: string) => token !== '' && keepsClassToken(token));
    if (kept.length === 0) element.removeAttribute('class');
    else element.setAttribute('class', kept.join(' '));
  }

  const id = element.getAttribute('id');
  if (id?.startsWith(INTERFACE_NAMESPACE) === true) {
    // Removed whole rather than filtered: an id is one value, and the pipeline emits none, so
    // there is nothing in this namespace an untrusted fragment could legitimately want.
    element.removeAttribute('id');
  }
}

DOMPurify.addHook('afterSanitizeAttributes', stripInterfaceNamespace);

/**
 * Removes everything a strict policy could not authorize from a fragment of HTML.
 *
 * Whether an image that survives sanitization is actually loaded is a question for the
 * `img-src` directive of the host policy, not for this function. A sanitizer answers "can
 * this execute", and answering "may this reach the network" here would silently make a
 * network policy decision on the operator's behalf.
 *
 * It also answers "can this take the page", which it did not before T016. That is a separate
 * question from execution and it has a separate mechanism, per SPEC 19.1.
 *
 * THE SCHEME LIST IS THIS PROJECT'S RATHER THAN THE SANITIZER'S DEFAULT, since the pre-M4 review.
 * Setting nothing left the answer to whatever `DOMPurify` ships, which is a list that moves with a
 * version bump: measured on the version installed then, `ftp:`, `tel:`, `sms:`, `callto:`, `cid:`,
 * `xmpp:` and `matrix:` survived in an `href` and nobody had decided they should. The dangerous
 * ones were all refused, so this is not a hole being closed; it is an allowlist that belongs to
 * whoever wrote the page becoming one, so that what a document may link to changes when this
 * project changes it and not when a dependency does.
 *
 * ONE THING THE SCHEME LIST DELIBERATELY DOES NOT REACH, MEASURED RATHER THAN ASSUMED: a `data:`
 * url still survives on `img` and the other media tags, because the sanitizer admits those
 * separately from this list. It is left that way. A browser runs no script in an image it loaded,
 * so `data:image/svg+xml` carrying an `onload` is inert there, and refusing it would take inline
 * images away from every document that embeds one. Whether such an image loads at all is the host
 * policy's `img-src` question, which is the same boundary the paragraph above draws.
 *
 * @param html - Untrusted HTML, from a specification document or from our own renderer
 * @returns The same fragment with every disallowed element and attribute removed
 */
export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES],
    ALLOWED_URI_REGEXP: DOCUMENT_LINK_SCHEMES,
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

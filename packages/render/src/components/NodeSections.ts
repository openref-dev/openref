/**
 * The two static sections of a node page that are not slots: description and security.
 *
 * SERVER ONLY SINCE `TX-ADOPT`. Both are markup over model fields with no state, no handler and
 * nothing the browser recomputes, so the browser fills their positions with childless elements
 * that adopt what the server drew, and this module is imported by `eager.ts` alone. They lived
 * inline in `NodePanel` until the adoption model made the composition resolve them through the
 * deferrable registry, the same move the Health panel made in session 40.
 *
 * THEY ARE POSITIONS AND NOT SLOTS, deliberately: the registry is 21 names by decision (SPEC
 * 10.4), and a theme that wants other security markup owns the page composition through
 * `AppShell` or waits for the registry to grow by a minor version. What moved here is where the
 * markup is drawn, not who may replace it.
 */

import { h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import type { SecurityModel } from '@openref/vue';

/**
 * The description section, with its heading and the rendered paragraph count.
 *
 * THE COUNT IS THE RENDERED PARAGRAPHS, per the layout and `TX-PARITY-UI`: what a reader
 * scrolls past. A description with no break still counts its one block.
 *
 * @param props - The sanitized description HTML
 * @returns The section
 */
export function NodeDescription(props: { readonly html: string }): VNode {
  const paragraphs = Math.max(1, (props.html.match(/<p[\s>]/g) ?? []).length);

  return h('section', { class: 'oref-section oref-section-description' }, [
    h('h2', { class: 'oref-section-title' }, [
      'Description ',
      h(
        'span',
        { class: 'oref-section-count' },
        `${String(paragraphs)} ${paragraphs === 1 ? 'paragraph' : 'paragraphs'}`,
      ),
    ]),
    h(MarkdownBlock, { html: props.html }),
  ]);
}

/**
 * The security section: the declared requirements, one row per scheme.
 *
 * Drawn only when there is no parity scale carrying the same assertion, which is `drawnOf`'s
 * condition and not this component's: the authentication and scopes rows are where the
 * requirement stands when runtime exists, per `TX-GUTTER`.
 *
 * @param props - The declared requirements
 * @returns The section
 */
export function NodeSecurity(props: { readonly security: readonly SecurityModel[] }): VNode {
  return h('section', { class: 'oref-section oref-section-security' }, [
    h('h2', { class: 'oref-section-title' }, 'Security'),
    h(
      'ul',
      { class: 'oref-security-list' },
      props.security.map((requirement) =>
        h('li', { class: 'oref-security-item', key: requirement.schemeId }, [
          h('code', {}, requirement.schemeId),
          h('span', { class: 'oref-security-type' }, requirement.type),
          requirement.scopes.length === 0
            ? null
            : h('span', { class: 'oref-security-scopes' }, requirement.scopes.join(', ')),
        ]),
      ),
    ),
  ]);
}

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
 * HANDED AN EMPTY LIST IT DRAWS ITS HEADING AND NO ROWS, WHICH THE SERVER NEVER ASKS FOR AND A
 * THEME COMPOSING THE PAGE ITSELF CAN. `drawnOf` gates this section on `security.length > 0`, so
 * nothing this package renders reaches that state; a theme that owns the page through `AppShell`
 * and mounts this position with an empty list gets a heading over nothing. That is left as it is
 * rather than guarded here, because it is how every sibling section behaves: `NodeDescription`
 * below, and `ChannelOperations` and `MessageList` in `ChannelSections.ts`, all draw their heading
 * unconditionally and are gated by the same walk. A guard on this one alone would make one section
 * of four disappear where the other three draw an empty block, which is a difference a theme
 * author would have to learn rather than derive. The rows themselves are still absent rather than
 * an empty list, per `securityList`, since a `ul` with no `li` in it is markup about nothing.
 *
 * @param props - The declared requirements
 * @returns The section
 */
export function NodeSecurity(props: { readonly security: readonly SecurityModel[] }): VNode {
  return h('section', { class: 'oref-section oref-section-security' }, [
    h('h2', { class: 'oref-section-title' }, 'Security'),
    securityList(props.security),
  ]);
}

/**
 * The requirements of one position as a list of rows, or nothing at all when there are none.
 *
 * ONE RENDERER FOR EVERY POSITION, per SPEC 8.2. An HTTP operation, an event server and an event
 * operation all name schemes out of one table, so they draw one row shape; a second copy here is
 * how two pages come to disagree about what a requirement says.
 *
 * NULL RATHER THAN AN EMPTY LIST, which is what lets a caller draw nothing. A channel whose server
 * and whose operations said nothing about security draws no row and no heading: an empty Security
 * block over a channel with no security is a picture of a posture the document does not have,
 * which is the reading SPEC 8.2 twice refused to publish.
 *
 * WHAT A ROW SAYS IS WHAT THE SCHEME SAYS. The name the document filed the scheme under, its type
 * out of the thirteen AsyncAPI names and the five OpenAPI ones, where the key travels when the
 * scheme declares a location, and the scopes when there are any. Nothing is composed out of
 * absence: a `plain` requirement draws its type alone.
 *
 * @param security - The requirements of one position
 * @returns The list, or null when the position named none
 */
export function securityList(security: readonly SecurityModel[]): VNode | null {
  if (security.length === 0) return null;

  return h(
    'ul',
    { class: 'oref-security-list' },
    security.map((requirement) =>
      h('li', { class: 'oref-security-item', key: requirement.schemeId }, [
        h('code', {}, requirement.schemeId),
        h('span', { class: 'oref-security-type' }, requirement.type),
        requirement.in === ''
          ? null
          : h(
              'span',
              { class: 'oref-security-where' },
              requirement.name === '' ? requirement.in : `${requirement.in} ${requirement.name}`,
            ),
        requirement.scopes.length === 0
          ? null
          : h('span', { class: 'oref-security-scopes' }, requirement.scopes.join(', ')),
      ]),
    ),
  );
}

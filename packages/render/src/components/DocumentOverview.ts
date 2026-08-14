/**
 * The document overview: the page a reader lands on.
 *
 * IT IS A SLOT SINCE `TX-SLOTWIRE`, AND THE REASON IS ARITHMETIC. A reader can open three kinds
 * of page and the registry named components for one of them. A theme that could replace every
 * part of a node page and nothing at all of the page a reader arrives at is a contract with a
 * hole in the middle, and adding the name is cheap now and a major version later.
 *
 * THE HEALTH PANEL ARRIVES AS CHILDREN. It is a position of its own, `HealthScore`, and it is the
 * one that renders on the server and is adopted rather than drawn in the browser, per SPEC 7.2.
 * Passing it in means a theme that replaces this page keeps it without knowing any of that.
 */

import { h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';

/**
 * Renders the overview of one document.
 *
 * @param props - What the document says about itself
 * @param context - Vue's second argument, for the children this position is handed
 * @returns The article
 */
export function DocumentOverview(
  props: {
    readonly title: string;
    readonly descriptionHtml: string;
    readonly servers: readonly string[];
    readonly basePath: string;
  },
  context: { readonly slots: { default?: () => VNode[] } },
): VNode {
  return h('article', { class: 'oref-overview' }, [
    h('h1', { class: 'oref-title' }, props.title),
    h(MarkdownBlock, { html: props.descriptionHtml }),
    props.servers.length === 0
      ? null
      : h('section', { class: 'oref-section oref-section-servers' }, [
          h('h2', { class: 'oref-section-title' }, 'Servers'),
          h(
            'ul',
            { class: 'oref-server-list' },
            props.servers.map((url) =>
              h('li', { class: 'oref-server', key: url }, [h('code', {}, url)]),
            ),
          ),
        ]),
    // THE HEALTH PANEL LIVES HERE AND NOWHERE ELSE, per SPEC 7.3. The report is a statement
    // about the whole document and this is the page about the whole document; a node page shows
    // the same report one subject at a time, inside its runtime block. It is absent rather than
    // scored zero when nothing measured the document, which is the same rule as the runtime
    // block's: nobody asked and nothing is claimed.
    ...(context.slots.default?.() ?? []),
  ]);
}

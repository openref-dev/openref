import { h, type VNode } from 'vue';

/**
 * The overview: what the document says about itself, its servers, and the Health panel.
 *
 * THE HEALTH PANEL ARRIVES AS CHILDREN AND IS NOT DRAWN FROM DATA HERE. It is a position of its
 * own, `HealthScore`, resolved during the server render, so this one places it and never inspects
 * it. A theme that forgot to render its children would drop the panel and the page would look
 * finished, which is why the reference's own overview draws the same way.
 *
 * The description is HTML the server rendered and sanitized, per SPEC 12, so it is set rather than
 * parsed here. There is no second sanitizer in a theme and there must not be: two sanitizers is
 * one policy nobody owns.
 */
export default function DocumentOverview(
  props: {
    readonly title: string;
    readonly descriptionHtml: string;
    readonly servers: readonly string[];
    readonly basePath: string;
  },
  context: { readonly slots: { readonly default?: () => VNode[] } },
): VNode {
  return h('article', { class: 'tt-overview' }, [
    h('h1', { class: 'tt-overview-title' }, props.title),
    props.descriptionHtml === ''
      ? null
      : h('div', { class: 'tt-overview-prose tt-prose', innerHTML: props.descriptionHtml }),
    props.servers.length === 0
      ? null
      : h('section', { class: 'tt-strip-block' }, [
          h('h2', { class: 'tt-strip-head' }, 'SERVERS'),
          h(
            'ul',
            { class: 'tt-server-list' },
            props.servers.map((server) =>
              h('li', { class: 'tt-server-row', key: server }, [
                h('code', { class: 'tt-server-url' }, server),
              ]),
            ),
          ),
        ]),
    h('div', { class: 'tt-overview-health' }, context.slots.default?.() ?? []),
  ]);
}

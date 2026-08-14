import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { entryHref } from '../links';
import type { NavEntryModel } from '@openref/vue';

/**
 * The tree, on the rail this theme keeps shut by default.
 *
 * Rows are one grid unit tall and the kind of every row is a three letter code in the gutter, so
 * the shape of a document is readable without reading any of it.
 *
 * A GROUP THAT SHIPPED NO CHILDREN IS OPENABLE AND SAYS SO. `childCount` above zero with an empty
 * `children` is a group whose contents did not travel with the page, and `load()` is the only way
 * to get them. A tree that tested `children.length` would draw it as an empty group, which is a
 * different statement and a wrong one.
 */
export default defineComponent({
  name: 'TelltaleNavTree',

  props: {
    entries: { type: Array as PropType<readonly NavEntryModel[]>, required: true },
    activeNodeId: { type: String as PropType<string | null>, default: null },
    activeSchemaId: { type: String as PropType<string | null>, default: null },
    basePath: { type: String, default: '' },
    complete: { type: Boolean, default: true },
    total: { type: Number, default: 0 },
    load: { type: Function as PropType<() => Promise<boolean>>, required: true },
  },

  setup(props) {
    const open = ref(new Set<string>());
    const loading = ref(false);
    const failed = ref(false);

    async function toggle(entry: NavEntryModel): Promise<void> {
      const next = new Set(open.value);
      if (next.has(entry.id)) next.delete(entry.id);
      else {
        next.add(entry.id);
        if (entry.children.length === 0 && entry.childCount > 0 && !props.complete) {
          loading.value = true;
          failed.value = !(await props.load());
          loading.value = false;
        }
      }
      open.value = next;
    }

    function row(entry: NavEntryModel, depth: number): VNode[] {
      const href = entryHref(entry, props.basePath);
      const active =
        (entry.nodeId !== null && entry.nodeId === props.activeNodeId) ||
        (entry.schemaId !== null && entry.schemaId === props.activeSchemaId);
      const expandable = entry.childCount > 0 || entry.children.length > 0;
      const expanded = open.value.has(entry.id);

      // The depth is a custom property on the row rather than a padding written inline, because an
      // inline style attribute cannot be authorized by a CSP nonce and this theme is served under
      // a policy without `unsafe-inline`. The stylesheet reads it.
      const attrs = {
        class: [
          'tt-nav-row',
          `tt-nav-depth-${String(Math.min(depth, 6))}`,
          active ? 'tt-nav-active' : null,
          entry.deprecated ? 'tt-nav-deprecated' : null,
        ],
      };

      const label = [
        h('span', { class: 'tt-nav-kind' }, entry.kind.slice(0, 3).toUpperCase()),
        h('span', { class: 'tt-nav-label' }, entry.label),
        entry.hint === '' ? null : h('span', { class: 'tt-nav-hint' }, entry.hint),
      ];

      const head = expandable
        ? h(
            'button',
            {
              ...attrs,
              type: 'button',
              'aria-expanded': expanded ? 'true' : 'false',
              onClick: (): void => {
                void toggle(entry);
              },
            },
            [h('span', { class: 'tt-nav-twist' }, expanded ? '-' : '+'), ...label],
          )
        : h(
            'a',
            { ...attrs, href: href ?? undefined, ...(active ? { 'aria-current': 'page' } : {}) },
            [h('span', { class: 'tt-nav-twist' }, ' '), ...label],
          );

      const children =
        expanded && entry.children.length > 0
          ? entry.children.flatMap((child) => row(child, depth + 1))
          : [];

      return [h('li', { class: 'tt-nav-item', key: entry.id }, [head, ...children])];
    }

    return (): VNode =>
      h('div', { class: 'tt-nav' }, [
        h(
          'ul',
          { class: 'tt-nav-list' },
          props.entries.flatMap((entry) => row(entry, 0)),
        ),
        h('p', { class: 'tt-nav-count' }, [
          h('span', { class: 'tt-nav-count-shown' }, String(props.entries.length)),
          h('span', { class: 'tt-nav-count-of' }, ' of '),
          h('span', { class: 'tt-nav-count-total' }, String(props.total)),
        ]),
        loading.value ? h('p', { class: 'tt-nav-loading' }, 'fetching the rest') : null,
        failed.value
          ? h('p', { class: 'tt-nav-failed' }, 'the rest of the tree could not be fetched')
          : null,
      ]);
  },
});

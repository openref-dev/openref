import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import TelltaleSectionIndex from './components/TelltaleSectionIndex';
import TelltaleStatusBar from './components/TelltaleStatusBar';
import type { PageKind } from '@openref/vue';

/**
 * The page shell of telltale, which is the `AppShell` position under its authoring name.
 *
 * Four regions on a fixed grid: a strip across the top, the tree on the left, the page in the
 * middle, a permanent section index on the right, and a bench line pinned to the bottom. The rail
 * is collapsed by default, which the handoff makes this theme's own choice rather than an option:
 * the main way through this reference is the palette, and the tree is there for when it is not.
 *
 * THREE REGIONS ARRIVE AS SLOTS AND THE PAGE IS ONE OF THEM. `nav` is the navigation tree,
 * `palette` is the search overlay, and the default slot is whichever of the three pages a reader
 * opened. Where they go is the whole of what a layout decides, and what is inside the default slot
 * is not something this component can see, reorder or take apart. That is the finding this theme
 * was written to produce and it is written up in `THEME-BOUNDARY.md`.
 *
 * THE RAIL TOGGLE IS CLIENT STATE AND IT STARTS IN THE SAME PLACE ON BOTH SIDES. The server draws
 * the rail collapsed and the first client render draws it collapsed, so the two agree; a shell
 * that read a stored preference during setup would be a hydration mismatch on the frame.
 */
export default defineComponent({
  name: 'TelltaleLayout',

  props: {
    title: { type: String, required: true },
    version: { type: String, required: true },
    basePath: { type: String, default: '' },
    activeNodeId: { type: String as PropType<string | null>, default: null },
    activeSchemaId: { type: String as PropType<string | null>, default: null },
    page: { type: String as PropType<PageKind>, required: true },
  },

  setup(props, { slots }) {
    const railOpen = ref(false);

    return (): VNode =>
      h(
        'div',
        {
          class: [
            'tt-shell',
            `tt-page-${props.page}`,
            railOpen.value ? 'tt-rail-open' : 'tt-rail-shut',
          ],
        },
        [
          // First in the document and first in the tab order, which is the only place a skip link
          // works. The reference's own shell draws one and a theme that dropped it would be a
          // theme that made the keyboard reader's job worse without saying so.
          h('a', { class: 'tt-skip', href: '#oref-main' }, 'Skip to content'),

          h('header', { class: 'tt-strip' }, [
            h(
              'button',
              {
                type: 'button',
                class: 'tt-rail-toggle',
                'aria-expanded': railOpen.value ? 'true' : 'false',
                'aria-controls': 'tt-rail',
                onClick: (): void => {
                  railOpen.value = !railOpen.value;
                },
              },
              railOpen.value ? 'HIDE TREE' : 'TREE',
            ),
            h('a', { class: 'tt-brand', href: props.basePath === '' ? '/' : props.basePath }, [
              h('span', { class: 'tt-brand-name' }, props.title),
              h('span', { class: 'tt-brand-version' }, props.version),
            ]),
            h('div', { class: 'tt-strip-palette' }, slots.palette?.() ?? []),
          ]),

          h('nav', { class: 'tt-rail', id: 'tt-rail', 'aria-label': 'Reference' }, slots.nav?.()),

          h('main', { class: 'tt-main', id: 'oref-main' }, slots.default?.()),

          h(TelltaleSectionIndex, { page: props.page }),

          h(TelltaleStatusBar, {
            page: props.page,
            nodeId: props.activeNodeId,
            schemaId: props.activeSchemaId,
          }),
        ],
      );
  },
});

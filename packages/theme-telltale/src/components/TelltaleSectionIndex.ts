import { defineComponent, h, onMounted, ref, type PropType, type VNode } from 'vue';
import { browserDocument, type HeadingElement } from '../dom';
import type { PageKind } from '@openref/vue';

/**
 * The permanent index on the right: the legend, and the sections of whatever is open.
 *
 * A theme component and not a slot, per `ai-docs/design/CONTRACT.md`.
 *
 * THE LEGEND IS SERVER DRAWN AND THE SECTION LIST IS NOT, AND THE REASON IS THE FINDING THIS THEME
 * WAS WRITTEN TO PRODUCE. An index of the sections on the page needs to know what sections are on
 * the page. The shell is handed the page kind and two ids; the content arrives through the default
 * slot as children it cannot look inside. So the only way for this component to learn what is on
 * the page is to go and read the DOM after mount, which is what it does, and which is a theme
 * reaching around the contract rather than through it. See `THEME-BOUNDARY.md`.
 *
 * IT READS HEADINGS THE THEME'S OWN COMPONENTS WROTE, which keeps it inside this theme even though
 * it is outside the contract: `h2.tt-strip-head` is written by `RuntimePanel`, `ParamTable`,
 * `ResponseList`, `CodeSample`, `AuthPanel`, `StreamLog`, `ResponseView` and `HealthScore`, all of
 * which are this package's files. It is not reading the reference's markup and it must not: the
 * two sections a node page draws that no position of this theme owns, Security and Request body,
 * carry `oref-section-title` and are deliberately not in this list, because an index that named
 * them would be an index quietly depending on the renderer's class names.
 *
 * NOTHING IS DRAWN BEFORE MOUNT, on either side, so the two renders agree.
 */
interface Section {
  readonly id: string;
  readonly label: string;
}

export default defineComponent({
  name: 'TelltaleSectionIndex',

  props: {
    page: { type: String as PropType<PageKind>, required: true },
  },

  setup(props) {
    const sections = ref<readonly Section[]>([]);

    onMounted(() => {
      const page = browserDocument();
      if (page === undefined) return;

      const found: Section[] = [];
      const heads: ArrayLike<HeadingElement> = page.querySelectorAll('.tt-main h2.tt-strip-head');

      for (let at = 0; at < heads.length; at += 1) {
        const head = heads[at];
        if (head === undefined) continue;

        const id = head.id === '' ? `tt-section-${String(at)}` : head.id;
        if (head.id === '') head.id = id;
        found.push({ id, label: head.textContent ?? '' });
      }

      sections.value = found;
    });

    return (): VNode =>
      h('aside', { class: 'tt-index', 'aria-label': 'On this page' }, [
        sections.value.length === 0
          ? null
          : h(
              'nav',
              { class: 'tt-index-sections' },
              h(
                'ul',
                { class: 'tt-index-list' },
                sections.value.map((section) =>
                  h('li', { class: 'tt-index-item', key: section.id }, [
                    h('a', { class: 'tt-index-link', href: `#${section.id}` }, section.label),
                  ]),
                ),
              ),
            ),

        h('div', { class: 'tt-legend' }, [
          h('h2', { class: 'tt-strip-head' }, 'LEGEND'),
          h('ul', { class: 'tt-legend-list' }, [
            h('li', { class: 'tt-legend-row' }, [
              h('abbr', { class: 'tt-prov tt-prov-declared', title: 'declared' }, 'DCL'),
              h('span', { class: 'tt-legend-text' }, 'a decorator says so'),
            ]),
            h('li', { class: 'tt-legend-row' }, [
              h('abbr', { class: 'tt-prov tt-prov-derived', title: 'derived' }, 'DRV'),
              h('span', { class: 'tt-legend-text' }, 'metadata under a known key'),
            ]),
            h('li', { class: 'tt-legend-row' }, [
              h('abbr', { class: 'tt-prov tt-prov-inferred', title: 'inferred' }, 'INF'),
              h('span', { class: 'tt-legend-text' }, 'read from the source, best effort'),
            ]),
          ]),
        ]),

        h('p', { class: 'tt-index-page' }, props.page.toUpperCase()),
      ]);
  },
});

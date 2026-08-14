/**
 * A named schema on a page of its own.
 *
 * Two things make this page necessary rather than decorative. The navigation ends in a
 * `Schemas` group, which T004 appends and which until then linked nowhere. And a page carries a
 * bounded slice of the schema map, so a target too far from the use sites to travel is shown by
 * linking here, which is only honest if here exists.
 *
 * The heading is the display name, never the identity suffix an external target carries.
 *
 * THE VIEW SEGMENT IS WIRED SINCE `TX-MARKUP`, and it turned out to be state plumbing: the
 * request and response views compute in core since T003 and the viewer always took `view` as a
 * prop; what was missing was one ref and two buttons. The default is `both` and each button is
 * a filter, per SPEC 11: pressing one narrows to that view, pressing it again returns to
 * `both`, so nothing is hidden until a reader asks. The state is the page's, like the sample
 * tab, so the server render and the first client render agree at `both`.
 *
 * THE ONE-BRANCH SEGMENT OF THE LAYOUT IS NOT HERE, per SPEC 11: the tree draws every branch
 * as a row, collapsing to one needs the per-node branch chooser that belongs to the form work,
 * and a control promising a capability that does not exist is the F14 class.
 *
 * IT IS THE DEFAULT OF THE `SchemaPage` SLOT, added in `TX-SLOTWIRE` with `DocumentOverview`. The
 * registry named components for the node page and for neither of the other two.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { StateNotice } from './StateNotice';
import { useDeferrable } from './deferrable';
import type { IRSchema, IRSchemaView } from '@openref/core';
import type { SchemaPageModel } from '@openref/vue';

/** The two narrowing views, in the order the layout draws the buttons. */
const VIEWS: readonly (readonly [IRSchemaView, string])[] = [
  ['request', 'request'],
  ['response', 'response'],
];

/** Renders one named schema. */
export const SchemaPanel = defineComponent({
  name: 'OrefSchemaPanel',

  props: {
    schema: { type: Object as PropType<SchemaPageModel>, required: true },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, default: () => ({}) },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
    /** The field a reader's fragment names, already decoded. Empty on the server, always. */
    anchor: { type: String, default: '' },
  },

  setup(props) {
    const deferrable = useDeferrable();
    const notice = useSlot('StateNotice', StateNotice);

    // Which half is showing. `both` on both sides of hydration, and a segment press narrows
    // it afterwards, which is the activeLang pattern of the sample tabs.
    const view = ref<IRSchemaView>('both');

    function toggle(target: IRSchemaView): void {
      view.value = view.value === target ? 'both' : target;
    }

    return (): VNode => {
      const schema = props.schema;

      return h('article', { class: 'oref-schema-page', 'data-oref-schema': schema.id }, [
        h('header', { class: 'oref-operation-header' }, [
          // The kicker names the page kind, per the layout and `TX-PARITY-UI`, the way the
          // bench head says `Bench`: the crumb carries the group, the kicker the kind.
          h('p', { class: 'oref-section-title oref-schema-kicker' }, 'Schema'),
          h('h1', { class: 'oref-title' }, schema.name),
          schema.deprecated
            ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated')
            : null,
          schema.dialect === '' ? null : h('p', { class: 'oref-schema-dialect' }, schema.dialect),
          schema.missing
            ? null
            : h(
                'div',
                { class: 'oref-seg', role: 'group', 'aria-label': 'Schema view' },
                VIEWS.map(([target, word]) =>
                  h(
                    'button',
                    {
                      class: 'oref-seg-btn',
                      key: target,
                      type: 'button',
                      'aria-pressed': view.value === target ? 'true' : 'false',
                      onClick: (): void => {
                        toggle(target);
                      },
                    },
                    word,
                  ),
                ),
              ),
        ]),
        h(MarkdownBlock, { html: schema.descriptionHtml }),
        schema.missing
          ? // A stale link is a normal event on a document that changed, so the page says so
            // rather than rendering an empty tree that looks like a schema with no fields.
            h(notice.value, {
              kind: 'schema-missing',
              message: 'This document declares no such schema.',
            })
          : h(deferrable.schemaView, {
              slot: { kind: 'named', schemaId: schema.id },
              label: schema.name,
              view: view.value,
              schemas: props.schemas,
              truncated: props.truncated,
              basePath: props.basePath,
              anchors: true,
              anchor: props.anchor,
            }),
        // THE `#` EXPLANATION, in the reader's words, per the layout and `TX-PARITY-UI`. It
        // stands only where the anchors do, so a missing schema's notice is not followed by
        // an explanation of marks that are not on the page.
        schema.missing
          ? null
          : h(
              'p',
              { class: 'oref-anchor-note' },
              'Expansion is per node. The # on a row is a permanent address: it opens the ' +
                'schema with its ancestors expanded and the field focused.',
            ),
      ]);
    };
  },
});

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
 * IT IS THE DEFAULT OF THE `SchemaPage` SLOT, added in `TX-SLOTWIRE` with `DocumentOverview`. The
 * registry named components for the node page and for neither of the other two.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { StateNotice } from './StateNotice';
import { useDeferrable } from './deferrable';
import type { IRSchema } from '@openref/core';
import type { SchemaPageModel } from '@openref/vue';

/** Renders one named schema. */
export const SchemaPanel = defineComponent({
  name: 'OrefSchemaPanel',

  props: {
    schema: { type: Object as PropType<SchemaPageModel>, required: true },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, default: () => ({}) },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const deferrable = useDeferrable();
    const notice = useSlot('StateNotice', StateNotice);

    return (): VNode => {
      const schema = props.schema;

      return h('article', { class: 'oref-schema-page', 'data-oref-schema': schema.id }, [
        h('header', { class: 'oref-operation-header' }, [
          h('h1', { class: 'oref-title' }, schema.name),
          schema.deprecated
            ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated')
            : null,
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
              view: 'both',
              schemas: props.schemas,
              truncated: props.truncated,
              basePath: props.basePath,
            }),
      ]);
    };
  },
});

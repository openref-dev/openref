/**
 * A named schema on a page of its own.
 *
 * Two things make this page necessary rather than decorative. The navigation ends in a
 * `Schemas` group, which T004 appends and which until now linked nowhere. And a page carries a
 * bounded slice of the schema map, so a target too far from the use sites to travel is shown by
 * linking here, which is only honest if here exists.
 *
 * The heading is the display name, never the identity suffix an external target carries.
 */

import type { IRSchema } from '@openref/core';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { SchemaView } from './SchemaView';
import type { SchemaPageModel } from '../page/domain/page-model';

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
            h('p', { class: 'oref-schema-empty' }, 'This document declares no such schema.')
          : h(SchemaView, {
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

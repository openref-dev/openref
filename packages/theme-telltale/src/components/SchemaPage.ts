import { useSlot, type SchemaPageModel } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import StateNotice from './StateNotice';

/**
 * One named schema on a page of its own, with its tree arriving as children.
 *
 * `missing` IS A STATE AND IT GOES THROUGH THE POSITION THAT OWNS STATES. A link to a schema this
 * document no longer declares is an ordinary thing to arrive at from a bookmark, and
 * `schema-missing` is one of the eight `StateNoticeKind`s for exactly this page. Writing the
 * sentence here instead would have put the same English in two positions, which is how the two
 * come to differ; and it would have made `StateNotice` a position no page of this theme reaches,
 * which is a slot filled and never drawn.
 */
export default defineComponent({
  name: 'TelltaleSchemaPage',

  props: {
    schema: { type: Object as PropType<SchemaPageModel>, required: true },
    basePath: { type: String, default: '' },
  },

  setup(props, { slots }) {
    const notice = useSlot('StateNotice', StateNotice);

    return (): VNode => {
      const schema = props.schema;

      return h(
        'article',
        { class: ['tt-schema-page', schema.missing ? 'tt-schema-missing' : null] },
        [
          h('header', { class: 'tt-schema-head' }, [
            h('span', { class: 'tt-schema-kind' }, 'SCH'),
            h('h1', { class: 'tt-schema-name' }, schema.name),
            schema.deprecated
              ? h('span', { class: 'tt-flag tt-flag-deprecated' }, 'DEPRECATED')
              : null,
          ]),
          schema.missing
            ? h(notice.value, {
                kind: 'schema-missing',
                message: 'This document declares no such schema.',
              })
            : null,
          schema.descriptionHtml === ''
            ? null
            : h('div', { class: 'tt-schema-prose tt-prose', innerHTML: schema.descriptionHtml }),
          h('div', { class: 'tt-schema-body' }, slots.default?.() ?? []),
        ],
      );
    };
  },
});

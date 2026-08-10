/**
 * The one component that inserts HTML rather than text.
 *
 * Its single job is to make that fact visible. Everything it receives has been through
 * `sanitizeHtml`, and it renders nothing at all when there is nothing to render, so an
 * empty description does not leave an empty box in the layout.
 */

import { defineComponent, h, type VNode } from 'vue';

/** Renders already sanitized HTML produced by the markdown renderer. */
export const MarkdownBlock = defineComponent({
  name: 'OrefMarkdownBlock',

  props: {
    html: { type: String, default: '' },
    tag: { type: String, default: 'div' },
    className: { type: String, default: 'oref-description' },
  },

  setup(props) {
    return (): VNode | null =>
      props.html === '' ? null : h(props.tag, { class: props.className, innerHTML: props.html });
  },
});

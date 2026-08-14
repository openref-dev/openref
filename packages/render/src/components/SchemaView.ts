/**
 * The schema viewer: what a position holds, resolved into a tree and handed to whoever draws it.
 *
 * IT IS THE POSITION AND `SchemaTree` IS THE SLOT. This computes the root from the use site and
 * the page's bounded schema slice, and closes the expander over that slice; the drawing is the
 * `SchemaTree` slot, which is handed a root and a function and never the map. That split is what
 * lets a theme replace the tree without being given a slice of the document, and it is what lets
 * expansion stay lazy: one level per open position, per SPEC 5.1.1.
 *
 * IT EXPANDS WITH THE ENGINE `@openref/vue` ALREADY OWNS, `schemaTreeRoot` and
 * `expandSchemaNode`, rather than walking schemas itself. That engine carries the cycle guard
 * SPEC 5.1.1 puts on the expander rather than on the IR: a chain of named references never
 * expanded, so no `$cycle` marker exists to read, and a revisit is detected against the path
 * from the root. A second walk here would be a second place for that to be got wrong.
 *
 * It does NOT use `useSchemaView`, and the reason is worth stating: that composable reads the
 * whole `IRDocument` out of the headless state, and a page carries a bounded slice of the
 * schema map rather than a document. The engine underneath is the same one.
 */

import type { IRSchema, IRSchemaSlot, IRSchemaView } from '@openref/core';
import {
  expandSchemaNode,
  inlineSchemaTreeRoot,
  schemaTreeRoot,
  useSlot,
  type SchemaTreeNode,
} from '@openref/vue';
import { computed, defineComponent, h, type PropType, type VNode } from 'vue';
import { SchemaTree } from './SchemaTree';
import { StateNotice } from './StateNotice';
import { schemaMapOf } from '../page/domain/schema-payload';

/** Renders one named or inline schema as an expandable tree. */
export const SchemaView = defineComponent({
  name: 'OrefSchemaView',

  props: {
    slot: { type: Object as PropType<IRSchemaSlot>, required: true },
    label: { type: String, required: true },
    view: { type: String as PropType<IRSchemaView>, default: 'both' },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, required: true },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const tree = useSlot('SchemaTree', SchemaTree);
    const notice = useSlot('StateNotice', StateNotice);

    const options = computed(() => ({
      schemas: schemaMapOf(props.schemas),
      view: props.view,
    }));

    const root = computed<SchemaTreeNode | undefined>(() => {
      if (props.slot.kind === 'named') return schemaTreeRoot(props.slot.schemaId, options.value);

      const body = props.slot.schema.normalized;
      return body === undefined
        ? undefined
        : inlineSchemaTreeRoot(body, props.label, options.value);
    });

    return (): VNode => {
      const start = root.value;

      if (start === undefined) {
        return h(notice.value, { kind: 'no-schema', message: 'No schema declared' });
      }

      return h(tree.value, {
        root: start,
        view: props.view,
        expand: (node: SchemaTreeNode) => expandSchemaNode(node, options.value),
        truncated: props.truncated,
        basePath: props.basePath,
        label: props.label,
        borrowedLabel: props.slot.kind === 'inline',
      });
    };
  },
});

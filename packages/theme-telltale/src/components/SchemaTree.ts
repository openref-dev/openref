import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { schemaHref } from '../links';
import type { SchemaTreeNode } from '@openref/vue';
import type { IRSchemaView } from '@openref/core';

/**
 * The schema tree, one level at a time.
 *
 * THE EXPANDER IS A PROP AND THE SCHEMA MAP IS NOT. Children come from `expand(node)`, which the
 * caller closed over the page's bounded slice, so this component never holds a slice of the
 * document and expansion stays lazy: a level is computed when a position is opened and not before.
 *
 * `relation` IS HOW THIS THEME TELLS A VARIANT FROM A PROPERTY FROM A PREFIX ITEM. The registry
 * used to name `BranchPicker`, `PatternKeys` and `TupleField` and no longer does, because they
 * were three names for three row kinds of one component. The distinction is still here, in a
 * field, which is the supported way to draw them differently.
 *
 * A CYCLE IS A ROW AND NOT AN ABSENCE. `cycle` is set on a position that revisits a schema already
 * on the path from the root, and it names what it points back to. A tree that stopped silently
 * would be a tree that lost a fact.
 *
 * `borrowedLabel` IS FINDING F15 AS A PROP. When the container lent this tree its word, the root
 * row does not print it again.
 */
export default defineComponent({
  name: 'TelltaleSchemaTree',

  props: {
    root: { type: Object as PropType<SchemaTreeNode>, required: true },
    view: { type: String as PropType<IRSchemaView>, default: 'both' },
    expand: {
      type: Function as PropType<(node: SchemaTreeNode) => readonly SchemaTreeNode[]>,
      required: true,
    },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
    label: { type: String, default: '' },
    borrowedLabel: { type: Boolean, default: false },
  },

  setup(props) {
    const open = ref(new Set<string>());

    function toggle(path: string): void {
      const next = new Set(open.value);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      open.value = next;
    }

    function row(node: SchemaTreeNode, depth: number, borrowed: boolean): VNode {
      const expanded = open.value.has(node.path);
      // The id rather than a flag, so the link below narrows without asking the same question
      // twice. A position left behind by the payload bound is still reachable, on its own page.
      const truncatedId =
        node.schemaId !== undefined && props.truncated.includes(node.schemaId)
          ? node.schemaId
          : undefined;
      const type = typeOf(node);

      const name = borrowed
        ? h('span', { class: 'tt-tree-borrowed' }, type)
        : h('span', { class: 'tt-tree-label' }, node.label);

      const head = [
        h('span', { class: 'tt-tree-rel' }, RELATIONS[node.relation]),
        name,
        borrowed ? null : h('span', { class: 'tt-tree-type' }, type),
        node.required ? h('span', { class: 'tt-tree-req' }, 'REQ') : null,
        node.cycle
          ? h('span', { class: 'tt-tree-cycle' }, `cycle to ${node.cycleTarget ?? 'itself'}`)
          : null,
        truncatedId === undefined
          ? null
          : h(
              'a',
              { class: 'tt-tree-link', href: schemaHref(truncatedId, props.basePath) },
              'on its own page',
            ),
      ];

      const children = expanded ? props.expand(node) : [];

      return h(
        'li',
        { class: ['tt-tree-node', `tt-tree-depth-${String(Math.min(depth, 6))}`], key: node.path },
        [
          node.expandable && !node.cycle
            ? h(
                'button',
                {
                  type: 'button',
                  class: 'tt-tree-row',
                  'aria-expanded': expanded ? 'true' : 'false',
                  onClick: (): void => {
                    toggle(node.path);
                  },
                },
                [h('span', { class: 'tt-tree-twist' }, expanded ? '-' : '+'), ...head],
              )
            : h('div', { class: 'tt-tree-row' }, [
                h('span', { class: 'tt-tree-twist' }, ' '),
                ...head,
              ]),
          children.length === 0
            ? null
            : h(
                'ul',
                { class: 'tt-tree-children' },
                children.map((child) => row(child, depth + 1, false)),
              ),
        ],
      );
    }

    return (): VNode =>
      h('div', { class: 'tt-tree' }, [
        h('ul', { class: 'tt-tree-list' }, [row(props.root, 0, props.borrowedLabel)]),
      ]);
  },
});

/** How this theme prints the relation of a position, in the three letters it prints everything in. */
const RELATIONS: Readonly<Record<SchemaTreeNode['relation'], string>> = {
  root: 'ROOT',
  property: 'PRP',
  patternProperty: 'PAT',
  propertyNames: 'KEY',
  additionalProperties: 'ADD',
  items: 'ITM',
  prefixItem: 'POS',
  allOf: 'ALL',
  oneOf: 'ONE',
  anyOf: 'ANY',
  not: 'NOT',
  variant: 'VAR',
};

/**
 * What a position holds, in the words a reader of a specification uses.
 *
 * The schema body is the only place this can come from: `SchemaTreeNode` carries no type label,
 * because what to call a type is a decision a theme makes. This one names the schema when the
 * position holds a named one and the JSON Schema type otherwise.
 */
function typeOf(node: SchemaTreeNode): string {
  if (node.schemaName !== undefined) return node.schemaName;

  const type = node.schema.type;
  if (typeof type === 'string') return type;
  if (Array.isArray(type)) return type.join(' | ');
  if (node.schema.oneOf !== undefined) return 'one of';
  if (node.schema.anyOf !== undefined) return 'any of';
  if (node.schema.allOf !== undefined) return 'all of';
  return 'any';
}

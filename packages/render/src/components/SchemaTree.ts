/**
 * The schema tree, one level at a time, with the viewer's own cycle stops.
 *
 * IT EXPANDS THROUGH THE FUNCTION IT IS HANDED AND HOLDS NO SCHEMA MAP. That is the shape the
 * `SchemaTree` slot was restated to, and it is a finding rather than a preference: the props were
 * `{ root, view }`, which lets a theme draw one level and stop, because children come from
 * `expandSchemaNode(node, { schemas, view })` and the map was never in the props. Handing the map
 * instead would have put a bounded slice of the document in the contract and made expansion
 * eager. Handing the function keeps it lazy and keeps the map out.
 *
 * A TARGET THE PAGE DID NOT SHIP IS A LINK TO THAT SCHEMA'S OWN PAGE, never an empty expansion.
 * `truncated` is what says which those are: it names every id referenced from something that
 * shipped and not shipped itself, which is exactly the question a link answers.
 *
 * SERVER AND CLIENT COMPUTE THE SAME TREE FROM THE SAME BYTES. Expansion is a pure function of
 * the shipped schemas and the open set, and the open set starts as the root path on both sides,
 * so the server rendered markup and the first client render are identical by construction
 * rather than by care.
 *
 * `SchemaTreeNode.relation` IS HOW A THEME TELLS THE ROW KINDS APART, and it is the supported
 * way. The registry had `BranchPicker`, `PatternKeys` and `TupleField` for the three of them
 * until `TX-SLOTWIRE`; the tree draws variants, pattern properties and prefix items as ordinary
 * rows through one expander, so those were three names for three row kinds of one component and
 * no page ever resolved them.
 *
 * A schema description is rendered as text, not as HTML. Every other description on a page is
 * markdown the server already rendered and sanitized; these positions do not exist until a
 * reader opens them, so there is nothing the server could have rendered. Text is the honest
 * answer, and it is the safe one: nothing here puts author supplied markup into the document.
 */

import type { IRSchemaView } from '@openref/core';
import type { SchemaTreeNode } from '@openref/vue';
import {
  computed,
  defineComponent,
  h,
  nextTick,
  onMounted,
  ref,
  type PropType,
  type VNode,
} from 'vue';
import { schemaHref } from '../page/domain/links';

/**
 * What this component needs from a keyboard event and from an element, and nothing else.
 *
 * DOM TYPES ARE SCOPED TO `src/browser` AND THE INTEGRATION SUITE, decided in T011 so that a
 * server only path cannot reach `document` by accident. A component renders on the server as
 * well as in the browser, so it stays outside that scope and says structurally what it needs.
 * These four members are the whole of it.
 */
interface KeyEvent {
  readonly key: string;
  preventDefault(): void;
}

interface FocusTarget {
  focus(): void;
  getAttribute(name: string): string | null;
}

interface QueryRoot {
  querySelectorAll(selectors: string): Iterable<FocusTarget>;
}

/** Keys the tree answers to, per the WAI-ARIA tree view pattern. */
const KEY_DOWN = 'ArrowDown';
const KEY_UP = 'ArrowUp';
const KEY_RIGHT = 'ArrowRight';
const KEY_LEFT = 'ArrowLeft';
const KEY_HOME = 'Home';
const KEY_END = 'End';

/** A position as it is rendered: the node, its depth, whether it is open, and what is under it. */
interface Row {
  readonly node: SchemaTreeNode;
  readonly level: number;
  readonly open: boolean;
  readonly children: readonly Row[];
}

function typeOf(node: SchemaTreeNode): string {
  const body = node.schema;

  if (node.schemaName !== undefined) return node.schemaName;
  if (body.$cycle !== undefined) return body.$cycle;
  if (body.enum !== undefined) return 'enum';
  if (body.type === undefined) return 'any';

  return typeof body.type === 'string' ? body.type : body.type.join(' | ');
}

/**
 * The rows a tree shows, nested.
 *
 * Only an open position is expanded, so a document with a thousand schemas costs one level of
 * work per open position and nothing for the rest. That is the laziness, and it is the reason
 * the whole schema map is not needed for a page to render.
 */
function buildRows(
  node: SchemaTreeNode,
  level: number,
  open: ReadonlySet<string>,
  expand: (node: SchemaTreeNode) => readonly SchemaTreeNode[],
): Row {
  const isOpen = node.expandable && open.has(node.path);
  const children = isOpen
    ? expand(node).map((child) => buildRows(child, level + 1, open, expand))
    : [];

  return { node, level, open: isOpen, children };
}

/** The same rows in the order a reader moves through them with the arrow keys. */
function flatten(row: Row, into: Row[]): Row[] {
  into.push(row);
  for (const child of row.children) flatten(child, into);
  return into;
}

/** Renders one expanded schema as a tree. */
export const SchemaTree = defineComponent({
  name: 'OrefSchemaTree',

  props: {
    root: { type: Object as PropType<SchemaTreeNode>, required: true },
    view: { type: String as PropType<IRSchemaView>, default: 'both' },
    expand: {
      type: Function as PropType<(node: SchemaTreeNode) => readonly SchemaTreeNode[]>,
      required: true,
    },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
    /** What the position is called: a media type, or the schema's own display name. */
    label: { type: String, default: '' },
    /**
     * Whether the root's label is the container's word rather than the schema's own.
     *
     * FINDING F15, AS A PROP, because only the caller knows. A body block prints
     * `application/json` in its head and lends that word to the tree so the tree has a root to
     * draw; printing it again on the root row is one position saying one thing twice. A schema
     * page's root is the schema, and its name is its own.
     */
    borrowedLabel: { type: Boolean, default: false },
    /**
     * Whether rows carry their permanent `#` link, per TX-MARKUP.
     *
     * The schema page turns it on; a tree under a response does not, because the fragment
     * namespace belongs to one tree per page and the schema page is that tree.
     */
    anchors: { type: Boolean, default: false },
    /** The row a reader's fragment names, already decoded, or empty. Empty on the server. */
    anchor: { type: String, default: '' },
  },

  setup(props) {
    // The root is open on the server and in the browser alike, so a reader sees the first level
    // without acting and the two renders agree.
    const open = ref<ReadonlySet<string>>(new Set<string>());
    const focused = ref<string | null>(null);
    const treeRef = ref<QueryRoot | null>(null);

    const tree = computed<Row>(() => {
      const start = props.root;
      const opened = new Set(open.value);
      opened.add(start.path);

      return buildRows(start, 1, opened, (node) => props.expand(node));
    });

    const order = computed<Row[]>(() => flatten(tree.value, []));

    function toggle(node: SchemaTreeNode): void {
      const next = new Set(open.value);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      open.value = next;
      focused.value = node.path;
    }

    // A PERMANENT ADDRESS OPENS THE SCHEMA AT THE FIELD, per TX-MARKUP: the ancestors of the
    // fragment's path expand level by level through the same lazy expander, one render per
    // level, and the row is focused when it exists. After mount only, so hydration compares
    // the markup the server actually sent; a fragment naming nothing expands nothing, because
    // a wrong link is a normal event on a document that changed.
    onMounted(() => {
      const target = props.anchor;
      if (target === '') return;

      void (async (): Promise<void> => {
        let current = props.root;

        while (current.path !== target) {
          if (!current.expandable) return;

          const child = props
            .expand(current)
            .find(
              (candidate) => candidate.path === target || target.startsWith(`${candidate.path}/`),
            );
          if (child === undefined) return;

          open.value = new Set(open.value).add(current.path);
          await nextTick();
          current = child;
        }

        focus(target);
      })();
    });

    /**
     * Moves focus to a row.
     *
     * The path is matched in JavaScript rather than interpolated into a selector, because a
     * path is built from property names out of a third party document and a name with a quote
     * or a bracket in it would either break the selector or, worse, not break it.
     */
    function focus(path: string): void {
      focused.value = path;

      const container = treeRef.value;
      if (container === null) return;

      for (const element of container.querySelectorAll('[data-oref-path]')) {
        if (element.getAttribute('data-oref-path') !== path) continue;
        element.focus();
        return;
      }
    }

    function onKeydown(event: KeyEvent, row: Row): void {
      const list = order.value;
      const at = list.findIndex((candidate) => candidate.node.path === row.node.path);
      if (at === -1) return;

      const move = (to: number): void => {
        event.preventDefault();
        const target = list[Math.min(Math.max(to, 0), list.length - 1)];
        if (target !== undefined) focus(target.node.path);
      };

      switch (event.key) {
        case KEY_DOWN:
          move(at + 1);
          return;
        case KEY_UP:
          move(at - 1);
          return;
        case KEY_HOME:
          move(0);
          return;
        case KEY_END:
          move(list.length - 1);
          return;
        case KEY_RIGHT:
          event.preventDefault();
          if (row.node.expandable && !row.open) toggle(row.node);
          else if (row.open) move(at + 1);
          return;
        case KEY_LEFT: {
          event.preventDefault();
          if (row.open) {
            toggle(row.node);
            return;
          }
          const parent = [...list.slice(0, at)]
            .reverse()
            .find((candidate) => candidate.level < row.level);
          if (parent !== undefined) focus(parent.node.path);
          return;
        }
        default:
          return;
      }
    }

    /** True when a position names a schema this page did not ship. */
    function isElsewhere(node: SchemaTreeNode): boolean {
      if (node.schemaId === undefined) return false;
      return props.truncated.includes(node.schemaId);
    }

    function rowContent(row: Row): (VNode | null)[] {
      const node = row.node;
      const marker = row.node.expandable
        ? `oref-schema-marker ${row.open ? 'oref-open' : 'oref-closed'}`
        : 'oref-schema-marker oref-schema-leaf';

      // ONE POSITION, ONE LABEL, which is finding F15 and shows up twice on the same row.
      //
      // An inline root has no name of its own: `label` is the caller's word for the position,
      // `application/json` on a body, borrowed so the tree has a root to draw, and the block
      // around the tree has already printed it.
      //
      // A named root has one, and prints it as its name and again as its type, because the type
      // of a position that is a named schema is that schema's name. `ProblemDto ProblemDto` was
      // on the demo. Where the two coincide the row keeps one of them, and it keeps the link
      // when there is one, since that carries the way to the schema's own page.
      const type = typeOf(node);
      const link = isElsewhere(node) && node.schemaId !== undefined;
      const borrowed = row.level === 1 && props.borrowedLabel;
      const same = node.label === type;

      const showName = !borrowed && !(same && link);
      const showType = !(same && showName);

      return [
        h('span', { class: marker, 'aria-hidden': 'true' }),
        showName ? h('span', { class: 'oref-schema-name' }, node.label) : null,
        node.required ? h('span', { class: 'oref-required' }, 'required') : null,
        !showType
          ? null
          : link
            ? h(
                'a',
                {
                  class: 'oref-schema-type oref-schema-link',
                  href: schemaHref(node.schemaId, props.basePath),
                },
                type,
              )
            : h('span', { class: 'oref-schema-type' }, type),
        node.schema.deprecated === true
          ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated')
          : null,
        node.cycle
          ? h(
              'span',
              { class: 'oref-schema-cycle' },
              node.cycleTarget === undefined ? 'cycle' : `cycle to ${node.cycleTarget}`,
            )
          : null,
        node.schema.description === undefined || node.schema.description === ''
          ? null
          : h('span', { class: 'oref-schema-doc' }, node.schema.description),
      ];
    }

    function renderRow(row: Row): VNode {
      const node = row.node;
      const interactive = node.expandable;
      const first = order.value[0]?.node.path;

      return h(
        'li',
        {
          class: 'oref-schema-item',
          key: node.path,
          role: 'treeitem',
          'aria-level': row.level,
          ...(interactive ? { 'aria-expanded': row.open } : {}),
        },
        [
          h(
            interactive ? 'button' : 'div',
            {
              class: ['oref-schema-row', node.cycle ? 'oref-schema-cycle-row' : ''],
              'data-oref-path': node.path,
              tabindex: (focused.value ?? first) === node.path ? 0 : -1,
              ...(interactive
                ? {
                    type: 'button',
                    onClick: (): void => {
                      toggle(node);
                    },
                  }
                : {}),
              onKeydown: (event: KeyEvent): void => {
                onKeydown(event, row);
              },
            },
            rowContent(row),
          ),
          // THE ANCHOR IS THE ROW'S SIBLING AND NOT ITS CHILD, because an expandable row is a
          // button and a link inside a button is markup no browser will honour. The theme
          // overlays it on the row's first line; the path travels percent encoded, since a
          // property name out of a third party document can hold anything.
          props.anchors
            ? h(
                'a',
                {
                  class: 'oref-schema-anchor',
                  href: `#${encodeURIComponent(node.path)}`,
                  'aria-label': `Permanent link to ${node.label}`,
                },
                '#',
              )
            : null,
          row.children.length === 0
            ? null
            : h(
                'ul',
                { class: 'oref-schema-list', role: 'group' },
                row.children.map((child) => renderRow(child)),
              ),
        ],
      );
    }

    return (): VNode =>
      h(
        'ul',
        {
          class: 'oref-schema-tree',
          role: 'tree',
          'aria-label': `${props.label} schema`,
          ref: treeRef,
        },
        [renderRow(tree.value)],
      );
  },
});

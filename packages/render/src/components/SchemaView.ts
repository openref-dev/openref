/**
 * The schema viewer: one tree, expanded a level at a time.
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
 *
 * SERVER AND CLIENT COMPUTE THE SAME TREE FROM THE SAME BYTES. Expansion is a pure function of
 * the shipped schemas and the open set, and the open set starts as the root path on both sides,
 * so the server rendered markup and the first client render are identical by construction
 * rather than by care.
 *
 * A target the page did not ship is a link to that schema's own page, never an empty expansion.
 *
 * A schema description is rendered as text, not as HTML. Every other description on a page is
 * markdown the server already rendered and sanitized; these positions do not exist until a
 * reader opens them, so there is nothing the server could have rendered. Text is the honest
 * answer, and it is the safe one: nothing here puts author supplied markup into the document.
 */

import type { IRSchema, IRSchemaSlot, IRSchemaView } from '@openref/core';
import {
  expandSchemaNode,
  inlineSchemaTreeRoot,
  schemaTreeRoot,
  type SchemaTreeNode,
} from '@openref/vue';
import { computed, defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { schemaHref } from '../page/domain/links';
import { schemaMapOf } from '../page/domain/schema-payload';

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

    // The root is open on the server and in the browser alike, so a reader sees the first level
    // without acting and the two renders agree.
    const open = ref<ReadonlySet<string>>(new Set<string>());
    const focused = ref<string | null>(null);
    const treeRef = ref<QueryRoot | null>(null);

    const tree = computed<Row | null>(() => {
      const start = root.value;
      if (start === undefined) return null;

      const opened = new Set(open.value);
      opened.add(start.path);

      return buildRows(start, 1, opened, (node) => expandSchemaNode(node, options.value));
    });

    const order = computed<Row[]>(() => {
      const start = tree.value;
      return start === null ? [] : flatten(start, []);
    });

    function toggle(node: SchemaTreeNode): void {
      const next = new Set(open.value);
      if (next.has(node.path)) next.delete(node.path);
      else next.add(node.path);
      open.value = next;
      focused.value = node.path;
    }

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
      return props.schemas[node.schemaId] === undefined;
    }

    function rowContent(row: Row): (VNode | null)[] {
      const node = row.node;
      const marker = row.node.expandable
        ? `oref-schema-marker ${row.open ? 'oref-open' : 'oref-closed'}`
        : 'oref-schema-marker oref-schema-leaf';

      return [
        h('span', { class: marker, 'aria-hidden': 'true' }),
        h('span', { class: 'oref-schema-name' }, node.label),
        node.required ? h('span', { class: 'oref-required' }, 'required') : null,
        isElsewhere(node) && node.schemaId !== undefined
          ? h(
              'a',
              {
                class: 'oref-schema-type oref-schema-link',
                href: schemaHref(node.schemaId, props.basePath),
              },
              typeOf(node),
            )
          : h('span', { class: 'oref-schema-type' }, typeOf(node)),
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

    return (): VNode => {
      const start = tree.value;

      if (start === null) {
        return h('p', { class: 'oref-schema-empty' }, 'No schema declared');
      }

      return h(
        'ul',
        {
          class: 'oref-schema-tree',
          role: 'tree',
          'aria-label': `${props.label} schema`,
          ref: treeRef,
        },
        [renderRow(start)],
      );
    };
  },
});

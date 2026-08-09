import type { IRJsonSchema, IRSchema, IRSchemaSlot, IRSchemaView } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useDocState } from '../state/api/context';
import { resolveSchemaSlot } from '../state/domain/node-view';
import type { SchemaTreeNode } from '../state/domain/schema-expansion';
import {
  expandSchemaNode,
  inlineSchemaTreeRoot,
  schemaTreeRoot,
} from '../state/domain/schema-expansion';

/**
 * The schema viewer's state: which view is shown, which positions are open, and how to get
 * the children of a position.
 *
 * Expansion is lazy. `children` is called when a position is opened, so a document with a
 * thousand schemas costs nothing until somebody clicks. Cycle protection belongs to the
 * expander and not to the IR, per SPEC 5.1.1: a chain of named references never expanded, so
 * no marker exists to read, and the expander tracks its own path instead.
 */
export interface UseSchemaView {
  readonly view: Ref<IRSchemaView>;
  readonly expandedPaths: Ref<ReadonlySet<string>>;
  setView(view: IRSchemaView): void;

  /** Root over a named schema, or `undefined` when the id names nothing. */
  root(schemaId: string): SchemaTreeNode | undefined;
  /** Root over a schema written inline at a use site. */
  inlineRoot(schema: IRJsonSchema, label: string): SchemaTreeNode;
  /** Root over whatever a use site slot holds, named or inline. */
  slotRoot(slot: IRSchemaSlot, label: string): SchemaTreeNode | undefined;
  /** One level of children. Empty when the position closes a cycle. */
  children(node: SchemaTreeNode): readonly SchemaTreeNode[];

  isExpanded(path: string): boolean;
  expand(path: string): void;
  collapse(path: string): void;
  toggle(path: string): void;
  collapseAll(): void;

  /** The document's schema map, for a theme that needs to look one up by id. */
  readonly schemas: ComputedRef<ReadonlyMap<string, IRSchema>>;
}

/**
 * @returns The schema viewer state
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { root, children, toggle } = useSchemaView();
 */
export function useSchemaView(): UseSchemaView {
  const state = useDocState();

  const options = (): { schemas: ReadonlyMap<string, IRSchema>; view: IRSchemaView } => ({
    schemas: state.document.value.schemas,
    view: state.view.value,
  });

  const setPaths = (mutate: (paths: Set<string>) => void): void => {
    const next = new Set(state.expandedPaths.value);
    mutate(next);
    state.expandedPaths.value = next;
  };

  return {
    view: state.view,
    expandedPaths: state.expandedPaths,
    setView: (view) => {
      state.view.value = view;
    },

    root: (schemaId) => schemaTreeRoot(schemaId, options()),
    inlineRoot: (schema, label) => inlineSchemaTreeRoot(schema, label, options()),
    slotRoot: (slot, label) => {
      if (slot.kind === 'named') return schemaTreeRoot(slot.schemaId, options());
      const schema = resolveSchemaSlot(slot, state.document.value.schemas);
      const normalized = schema?.normalized;
      return normalized === undefined
        ? undefined
        : inlineSchemaTreeRoot(normalized, label, options());
    },
    children: (node) => expandSchemaNode(node, options()),

    isExpanded: (path) => state.expandedPaths.value.has(path),
    expand: (path) => {
      setPaths((paths) => paths.add(path));
    },
    collapse: (path) => {
      setPaths((paths) => {
        paths.delete(path);
      });
    },
    toggle: (path) => {
      setPaths((paths) => {
        if (paths.has(path)) paths.delete(path);
        else paths.add(path);
      });
    },
    collapseAll: () => {
      state.expandedPaths.value = new Set<string>();
    },

    schemas: computed(() => state.document.value.schemas),
  };
}

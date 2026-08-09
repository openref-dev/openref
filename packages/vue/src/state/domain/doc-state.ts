import type { IRDocument, IRNode, IRSchemaView } from '@openref/core';
import { computed, ref, shallowRef } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { ISearchPort } from '../application/ports/search.port';
import type { NodeView } from './node-view';
import { materializeNode } from './node-view';
import type { ResolvedTheme, ThemeDefinition } from '../../theme/domain/theme.types';
import { resolveTheme } from '../../theme/domain/theme';

/**
 * The document state, per SPEC 11: `ref`, `shallowRef` and `computed`, handed around by
 * `provide` and `inject`. No Pinia, and no module level singleton, so two references can be
 * mounted on one page without seeing each other's state.
 *
 * The document itself sits in a `shallowRef`. It is a large frozen graph produced by the
 * normalizer and never mutated in place, so making every schema in it deeply reactive would
 * cost the whole document in proxies to observe changes that cannot happen.
 */

/** What the state is built from. */
export interface DocStateOptions {
  readonly document: IRDocument;
  /** The theme in force. The default theme is resolved when nothing is given. */
  readonly theme?: ThemeDefinition;
  /** A loaded search index, when one has been built. Search reports itself unavailable without one. */
  readonly search?: ISearchPort;
  /** Node opened at startup, for a deep link. */
  readonly activeNodeId?: string;
  /** View shown at startup. */
  readonly view?: IRSchemaView;
}

/** The state object every composable reads. */
export interface DocState {
  readonly document: ShallowRef<IRDocument>;
  /** Id of the node currently open, or `undefined` on the overview. */
  readonly activeNodeId: Ref<string | undefined>;
  /** Whether the request or the response view of schemas is shown. */
  readonly view: Ref<IRSchemaView>;
  /** Current search query text. */
  readonly query: Ref<string>;
  /** Paths of the schema tree positions currently open. */
  readonly expandedPaths: Ref<ReadonlySet<string>>;
  readonly theme: Ref<ResolvedTheme>;
  /** The search index, absent when none was supplied. */
  readonly search: ISearchPort | undefined;
  /** The node currently open, materialized. */
  readonly activeNode: ComputedRef<NodeView | undefined>;

  /**
   * Materialized view of a node, computed on first access and cached from then on.
   *
   * @param id - Key into `document.nodes` or `document.webhooks`
   * @returns The view, or `undefined` when nothing carries that id
   */
  nodeView(id: string): NodeView | undefined;
  /** Whether a node has been materialized yet. Introspection, so laziness can be asserted. */
  isMaterialized(id: string): boolean;
  /** Drop every cached view. Used when the document is replaced. */
  invalidate(): void;
  /** Replace the document, for example after a federated remote came back. */
  setDocument(document: IRDocument): void;
}

function findNode(document: IRDocument, id: string): IRNode | undefined {
  return document.nodes.get(id) ?? document.webhooks.get(id);
}

/**
 * Creates one independent document state.
 *
 * @param options - The document and the optional wiring around it
 * @returns A state object, owned by the caller and shared through `provide`
 *
 * @example
 * const state = createDocState({ document });
 * provideDocState(state);
 */
export function createDocState(options: DocStateOptions): DocState {
  const document = shallowRef(options.document);
  const activeNodeId = ref<string | undefined>(options.activeNodeId);
  const view = ref<IRSchemaView>(options.view ?? 'both');
  const query = ref('');
  const expandedPaths = ref<ReadonlySet<string>>(new Set<string>());
  const theme = ref<ResolvedTheme>(resolveTheme(options.theme));

  // The cache is deliberately not reactive. It holds derived values keyed by node id, and a
  // cache entry appearing is not a state change anything should re-render for.
  let cache = new Map<string, NodeView>();

  const nodeView = (id: string): NodeView | undefined => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;

    const node = findNode(document.value, id);
    if (node === undefined) return undefined;

    const materialized = materializeNode(node, document.value);
    cache.set(id, materialized);
    return materialized;
  };

  return {
    document,
    activeNodeId,
    view,
    query,
    expandedPaths,
    theme,
    search: options.search,
    activeNode: computed(() =>
      activeNodeId.value === undefined ? undefined : nodeView(activeNodeId.value),
    ),
    nodeView,
    isMaterialized: (id) => cache.has(id),
    invalidate: () => {
      cache = new Map<string, NodeView>();
    },
    setDocument: (next) => {
      cache = new Map<string, NodeView>();
      document.value = next;
    },
  };
}

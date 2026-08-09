import type {
  IRDocument,
  IRDocumentKind,
  IRInfo,
  IRNavNode,
  IRSecurityScheme,
  IRServer,
} from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import { useDocState } from '../state/api/context';

/**
 * The document a theme is rendering.
 *
 * Everything is a `computed` over the provided state rather than a copy, so replacing the
 * document, which federation does when a remote comes back, moves the whole tree at once.
 */
export interface UseDocument {
  readonly document: ComputedRef<IRDocument>;
  readonly info: ComputedRef<IRInfo>;
  readonly hash: ComputedRef<string>;
  readonly kind: ComputedRef<IRDocumentKind>;
  readonly navigation: ComputedRef<readonly IRNavNode[]>;
  readonly servers: ComputedRef<readonly IRServer[]>;
  readonly security: ComputedRef<readonly IRSecurityScheme[]>;
  /** Node ids in the order the navigation lists them, so a theme never sorts. */
  readonly nodeIds: ComputedRef<readonly string[]>;
  readonly activeNodeId: Ref<string | undefined>;
  /** Opens a node, or the overview when given nothing. */
  select(id: string | undefined): void;
}

/**
 * @returns The document and the selection over it
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { info, navigation, select } = useDocument();
 */
export function useDocument(): UseDocument {
  const state = useDocState();

  return {
    document: computed(() => state.document.value),
    info: computed(() => state.document.value.info),
    hash: computed(() => state.document.value.hash),
    kind: computed(() => state.document.value.kind),
    navigation: computed(() => state.document.value.navigation),
    servers: computed(() => state.document.value.servers),
    security: computed(() => state.document.value.security),
    nodeIds: computed(() => [...state.document.value.nodes.keys()]),
    activeNodeId: state.activeNodeId,
    select: (id) => {
      state.activeNodeId.value = id;
    },
  };
}

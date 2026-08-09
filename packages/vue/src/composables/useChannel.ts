import type { IRChannelOperation, IRMessage } from '@openref/core';
import { computed } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import type { ChannelView } from '../state/domain/node-view';
import { useNode } from './useNode';

/**
 * One event channel.
 *
 * Channels are in the IR from M0 under the `channel` discriminant, so this composable is real
 * rather than declared: it simply finds nothing until an AsyncAPI document is normalized in
 * M5. Yielding `undefined` for an HTTP operation is the same narrowing `useOperation` does in
 * the other direction.
 */
export interface UseChannel {
  readonly id: ComputedRef<string | undefined>;
  readonly channel: ComputedRef<ChannelView | undefined>;
  readonly operations: ComputedRef<readonly IRChannelOperation[]>;
  readonly messages: ComputedRef<readonly IRMessage[]>;
}

/**
 * @param id - Channel node id, or nothing to follow the current selection
 * @returns The channel and its parts
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { channel, messages } = useChannel('orders.created');
 */
export function useChannel(id?: MaybeRefOrGetter<string | undefined>): UseChannel {
  const { id: resolvedId, node } = useNode(id);

  const channel = computed(() => (node.value?.kind === 'channel' ? node.value : undefined));

  return {
    id: resolvedId,
    channel,
    operations: computed(() => channel.value?.operations ?? []),
    messages: computed(() => channel.value?.messages ?? []),
  };
}

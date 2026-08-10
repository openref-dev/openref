import { ErrorCode, OpenRefError, RunnerError } from '@openref/core';
import { computed, ref, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useRunnerPort } from '../runner/api/context';
import { runnerOperationOf } from '../runner/domain/runner-operation';
import { useDocState } from '../state/api/context';
import { useNode } from './useNode';
import type { RunnerOperationView, RunnerResult } from '../runner/application/ports/runner.port';

/**
 * The try-it runner, per SPEC 14.1.
 *
 * M0 sends JSON bodies, plain path, query and header parameters, `apiKey` and `http bearer`,
 * in direct mode. The full serialization matrix, the remaining auth schemes, the same origin
 * proxy and streaming are M2.
 *
 * `available` is false when no runner was provided above, and `send` then rejects rather than
 * doing nothing. It reports rather than silently failing: a theme renders a disabled console
 * from `available` without touching `send`, and anything that does call `send` gets an error
 * naming the reason instead of a request that never happened.
 *
 * CREDENTIALS ARE NOT STATE HERE. They live in the runner, behind the storage policy of SPEC
 * 14.4, and are read and written one scheme at a time. Holding them in a ref would put them in
 * whatever a component serializes, which on a server rendered page is the page.
 */
export interface UseRunner {
  readonly id: ComputedRef<string | undefined>;
  /** Whether a runner was provided above this component. */
  readonly available: ComputedRef<boolean>;
  /** Whether a request is in flight. */
  readonly pending: ComputedRef<boolean>;
  /** The last response, until another request is sent. */
  readonly result: ComputedRef<RunnerResult | undefined>;
  /** Why the last send failed, in one sentence, or undefined when it did not. */
  readonly error: ComputedRef<string | undefined>;
  /** What this operation can be sent with, or undefined when it cannot be sent at all. */
  readonly operation: ComputedRef<RunnerOperationView | undefined>;

  /**
   * @param schemeId - Id of the security scheme
   * @returns The stored credential, or undefined when there is none
   */
  credential(schemeId: string): string | undefined;

  /**
   * @param schemeId - Id of the security scheme
   * @param value - The credential as the reader typed it, empty to clear it
   */
  setCredential(schemeId: string, value: string): void;

  /**
   * Sends the request.
   *
   * @param args - Server, typed values and body
   * @returns What came back
   * @throws {RunnerError} When no runner was provided, or the operation cannot be sent
   */
  send(args: UseRunnerSendArgs): Promise<RunnerResult>;
}

/** What a send needs beyond the operation itself. */
export interface UseRunnerSendArgs {
  readonly serverUrl: string;
  /** Parameter values keyed by `${location}:${name}`. */
  readonly values: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly mediaType?: string;
}

/**
 * The runner for an operation given directly, without the document state.
 *
 * This is what the renderer uses: a rendered page carries the projection rather than the IR,
 * so there is no state to resolve a node id against. {@link useRunner} is the same engine with
 * the operation resolved out of the state first.
 *
 * @param source - The operation projection, or nothing when the page has none
 * @returns The runner for it
 *
 * @example
 * const { send, pending } = useRunnerFor(() => props.run);
 */
export function useRunnerFor(source: MaybeRefOrGetter<RunnerOperationView | undefined>): UseRunner {
  const port = useRunnerPort();
  const operation = computed(() => toValue(source));
  const pending = ref(false);
  const result = ref<RunnerResult | undefined>(undefined);
  const error = ref<string | undefined>(undefined);

  async function send(args: UseRunnerSendArgs): Promise<RunnerResult> {
    const target = operation.value;

    if (port === undefined || target === undefined) {
      throw new RunnerError(
        port === undefined
          ? 'no runner was provided above this component, so nothing can be sent'
          : 'this node carries no operation to send',
        ErrorCode.RUN_NOT_AVAILABLE,
        undefined,
        { nodeId: target?.nodeId },
      );
    }

    pending.value = true;
    error.value = undefined;

    try {
      const response = await port.send({
        operation: target,
        serverUrl: args.serverUrl,
        values: args.values,
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.mediaType === undefined ? {} : { mediaType: args.mediaType }),
      });
      result.value = response;
      return response;
    } catch (cause) {
      error.value = messageOf(cause);
      result.value = undefined;
      throw cause;
    } finally {
      pending.value = false;
    }
  }

  return {
    id: computed(() => operation.value?.nodeId),
    available: computed(() => port !== undefined && operation.value !== undefined),
    pending: computed(() => pending.value),
    result: computed(() => result.value),
    error: computed(() => error.value),
    operation,
    credential: (schemeId) => port?.credential(schemeId),
    setCredential: (schemeId, value) => {
      port?.setCredential(schemeId, value);
    },
    send,
  };
}

/**
 * @param id - Operation node id, or nothing to follow the current selection
 * @returns The runner for that operation
 * @throws {ThemeContractError} When no state was provided above
 *
 * @example
 * const { available, send } = useRunner();
 */
export function useRunner(id?: MaybeRefOrGetter<string | undefined>): UseRunner {
  const state = useDocState();
  const { node } = useNode(id);

  return useRunnerFor(() => {
    const view = node.value;
    if (view?.kind !== 'operation') return undefined;

    return runnerOperationOf(view.node, state.document.value);
  });
}

/**
 * The one sentence a console shows when a send failed.
 *
 * An `OpenRefError` already carries a message written for a reader, so it is used as it stands.
 * Anything else is reported by kind rather than by its own message: a `TypeError` out of the
 * network stack says `Failed to fetch`, which tells a reader nothing about what to do next.
 */
function messageOf(cause: unknown): string {
  if (cause instanceof OpenRefError) return cause.message;
  if (cause instanceof Error && cause.message !== '') return cause.message;

  return 'the request failed for an unknown reason';
}

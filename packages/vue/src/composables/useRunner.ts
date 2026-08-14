import { ErrorCode, OpenRefError, RunnerError } from '@openref/core';
import { computed, ref, toValue } from 'vue';
import type { ComputedRef, MaybeRefOrGetter } from 'vue';
import { useRunnerPort } from '../runner/api/context';
import { runnerOperationOf } from '../runner/domain/runner-operation';
import { useDocState } from '../state/api/context';
import { useNode } from './useNode';
import type {
  IRunnerPort,
  RunnerBody,
  RunnerDeviceAuthorization,
  RunnerOAuthClient,
  RunnerOAuthFlowKind,
  RunnerOAuthFlowView,
  RunnerOperationView,
  RunnerResult,
  RunnerSecuritySchemeView,
  RunnerSessionStatus,
  RunnerSignInOutcome,
  RunnerValue,
} from '../runner/application/ports/runner.port';

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
 *
 * THE SIGN IN SURFACE IS HERE SINCE T031, AND THE REASON IT WAS NOT IS WORTH KEEPING. T028 built
 * the OAuth2 half of `IRunnerPort` and left the glue in the try-it console, because this module
 * sat in the first paint chunk of every page and everything it retained was downloaded by
 * readers who never open a console. The cause turned out to be the barrel rather than the
 * package, per `src/runner.ts`: from T031 these two functions are reached through
 * `@openref/vue/runner`, which the first paint never imports, so the surface costs the Send
 * gesture and costs the first paint minus 962 bytes.
 *
 * WHAT IS DELIBERATELY NOT HERE IS ANYTHING THAT TOUCHES A WINDOW. A redirect outcome is handed
 * back rather than followed, and reading what happened on the way back from an authorization
 * server stays in whatever owns the page, because a headless layer that navigated could not be
 * server rendered.
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

  /**
   * Whether this runner runs OAuth2 flows at all, per SPEC 14.4.
   *
   * The port's OAuth2 half is optional, so a host may compose a runner that sends requests and
   * knows nothing about sign in. A theme draws no sign in control when this is false, rather
   * than drawing one that refuses.
   */
  readonly signInAvailable: ComputedRef<boolean>;

  /** What each scheme's session looks like, keyed by scheme id, as far as anything has asked. */
  readonly sessions: ComputedRef<Readonly<Record<string, RunnerSessionStatus>>>;

  /**
   * Device flows waiting on the reader, keyed by scheme id.
   *
   * An entry appears when a device flow has told the reader a code to enter and disappears when
   * the authorization server has answered, whichever way it answered.
   */
  readonly devices: ComputedRef<Readonly<Record<string, RunnerDeviceAuthorization>>>;

  /** The scheme a sign in is running for, or undefined when none is. */
  readonly signingIn: ComputedRef<string | undefined>;

  /**
   * The flows a scheme can be signed in with: its own, or the ones its discovery document
   * answered with once {@link UseRunner.signIn} has asked for them.
   *
   * @param scheme - The security scheme
   * @returns The flows, empty when the scheme declares none and nothing has been discovered
   */
  flows(scheme: RunnerSecuritySchemeView): readonly RunnerOAuthFlowView[];

  /**
   * Re-reads one scheme's session from the runner.
   *
   * @param schemeId - Id of the security scheme
   */
  refreshSession(schemeId: string): void;

  /**
   * Signs in, running discovery and the device wait where the flow needs them.
   *
   * A REDIRECT IS RETURNED RATHER THAN FOLLOWED. Navigating is a decision about a window, and
   * this layer has no window: a headless composable that called `location.assign` could not be
   * server rendered and could not be tested without one. Whoever draws the control follows it.
   *
   * @param args - The scheme, the flow the reader chose, and what they typed
   * @returns Whether the reader is signed in, has to be redirected, or approved a device
   * @throws {RunnerError} When no runner was provided, when this runner runs no OAuth2 flows,
   *         or when the scheme offers no flow a browser can run
   */
  signIn(args: UseRunnerSignInArgs): Promise<RunnerSignInOutcome>;

  /**
   * Ends one scheme's session, and re-reads it so a control drawn from `sessions` moves.
   *
   * @param schemeId - Id of the security scheme
   */
  signOut(schemeId: string): void;
}

/** What a send needs beyond the operation itself. */
export interface UseRunnerSendArgs {
  readonly serverUrl: string;
  /** Parameter values keyed by `${location}:${name}`, absent when the reader filled nothing in. */
  readonly values: Readonly<Record<string, RunnerValue>>;
  /** What the reader supplied for the body, in one of the three forms of SPEC 14.3. */
  readonly body?: RunnerBody;
  readonly mediaType?: string;
}

/** What a sign in needs beyond the scheme itself. */
export interface UseRunnerSignInArgs {
  readonly scheme: RunnerSecuritySchemeView;
  /** The flow the reader chose. The first flow the scheme offers when absent. */
  readonly flowKind?: RunnerOAuthFlowKind;
  /** Client id, secret, scopes and password grant fields, as the reader supplied them. */
  readonly client: RunnerOAuthClient;
  /** Where an authorization server returns the reader to, and where they were. */
  readonly redirect?: { readonly redirectUri: string; readonly returnPath: string };
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
  // THE SIGN IN STATE IS HERE AND THE CREDENTIALS ARE NOT, and the difference is what SPEC 14.4
  // stores. A session's status, a device's user code and which flows a discovery document
  // answered with are all facts about a sign in that is running; none of them is a secret, and
  // none of them is written anywhere by this composable. What the reader typed into a sign in
  // form is passed through to the port and never held here at all.
  const discovered = ref<Record<string, readonly RunnerOAuthFlowView[]>>({});
  const sessions = ref<Record<string, RunnerSessionStatus>>({});
  const devices = ref<Record<string, RunnerDeviceAuthorization>>({});
  const signingIn = ref<string | undefined>(undefined);

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

  /**
   * The port, or the refusal that names which half of it is missing.
   *
   * TWO SENTENCES RATHER THAN ONE, because "there is no runner" and "this runner does not run
   * OAuth2 flows" send a reader to two different places, and SPEC 14.4 makes the second half of
   * the port optional precisely so that the second sentence can be true on its own.
   *
   * @param schemeId - Id of the security scheme, for the error context
   * @returns The port's `signIn`, already bound
   * @throws {RunnerError} When there is no runner, or the runner runs no OAuth2 flows
   */
  function requireSignIn(schemeId: string): NonNullable<IRunnerPort['signIn']> {
    if (port === undefined) {
      throw new RunnerError(
        'no runner was provided above this component, so nothing can be signed in',
        ErrorCode.RUN_NOT_AVAILABLE,
        undefined,
        { schemeId },
      );
    }

    const signInAt = port.signIn?.bind(port);
    if (signInAt === undefined) {
      throw new RunnerError(
        'the runner this reference was composed with does not run OAuth2 flows',
        ErrorCode.RUN_NOT_AVAILABLE,
        undefined,
        { schemeId },
      );
    }

    return signInAt;
  }

  function flows(scheme: RunnerSecuritySchemeView): readonly RunnerOAuthFlowView[] {
    return scheme.flows.length > 0 ? scheme.flows : (discovered.value[scheme.id] ?? []);
  }

  function refreshSession(schemeId: string): void {
    sessions.value = {
      ...sessions.value,
      [schemeId]: port?.sessionStatus?.(schemeId) ?? { signedIn: false, renewable: false },
    };
  }

  async function signIn(args: UseRunnerSignInArgs): Promise<RunnerSignInOutcome> {
    const scheme = args.scheme;
    const signInAt = requireSignIn(scheme.id);
    signingIn.value = scheme.id;

    try {
      // DISCOVERY RUNS ONLY WHEN THE DOCUMENT DECLARED NOTHING, per SPEC 14.4. A scheme that
      // names its own flows is answered from the page, so an `openIdConnect` scheme is the only
      // one that costs a request before the reader can be asked which flow they want.
      let available = flows(scheme);
      if (available.length === 0 && scheme.openIdConnectUrl !== undefined) {
        available = (await port?.discover?.(scheme.openIdConnectUrl)) ?? [];
        discovered.value = { ...discovered.value, [scheme.id]: available };
      }

      const flow = available.find((candidate) => candidate.kind === args.flowKind) ?? available[0];
      if (flow === undefined) {
        throw new RunnerError(
          'this scheme declares no flow that can be run from a browser',
          ErrorCode.RUN_AUTH_FAILED,
          undefined,
          { schemeId: scheme.id },
        );
      }

      const outcome = await signInAt(scheme.id, flow, args.client, args.redirect);

      // A REDIRECT IS HANDED BACK UNTOUCHED AND THE SESSION IS NOT RE-READ. The reader has not
      // signed in yet; they are about to leave the page, and the answer arrives on the way back
      // through the landing route, which is a different page load.
      if (outcome.kind === 'redirect') return outcome;

      if (outcome.kind === 'device') {
        devices.value = { ...devices.value, [scheme.id]: outcome.device };
        try {
          await port?.completeDeviceAuthorization?.(scheme.id);
        } finally {
          const { [scheme.id]: _approved, ...rest } = devices.value;
          devices.value = rest;
        }
      }

      refreshSession(scheme.id);
      return outcome;
    } finally {
      signingIn.value = undefined;
    }
  }

  function signOut(schemeId: string): void {
    port?.signOut?.(schemeId);
    refreshSession(schemeId);
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
    signInAvailable: computed(() => port?.signIn !== undefined),
    sessions: computed(() => sessions.value),
    devices: computed(() => devices.value),
    signingIn: computed(() => signingIn.value),
    flows,
    refreshSession,
    signIn,
    signOut,
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

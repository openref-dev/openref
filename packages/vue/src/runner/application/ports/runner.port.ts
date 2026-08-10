/**
 * How a request runner reaches the headless layer.
 *
 * DEFINED HERE RATHER THAN IMPORTED, exactly as `ISearchPort` is and for the same reason: the
 * dependency rule of STANDARDS 3.5 gives this package one upstream, `core`, so `vue` cannot see
 * `@openref/runner` and must not. A `RequestRunner` from that package satisfies this port
 * structurally, so the runner is not made to know about the port either, and the two are proved
 * to agree wherever they are composed.
 *
 * THE PORT HOLDS THE CREDENTIALS. They are not a member of the send call, not a prop and not a
 * field of any page model, so nothing above the runner ever holds one. A component reads a
 * value back to fill its own field and writes one when the reader types; both go through here.
 */

import type { IRParameterLocation, IRParameterStyle, IRSecuritySchemeType } from '@openref/core';

/** One parameter, reduced to what sending it requires. */
export interface RunnerParameterView {
  readonly name: string;
  readonly in: IRParameterLocation;
  readonly required: boolean;
  readonly style: IRParameterStyle;
  readonly explode: boolean;
  readonly allowReserved?: boolean;
}

/** One security scheme, reduced to what sending it requires. */
export interface RunnerSecuritySchemeView {
  readonly id: string;
  readonly type: IRSecuritySchemeType;
  readonly in?: 'query' | 'header' | 'cookie';
  readonly name?: string;
  readonly scheme?: string;
}

/**
 * One operation, reduced to what sending it requires.
 *
 * A plain JSON projection rather than the IR node, so it travels inside a rendered page without
 * the document travelling with it. {@link runnerOperationOf} derives it from the IR.
 */
export interface RunnerOperationView {
  readonly nodeId: string;
  readonly method: string;
  readonly path: string;
  readonly parameters: readonly RunnerParameterView[];
  /** Server urls, the operation's own overrides first, else the document's. */
  readonly servers: readonly string[];
  readonly security: readonly RunnerSecuritySchemeView[];
  /** Media types the request body is declared with, in document order. */
  readonly bodyMediaTypes: readonly string[];
}

/** One response header. */
export interface RunnerResultHeader {
  readonly name: string;
  readonly value: string;
}

/** What came back, and how long it took. */
export interface RunnerResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: readonly RunnerResultHeader[];
  readonly body: string;
  readonly durationMs: number;
}

/** One send: which operation, against which server, with what typed into it. */
export interface RunnerSendInput {
  readonly operation: RunnerOperationView;
  readonly serverUrl: string;
  /** Parameter values keyed by `${location}:${name}`. */
  readonly values: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly mediaType?: string;
}

/** A request runner, as the headless layer sees one. */
export interface IRunnerPort {
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
   * @param input - Operation, server and what the reader typed
   * @returns Status, headers, body and duration
   */
  send(input: RunnerSendInput): Promise<RunnerResult>;
}

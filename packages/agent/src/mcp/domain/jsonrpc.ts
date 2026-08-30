/**
 * JSON-RPC 2.0, the subset the MCP endpoint of SPEC 18 speaks, read defensively.
 *
 * WRITTEN HERE RATHER THAN TAKEN FROM AN SDK, and that is a decision with a reason rather than
 * a preference. A dependency is a licence check, a size check and a stop-and-ask under the BUILD
 * protocol, and what would be bought is an envelope of five members. What this package does with
 * the envelope, which methods it answers and what it refuses to expose, is the whole of the work
 * and is not in any SDK.
 *
 * EVERY READ IS A REFUSAL PATH. The body arrives from a caller this server did not write, so
 * nothing is defaulted: a request with no `method` is not a request with an empty method, and an
 * `id` that is an object is not an id. Each is an error object with the code JSON-RPC assigns it,
 * because a peer that cannot tell "I did not understand you" from "there is nothing there" is a
 * peer that retries forever.
 *
 * A NOTIFICATION GETS NO REPLY AT ALL, per JSON-RPC, and that is why {@link readJsonRpc} reports
 * the absence of `id` rather than substituting one. `notifications/initialized` is the one MCP
 * sends after the handshake, and answering it would be a protocol error on this side.
 */

/** The version member JSON-RPC 2.0 requires on every message. */
export const JSONRPC_VERSION = '2.0';

/** Error codes JSON-RPC 2.0 assigns, and the only ones this endpoint produces. */
export const JSONRPC_ERROR = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
} as const;

/** An id as JSON-RPC allows it: a string, a number, or absent on a notification. */
export type JsonRpcId = string | number;

/** One request this endpoint was asked to answer. */
export interface JsonRpcRequest {
  readonly method: string;
  /** Absent exactly when the message is a notification, which is answered with nothing. */
  readonly id?: JsonRpcId;
  readonly params: Readonly<Record<string, unknown>>;
}

/** What {@link readJsonRpc} produced: a request, or the error object to answer with. */
export type JsonRpcRead =
  | { readonly ok: true; readonly request: JsonRpcRequest }
  | {
      readonly ok: false;
      readonly code: number;
      readonly message: string;
      readonly id?: JsonRpcId;
    };

/** One answer, in the shape JSON-RPC serializes. */
export interface JsonRpcResponse {
  readonly jsonrpc: typeof JSONRPC_VERSION;
  readonly id: JsonRpcId | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/**
 * Whether a value is an id JSON-RPC allows.
 *
 * `null` IS NOT ONE HERE, WHICH IS NARROWER THAN THE SPECIFICATION AND DELIBERATE. JSON-RPC
 * allows a null id and says it should not be used; a null id is also what this endpoint answers
 * with when it could not read the request at all, so accepting one as a request id would make a
 * successful answer and a parse failure indistinguishable to the caller.
 *
 * @param value - Whatever was in the `id` member
 * @returns True when it can be echoed back as an id
 */
function isId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * Reads one JSON-RPC request out of a request body.
 *
 * A BATCH IS REFUSED BY NAME RATHER THAN PARTIALLY HANDLED. JSON-RPC allows an array of requests
 * and MCP's own transport does not require one; answering the first element of a batch and
 * dropping the rest is a server that looks like it worked, which is worse than one that says it
 * does not do this.
 *
 * @param body - The request body as text
 * @returns The request, or the error to answer with and the id to answer under if there was one
 */
export function readJsonRpc(body: string): JsonRpcRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, code: JSONRPC_ERROR.parse, message: 'the request body is not JSON' };
  }

  if (Array.isArray(parsed)) {
    return {
      ok: false,
      code: JSONRPC_ERROR.invalidRequest,
      message: 'this endpoint answers one JSON-RPC request per call and not a batch',
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      ok: false,
      code: JSONRPC_ERROR.invalidRequest,
      message: 'a JSON-RPC request is an object',
    };
  }

  const envelope = parsed as Record<string, unknown>;
  const id = isId(envelope.id) ? envelope.id : undefined;

  if (envelope.jsonrpc !== JSONRPC_VERSION) {
    return {
      ok: false,
      code: JSONRPC_ERROR.invalidRequest,
      message: `a JSON-RPC request carries jsonrpc "${JSONRPC_VERSION}"`,
      ...(id === undefined ? {} : { id }),
    };
  }

  if (typeof envelope.method !== 'string' || envelope.method === '') {
    return {
      ok: false,
      code: JSONRPC_ERROR.invalidRequest,
      message: 'a JSON-RPC request names a method',
      ...(id === undefined ? {} : { id }),
    };
  }

  const params =
    typeof envelope.params === 'object' &&
    envelope.params !== null &&
    !Array.isArray(envelope.params)
      ? (envelope.params as Readonly<Record<string, unknown>>)
      : {};

  return {
    ok: true,
    request: { method: envelope.method, params, ...(id === undefined ? {} : { id }) },
  };
}

/**
 * A successful answer.
 *
 * @param id - The id the request carried
 * @param result - What to answer with
 * @returns The response object
 */
export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

/**
 * A failed answer.
 *
 * @param id - The id the request carried, or null when it could not be read
 * @param code - One of {@link JSONRPC_ERROR}
 * @param message - Why, phrased for whoever wrote the caller
 * @returns The response object
 */
export function jsonRpcError(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: JSONRPC_VERSION, id, error: { code, message } };
}

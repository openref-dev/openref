/**
 * The seam between the route table and whichever http server is underneath.
 *
 * A handler in this package receives a request reduced to what a documentation route can
 * possibly need, and returns a status, headers and a body. It never touches a framework
 * object, which is what lets one set of handlers serve Express and Fastify and what lets the
 * whole route table be tested without either.
 */

/** One request, reduced to what a documentation route reads. */
export interface ReferenceRequest {
  /** Route parameters, already decoded by the router. */
  readonly params: Readonly<Record<string, string>>;
  /** Request headers, lower cased. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * CSP nonce the host generated for this response.
   *
   * Absent means the host serves no nonce policy, which is a supported deployment: the shell
   * then writes an empty nonce attribute, per the T011 decision that the attribute is always
   * present so the policy scan can read it.
   */
  readonly nonce?: string;
}

/** What a handler answers with. */
export interface ReferenceReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Text for a document or a payload, bytes for a font. */
  readonly body: string | Uint8Array;
}

/** A route handler. */
export type ReferenceHandler = (request: ReferenceRequest) => Promise<ReferenceReply>;

/**
 * Registers routes on one http server and writes the replies back to it.
 *
 * Named `{Target}{Feature}Adapter` per the conventions: `ExpressReferenceAdapter` and
 * `FastifyReferenceAdapter`.
 */
export interface IReferenceHttpAdapter {
  /** Platform this adapter speaks for, as `getType` reports it. */
  readonly kind: string;
  /**
   * Registers one route.
   *
   * @param pattern - Absolute path pattern in the `:name` dialect
   * @param handler - What answers it
   */
  get(pattern: string, handler: ReferenceHandler): void;
}

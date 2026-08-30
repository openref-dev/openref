/**
 * The seam between the route table and whichever http server is underneath.
 *
 * A handler in this package receives a request reduced to what a documentation route can
 * possibly need, and returns a status, headers and a body. It never touches a framework
 * object, which is what lets one set of handlers serve Express and Fastify and what lets the
 * whole route table be tested without either.
 */

import type { Readable } from 'node:stream';

/** One request, reduced to what a documentation route reads. */
export interface ReferenceRequest {
  /** Route parameters, already decoded by the router. */
  readonly params: Readonly<Record<string, string>>;
  /** Request headers, lower cased. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Query parameters, already decoded by the router.
   *
   * ONE ROUTE READS THIS AND IT IS THE OAuth2 CALLBACK, which is answered by whatever an
   * authorization server put in the url. Every other route here is addressed by its path, which is
   * why this arrived only in M2 and why it is optional: an adapter that does not supply it serves
   * every route but that one.
   */
  readonly query?: Readonly<Record<string, string>>;
  /**
   * CSP nonce the host generated for this response.
   *
   * Absent means the host serves no nonce policy, which is a supported deployment: the shell
   * then writes an empty nonce attribute, per the T011 decision that the attribute is always
   * present so the policy scan can read it.
   */
  readonly nonce?: string;
  /**
   * The request body as text, for the one route that takes one.
   *
   * ONE ROUTE READS THIS AND IT IS THE PROXY OF SPEC 14.5. Every other route here is addressed by
   * its path and answers a `GET`, which is why this arrived only in M2. An adapter that supplies
   * nothing serves every route but that one, and that one then refuses rather than sending a
   * request built out of an absent body.
   */
  readonly body?: string;
}

/** What a handler answers with. */
export interface ReferenceReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /**
   * Text for a document or a payload, bytes for a font, a stream for the bridge of SPEC 14.8.
   *
   * THE STREAM ARM ARRIVED WITH `T056` AND IT WIDENED THIS UNION RATHER THAN ADDING A SIBLING
   * MEMBER, which is recorded in `ai-docs/design/CONTRACT.md` as a break. An optional `stream`
   * beside a `body` would leave a consumer that never heard of it writing the empty body and
   * closing, which is a working response carrying nothing and a defect nothing goes red on. A
   * widened union in an output position stops that consumer's compile instead.
   *
   * EVERY OTHER ROUTE STILL ANSWERS IN ONE WRITE, and that is worth keeping true: a page, a
   * specification and a font are values this package already holds whole, so streaming them would
   * buy nothing and cost the etag comparison its subject.
   */
  readonly body: string | Uint8Array | Readable;
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

  /**
   * Registers one route that takes a body.
   *
   * THE BODY IS READ OFF THE SOCKET RATHER THAN OUT OF A PARSER, and that is a decision about what
   * this package may assume of a host. `express.json()` and `@fastify/formbody` are middleware a
   * host installs or does not, and a proxy route that worked only where one was installed would be
   * a feature whose presence depends on somebody else's configuration. The adapter reads the
   * stream itself, bounded, and hands over text.
   *
   * @param pattern - Absolute path pattern in the `:name` dialect
   * @param handler - What answers it
   */
  post(pattern: string, handler: ReferenceHandler): void;
}

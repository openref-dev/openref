/**
 * The Fastify half of SPEC 23's "both adapters".
 *
 * A reply goes through Fastify's own object rather than through `reply.raw`. Writing to the
 * raw socket leaves Fastify believing the reply was never sent, which turns every response
 * into a warning and, with a timeout configured, into a second response attempt. The three
 * calls used, `status`, `header` and `send`, have been stable across Fastify 4 and 5, which
 * is what NestJS 10 and 11 carry.
 *
 * A `Uint8Array` is handed to `send` as a Buffer. Fastify serializes an unknown object to
 * JSON and would turn a font file into a list of numbers, which is a corruption that looks
 * like a font that failed to load.
 */

import { readRequestBody } from '../../domain/request-body';
import { readNestedString, readStringRecord } from '../../domain/request-shape';
import { failureReply } from '../../domain/reply';
import type {
  IReferenceHttpAdapter,
  ReferenceHandler,
  ReferenceReply,
} from '../../application/ports/reference-http.port';
import type { RouteAdmission, RouteGate } from '../../../visibility/domain/admission';
import type { HttpAdapterLike } from '../../../shared/types/nest-surface';
import type { ReferenceAdapterOptions } from './express-reference.adapter';

/** Where `@fastify/helmet` leaves a nonce on a reply. */
const NONCE_PATHS: readonly (readonly string[])[] = [
  ['cspNonce', 'script'],
  ['cspNonce', 'style'],
];

/** The subset of a Fastify reply used here. */
interface FastifyReplyLike {
  status(code: number): unknown;
  header(name: string, value: string): unknown;
  send(payload: string | Uint8Array): unknown;
}

/**
 * Reports whether a value is a Fastify reply.
 *
 * @param value - Whatever the framework passed
 * @returns True when it carries the three members a reply is written through
 */
function isFastifyReply(value: unknown): value is FastifyReplyLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return (
    typeof candidate.status === 'function' &&
    typeof candidate.header === 'function' &&
    typeof candidate.send === 'function'
  );
}

/**
 * Writes one reply to a Fastify reply object.
 *
 * @param reply - Framework reply
 * @param response - What to write
 * @returns True when it was written, false when the object was not a reply at all
 */
export function writeFastifyReply(reply: unknown, response: ReferenceReply): boolean {
  if (!isFastifyReply(reply)) return false;

  reply.status(response.status);
  for (const [name, value] of Object.entries(response.headers)) reply.header(name, value);
  reply.send(typeof response.body === 'string' ? response.body : Buffer.from(response.body));

  return true;
}

/** Registers the route table on a Fastify based NestJS application. */
export class FastifyReferenceAdapter implements IReferenceHttpAdapter {
  readonly kind = 'fastify';

  /**
   * @param adapter - The NestJS http adapter to register routes on
   * @param admission - The decision of SPEC 19.6, run in front of every route registered here
   * @param options - Nonce lookup and error reporting
   */
  constructor(
    private readonly adapter: HttpAdapterLike,
    private readonly admission: RouteAdmission,
    private readonly options: ReferenceAdapterOptions = {},
  ) {}

  /** @inheritdoc */
  get(pattern: string, handler: ReferenceHandler): void {
    const gate = this.admission.at('get', pattern);

    this.adapter.get(pattern, (request: unknown, reply: unknown): void => {
      this.answer(gate, handler, request, reply, null);
    });
  }

  /** @inheritdoc */
  post(pattern: string, handler: ReferenceHandler): void {
    const gate = this.admission.at('post', pattern);

    this.adapter.post(pattern, (request: unknown, reply: unknown): void => {
      this.answer(gate, handler, request, reply, () => readRequestBody(request));
    });
  }

  /**
   * Runs one handler and writes what it answered.
   *
   * @param gate - The admission for this route
   * @param handler - What answers the route
   * @param request - Framework request
   * @param reply - Framework reply
   * @param readBody - Reads the body, or null on a route that takes none
   */
  private answer(
    gate: RouteGate,
    handler: ReferenceHandler,
    request: unknown,
    reply: unknown,
    readBody: (() => Promise<string>) | null,
  ): void {
    void this.resolve(gate, handler, request, reply, readBody)
      .then((response) => writeFastifyReply(reply, response))
      .catch((cause: unknown) => {
        this.options.onError?.(cause);
        writeFastifyReply(reply, failureReply());
      });
  }

  /**
   * The reply for one request: the refusal, or whatever the handler answered.
   *
   * The body is read after the admission and never before, for the reason the Express half of this
   * pair states at the same method.
   *
   * @param gate - The admission for this route
   * @param handler - What answers the route
   * @param request - Framework request
   * @param reply - Framework reply
   * @param readBody - Reads the body, or null on a route that takes none
   * @returns What to write
   */
  private async resolve(
    gate: RouteGate,
    handler: ReferenceHandler,
    request: unknown,
    reply: unknown,
    readBody: (() => Promise<string>) | null,
  ): Promise<ReferenceReply> {
    const refusal = await gate(request, reply);
    if (refusal !== undefined) return refusal;

    const nonce = this.nonceOf(request, reply);
    const text = readBody === null ? null : await readBody();

    return handler({
      params: readStringRecord(request, 'params'),
      headers: readStringRecord(request, 'headers'),
      query: readStringRecord(request, 'query'),
      ...(nonce === undefined ? {} : { nonce }),
      ...(text === null ? {} : { body: text }),
    });
  }

  /**
   * Finds the nonce for one response.
   *
   * @param request - Framework request
   * @param reply - Framework reply
   * @returns The nonce, or undefined when the host serves no nonce policy
   */
  private nonceOf(request: unknown, reply: unknown): string | undefined {
    const supplied = this.options.nonce?.(request, reply);
    if (supplied !== undefined) return supplied;

    for (const path of NONCE_PATHS) {
      const found = readNestedString(reply, path);
      if (found !== undefined) return found;
    }

    return undefined;
  }
}

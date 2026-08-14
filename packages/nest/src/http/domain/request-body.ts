/**
 * Reading the body of the one route that takes one, without depending on a host's middleware.
 *
 * THE HOST'S PARSER IS USED WHERE IT ALREADY RAN AND NEVER REQUIRED. Fastify parses JSON out of
 * the box and hands over an object; Express parses nothing unless somebody installed
 * `express.json()`. A proxy route that worked on one and 400'd on the other would be a feature
 * whose presence depends on a line in somebody else's bootstrap file, so this reads whichever is
 * there: a parsed body if the framework produced one, and the socket if it did not.
 *
 * IT IS BOUNDED BEFORE IT IS READ AND WHILE IT IS BEING READ. A `Content-Length` above the ceiling
 * is refused without reading anything, and a body with no declared length is cut off at the same
 * number, because a declared length is a claim and the bytes are the fact.
 */

/** How many bytes of proxied request body are accepted. */
export const MAX_REQUEST_BODY_BYTES = 8 * 1024 * 1024;

/**
 * The part of a Node readable stream this reads.
 *
 * The listener takes `unknown` rather than `never`, which is the wider position for a parameter
 * and therefore the narrower one for what may be assigned to it: three listeners are registered
 * here, one per event, and each one narrows the argument itself.
 */
interface ReadableLike {
  on(event: string, listener: (chunk: unknown) => void): unknown;
  destroy(error?: Error): unknown;
}

/**
 * Whether a value can be read as a stream of chunks.
 *
 * @param value - Whatever the framework passed
 * @returns True when it has the two members used here
 */
function isReadable(value: unknown): value is ReadableLike {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;

  return typeof candidate.on === 'function' && typeof candidate.destroy === 'function';
}

/**
 * The body a framework already parsed, as text, or null when it parsed none.
 *
 * @param request - Framework request
 * @returns The body as text, or null
 */
function parsedBodyOf(request: unknown): string | null {
  if (typeof request !== 'object' || request === null) return null;
  const body = (request as Record<string, unknown>).body;

  if (body === undefined || body === null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8');
  if (typeof body === 'object') return JSON.stringify(body);

  return null;
}

/**
 * Reads the request body as text.
 *
 * @param request - Framework request, which may be a stream, may carry a parsed body, or both
 * @returns The body, empty when there was none
 * @throws {Error} When the body is larger than {@link MAX_REQUEST_BODY_BYTES}
 */
export async function readRequestBody(request: unknown): Promise<string> {
  const parsed = parsedBodyOf(request);
  if (parsed !== null) return parsed;

  // Fastify hands over its own request object and keeps the socket on `raw`; Express hands over
  // the socket itself. Trying both is what makes this one function rather than two.
  const raw = (request as { raw?: unknown } | null)?.raw;
  const stream = isReadable(raw) ? raw : isReadable(request) ? request : null;
  if (stream === null) return '';

  const declared = declaredLength(request);
  if (declared !== null && declared > MAX_REQUEST_BODY_BYTES) {
    throw tooLarge(declared);
  }

  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let stopped = false;

    stream.on('data', (chunk: unknown) => {
      if (stopped) return;

      // NARROWED HERE RATHER THAN DECLARED, because what a framework's stream emits is a claim
      // nobody made. A chunk that is neither bytes nor text is dropped rather than coerced, which
      // makes the length this counts the length it kept.
      const bytes =
        typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : chunk instanceof Uint8Array
            ? Buffer.from(chunk)
            : null;
      if (bytes === null) return;

      size += bytes.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        stopped = true;
        stream.destroy();
        reject(tooLarge(size));
        return;
      }

      chunks.push(bytes);
    });

    stream.on('end', () => {
      if (!stopped) resolve(Buffer.concat(chunks).toString('utf8'));
    });

    stream.on('error', (cause: unknown) => {
      if (!stopped) reject(cause instanceof Error ? cause : new Error(String(cause)));
    });
  });
}

/**
 * The declared length of a request, when it declared one.
 *
 * @param request - Framework request
 * @returns The number, or null
 */
function declaredLength(request: unknown): number | null {
  if (typeof request !== 'object' || request === null) return null;
  const headers = (request as Record<string, unknown>).headers;
  if (typeof headers !== 'object' || headers === null) return null;

  const value = (headers as Record<string, unknown>)['content-length'];
  if (typeof value !== 'string') return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * The refusal for a body that is too large.
 *
 * @param size - What was declared or read
 * @returns The error
 */
function tooLarge(size: number): Error {
  return new Error(
    `the request body is ${String(size)} bytes, above the ${String(MAX_REQUEST_BODY_BYTES)} this route accepts`,
  );
}

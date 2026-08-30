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
 *
 * IT ALWAYS SETTLES, AND THAT PROPERTY HAD TO BE PUT HERE RATHER THAN ASSUMED. Found by the blind
 * review of `T058`, per SPEC 14.5: this classified a framework parsed body by its JavaScript type
 * and read "nothing was parsed" off a number, a boolean and `null`, all three of which a JSON
 * parser produces from a legal document. The reader then went to the socket, which that same
 * parser had already drained, so `end` never fired again and the promise never settled. Measured
 * on Fastify at both body taking addresses: `42`, `true` and `null` never answered, while a string
 * and an array did, and Express refused all three at its own strict JSON parser before this
 * function was reached. A route that never answers holds a connection, a handler closure and a
 * pending promise for as long as the client waits, which is a resource leak one request wide.
 *
 * SO THE CLASSIFICATION ASKS WHETHER A BODY WAS PARSED AND NOT WHAT SHAPE IT IS, and the stream
 * path additionally refuses to wait on a stream that has already ended. The two are one fix at two
 * depths: the first removes the cause, the second removes the class, because any future reading of
 * "nothing was parsed" over a drained socket now answers "no bytes" instead of never answering.
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

/** Whether a body was parsed by the framework, and what it says as text. */
type ParsedBody = { readonly parsed: true; readonly text: string } | { readonly parsed: false };

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
 * The body a framework already parsed, as text, or the fact that it parsed none.
 *
 * `undefined` IS THE ONLY "NOTHING WAS PARSED", AND EVERY OTHER VALUE IS A PARSED BODY. That is
 * the whole of the fix the header of this file describes. `null`, a number and a boolean are what
 * a JSON parser hands back for `null`, `42` and `true`, which are legal JSON documents; reading
 * any of them as "no body" sent the caller to a socket the parser had already drained. Both
 * frameworks leave `body` absent when they parsed nothing: Express before its parser runs, Fastify
 * on a request that carried no body at all.
 *
 * WHAT IT DOES NOT DO IS DECIDE WHETHER THE BODY IS USABLE. A route that wants an object refuses a
 * number itself, in its own words, which is where the two callers already differ: `_proxy` answers
 * 403 with the reason and `mcp` answers a JSON-RPC error object. Deciding here would put one of
 * those two sentences in a function that serves both.
 *
 * @param request - Framework request
 * @returns Whether a body was parsed, and its text when one was
 */
function parsedBodyOf(request: unknown): ParsedBody {
  if (typeof request !== 'object' || request === null) return { parsed: false };
  const body = (request as Record<string, unknown>).body;

  if (body === undefined) return { parsed: false };
  if (typeof body === 'string') return { parsed: true, text: body };
  if (body instanceof Uint8Array) {
    return { parsed: true, text: Buffer.from(body).toString('utf8') };
  }

  // A VALUE NO JSON PARSER PRODUCES IS A BODY OF NO TEXT, AND IT IS SAID HERE RATHER THAN LEFT TO
  // `JSON.stringify`. That function answers `undefined` for a function and for a symbol and throws
  // on a `bigint`, and its declared return type says `string` in all three cases, so relying on it
  // would be relying on a type that is wrong. Named, the branch is a statement: a body this reader
  // cannot express as text is empty, which every caller already refuses by name rather than acting
  // on. `null`, a number and a boolean fall through to the serializer below, which is the whole
  // point of the fix.
  if (typeof body === 'function' || typeof body === 'symbol' || typeof body === 'bigint') {
    return { parsed: true, text: '' };
  }

  return { parsed: true, text: JSON.stringify(body) };
}

/**
 * Whether a stream has already delivered everything it will ever deliver.
 *
 * THE SECOND HALF OF THE FIX, AND IT GUARDS THE CLASS RATHER THAN THE CASE. A stream that has
 * ended emits no further `end`, so a reader that attaches a listener to one waits forever. Both
 * flags are read because they answer slightly different questions and neither is guaranteed
 * present on a framework's own object: `readableEnded` is Node's stream flag, `complete` is
 * `IncomingMessage`'s statement that the whole message arrived.
 *
 * @param stream - Whatever the framework handed over
 * @returns True when nothing more can be read from it
 */
function alreadyEnded(stream: unknown): boolean {
  if (typeof stream !== 'object' || stream === null) return false;
  const candidate = stream as { readableEnded?: unknown; complete?: unknown };

  return candidate.readableEnded === true || candidate.complete === true;
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
  if (parsed.parsed) return parsed.text;

  // Fastify hands over its own request object and keeps the socket on `raw`; Express hands over
  // the socket itself. Trying both is what makes this one function rather than two.
  const raw = (request as { raw?: unknown } | null)?.raw;
  const stream = isReadable(raw) ? raw : isReadable(request) ? request : null;
  if (stream === null) return '';

  // A DRAINED STREAM ANSWERS "NO BYTES" RATHER THAN NEVER ANSWERING, per the header of this file.
  // This is unreachable through the two classifications above today, and it is here because it was
  // reachable yesterday and the failure it produced was silence rather than an error.
  if (alreadyEnded(stream) || alreadyEnded(raw)) return '';

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

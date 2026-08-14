import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRunner, type RunnableOperation, type RunnerBody } from '../../src/index';

/**
 * Every body form of SPEC 14.3, sent to a server that actually parses it.
 *
 * A SNAPSHOT OF A MULTIPART BODY PROVES THAT IT DID NOT CHANGE, NOT THAT IT WORKS. The two ways
 * to build one wrongly, a bare line feed where the delimiter needs a CRLF and a file decoded
 * through UTF-8 on the way into a string, both produce a body that looks correct in a diff and
 * that a strict parser refuses or silently truncates. So the assertion here is what a parser saw,
 * and the parser is not this project's: the server hands the bytes to the platform's own
 * `Request.formData`, which is the same implementation a browser uses, and to `URLSearchParams`.
 *
 * THE TRANSPORT IS THE REAL ONE. `RequestRunner` with no transport builds a `FetchHttpTransport`
 * over the global `fetch`, so what is exercised is the whole path from a typed field to bytes on
 * a socket, including the one thing a unit test cannot reach: whether `fetch` accepts the body
 * this package hands it.
 */

/** What the server made of a request, as it reports it back. */
interface Received {
  readonly contentType: string;
  /** For a text body: the text. */
  readonly text?: string;
  /** For a form body: field name to value, with a file reported by name, type and size. */
  readonly fields?: Record<string, string>;
  /** Bytes the server received, which is how a corrupted upload is caught. */
  readonly byteLength: number;
}

let server: Server;
let origin: string;
let requests = 0;

/** Reads the whole request body, since a runner test is the wrong place to stream one. */
async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

/**
 * Describes one request using parsers this project did not write.
 *
 * `Request.formData` is undici's multipart parser, which is the one the browser's `fetch` uses.
 * If the body this package builds is not readable by it, it is not readable by a browser either.
 */
async function describeRequest(request: IncomingMessage, raw: Buffer): Promise<Received> {
  const contentType = request.headers['content-type'] ?? '';
  const base = { contentType, byteLength: raw.byteLength };

  // A BODY TOO BIG TO ECHO IS REPORTED BY ITS SIZE ALONE. Echoing nine megabytes back as hex
  // makes an eighteen megabyte response, which the runner's own response ceiling refuses, and
  // the case would then fail on the way back for a reason that has nothing to do with what it
  // is about.
  if (raw.byteLength > 64 * 1024) return base;

  if (contentType.startsWith('multipart/')) {
    // THE DEPRECATION IS ABOUT THROUGHPUT IN A PRODUCTION SERVER AND NOT ABOUT CORRECTNESS.
    // undici recommends a streaming parser for a server that handles real uploads; this is a test
    // server reading a few hundred bytes, and undici's own parser is the whole point of the case,
    // because it is the implementation a browser's `fetch` uses. Suppressed here, at one call,
    // with the reason, rather than by touching the rule.
    const parsed = await new Request('http://parse.invalid', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(raw),
      // eslint-disable-next-line @typescript-eslint/no-deprecated
    }).formData();

    const fields: Record<string, string> = {};
    for (const [name, value] of parsed) {
      fields[name] =
        typeof value === 'string'
          ? value
          : `file:${value.name}:${value.type}:${String(value.size)}`;
    }

    return { ...base, fields };
  }

  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    const parsed = new URLSearchParams(raw.toString('utf8'));
    const fields: Record<string, string> = {};
    for (const [name, value] of parsed) fields[name] = value;

    return { ...base, fields };
  }

  if (contentType.startsWith('application/octet-stream')) {
    return { ...base, text: raw.toString('hex') };
  }

  return { ...base, text: raw.toString('utf8') };
}

beforeAll(async () => {
  server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests += 1;

    void bodyOf(request)
      .then((raw) => describeRequest(request, raw))
      .then((received) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(received));
      })
      .catch((cause: unknown) => {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end(cause instanceof Error ? cause.message : 'parse failed');
      });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  origin = `http://127.0.0.1:${String(address.port)}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

/** The operation under test, declaring one media type. */
function operation(mediaType: string): RunnableOperation {
  return {
    nodeId: 'post-uploads',
    method: 'post',
    path: '/uploads',
    parameters: [],
    servers: [origin],
    security: [],
    body: [{ mediaType }],
  };
}

/** Sends one body and returns what the server made of it. */
async function roundTrip(mediaType: string, body: RunnerBody): Promise<Received> {
  const runner = createRunner({ visibility: 'public', storageBacking: {} as never });
  const result = await runner.send({
    operation: operation(mediaType),
    serverUrl: origin,
    values: {},
    body,
    mediaType,
  });

  expect(result.status).toBe(200);

  return JSON.parse(result.body) as Received;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]);

describe('every body form of SPEC 14.3, against a real server', () => {
  it('should round trip application/json', async () => {
    // Given, When
    const received = await roundTrip('application/json', {
      kind: 'text',
      text: '{"sku":"a","qty":2}',
    });

    // Then
    expect(received.contentType).toBe('application/json');
    expect(received.text).toBe('{"sku":"a","qty":2}');
  });

  it('should round trip text/plain', async () => {
    // Given, When
    const received = await roundTrip('text/plain', { kind: 'text', text: 'order 42' });

    // Then
    expect(received.text).toBe('order 42');
  });

  it('should round trip application/x-ndjson, one document per line', async () => {
    // Given, When
    const received = await roundTrip('application/x-ndjson', {
      kind: 'text',
      text: '{"a":1}\n{"b":2}\n',
    });

    // Then
    expect(received.text).toBe('{"a":1}\n{"b":2}\n');
    expect(received.text?.split('\n').filter((line) => line !== '')).toHaveLength(2);
  });

  it('should round trip x-www-form-urlencoded, and the server decodes the plus as a space', async () => {
    // Given, When
    const received = await roundTrip('application/x-www-form-urlencoded', {
      kind: 'fields',
      fields: [
        { kind: 'text', name: 'sku', value: 'a b' },
        { kind: 'text', name: 'note', value: '100% & rising' },
      ],
    });

    // Then, the assertion is what the parser produced rather than what was encoded
    expect(received.fields).toEqual({ sku: 'a b', note: '100% & rising' });
  });

  it('should round trip multipart with a file part beside a JSON part', async () => {
    // Given the case SPEC 14.3 and T027 both name by itself
    const received = await roundTrip('multipart/form-data', {
      kind: 'fields',
      fields: [
        {
          kind: 'text',
          name: 'metadata',
          value: '{"title":"logo"}',
          contentType: 'application/json',
        },
        {
          kind: 'file',
          name: 'file',
          file: { fileName: 'logo.png', mediaType: 'image/png', bytes: PNG_BYTES },
        },
      ],
    });

    // Then, undici's own multipart parser read both parts, the file as a file with its name, its
    // type and every one of its bytes, including the two that are not valid UTF-8
    expect(received.fields?.metadata).toBe('{"title":"logo"}');
    expect(received.fields?.file).toBe(`file:logo.png:image/png:${String(PNG_BYTES.length)}`);
  });

  it('should round trip application/octet-stream byte for byte', async () => {
    // Given, When
    const received = await roundTrip('application/octet-stream', {
      kind: 'binary',
      file: { fileName: 'logo.png', mediaType: 'image/png', bytes: PNG_BYTES },
    });

    // Then, hex rather than text, because the point is the bytes that UTF-8 would have replaced
    expect(received.text).toBe(Buffer.from(PNG_BYTES).toString('hex'));
    expect(received.byteLength).toBe(PNG_BYTES.length);
  });
});

describe('maxBodyBytes, against the same server', () => {
  it('should refuse a 10 MB body without sending it, and say what to do', async () => {
    // Given ten megabytes and the default ceiling of eight, which is the case T027 states. What
    // makes this a message rather than a hang is that the refusal reads a length that is already
    // known: nothing is copied, nothing is encoded, and no request is made.
    const before = requests;
    const runner = createRunner({ visibility: 'public', storageBacking: {} as never });

    // When
    const send = runner.send({
      operation: operation('application/octet-stream'),
      serverUrl: origin,
      values: {},
      body: {
        kind: 'binary',
        file: {
          fileName: 'big.bin',
          mediaType: 'application/octet-stream',
          bytes: new Uint8Array(10 * 1024 * 1024),
        },
      },
      mediaType: 'application/octet-stream',
    });

    // Then
    await expect(send).rejects.toThrow(/maxBodyBytes/);
    expect(requests).toBe(before);
  });

  it('should send a body under a raised ceiling, so the ceiling is a setting rather than a wall', async () => {
    // Given the same body against a host that raised the limit. An assertion that something is
    // refused proves nothing unless the same path admits what it should.
    const runner = createRunner({
      visibility: 'public',
      storageBacking: {} as never,
      maxBodyBytes: 12 * 1024 * 1024,
    });

    // When
    const result = await runner.send({
      operation: operation('application/octet-stream'),
      serverUrl: origin,
      values: {},
      body: {
        kind: 'binary',
        file: {
          fileName: 'big.bin',
          mediaType: 'application/octet-stream',
          bytes: new Uint8Array(9 * 1024 * 1024),
        },
      },
      mediaType: 'application/octet-stream',
    });

    // Then
    expect(result.status).toBe(200);
    expect((JSON.parse(result.body) as Received).byteLength).toBe(9 * 1024 * 1024);
  });
});

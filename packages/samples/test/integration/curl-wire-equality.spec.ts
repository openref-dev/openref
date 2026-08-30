/**
 * The test SPEC 18 and T057 are really about: the generated cURL, executed by cURL against a live
 * server, produces the request the runner produces, compared at the wire level.
 *
 * IT RUNS THE REAL BINARY THROUGH A REAL SHELL. Parsing the command in JavaScript and replaying it
 * with `fetch` would prove that this package's emitter agrees with a parser this package also
 * wrote, which is the shape of proof that lets both be wrong together. `sh -c` also puts the
 * quoting under test: a body carrying a quote, a dollar sign or a backtick reaches the server as
 * the reader wrote it, or the case fails.
 *
 * THE SERVER RECORDS BYTES AND NOT MEANINGS. It keeps the request target as the request line
 * carried it, the header field values as they arrived, and the body as a buffer, so the comparison
 * is between two wires and not between two interpretations of them.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchHttpTransport, isMultipart } from '@openref/runner';
import type { RunnableOperation } from '@openref/runner';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import type { SampleRequest } from '../../src/index';
import { pngFile } from '../mocks/operations';

/** One request as the server saw it. */
interface Wire {
  readonly method: string;
  readonly target: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
}

/** One part of a multipart body, as the framing carried it. */
interface Part {
  readonly disposition: string;
  readonly contentType: string;
  readonly body: Buffer;
}

let server: Server;
let origin = '';
let workDirectory = '';
const seen: Wire[] = [];

/** Reads the whole request body. */
async function bodyOf(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);

  return Buffer.concat(chunks);
}

beforeAll(async () => {
  // A PROOF OF PRESENCE BEFORE ANY PROOF OF EQUALITY: without the binary this suite proves
  // nothing, and a suite that cannot determine its fact says so rather than passing.
  const version = await runShell('curl --version', process.cwd());
  expect(version.code, `curl is not runnable here: ${version.stderr}`).toBe(0);
  expect(version.stdout.startsWith('curl ')).toBe(true);

  workDirectory = await mkdtemp(join(tmpdir(), 'openref-samples-'));
  await writeFile(join(workDirectory, pngFile().fileName), pngFile().bytes);

  server = createServer((request, response) => {
    void (async () => {
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers[name] = value;
      }

      seen.push({
        method: request.method ?? '',
        target: request.url ?? '',
        headers,
        body: await bodyOf(request),
      });

      response.writeHead(204).end();
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  origin = `http://127.0.0.1:${String(address.port)}`;
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(async () => {
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve();
    }),
  );
});

/** Runs one shell command and waits for it. */
function runShell(
  command: string,
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('sh', ['-c', command], { cwd });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** The cURL sample of a request. */
function curlOf(request: SampleRequest): string {
  const sample = generateCodeSamples(request).samples.find((entry) => entry.lang === 'shell');
  expect(sample).toBeDefined();

  return sample?.source ?? '';
}

/**
 * Sends the same request twice, once through the runner's transport and once through cURL.
 *
 * @param request - The request under test
 * @returns What the server saw, runner first
 */
async function bothWays(request: SampleRequest): Promise<readonly [Wire, Wire]> {
  seen.length = 0;

  await new FetchHttpTransport().send(request.plan);
  const command = curlOf(request);
  const run = await runShell(command, workDirectory);
  expect(run.code, `curl failed: ${run.stderr}\n${command}`).toBe(0);

  expect(seen).toHaveLength(2);

  return [seen[0]!, seen[1]!];
}

/** The boundary a multipart content type declares. */
function boundaryOf(contentType: string): string {
  const match = /boundary=(?<boundary>[^;]+)/.exec(contentType);
  expect(match?.groups?.boundary, `no boundary in ${contentType}`).toBeDefined();

  return match?.groups?.boundary ?? '';
}

/** Splits a multipart body into its parts, by the boundary its content type declares. */
function partsOf(wire: Wire): readonly Part[] {
  const boundary = boundaryOf(wire.headers['content-type'] ?? '');
  const sections = wire.body.toString('binary').split(`--${boundary}`);

  return sections
    .filter((section) => section !== '' && section !== '--\r\n' && section !== '--')
    .map((section) => {
      const cut = section.indexOf('\r\n\r\n');
      const head = section.slice(0, cut);
      const body = section.slice(cut + 4, section.length - 2);
      const disposition = /content-disposition: ([^\r\n]+)/i.exec(head)?.[1] ?? '';
      const contentType = /content-type: ([^\r\n]+)/i.exec(head)?.[1] ?? '';

      return { disposition, contentType, body: Buffer.from(body, 'binary') };
    });
}

/**
 * Compares two wires over everything the request declares.
 *
 * A MULTIPART CONTENT TYPE IS COMPARED AS A MEDIA TYPE AND ITS PARTS, not as a string, and that
 * is the one difference this suite accepts. The boundary is chosen by whoever frames the body,
 * so the runner's and curl's differ by construction; what has to match is every part the reader
 * supplied, byte for byte.
 */
function expectSameWire(request: SampleRequest, runner: Wire, curl: Wire): void {
  expect(curl.method).toBe(runner.method);
  expect(curl.method).toBe(request.plan.method);
  expect(curl.target).toBe(runner.target);
  expect(`${origin}${curl.target}`).toBe(request.plan.url);

  const multipart = isMultipart(request.contentType ?? '');

  for (const [name, value] of Object.entries(request.plan.headers)) {
    const field = name.toLowerCase();
    expect(runner.headers[field], `runner dropped ${name}`).toBeDefined();

    if (multipart && field === 'content-type') {
      expect(curl.headers[field]?.startsWith('multipart/form-data;')).toBe(true);
      continue;
    }

    expect(curl.headers[field], `curl sent a different ${name}`).toBe(value);
    expect(runner.headers[field]).toBe(value);
  }

  if (multipart) {
    expect(partsOf(curl)).toEqual(partsOf(runner));
    return;
  }

  expect(curl.body.equals(runner.body)).toBe(true);
}

/** An operation pointed at the live server. */
function operation(
  overrides: Partial<RunnableOperation> & Pick<RunnableOperation, 'method' | 'path'>,
): RunnableOperation {
  return {
    nodeId: 'wire',
    parameters: [],
    security: [],
    body: [],
    ...overrides,
    servers: [origin],
  };
}

describe('the generated cURL and the runner send one request', () => {
  it(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'get',
          path: '/pets',
          parameters: [
            { name: 'limit', in: 'query', required: false, style: 'form', explode: true },
            { name: 'tags', in: 'query', required: false, style: 'form', explode: false },
            { name: 'X-Trace', in: 'header', required: false, style: 'simple', explode: false },
          ],
          security: [{ id: 'k', type: 'apiKey', in: 'header', name: 'X-Api-Key' }],
        }),
        {
          values: {
            'query:limit': { kind: 'primitive', value: '10' },
            'query:tags': { kind: 'array', value: ['cat', 'small dog'] },
            'header:X-Trace': { kind: 'primitive', value: 'abc 123' },
          },
          serverUrl: origin,
        },
        { k: 'key-value' },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      expect(curl.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should agree on a JSON body carrying the characters a shell would otherwise read',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'post',
          path: '/pets',
          body: [{ mediaType: 'application/json' }],
          security: [{ id: 'b', type: 'http', scheme: 'basic' }],
        }),
        {
          values: {},
          serverUrl: origin,
          body: { kind: 'text', text: `{"name":"O'Hara $(whoami) \`id\`","n":1}` },
        },
        { b: 'ann:secret' },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      expect(curl.body.toString('utf8')).toBe(`{"name":"O'Hara $(whoami) \`id\`","n":1}`);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should agree on a form urlencoded body, which the encoder writes and neither client does',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'post',
          path: '/pets',
          body: [{ mediaType: 'application/x-www-form-urlencoded' }],
        }),
        {
          values: {},
          serverUrl: origin,
          body: {
            kind: 'fields',
            fields: [
              { kind: 'text', name: 'name', value: 'one two' },
              { kind: 'text', name: 'note', value: 'a&b=c' },
            ],
          },
        },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      expect(curl.body.toString('utf8')).toBe('name=one+two&note=a%26b%3Dc');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should agree on a multipart body part for part, boundary aside',
    async () => {
      // Given, a text field whose value begins with the character `-F` would read as a file name
      const request = buildSampleRequest(
        operation({
          method: 'post',
          path: '/pets/photo',
          body: [{ mediaType: 'multipart/form-data' }],
        }),
        {
          values: {},
          serverUrl: origin,
          body: {
            kind: 'fields',
            fields: [
              { kind: 'text', name: 'note', value: '@home' },
              { kind: 'file', name: 'cover', file: pngFile() },
            ],
          },
        },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      const parts = partsOf(curl);
      expect(parts).toHaveLength(2);
      expect(parts[0]?.body.toString('utf8')).toBe('@home');
      expect(parts[1]?.body.equals(Buffer.from(pngFile().bytes))).toBe(true);
      expect(boundaryOf(curl.headers['content-type'] ?? '')).not.toBe(
        boundaryOf(runner.headers['content-type'] ?? ''),
      );
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should agree on a multipart text part that declares a content type of its own',
    async () => {
      // Given, the value carries the three characters cURL's own `-F` parser reads: a leading at
      // sign, a semicolon and a quote. `--form-string` is literal and cannot give the part a
      // content type, which the runner's encoder does write, so this part takes the other form.
      const request = buildSampleRequest(
        operation({
          method: 'post',
          path: '/pets/photo',
          body: [{ mediaType: 'multipart/form-data' }],
        }),
        {
          values: {},
          serverUrl: origin,
          body: {
            kind: 'fields',
            fields: [
              {
                kind: 'text',
                name: 'meta',
                value: '@home; said "hi" \\ ok',
                contentType: 'text/plain',
              },
              { kind: 'text', name: 'plain', value: 'no type' },
            ],
          },
        },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      const parts = partsOf(curl);
      expect(parts[0]?.contentType).toBe('text/plain');
      expect(parts[0]?.body.toString('utf8')).toBe('@home; said "hi" \\ ok');
      expect(parts[1]?.contentType).toBe('');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should agree on a binary body, byte for byte',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({ method: 'put', path: '/pets/photo', body: [{ mediaType: 'image/png' }] }),
        { values: {}, serverUrl: origin, body: { kind: 'binary', file: pngFile() } },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      expect(curl.body.equals(Buffer.from(pngFile().bytes))).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should agree on an apiKey that travels in the query string',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'get',
          path: '/pets',
          security: [{ id: 'k', type: 'apiKey', in: 'query', name: 'api key' }],
        }),
        { values: {}, serverUrl: origin },
        { k: 'a/b c' },
      );

      // When
      const [runner, curl] = await bothWays(request);

      // Then
      expectSameWire(request, runner, curl);
      expect(curl.target).toBe('/pets?api%20key=a%2Fb%20c');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

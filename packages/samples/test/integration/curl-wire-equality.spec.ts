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
 * THE SERVER RECORDS BYTES AND NOT MEANINGS, and it is the harness `test/mocks/wire.ts` holds,
 * shared with the suite that drives wget, HTTPie, PowerShell, Swift and Ruby. What is shared is the
 * mechanism; the verdict below is this suite's own, because multipart equality is a question only
 * cURL answers here.
 */

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
import {
  boundaryOf,
  comparableHeaders,
  partHeader,
  partsOf,
  runShell,
  startWireServer,
  withoutBoundary,
} from '../mocks/wire';
import type { Wire, WireServer } from '../mocks/wire';

let wire: WireServer;
let origin = '';
let workDirectory = '';

beforeAll(async () => {
  // A PROOF OF PRESENCE BEFORE ANY PROOF OF EQUALITY: without the binary this suite proves
  // nothing, and a suite that cannot determine its fact says so rather than passing. cURL is
  // required outright rather than skipped, because every machine this project builds on has it.
  const version = await runShell('curl --version', process.cwd());
  expect(version.code, `curl is not runnable here: ${version.stderr}`).toBe(0);
  expect(version.stdout.startsWith('curl ')).toBe(true);

  workDirectory = await mkdtemp(join(tmpdir(), 'openref-samples-'));
  await writeFile(join(workDirectory, pngFile().fileName), pngFile().bytes);

  wire = await startWireServer();
  origin = wire.origin;
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(async () => {
  await wire.close();
});

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
  wire.reset();

  await new FetchHttpTransport().send(request.plan);
  const command = curlOf(request);
  const run = await runShell(command, workDirectory);
  expect(run.code, `curl failed: ${run.stderr}\n${command}`).toBe(0);

  expect(wire.seen).toHaveLength(2);

  return [wire.seen[0]!, wire.seen[1]!];
}

/**
 * Compares two wires over everything the request declares.
 *
 * A MULTIPART CONTENT TYPE IS COMPARED WITHOUT ITS BOUNDARY, not as a string and not as a prefix,
 * and that is the one difference this suite accepts. The boundary is chosen by whoever frames the
 * body, so the runner's and curl's differ by construction; the rest of the field is held to the
 * plan's and every part the reader supplied has to match byte for byte.
 *
 * A PART IS COMPARED OVER EVERY HEADER IT CARRIES, SINCE 2026-09-03, and the reader of it lives in
 * `test/mocks/wire.ts` beside the other one. The reader here named two fields and dropped the rest,
 * so a header a client added to a part of its own was invisible by construction, the same class one
 * level down from the one `comparableHeaders` was rewritten to end.
 */
function expectSameWire(request: SampleRequest, runner: Wire, curl: Wire): void {
  expect(curl.method).toBe(runner.method);
  expect(curl.method).toBe(request.plan.method);
  expect(curl.target).toBe(runner.target);
  expect(`${origin}${curl.target}`).toBe(request.plan.url);

  const multipart = isMultipart(request.contentType ?? '');

  // THE WHOLE REQUEST, MINUS CLIENT IDENTITY, for the reason `comparableHeaders` states: comparing
  // only the fields the plan names made a header the client added invisible by construction. The
  // content type of a multipart body is the one field this suite has always excused, because
  // whoever frames the body picks the boundary, and the parts are compared instead.
  // The boundary is curl's to pick, so both the content type that declares it and the length that
  // follows from it are excused; the parts are compared instead. A request with no body at all is
  // excused its content length for the reason `comparableHeaders` gives.
  const exempt = multipart
    ? ['content-type', 'content-length']
    : request.plan.body === null
      ? ['content-length']
      : [];
  expect(comparableHeaders(curl, exempt)).toEqual(comparableHeaders(runner, exempt));

  for (const [name, value] of Object.entries(request.plan.headers)) {
    const field = name.toLowerCase();
    expect(runner.headers[field], `runner dropped ${name}`).toBeDefined();

    if (multipart && field === 'content-type') {
      // THE BOUNDARY IS EXCUSED AND NOTHING ELSE IN THE FIELD IS, which is what the corrected
      // SPEC 18 sentence states. Reading the field as a prefix left everything after
      // `multipart/form-data;` unlooked at, so a client adding a `charset` of its own would have
      // passed: the exemption is narrow enough to name, and this is it named.
      expect(withoutBoundary(curl.headers[field] ?? '')).toBe(withoutBoundary(value));
      expect(withoutBoundary(runner.headers[field] ?? '')).toBe(withoutBoundary(value));
      expect(boundaryOf(curl.headers[field] ?? '')).not.toBe('');
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
      expect(partHeader(parts[0], 'content-type')).toBe('text/plain');
      expect(parts[0]?.body.toString('utf8')).toBe('@home; said "hi" \\ ok');
      expect(partHeader(parts[1], 'content-type')).toBe('');
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

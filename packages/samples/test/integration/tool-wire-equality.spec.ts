/**
 * The three command line tools, Swift, Ruby and C#, executed for real against a live server,
 * sending the request the runner sends, compared at the wire level.
 *
 * IT IS THE SAME PROOF cURL ALREADY HAS AND FOR THE SAME REASON. SPEC 18's whole claim is that a
 * sample and the button beside it are one request; a claim of that shape is worth exactly as much
 * as the binary that was run to check it. So each sample is handed to a real shell, the runner's
 * own transport sends the same plan, and the server compares what arrived.
 *
 * A CASE THAT CANNOT DETERMINE ITS FACT SAYS SO. Six toolchains are guarded: wget, HTTPie,
 * PowerShell, Swift, Ruby and the .NET SDK. None is on every machine this project builds on, so each
 * group asserts its toolchain is present and skips with the reason named when it is not. It never
 * passes without having sent anything, which is what separates a skip from a green case that proved
 * nothing. Where each group runs is recorded in `tools/gates/src/lib/conditional-cases.ts`, because
 * a guard covering neither machine looks exactly like one covering both.
 *
 * WHAT IS NOT PROVED HERE IS NAMED IN SPEC 18 RATHER THAN LEFT OUT. Kotlin, Dart and Python have no
 * case, because proving any of them means fetching a dependency from the network during a test run:
 * `kotlinc` plus the OkHttp jar, the Dart SDK plus `pub get` for `package:http`, or `pip install
 * httpx` for a system interpreter that does not carry it. Java has none for a different reason,
 * measured 2026-09-04: there is no JDK on the workstation at all, so the group would run on neither
 * machine, which the `test-skips` gate makes an error. Go, PHP, Rust and TypeScript have no case
 * either.
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FetchHttpTransport } from '@openref/runner';
import type { RunnableOperation } from '@openref/runner';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import type { SampleLanguageId, SampleRequest } from '../../src/index';
import { pngFile } from '../mocks/operations';
import { comparableHeaders, runShell, startWireServer, toolIsRunnable } from '../mocks/wire';
import type { Wire, WireServer } from '../mocks/wire';

let wire: WireServer;
let origin = '';
let workDirectory = '';

/**
 * Which binaries answered their version probe, decided once for the whole file.
 *
 * TAKEN AT MODULE LOAD AND NOT IN `beforeAll`, WHICH IS NOT A STYLE CHOICE. Vitest evaluates the
 * condition of `it.skipIf` while it collects the file, before any hook has run, so a record filled
 * in by `beforeAll` is still all false when the decision is made and every case skips on a machine
 * that has all four. Measured: the first edition of this file skipped fourteen of fourteen with
 * wget, HTTPie, PowerShell, Swift and Ruby all installed, which is exactly the silent green a skip is
 * supposed to prevent.
 */
const present = {
  wget: await toolIsRunnable('wget --version'),
  httpie: await toolIsRunnable('http --version'),
  powershell: await toolIsRunnable('pwsh -NoProfile -Command "exit 0"'),
  swift: await toolIsRunnable('swift --version'),
  ruby: await toolIsRunnable('ruby --version'),
  dotnet: await toolIsRunnable('DOTNET_CLI_TELEMETRY_OPTOUT=1 dotnet --version'),
};

beforeAll(async () => {
  wire = await startWireServer();
  origin = wire.origin;

  workDirectory = await mkdtemp(join(tmpdir(), 'openref-tools-'));
  await writeFile(join(workDirectory, pngFile().fileName), pngFile().bytes);
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(async () => {
  await wire.close();
});

/** The sample of one language, which must exist before anything can be proved with it. */
function sampleFor(request: SampleRequest, lang: SampleLanguageId): string {
  const sample = generateCodeSamples(request).samples.find((entry) => entry.lang === lang);
  expect(sample, `${lang} produced no sample to run`).toBeDefined();

  return sample?.source ?? '';
}

/**
 * Sends the same request twice, once through the runner's transport and once through the command.
 *
 * @param request - The request under test
 * @param command - The shell command that sends it a second time
 * @returns What the server saw, runner first
 */
async function bothWays(request: SampleRequest, command: string): Promise<readonly [Wire, Wire]> {
  wire.reset();

  await new FetchHttpTransport().send(request.plan);
  const run = await runShell(command, workDirectory);
  expect(run.code, `the command failed: ${run.stderr}\n${command}`).toBe(0);

  expect(wire.seen, `two requests expected, got ${String(wire.seen.length)}`).toHaveLength(2);

  return [wire.seen[0]!, wire.seen[1]!];
}

/**
 * Compares two wires over everything the request declares.
 *
 * THE WHOLE REQUEST IS COMPARED, MINUS A NAMED LIST, which is what the cURL suite does too. This
 * docblock said the opposite until 2026-09-03 and was contradicted by its own function body: it
 * still described the pre-widening rule, under which only the fields the plan named were held
 * against each other and a header a client invented could fail nothing. What is exempt now is
 * `CLIENT_IDENTITY_HEADERS`, plus `content-length` where the caller asks, and the plan's own
 * headers are still checked against both sides on top of that.
 */
function expectSameWire(
  request: SampleRequest,
  runner: Wire,
  tool: Wire,
  exempt: readonly string[] = [],
): void {
  expect(tool.method).toBe(runner.method);
  expect(tool.method).toBe(request.plan.method);
  expect(tool.target).toBe(runner.target);
  expect(`${origin}${tool.target}`).toBe(request.plan.url);

  // THE WHOLE REQUEST AND NOT THE FIELDS THE PLAN HAPPENS TO NAME. The first edition looped over
  // `request.plan.headers`, so a header the tool added of its own was outside what the comparison
  // could see; `comparableHeaders` inverts that to everything minus a named client identity list.
  // A request with no body is excused its content length, and only that: framing an empty body as
  // `0` or as nothing is the client's choice and both are legal. Everything else is compared, which
  // is what catches a client inventing a content type.
  const excused = request.plan.body === null ? [...exempt, 'content-length'] : exempt;
  expect(comparableHeaders(tool, excused)).toEqual(comparableHeaders(runner, excused));

  // And the plan is still checked against both, so a comparison of two clients that agreed with
  // each other and not with the document would still fail.
  for (const [name, value] of Object.entries(request.plan.headers)) {
    const field = name.toLowerCase();
    expect(runner.headers[field], `the runner dropped ${name}`).toBe(value);
    expect(tool.headers[field], `the tool sent a different ${name}`).toBe(value);
  }

  expect(tool.body.equals(runner.body)).toBe(true);
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

/** A GET carrying query parameters, a header parameter and an apiKey. */
function queryRequest(): SampleRequest {
  return buildSampleRequest(
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
}

/** A JSON body carrying the characters a shell would otherwise read, and a basic credential. */
function hostileBodyRequest(): SampleRequest {
  return buildSampleRequest(
    operation({
      method: 'post',
      path: '/pets',
      body: [{ mediaType: 'application/json' }],
      security: [{ id: 'b', type: 'http', scheme: 'basic' }],
    }),
    {
      values: {},
      serverUrl: origin,
      body: { kind: 'text', text: `{"name":"O'Hara $(whoami) \`id\` é","n":1}` },
    },
    { b: 'ann:secret' },
  );
}

/** An apiKey that travels in the query string, whose value needs percent encoding. */
function encodedQueryRequest(): SampleRequest {
  return buildSampleRequest(
    operation({
      method: 'get',
      path: '/pets',
      security: [{ id: 'k', type: 'apiKey', in: 'query', name: 'api key' }],
    }),
    { values: {}, serverUrl: origin },
    { k: 'a/b c' },
  );
}

/** A binary body, which two of the three tools can send from the file. */
function binaryRequest(): SampleRequest {
  return buildSampleRequest(
    operation({ method: 'put', path: '/pets/photo', body: [{ mediaType: 'image/png' }] }),
    { values: {}, serverUrl: origin, body: { kind: 'binary', file: pngFile() } },
  );
}

/**
 * The PowerShell sample as `pwsh` is handed it, which is how a Windows reader would paste it.
 *
 * DEFINED ONCE, because two spellings of the same shell quoting is how the second one goes wrong:
 * the first attempt at a copy in the redirect group produced an unquoted `Bearer token` and
 * PowerShell tried to run `Bearer` as a command.
 */
function pwshCommand(script: string): string {
  return `pwsh -NoProfile -Command '${script.replace(/'/g, "'\\''")}'`;
}

describe('the generated wget command and the runner send one request', () => {
  it.skipIf(!present.wget)(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = queryRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'sh'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.wget)(
    'should agree on a JSON body carrying the characters a shell would otherwise read',
    async () => {
      // Given
      const request = hostileBodyRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'sh'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.toString('utf8')).toContain('$(whoami)');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.wget)(
    'should agree on a binary body sent from the file, byte for byte',
    async () => {
      // Given
      const request = binaryRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'sh'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.equals(Buffer.from(pngFile().bytes))).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.wget)(
    'should agree on an apiKey that travels in the query string',
    async () => {
      // Given
      const request = encodedQueryRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'sh'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?api%20key=a%2Fb%20c');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the generated HTTPie command and the runner send one request', () => {
  it.skipIf(!present.httpie)(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = queryRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'bash'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.httpie)(
    'should agree on a JSON body carrying the characters a shell would otherwise read',
    async () => {
      // Given
      const request = hostileBodyRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'bash'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.toString('utf8')).toContain('$(whoami)');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.httpie)(
    'should agree on a binary body redirected into it, byte for byte',
    async () => {
      // Given
      const request = binaryRequest();

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'bash'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.equals(Buffer.from(pngFile().bytes))).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.httpie)(
    'should send an empty header value rather than dropping the header',
    async () => {
      // Given, the measured trap: `X-Empty:` removes the header and `X-Empty;` sends it empty
      const request = buildSampleRequest(
        operation({
          method: 'get',
          path: '/pets',
          parameters: [
            { name: 'X-Empty', in: 'header', required: false, style: 'simple', explode: false },
          ],
        }),
        {
          values: { 'header:X-Empty': { kind: 'primitive', value: '' } },
          serverUrl: origin,
        },
      );
      expect(request.plan.headers['X-Empty']).toBe('');

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'bash'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.headers['x-empty']).toBe('');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the generated PowerShell command and the runner send one request', () => {
  it.skipIf(!present.powershell)(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = queryRequest();

      // When
      const [runner, tool] = await bothWays(request, pwshCommand(sampleFor(request, 'powershell')));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.powershell)(
    'should agree on a JSON body carrying the characters a shell would otherwise read',
    async () => {
      // Given
      const request = hostileBodyRequest();

      // When
      const [runner, tool] = await bothWays(request, pwshCommand(sampleFor(request, 'powershell')));

      // Then, the subexpression reached the server as text rather than being run by either shell
      expectSameWire(request, runner, tool);
      expect(tool.body.toString('utf8')).toContain('$(whoami)');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.powershell)(
    'should agree on a binary body read off disk, byte for byte',
    async () => {
      // Given
      const request = binaryRequest();

      // When
      const [runner, tool] = await bothWays(request, pwshCommand(sampleFor(request, 'powershell')));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.equals(Buffer.from(pngFile().bytes))).toBe(true);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.powershell)(
    'should agree on a method the WebRequestMethod enumeration does not name',
    async () => {
      // Given, the reason the emitter writes -CustomMethod for every method
      const request = buildSampleRequest(operation({ method: 'propfind', path: '/pets' }), {
        values: {},
        serverUrl: origin,
      });
      expect(request.plan.method).toBe('PROPFIND');

      // When
      const [runner, tool] = await bothWays(request, pwshCommand(sampleFor(request, 'powershell')));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.method).toBe('PROPFIND');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the generated Swift program and the runner send one request', () => {
  /** Writes the sample to a file and runs it, which is what `swift` does with a script. */
  async function swiftCommand(request: SampleRequest, name: string): Promise<string> {
    const source = sampleFor(request, 'swift');
    await writeFile(join(workDirectory, `${name}.swift`), source, 'utf8');

    return `swift ${name}.swift`;
  }

  it.skipIf(!present.swift)(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = queryRequest();

      // When
      const [runner, tool] = await bothWays(request, await swiftCommand(request, 'query'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.swift)(
    'should agree on a JSON body carrying a quote, a subexpression and a non ASCII character',
    async () => {
      // Given
      const request = hostileBodyRequest();

      // When
      const [runner, tool] = await bothWays(request, await swiftCommand(request, 'body'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.toString('utf8')).toContain('é');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the generated Ruby program and the runner send one request', () => {
  /**
   * Writes the sample to a file and runs it.
   *
   * RUBY WAS ON THE NOT-PROVED LIST AND DID NOT BELONG THERE. It ships with every macOS and most
   * Linux images, needs no dependency beyond its own standard library, and the presence probe this
   * suite already had was all that was missing. C# came off the same list on 2026-09-04, by the
   * same route. The level 2 templates still on it need a toolchain each or a fetched dependency.
   */
  async function rubyCommand(request: SampleRequest, name: string): Promise<string> {
    const source = sampleFor(request, 'ruby');
    await writeFile(join(workDirectory, `${name}.rb`), source, 'utf8');

    return `ruby ${name}.rb`;
  }

  it.skipIf(!present.ruby)(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = queryRequest();

      // When
      const [runner, tool] = await bothWays(request, await rubyCommand(request, 'query'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.ruby)(
    'should agree on a JSON body carrying a quote, a subexpression and an interpolation opener',
    async () => {
      // Given, the two characters `quoteRuby` exists for: `#` opens an interpolation and `\` is
      // the escape, and neither may reach the server as anything but itself
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
          body: { kind: 'text', text: '{"n":"#{1+1} O\'Hara \\\\ ok","q":1}' },
        },
        { b: 'ann:secret' },
      );

      // When
      const [runner, tool] = await bothWays(request, await rubyCommand(request, 'body'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.body.toString('utf8')).toContain('#{1+1}');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.ruby)(
    'should agree on a method Net::HTTP ships no request class for',
    async () => {
      // Given, the generic request path the unit suite pins the source of
      const request = buildSampleRequest(operation({ method: 'propfind', path: '/pets' }), {
        values: {},
        serverUrl: origin,
      });

      // When
      const [runner, tool] = await bothWays(request, await rubyCommand(request, 'exotic'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.method).toBe('PROPFIND');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the generated C# program and the runner send one request', () => {
  /**
   * Writes the sample to a file and runs it as a .NET file based application.
   *
   * ONE LINE IS ADDED AND IT IS DECLARED HERE RATHER THAN LEFT TO BE NOTICED. The C# emitter
   * produces a snippet, which is what SPEC 18 says a level 2 template is: `HttpClient`,
   * `HttpRequestMessage` and `StringContent` are covered by the implicit global usings of a console
   * application, and `MediaTypeHeaderValue` is not, so a body carrying a content type does not
   * compile on its own. The harness prepends `using System.Net.Http.Headers;` and nothing else, and
   * the case below asserts that the file is that one line plus the sample verbatim, so the addition
   * cannot grow into a rewrite of what is under test.
   *
   * TELEMETRY IS OPTED OUT OF, WHICH IS NOT HOUSEKEEPING. The .NET CLI reports usage over the
   * network on first run, and a suite in this repository that made an outgoing request of its own
   * would be the thing the security suite exists to forbid. The presence probe carries the same
   * variable, so the tool is never found present by a probe that behaves differently from the run.
   *
   * @param request - The request under test
   * @param name - A file name stem unique within the work directory
   * @returns The shell command that sends it
   */
  async function csharpCommand(request: SampleRequest, name: string): Promise<string> {
    const source = sampleFor(request, 'csharp');
    const file = `${source.includes('MediaTypeHeaderValue') ? 'using System.Net.Http.Headers;\n\n' : ''}${source}\n`;
    expect(file.endsWith(`${source}\n`), 'the harness added more than one using directive').toBe(
      true,
    );
    await writeFile(join(workDirectory, `${name}.cs`), file, 'utf8');

    return `DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 dotnet run ${name}.cs`;
  }

  it.skipIf(!present.dotnet)(
    'should agree on a GET carrying query parameters, a header parameter and an apiKey',
    async () => {
      // Given
      const request = queryRequest();

      // When
      const [runner, tool] = await bothWays(request, await csharpCommand(request, 'query'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.target).toBe('/pets?limit=10&tags=cat,small%20dog');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.dotnet)(
    'should agree on a JSON body carrying a quote, a subexpression and a non ASCII character',
    async () => {
      // Given
      const request = hostileBodyRequest();

      // When
      const [runner, tool] = await bothWays(request, await csharpCommand(request, 'body'));

      // Then, including the content type, which .NET carries on the content and not on the request,
      // and which is the one refusal this emitter has that is not about bytes
      expectSameWire(request, runner, tool);
      expect(tool.body.toString('utf8')).toContain('é');
      expect(tool.headers['content-type']).toBe('application/json');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the octets a non ASCII header value reaches the server as', () => {
  /**
   * The measurement SPEC 18's refusal is written from, kept as a case so it cannot rot.
   *
   * IT ASSERTS THE OCTETS BECAUSE THE SUBJECT IS AN ENCODING. An earlier edition of this comment
   * said the two encodings compare equal as decoded text; that was false and a blind review said
   * so, since `caf\xE9` decodes to `café` and `caf\xC3\xA9` decodes to `cafÃ©`. The case is
   * unchanged and still right: a claim about which bytes reached the server is checked in bytes,
   * not in whatever Node made of them.
   */
  const value = 'café';

  /** The same header, sent by whichever client the case is about. */
  function headerRequest(): SampleRequest {
    return buildSampleRequest(
      operation({
        method: 'get',
        path: '/h',
        parameters: [
          { name: 'X-N', in: 'header', required: false, style: 'simple', explode: false },
        ],
      }),
      { values: { 'header:X-N': { kind: 'primitive', value } }, serverUrl: origin },
    );
  }

  it(
    'should be one octet from the runner, which is the rule its own platform states',
    async () => {
      // Given
      const request = headerRequest();
      expect(request.plan.headers['X-N']).toBe(value);

      // When
      wire.reset();
      await new FetchHttpTransport().send(request.plan);

      // Then, the ByteString rule of the fetch specification: one octet per code point
      expect(wire.seen).toHaveLength(1);
      expect(wire.seen[0]?.rawHeaders['x-n']?.toString('hex')).toBe('636166e9');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.wget)(
    'should be the UTF-8 pair from a shell command, which is why the form is refused',
    async () => {
      // Given, the command the emitter would have written before the refusal was added
      const request = headerRequest();
      const command = `wget -O - --method 'GET' --header 'X-N: ${value}' ` + `'${origin}/h'`;

      // When
      wire.reset();
      const run = await runShell(command, workDirectory);
      expect(run.code).toBe(0);

      // Then, two octets where the runner sent one: the same header, different bytes
      expect(wire.seen[0]?.rawHeaders['x-n']?.toString('hex')).toBe('636166c3a9');

      // And the generator writes no wget sample for it at all
      expect(generateCodeSamples(request).samples.map((sample) => sample.lang)).not.toContain('sh');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.powershell)(
    'should be refused outright by PowerShell, which sends nothing at all',
    async () => {
      // Given
      const command =
        `pwsh -NoProfile -Command "Invoke-RestMethod -Uri '${origin}/h' -CustomMethod GET ` +
        `-Headers @{ 'X-N' = '${value}' } | Out-Null"`;

      // When
      wire.reset();
      const run = await runShell(command, workDirectory);

      // Then
      expect(run.code).not.toBe(0);
      expect(run.stderr).toContain('ASCII');
      expect(wire.seen).toHaveLength(0);
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('what each client does with a redirect', () => {
  /**
   * The three behaviours behind the note, pinned so the note cannot drift from the clients.
   *
   * THE FIRST REQUEST IS IDENTICAL IN ALL OF THEM, which is what makes this a note rather than a
   * refusal: the plan describes one request and every client sends that request. What differs is
   * what each does with a 302, and that is a client policy the plan says nothing about.
   */
  function redirectRequest(): SampleRequest {
    return buildSampleRequest(
      operation({
        method: 'get',
        path: '/redirect',
        security: [{ id: 'b', type: 'http', scheme: 'bearer' }],
      }),
      { values: {}, serverUrl: origin },
      { b: 'token' },
    );
  }

  /** How many requests a command made, and whether the last one carried the credential. */
  async function follow(command: string): Promise<{ count: number; lastAuth: boolean }> {
    wire.reset();
    const run = await runShell(command, workDirectory);
    expect(run.code, run.stderr).toBe(0);

    return {
      count: wire.seen.length,
      lastAuth: wire.seen[wire.seen.length - 1]?.headers.authorization !== undefined,
    };
  }

  it(
    'should be followed by the runner with the credential re-sent, which is the baseline',
    async () => {
      // Given
      const request = redirectRequest();

      // When
      wire.reset();
      await new FetchHttpTransport().send(request.plan);

      // Then
      expect(wire.seen).toHaveLength(2);
      expect(wire.seen[1]?.target).toBe('/landed');
      expect(wire.seen[1]?.headers.authorization).toBe('Bearer token');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.wget || !present.httpie || !present.powershell || !present.swift)(
    'should be three behaviours across four clients, and the note names the two that differ',
    async () => {
      // Given
      const request = redirectRequest();
      const script = sampleFor(request, 'powershell');
      await writeFile(join(workDirectory, 'redirect.swift'), sampleFor(request, 'swift'), 'utf8');

      // When
      const wgetRun = await follow(sampleFor(request, 'sh'));
      const httpieRun = await follow(sampleFor(request, 'bash'));
      const pwshRun = await follow(pwshCommand(script));
      const swiftRun = await follow('swift redirect.swift');

      // Then, wget matches the runner and therefore carries no note
      expect(wgetRun).toEqual({ count: 2, lastAuth: true });

      // And HTTPie stops at the first response
      expect(httpieRun).toEqual({ count: 1, lastAuth: true });

      // And both of these follow and drop the credential
      expect(pwshRun).toEqual({ count: 2, lastAuth: false });
      expect(swiftRun).toEqual({ count: 2, lastAuth: false });

      // And the note list says exactly that, with wget absent from it
      const notes = generateCodeSamples(request).notes.map((note) => note.lang);
      expect(notes).toContain('bash');
      expect(notes).toContain('powershell');
      expect(notes).toContain('swift');
      expect(notes).not.toContain('sh');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the four divergences the widened wire comparison exposed', () => {
  /**
   * Each is a header a client added or dropped on its own, which the old comparison could not see.
   *
   * THE COMPARISON USED TO LOOK AT THE HEADERS THE PLAN NAMED AND NOTHING ELSE, so a client putting
   * a content type of its own on the wire was outside what any case could fail on. These four are
   * what one run of the widened comparison found, and each is asserted twice: the emitter's output
   * now matches the runner, and the shape it replaced is shown still diverging.
   */
  it.skipIf(!present.powershell)(
    'should stop PowerShell inventing a content type on a bodyless request',
    async () => {
      // Given
      const request = buildSampleRequest(operation({ method: 'post', path: '/b' }), {
        values: {},
        serverUrl: origin,
      });
      expect(request.plan.body).toBeNull();

      // When
      const [runner, tool] = await bothWays(request, pwshCommand(sampleFor(request, 'powershell')));

      // Then
      expectSameWire(request, runner, tool);
      expect(runner.headers['content-type']).toBeUndefined();
      expect(tool.headers['content-type']).toBeUndefined();

      // And the shape the emitter replaced, which is what the old comparison could not see
      wire.reset();
      const bare = await runShell(
        `pwsh -NoProfile -Command "Invoke-RestMethod -Uri '${origin}/b' -CustomMethod POST | Out-Null"`,
        workDirectory,
      );
      expect(bare.code).toBe(0);
      expect(wire.seen[0]?.headers['content-type']).toBe('application/x-www-form-urlencoded');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.ruby)(
    'should stop Ruby inventing a content type on a bodyless request',
    async () => {
      // Given
      const request = buildSampleRequest(operation({ method: 'post', path: '/b' }), {
        values: {},
        serverUrl: origin,
      });

      // When
      const source = sampleFor(request, 'ruby');
      await writeFile(join(workDirectory, 'bodyless.rb'), source, 'utf8');
      const [runner, tool] = await bothWays(request, 'ruby bodyless.rb');

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.headers['content-type']).toBeUndefined();
      expect(source).toContain('Net::HTTPGenericRequest.new("POST", false, true, uri)');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it(
    'should send an empty header value from cURL, which the obvious spelling drops',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'get',
          path: '/e',
          parameters: [
            { name: 'X-Empty', in: 'header', required: false, style: 'simple', explode: false },
          ],
        }),
        { values: { 'header:X-Empty': { kind: 'primitive', value: '' } }, serverUrl: origin },
      );

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'shell'));

      // Then
      expectSameWire(request, runner, tool);
      expect(tool.headers['x-empty']).toBe('');

      // And the spelling it replaced, measured dropping the field entirely
      wire.reset();
      const dropped = await runShell(
        `curl -s -o /dev/null -X GET -H 'X-Empty: ' '${origin}/e'`,
        workDirectory,
      );
      expect(dropped.code).toBe(0);
      expect(wire.seen[0]?.headers['x-empty']).toBeUndefined();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );

  it.skipIf(!present.httpie)(
    'should refuse the HTTPie tab for a header value that would become a body field',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'get',
          path: '/e',
          parameters: [
            { name: 'X-V', in: 'header', required: false, style: 'simple', explode: false },
          ],
        }),
        { values: { 'header:X-V': { kind: 'primitive', value: '=1' } }, serverUrl: origin },
      );

      // Then, no tab at all rather than a command that sends something else
      expect(generateCodeSamples(request).samples.map((entry) => entry.lang)).not.toContain('bash');

      // And what that tab would have sent, measured: the header gone and a JSON body in its place
      wire.reset();
      const run = await runShell(
        `http --ignore-stdin --quiet GET '${origin}/e' 'X-V:=1'`,
        workDirectory,
      );
      expect(run.code).toBe(0);
      expect(wire.seen[0]?.headers['x-v']).toBeUndefined();
      expect(wire.seen[0]?.body.toString('utf8')).toBe('{"X-V": 1}');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('a document that names one of the exempt headers itself', () => {
  /**
   * What keeps the exemption list from being a hole, verified rather than assumed.
   *
   * THE EXEMPTION DROPS A FIELD FROM THE TWO-CLIENT COMPARISON AND FROM NOTHING ELSE. The loop over
   * `request.plan.headers` runs after it and holds both sides to the value the plan states, so a
   * document declaring `Accept-Language` as a header parameter is checked on the runner and on the
   * tool exactly as any other header is. Without this case the safety of the list rests on reading
   * the function.
   */
  it.skipIf(!present.wget)(
    'should still be compared on both sides, since the exemption is only client against client',
    async () => {
      // Given
      const request = buildSampleRequest(
        operation({
          method: 'get',
          path: '/pets',
          parameters: [
            {
              name: 'Accept-Language',
              in: 'header',
              required: false,
              style: 'simple',
              explode: false,
            },
          ],
        }),
        {
          values: { 'header:Accept-Language': { kind: 'primitive', value: 'de-DE' } },
          serverUrl: origin,
        },
      );
      expect(request.plan.headers['Accept-Language']).toBe('de-DE');

      // When
      const [runner, tool] = await bothWays(request, sampleFor(request, 'sh'));

      // Then, the plan's value reached both, which the exempt list did not excuse
      expectSameWire(request, runner, tool);
      expect(runner.headers['accept-language']).toBe('de-DE');
      expect(tool.headers['accept-language']).toBe('de-DE');
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

import {
  DEFAULT_SERVER_URL,
  ErrorCode,
  normalizeOpenApiDocument,
  RunnerError,
  type IROperation,
} from '@openref/core';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import {
  createDocState,
  materializeNode,
  provideDocState,
  provideRunner,
  runnerOperationOf,
  type IRunnerPort,
  type RunnerBodyMediaTypeView,
  type RunnerOperationView,
  type RunnerSecuritySchemeView,
  type RunnerSendInput,
  type RunnerSessionStatus,
  type RunnerSignInOutcome,
} from '../../src/index';
import { useRunner, useRunnerFor, type UseRunner } from '../../src/runner';
import { bodyDocument, simpleDocument } from '../mocks/documents';

/** A port that records what it was asked to send and answers with a fixed response. */
function stubRunner(): IRunnerPort & {
  readonly sent: RunnerSendInput[];
  readonly store: Map<string, string>;
} {
  const sent: RunnerSendInput[] = [];
  const store = new Map<string, string>();

  return {
    sent,
    store,
    credential: (schemeId) => store.get(schemeId),
    setCredential: (schemeId, value) => {
      store.set(schemeId, value);
    },
    send: (input) => {
      sent.push(input);
      return Promise.resolve({
        status: 204,
        statusText: 'No Content',
        headers: [],
        body: '',
        durationMs: 7,
      });
    },
  };
}

/** Runs a composable in a child of a component providing the state and, optionally, a runner. */
async function withRunner<T>(
  body: () => T,
  runner?: IRunnerPort,
  document = simpleDocument(),
): Promise<T> {
  let captured: { value: T } | undefined;

  const child = defineComponent({
    name: 'Child',
    setup() {
      captured = { value: body() };
      return () => h('div');
    },
  });

  const parent = defineComponent({
    name: 'Parent',
    setup() {
      provideDocState(createDocState({ document }));
      if (runner !== undefined) provideRunner(runner);
      return () => h(child);
    },
  });

  await renderToString(createSSRApp(parent));

  if (captured === undefined) throw new Error('the child setup never ran');
  return captured.value;
}

describe('runnerOperationOf', () => {
  it('should project an operation into what sending it requires', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then
    expect(run?.method).toBe('get');
    expect(run?.path).toBe('/orders');
    expect(run?.servers).toEqual(['https://api.example.com']);
    expect(run?.parameters.map((parameter) => parameter.name)).toEqual(['limit', 'X-Trace']);
  });

  /**
   * T026: which cell of the SPEC 14.2 matrix a parameter's values land in.
   *
   * IT IS READ FROM THE SCHEMA AND NOT FROM WHAT THE READER TYPED. A console deciding from the
   * shape of the text in a field would send `1,2` as an array on a parameter the document
   * declared a plain string, and the request would differ from the document by a comma.
   */
  it('should read the value kind of every parameter off the schema it declares', () => {
    // Given a document whose parameters declare a scalar, an array and an object
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'kinds', version: '1' },
      paths: {
        '/things': {
          get: {
            operationId: 'listThings',
            parameters: [
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
              { name: 'tags', in: 'query', schema: { type: 'array', items: { type: 'string' } } },
              {
                name: 'filter',
                in: 'query',
                style: 'deepObject',
                explode: true,
                schema: { type: 'object', properties: { status: { type: 'string' } } },
              },
              { name: 'anything', in: 'query' },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
    const node = document.nodes.get('list-things') ?? [...document.nodes.values()][0];

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then, and a parameter with no schema is `primitive`, because that is the kind that renders
    // as itself at every style rather than the one that invents structure
    expect(run?.parameters.map((parameter) => [parameter.name, parameter.valueKind])).toEqual([
      ['limit', 'primitive'],
      ['tags', 'array'],
      ['filter', 'object'],
      ['anything', 'primitive'],
    ]);
  });

  it('should list parameters in the order the parameter table lists them', () => {
    // Given an operation whose parameters interleave the locations, which is what the demo's
    // `List orders` does: one header parameter written among the query ones. The table renders
    // `materializeNode`, which groups; the console rendered the document's own order, so the
    // header field sat in the middle of the query fields and a reader filling the form after
    // reading the table had to find every one of them twice. Found in a browser on the demo.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Interleaved', version: '1.0.0' },
      paths: {
        '/orders/{id}': {
          get: {
            operationId: 'readOrder',
            parameters: [
              { name: 'currency', in: 'query', schema: { type: 'string' } },
              { name: 'X-Request-Id', in: 'header', schema: { type: 'string' } },
              { name: 'perPage', in: 'query', schema: { type: 'integer' } },
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
    // The id is the one SPEC 5.1 derives from the method and the path, not the `operationId`.
    const node = document.nodes.get('get-orders-id');
    if (node?.kind !== 'operation') throw new Error('the fixture lost its operation');

    // When
    const run = runnerOperationOf(node, document);
    const view = materializeNode(node, document);
    if (view.kind !== 'operation') throw new Error('the fixture lost its operation');
    const table = [...view.parameters.values()].flat();

    // Then the console and the table read the same list in the same order, and the order the
    // author wrote is untouched inside a location: `currency` still precedes `perPage`
    expect(run.parameters.map((parameter) => parameter.name)).toEqual([
      'id',
      'currency',
      'perPage',
      'X-Request-Id',
    ]);
    expect(run.parameters.map((parameter) => parameter.name)).toEqual(
      table.map((parameter) => parameter.name),
    );
  });

  it('should carry the document servers when the operation overrides none', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('post-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then
    expect(run?.servers).toEqual(document.servers.map((server) => server.url));
  });

  it('should resolve a security requirement against the declared scheme', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('get-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then
    expect(run?.security).toEqual([{ id: 'bearer', type: 'http', scheme: 'bearer', flows: [] }]);
  });

  it('should name the media types of a declared request body', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('post-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then
    expect(run?.body.map(({ exampleText: _prefill, ...named }) => named)).toEqual([
      { mediaType: 'application/json', editor: 'text', fields: [] },
    ]);
  });

  it('should prefill the text editor with the generated example, per TX-PARITY-UI', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('post-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;
    const media = run?.body[0];

    // Then
    expect(media?.editor).toBe('text');
    expect(media?.exampleText).toBeDefined();
    expect(JSON.parse(media?.exampleText ?? '')).toBeTypeOf('object');
  });
});

describe('runnerOperationOf, the body editors of SPEC 14.3', () => {
  /** The one operation that declares every body form, projected. */
  function projected(): RunnerOperationView {
    const document = bodyDocument();
    const node = document.nodes.get('post-uploads');
    if (node?.kind !== 'operation') throw new Error('the fixture lost its operation');

    return runnerOperationOf(node, document);
  }

  function media(mediaType: string): RunnerBodyMediaTypeView | undefined {
    return projected().body.find((entry) => entry.mediaType === mediaType);
  }

  it('should give the three text media types one editor between them', () => {
    // Given, When, Then. JSON, ndjson and plain text differ in what the runner validates and in
    // nothing a reader is asked for, which is why there are three editors and not six.
    for (const mediaType of ['application/json', 'text/plain', 'application/x-ndjson']) {
      expect(media(mediaType)?.editor).toBe('text');
      expect(media(mediaType)?.fields).toEqual([]);
    }
  });

  it('should give a schema declared as a binary string the file editor', () => {
    // Given, When, Then
    expect(media('application/octet-stream')?.editor).toBe('binary');
  });

  it('should give a urlencoded body one field per declared property, and no part types', () => {
    // Given, When
    const form = media('application/x-www-form-urlencoded');

    // Then, a urlencoded field has no content type of its own: the body has one for all of it
    expect(form?.editor).toBe('fields');
    expect(form?.fields).toEqual([
      { name: 'sku', required: true, kind: 'text' },
      { name: 'note', required: false, kind: 'text' },
    ]);
  });

  it('should read the file part off the schema and the part types off the property type', () => {
    // Given the case T027 and SPEC 14.3 both name: a file part beside a JSON part. Three part
    // types here are derived from the property types; the fourth is the declared one, because
    // the fixture's document has always written an `encoding` block for it and the normalizer
    // carries it since T034. Until then this row read text/plain, which was the defect the
    // T034 amendment recorded: the declaration was in the document and reached nothing.
    const form = media('multipart/form-data');

    // Then
    expect(form?.editor).toBe('fields');
    expect(form?.fields).toEqual([
      { name: 'file', required: true, kind: 'file', contentType: 'application/octet-stream' },
      { name: 'metadata', required: false, kind: 'text', contentType: 'application/json' },
      // An array takes its item's answer, which for strings is plain text
      { name: 'tags', required: false, kind: 'text', contentType: 'text/plain' },
      { name: 'sidecar', required: false, kind: 'text', contentType: 'application/xml' },
    ]);
  });

  it('should let a declared encoding win over the type it would have derived', () => {
    // Given an operation built by hand. Until T034 this was the only way to reach the branch,
    // because the normalizer never filled `encoding`; the normalized path is the case below,
    // and this one stays because it pins the projection's own precedence with no normalizer in
    // the frame.
    const document = bodyDocument();
    const node = document.nodes.get('post-uploads');
    if (node?.kind !== 'operation') throw new Error('the fixture lost its operation');

    const declared: IROperation = {
      ...node,
      requestBody: {
        required: true,
        content: (node.requestBody?.content ?? []).map((media) =>
          media.mediaType === 'multipart/form-data'
            ? { ...media, encoding: { sidecar: { contentType: 'application/xml' } } }
            : media,
        ),
      },
    };

    // When
    const form = runnerOperationOf(declared, document).body.find(
      (entry) => entry.mediaType === 'multipart/form-data',
    );

    // Then
    expect(form?.fields.find((field) => field.name === 'sidecar')?.contentType).toBe(
      'application/xml',
    );
    // And the derived answers beside it are untouched
    expect(form?.fields.find((field) => field.name === 'metadata')?.contentType).toBe(
      'application/json',
    );
  });

  it('should carry a document-declared part content type through the normalizer to a page', () => {
    // Given a document rather than a hand built operation, per the T034 amendment: the
    // normalizer fills `IRMediaType.encoding` now, so a part content type written in the
    // document reaches the projection with no hand assembly anywhere on the path.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Uploads', version: '1.0.0' },
      paths: {
        '/uploads': {
          post: {
            requestBody: {
              required: true,
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: {
                      file: { type: 'string', format: 'binary' },
                      sidecar: { type: 'string' },
                    },
                    required: ['file'],
                  },
                  encoding: { sidecar: { contentType: 'application/xml' } },
                },
              },
            },
            responses: { '201': { description: 'Created.' } },
          },
        },
      },
    });

    const node = [...document.nodes.values()].find((candidate) => candidate.kind === 'operation');
    if (node?.kind !== 'operation') throw new Error('the fixture lost its operation');

    // When
    const form = runnerOperationOf(node, document).body.find(
      (entry) => entry.mediaType === 'multipart/form-data',
    );

    // Then the document's declaration wins over the default rule, end to end
    expect(form?.fields.find((field) => field.name === 'sidecar')?.contentType).toBe(
      'application/xml',
    );
    expect(form?.fields.find((field) => field.name === 'file')?.contentType).toBe(
      'application/octet-stream',
    );
  });

  it('should list the media types in the order the IR carries them, since the first is the default', () => {
    // Given, When. The normalizer sorts a content map by code point, so this is not the order the
    // fixture writes them in, and the console's default media type is whichever sorts first.
    const types = projected().body.map((entry) => entry.mediaType);

    // Then
    expect(types).toEqual([
      'application/json',
      'application/octet-stream',
      'application/x-ndjson',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
      'text/plain',
    ]);
  });
});

describe('useRunner', () => {
  it('should report unavailable when no runner was provided above', async () => {
    // Given, a reference published read only is a supported build rather than a broken one.
    const runner = await withRunner(() => useRunner('get-orders'));

    // When
    const available = runner.available.value;

    // Then
    expect(available).toBe(false);
  });

  it('should report available once a runner is provided', async () => {
    // Given
    const runner = await withRunner(() => useRunner('get-orders'), stubRunner());

    // When
    const available = runner.available.value;

    // Then
    expect(available).toBe(true);
  });

  it('should send the projection of the operation it was pointed at', async () => {
    // Given
    const port = stubRunner();
    const runner = await withRunner(() => useRunner('get-orders'), port);

    // When
    await runner.send({
      serverUrl: 'https://api.example.com',
      values: { 'query:limit': { kind: 'primitive', value: '10' } },
    });

    // Then
    expect(port.sent[0]?.operation.nodeId).toBe('get-orders');
    expect(port.sent[0]?.values).toEqual({ 'query:limit': { kind: 'primitive', value: '10' } });
  });

  it('should hold the result of the last send', async () => {
    // Given
    const runner = await withRunner(() => useRunner('get-orders'), stubRunner());

    // When
    await runner.send({ serverUrl: 'https://api.example.com', values: {} });

    // Then
    expect(runner.result.value?.status).toBe(204);
    expect(runner.pending.value).toBe(false);
    expect(runner.error.value).toBeUndefined();
  });

  it('should reject with the not available code when there is no runner', async () => {
    // Given
    const runner = await withRunner(() => useRunner('get-orders'));

    // When
    let thrown: unknown;
    try {
      await runner.send({ serverUrl: 'https://api.example.com', values: {} });
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect(thrown).toBeInstanceOf(RunnerError);
    expect((thrown as RunnerError).code).toBe(ErrorCode.RUN_NOT_AVAILABLE);
  });

  it('should read and write a credential through the runner rather than hold one', async () => {
    // Given, holding one in a ref would put it in whatever a component serializes, which on a
    // server rendered page is the page.
    const port = stubRunner();
    const runner = await withRunner(() => useRunner('get-orders'), port);

    // When
    runner.setCredential('bearer', 'token');

    // Then
    expect(port.store.get('bearer')).toBe('token');
    expect(runner.credential('bearer')).toBe('token');
  });

  it('should report a failed send as one sentence and clear the previous result', async () => {
    // Given
    const port: IRunnerPort = {
      credential: () => undefined,
      setCredential: () => undefined,
      send: () => Promise.reject(new Error('the host refused this origin')),
    };
    const runner = await withRunner(() => useRunner('get-orders'), port);

    // When
    await expect(
      runner.send({ serverUrl: 'https://api.example.com', values: {} }),
    ).rejects.toThrow();

    // Then
    expect(runner.error.value).toBe('the host refused this origin');
    expect(runner.result.value).toBeUndefined();
  });

  it('should yield no operation for a channel rather than pretend it can be sent', async () => {
    // Given, a channel is reached over a broker and there is nothing to send with fetch.
    const runner = await withRunner(() => useRunner('nothing-here'), stubRunner());

    // When
    const operation = runner.operation.value;

    // Then
    expect(operation).toBeUndefined();
    expect(runner.available.value).toBe(false);
  });
});

describe('useRunnerFor', () => {
  it('should work from a projection alone, with no document state', async () => {
    // Given, this is what the renderer uses: a page carries the projection, not the IR.
    const port = stubRunner();
    const run: RunnerOperationView = {
      nodeId: 'get-orders',
      method: 'get',
      path: '/orders',
      parameters: [],
      servers: ['https://api.example.com'],
      security: [],
      body: [],
    };

    let captured: UseRunner | undefined;
    const child = defineComponent({
      name: 'Child',
      setup() {
        captured = useRunnerFor(() => run);
        return () => h('div');
      },
    });
    const parent = defineComponent({
      name: 'Parent',
      setup() {
        provideRunner(port);
        return () => h(child);
      },
    });

    // When
    await renderToString(createSSRApp(parent));

    // Then
    expect(captured?.available.value).toBe(true);
    expect(captured?.id.value).toBe('get-orders');
  });
});

describe('runnerOperationOf, the default server', () => {
  it('should give the console somewhere to send when the document declared no server', () => {
    // Given, the case this exists for: a NestJS application whose `DocumentBuilder` was never
    // told a server url, which is the default a scaffolded application ships with. Before the
    // T004-R1 retrofit the list was empty and the console reported that there was nowhere to
    // send, on a page served by the very application the request was meant for.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      paths: {
        '/orders': {
          get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } },
        },
      },
    });
    const node = [...document.nodes.values()][0];

    // When
    const view = node?.kind === 'operation' ? runnerOperationOf(node, document) : null;

    // Then
    expect(view?.servers).toEqual([DEFAULT_SERVER_URL]);
  });
});

/**
 * The headless sign in surface of T031, per SPEC 14.4 and the T031 amendment.
 *
 * IT WAS THE CONSOLE'S UNTIL THIS TASK, AND THE REASON IT MOVED IS WHAT THESE CASES PROTECT. A
 * theme author writing their own try-it console had `IRunnerPort` and no glue: the flow choice,
 * the discovery request, the device wait and the session re-read were written inside a component
 * they do not own. Every case below drives the composable and never the panel, which is the
 * statement that the surface is reachable without the renderer.
 */

/** One OAuth2 scheme with the flow kinds it is asked about, as the projection carries it. */
function oauthScheme(overrides: Partial<RunnerSecuritySchemeView> = {}): RunnerSecuritySchemeView {
  return {
    id: 'oauth',
    type: 'oauth2',
    flows: [
      {
        kind: 'authorizationCode',
        authorizationUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: ['orders:read'],
      },
    ],
    ...overrides,
  };
}

/** The operation the sign in cases run against, which needs nothing but a node id. */
const SIGN_IN_OPERATION: RunnerOperationView = {
  nodeId: 'get-orders',
  method: 'get',
  path: '/orders',
  parameters: [],
  servers: ['https://api.example.com'],
  security: [],
  body: [],
};

/** A port that runs OAuth2 flows and records what it was asked. */
function signInRunner(
  outcome: RunnerSignInOutcome = { kind: 'signed-in' },
  extra: Partial<IRunnerPort> = {},
): IRunnerPort & { readonly calls: string[]; signedIn: boolean } {
  const calls: string[] = [];
  const port: IRunnerPort & { readonly calls: string[]; signedIn: boolean } = {
    calls,
    signedIn: false,
    credential: () => undefined,
    setCredential: () => undefined,
    send: () => Promise.reject(new Error('these cases never send')),
    signIn: (schemeId: string) => {
      calls.push(`signIn:${schemeId}`);
      if (outcome.kind === 'signed-in') port.signedIn = true;
      return Promise.resolve(outcome);
    },
    completeDeviceAuthorization: (schemeId: string) => {
      calls.push(`device:${schemeId}`);
      port.signedIn = true;
      return Promise.resolve();
    },
    sessionStatus: (schemeId: string): RunnerSessionStatus => {
      calls.push(`status:${schemeId}`);
      return { signedIn: port.signedIn, renewable: port.signedIn };
    },
    signOut: (schemeId: string) => {
      calls.push(`signOut:${schemeId}`);
      port.signedIn = false;
    },
    ...extra,
  };

  return port;
}

/** Runs a body in a tree with a runner and no document state, which is the renderer's shape. */
async function withPort<T>(body: () => T, port?: IRunnerPort): Promise<T> {
  let captured: { value: T } | undefined;

  const child = defineComponent({
    name: 'Child',
    setup() {
      captured = { value: body() };
      return () => h('div');
    },
  });

  const parent = defineComponent({
    name: 'Parent',
    setup() {
      if (port !== undefined) provideRunner(port);
      return () => h(child);
    },
  });

  await renderToString(createSSRApp(parent));

  if (captured === undefined) throw new Error('the child setup never ran');
  return captured.value;
}

describe('useRunnerFor, the sign in surface', () => {
  it('should report the OAuth2 half absent when the runner does not implement it', async () => {
    // Given a runner that sends requests and knows nothing about sign in, which SPEC 14.4 makes
    // a supported composition rather than a broken one
    const port = stubRunner();

    // When
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // Then
    expect(runner.signInAvailable.value).toBe(false);
  });

  it('should refuse a sign in with the sentence that names which half is missing', async () => {
    // Given the same runner, and a reader who pressed the control anyway
    const port = stubRunner();
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // When
    const refusal = await runner.signIn({ scheme: oauthScheme(), client: { clientId: 'c' } }).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    // Then, the two refusals are told apart: this runner exists and runs no flows
    expect(refusal).toBeInstanceOf(RunnerError);
    expect((refusal as RunnerError).message).toContain('does not run OAuth2 flows');
    expect((refusal as RunnerError).code).toBe(ErrorCode.RUN_NOT_AVAILABLE);
  });

  it('should refuse a sign in with a different sentence when there is no runner at all', async () => {
    // Given no runner provided above
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION));

    // When
    const refusal = await runner.signIn({ scheme: oauthScheme(), client: { clientId: 'c' } }).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    // Then
    expect((refusal as RunnerError).message).toContain('no runner was provided');
  });

  it('should sign in with the flow the reader chose and re-read the session', async () => {
    // Given a scheme offering two flows and a reader who chose the second
    const port = signInRunner();
    const scheme = oauthScheme({
      flows: [
        { kind: 'authorizationCode', scopes: [] },
        { kind: 'clientCredentials', tokenUrl: 'https://auth.example.com/token', scopes: [] },
      ],
    });
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // When
    const outcome = await runner.signIn({
      scheme,
      flowKind: 'clientCredentials',
      client: { clientId: 'c' },
    });

    // Then
    expect(outcome).toEqual({ kind: 'signed-in' });
    expect(port.calls).toEqual(['signIn:oauth', 'status:oauth']);
    expect(runner.sessions.value.oauth).toEqual({ signedIn: true, renewable: true });
    expect(runner.signingIn.value).toBeUndefined();
  });

  it('should hand a redirect back rather than following it, and leave the session alone', async () => {
    // Given a flow that answers with somewhere to send the reader. The composable has no window,
    // and the sign in has not happened yet: it happens on the way back, on another page load.
    const port = signInRunner({ kind: 'redirect', url: 'https://auth.example.com/authorize?x=1' });
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // When
    const outcome = await runner.signIn({ scheme: oauthScheme(), client: { clientId: 'c' } });

    // Then
    expect(outcome).toEqual({ kind: 'redirect', url: 'https://auth.example.com/authorize?x=1' });
    expect(port.calls).toEqual(['signIn:oauth']);
    expect(runner.sessions.value.oauth).toBeUndefined();
  });

  it('should hold a device code while the reader approves it and drop it afterwards', async () => {
    // Given a device flow, which is the one flow whose outcome a reader has to act on elsewhere
    const device = {
      userCode: 'WDJB-MJHT',
      verificationUri: 'https://auth.example.com/device',
      expiresInSeconds: 600,
      intervalSeconds: 5,
    };
    let held: readonly string[] = [];
    const port = signInRunner(
      { kind: 'device', device },
      {
        completeDeviceAuthorization: () => {
          // Read while the wait is running, which is the only moment the entry exists
          held = Object.keys(captured?.devices.value ?? {});
          return Promise.resolve();
        },
      },
    );
    let captured: UseRunner | undefined;
    const runner = await withPort(() => {
      captured = useRunnerFor(() => SIGN_IN_OPERATION);
      return captured;
    }, port);

    // When
    const outcome = await runner.signIn({
      scheme: oauthScheme({ flows: [{ kind: 'deviceAuthorization', scopes: [] }] }),
      client: { clientId: 'c' },
    });

    // Then
    expect(outcome).toEqual({ kind: 'device', device });
    expect(held).toEqual(['oauth']);
    expect(runner.devices.value).toEqual({});
  });

  it('should discover the flows of an openIdConnect scheme that declares none, once', async () => {
    // Given a scheme with a discovery document and no flows of its own, which is what SPEC 14.4
    // says `openIdConnect` looks like in a normalized document
    const discovered = [
      { kind: 'authorizationCode' as const, tokenUrl: 'https://auth.example.com/t', scopes: [] },
    ];
    let asked = 0;
    const port = signInRunner(
      { kind: 'signed-in' },
      {
        discover: () => {
          asked += 1;
          return Promise.resolve(discovered);
        },
      },
    );
    const scheme = oauthScheme({
      id: 'oidc',
      type: 'openIdConnect',
      flows: [],
      openIdConnectUrl: 'https://auth.example.com/.well-known/openid-configuration',
    });
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // When, twice, because the second call is what proves the answer was kept
    expect(runner.flows(scheme)).toEqual([]);
    await runner.signIn({ scheme, client: { clientId: 'c' } });
    await runner.signIn({ scheme, client: { clientId: 'c' } });

    // Then
    expect(asked).toBe(1);
    expect(runner.flows(scheme)).toEqual(discovered);
  });

  it('should refuse a scheme that offers no flow a browser can run', async () => {
    // Given a scheme with no flows and no discovery document to ask
    const port = signInRunner();
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // When
    const refusal = await runner
      .signIn({ scheme: oauthScheme({ flows: [] }), client: { clientId: 'c' } })
      .then(
        () => undefined,
        (cause: unknown) => cause,
      );

    // Then
    expect((refusal as RunnerError).code).toBe(ErrorCode.RUN_AUTH_FAILED);
    expect(port.calls).toEqual([]);
    expect(runner.signingIn.value).toBeUndefined();
  });

  it('should end a session and re-read it, so a control drawn from sessions moves', async () => {
    // Given a reader who is signed in
    const port = signInRunner();
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);
    await runner.signIn({ scheme: oauthScheme(), client: { clientId: 'c' } });

    // When
    runner.signOut('oauth');

    // Then
    expect(port.calls).toEqual(['signIn:oauth', 'status:oauth', 'signOut:oauth', 'status:oauth']);
    expect(runner.sessions.value.oauth).toEqual({ signedIn: false, renewable: false });
  });

  it('should report a scheme with no session read yet as absent rather than as signed out', async () => {
    // Given nothing has asked about this scheme. Absent and signed out are different answers: one
    // says the runner was never consulted, the other says it was and said no.
    const port = signInRunner();

    // When
    const runner = await withPort(() => useRunnerFor(() => SIGN_IN_OPERATION), port);

    // Then
    expect(runner.sessions.value.oauth).toBeUndefined();
    runner.refreshSession('oauth');
    expect(runner.sessions.value.oauth).toEqual({ signedIn: false, renewable: false });
  });
});

import { ErrorCode, RunnerError } from '@openref/core';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { describe, expect, it } from 'vitest';
import {
  createDocState,
  provideDocState,
  provideRunner,
  runnerOperationOf,
  useRunner,
  useRunnerFor,
  type IRunnerPort,
  type RunnerOperationView,
  type RunnerSendInput,
  type UseRunner,
} from '../../src/index';
import { simpleDocument } from '../mocks/documents';

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
    expect(run?.security).toEqual([{ id: 'bearer', type: 'http', scheme: 'bearer' }]);
  });

  it('should name the media types of a declared request body', () => {
    // Given
    const document = simpleDocument();
    const node = document.nodes.get('post-orders');

    // When
    const run = node?.kind === 'operation' ? runnerOperationOf(node, document) : undefined;

    // Then
    expect(run?.bodyMediaTypes).toEqual(['application/json']);
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
    await runner.send({ serverUrl: 'https://api.example.com', values: { 'query:limit': '10' } });

    // Then
    expect(port.sent[0]?.operation.nodeId).toBe('get-orders');
    expect(port.sent[0]?.values).toEqual({ 'query:limit': '10' });
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
      bodyMediaTypes: [],
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

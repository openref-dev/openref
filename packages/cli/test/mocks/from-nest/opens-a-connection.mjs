import { createServer } from 'node:net';

/**
 * An application that opens a connection while booting, the way a database driver does, and hands
 * it back to no one when it closes.
 *
 * A REAL SOCKET RATHER THAN A TIMER, because the task's own bullet names three shapes and a timer
 * only answers one. A driver pool holds a refed socket; `close` here resolves at once, exactly as
 * a pool whose `end` was never called does, and the process then cannot exit on its own.
 */
export async function createApp() {
  const server = createServer();
  await new Promise((ready) => {
    server.listen(0, '127.0.0.1', ready);
  });

  const document = {
    id: 'opens-a-connection',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'OpensAConnection', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map([
      [
        'get-rows',
        {
          kind: 'operation',
          id: 'get-rows',
          method: 'get',
          path: '/rows',
          rawOperationId: 'getRows',
          summary: 'Read rows',
          tags: [],
          deprecated: false,
          parameters: [],
          responses: [{ statusCode: '200', description: 'ok', content: [] }],
          security: [],
          servers: [],
          runtime: {},
        },
      ],
    ]),
    schemas: new Map(),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };

  return {
    get(token) {
      if (token !== 'OPENREF_REFERENCES') return undefined;
      return { all: () => [{ pass: { document } }] };
    },
    // The connection is deliberately left open, which is what an unclosed pool does.
    close: () => Promise.resolve(),
  };
}

/**
 * An application that starts a scheduler while booting and does not stop it when it closes.
 *
 * TWO PROPERTIES IN ONE FIXTURE, because the two failures it drives are the same run. The timer
 * is refed, so nothing else in the process keeps Node alive and the loop never drains: this is the
 * shape SPEC 17's forced shutdown paragraph is about, and its `close` resolves at once, so the
 * timeout path never runs. And the document is large enough that `doctor --json` writes more than
 * a pipe will hold without being read, which is what makes the flush before `process.exit`
 * provable rather than asserted.
 *
 * `close` DOES NOT CLEAR THE TIMER ON PURPOSE. A real application leaks one from a service
 * constructor, a driver pool or a file watcher, and the point of the fixture is the leak.
 */

/** How many operations the document carries. Sized so `--json` exceeds any pipe buffer. */
const OPERATION_COUNT = 400;

function operation(index) {
  const id = `get-widgets-${String(index)}`;
  return [
    id,
    {
      kind: 'operation',
      id,
      method: 'get',
      path: `/widgets/${String(index)}`,
      // No `rawOperationId`, no summary and no description, so every quality rule of SPEC 7.1
      // finds something and the report is as long as the document is.
      tags: [],
      deprecated: false,
      parameters: [],
      responses: [{ statusCode: '200', description: 'ok', content: [] }],
      security: [],
      servers: [],
      runtime: {},
    },
  ];
}

export async function createApp() {
  // The scheduler. Refed, so the process cannot exit while it is alive.
  setInterval(() => {}, 1000);

  const document = {
    id: 'leaves-a-timer',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'LeavesATimer', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(Array.from({ length: OPERATION_COUNT }, (_, index) => operation(index))),
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
    close: () => Promise.resolve(),
  };
}

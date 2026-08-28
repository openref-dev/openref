import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * An application that writes to disk while booting, the way a cache warmer or a migration does.
 *
 * IT CLEANS UP AFTER ITSELF AND LEAVES NOTHING RUNNING, which makes it the control of the three:
 * booting an application with a side effect is not by itself a reason for the CLI to force
 * anything, so this run must exit on its own and say nothing. Without it the other two fixtures
 * would only show that the CLI can force an exit, never that it declines to.
 */
const directory = mkdtempSync(join(tmpdir(), 'openref-boot-write-'));
writeFileSync(join(directory, 'warmed.txt'), 'warmed at boot', 'utf8');

export async function createApp() {
  const document = {
    id: 'writes-to-disk',
    kind: 'openapi',
    hash: 'h',
    info: { title: 'WritesToDisk', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map([
      [
        'get-cache',
        {
          kind: 'operation',
          id: 'get-cache',
          method: 'get',
          path: '/cache',
          rawOperationId: 'getCache',
          summary: 'Read the cache',
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
    close: () => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    },
  };
}

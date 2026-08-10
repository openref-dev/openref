/**
 * Boots the fixture in a process of its own and prints its url.
 *
 * A process of its own for the same reason the compatibility fixtures are: the measurement
 * must not share a heap or a main thread with the thing being measured. The port is chosen by
 * the operating system and reported back, so nothing races a fixed number.
 */

import { createFixture, type FixtureDocument } from './app.js';
import { TTI_NODE_COUNT } from './specification.js';

/** What a booted fixture reports on stdout, as one line of JSON. */
export interface FixtureReady {
  readonly ready: true;
  readonly url: string;
  readonly document: FixtureDocument;
  readonly nodeCount: number;
}

const args = process.argv.slice(2);
const value = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

const document: FixtureDocument = value('document') === 'memory' ? 'memory' : 'large';
const port = Number(value('port') ?? 0);

const app = createFixture(document);

const url = await new Promise<string>((resolve) => {
  const server = app.listen(port, '127.0.0.1', () => {
    const address = server.address();
    const bound = typeof address === 'object' && address !== null ? address.port : port;
    resolve(`http://127.0.0.1:${String(bound)}`);
  });
});

const ready: FixtureReady = {
  ready: true,
  url,
  document,
  // The memory document is a real one and its node count is whatever Stripe publishes, which
  // the harness reads off the served page rather than being told here.
  nodeCount: document === 'large' ? TTI_NODE_COUNT : 0,
};

process.stdout.write(`${JSON.stringify(ready)}\n`);

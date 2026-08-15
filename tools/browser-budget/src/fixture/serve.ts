/**
 * Boots the fixture in a process of its own and prints its url.
 *
 * A process of its own for the same reason the compatibility fixtures are: the measurement
 * must not share a heap or a main thread with the thing being measured. The port is chosen by
 * the operating system and reported back, so nothing races a fixed number.
 */

import { createFixture, type FixtureDocument } from './app.js';
import { PROOF_NODE_COUNT, TTI_NODE_COUNT } from './specification.js';

/** What a booted fixture reports on stdout, as one line of JSON. */
export interface FixtureReady {
  readonly ready: true;
  readonly url: string;
  readonly document: FixtureDocument;
  readonly nodeCount: number;
  /** Whether this boot sends the strict policy, reported so a proof cannot assume it. */
  readonly policy: boolean;
}

const args = process.argv.slice(2);
const value = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

const requested = value('document');
const document: FixtureDocument =
  requested === 'memory' ? 'memory' : requested === 'proof' ? 'proof' : 'large';
const port = Number(value('port') ?? 0);

// OFF ONLY WHEN ASKED FOR IN THOSE WORDS. Anything else, a typo included, boots with the
// policy on, because a fixture that quietly served no policy would make every proof that
// depends on one pass while proving nothing.
const policy = value('policy') !== 'off';

// THE AUTHORIZATION SERVER IS ABSENT UNLESS NAMED, so every other boot serves the document it
// always served. `connect` off is the proof that the recommended policy blocks the exchange.
const authorizationServer = value('auth');
const allowAuthorizationConnect = value('auth-connect') !== 'off';

const app = createFixture(document, {
  policy,
  allowAuthorizationConnect,
  ...(authorizationServer === undefined ? {} : { authorizationServer }),
});

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
  nodeCount: document === 'large' ? TTI_NODE_COUNT : document === 'proof' ? PROOF_NODE_COUNT : 0,
  policy,
};

process.stdout.write(`${JSON.stringify(ready)}\n`);

/**
 * Boots the fixture in a process of its own and prints its url.
 *
 * A process of its own for the same reason the compatibility fixtures are: the measurement
 * must not share a heap or a main thread with the thing being measured. The port is chosen by
 * the operating system and reported back, so nothing races a fixed number.
 *
 * THE CHANNEL DOCUMENT IS BOOTED IN TWO STEPS AND EVERY OTHER ONE IS NOT, which is deliberate
 * rather than tidy. That document declares a socket server, a server has a host, and the host is
 * this process's own port, which nothing knows until the listener is bound; so the socket is bound
 * first and the document is built from what it reports. The three measured documents keep the
 * boot they have always had, because a study whose fixture changed how it starts is a study
 * comparing two things.
 */

import { createServer } from 'node:http';
import { createFixture, type FixtureDocument } from './app.js';
import { attachSocketEcho } from './socket-echo.js';
import {
  CHANNEL_ADDRESS,
  CHANNEL_GREETING,
  PROOF_NODE_COUNT,
  TTI_NODE_COUNT,
} from './specification.js';

/** What a booted fixture reports on stdout, as one line of JSON. */
export interface FixtureReady {
  readonly ready: true;
  readonly url: string;
  readonly document: FixtureDocument;
  readonly nodeCount: number;
  /** Whether this boot sends the strict policy, reported so a proof cannot assume it. */
  readonly policy: boolean;
  /**
   * The socket address the channel document's console resolves to, absent on every other boot.
   *
   * REPORTED RATHER THAN RECOMPUTED BY A CASE. The address a reader is shown is the server's url
   * joined with the channel's own address, per SPEC 8.2, and a test that spelled the join out
   * again would be a second copy of the rule the console is being proved on.
   */
  readonly socketAddress?: string;
}

const args = process.argv.slice(2);
const value = (name: string): string | undefined =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

const requested = value('document');
const document: FixtureDocument =
  requested === 'memory'
    ? 'memory'
    : requested === 'proof'
      ? 'proof'
      : requested === 'channel'
        ? 'channel'
        : 'large';
const port = Number(value('port') ?? 0);

// OFF ONLY WHEN ASKED FOR IN THOSE WORDS. Anything else, a typo included, boots with the
// policy on, because a fixture that quietly served no policy would make every proof that
// depends on one pass while proving nothing.
const policy = value('policy') !== 'off';

// THE AUTHORIZATION SERVER IS ABSENT UNLESS NAMED, so every other boot serves the document it
// always served. `connect` off is the proof that the recommended policy blocks the exchange.
const authorizationServer = value('auth');
const allowAuthorizationConnect = value('auth-connect') !== 'off';

let url: string;
let socketAddress: string | undefined;

if (document === 'channel') {
  const server = createServer();

  const bound = await new Promise<number>((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    });
  });

  const host = `127.0.0.1:${String(bound)}`;
  const app = createFixture('channel', { policy, socketHost: host });

  server.on('request', app);
  attachSocketEcho(server, { greeting: CHANNEL_GREETING });

  url = `http://${host}`;
  socketAddress = `ws://${host}/${CHANNEL_ADDRESS}`;
} else {
  const app = createFixture(document, {
    policy,
    allowAuthorizationConnect,
    ...(authorizationServer === undefined ? {} : { authorizationServer }),
  });

  url = await new Promise<string>((resolve) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const boundPort = typeof address === 'object' && address !== null ? address.port : port;
      resolve(`http://127.0.0.1:${String(boundPort)}`);
    });
  });
}

const ready: FixtureReady = {
  ready: true,
  url,
  document,
  // The memory document is a real one and its node count is whatever Stripe publishes, which
  // the harness reads off the served page rather than being told here. The channel document is
  // one channel, and one channel is one node.
  nodeCount:
    document === 'large'
      ? TTI_NODE_COUNT
      : document === 'proof'
        ? PROOF_NODE_COUNT
        : document === 'channel'
          ? 1
          : 0,
  policy,
  ...(socketAddress === undefined ? {} : { socketAddress }),
};

process.stdout.write(`${JSON.stringify(ready)}\n`);

/**
 * Boots the fake authorization server in a process of its own and prints both its origins.
 *
 * TWO LISTENERS, ONE APPLICATION. The redirecting mode has to send the token request to a host the
 * document never named, and "another host" in the browser's sense is another origin rather than
 * another path. Two ports on 127.0.0.1 are two origins to every rule that matters here: CORS, the
 * fetch redirect policy and `connect-src` all read them apart.
 *
 * THE ALLOWED ORIGIN ARRIVES AFTER BOOT, over the control route, and the reason is a cycle: the
 * reference has to carry this server's urls in its document, so this boots first, and this has to
 * allow the reference's origin, which the operating system has not chosen yet. Until the harness
 * closes the cycle the token endpoint sends no CORS headers, so a forgotten step fails loudly.
 */

import { createAuthorizationServer } from './authorization-server.js';

/** What a booted authorization server reports on stdout, as one line of JSON. */
export interface AuthorizationServerReady {
  readonly ready: true;
  /** Origin the document's flows point at. */
  readonly url: string;
  /** The other origin, which the redirecting mode sends the token request to. */
  readonly elsewhere: string;
}

async function listen(app: ReturnType<typeof createAuthorizationServer>): Promise<string> {
  return await new Promise<string>((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve(`http://127.0.0.1:${String(port)}`);
    });
  });
}

// THE SECOND ORIGIN IS BUILT FIRST, because the first one has to be told where it is. It carries
// the same routes and only ever answers the exchange the redirect lands on.
const elsewhereApp = createAuthorizationServer();
const elsewhere = await listen(elsewhereApp);

const app = createAuthorizationServer({ elsewhereOrigin: elsewhere });
const url = await listen(app);

const ready: AuthorizationServerReady = { ready: true, url, elsewhere };

process.stdout.write(`${JSON.stringify(ready)}\n`);

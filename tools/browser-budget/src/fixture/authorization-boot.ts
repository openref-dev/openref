/**
 * Booting the fake authorization server as a child process, and closing the cycle between them.
 *
 * THE TWO SERVERS EACH NEED THE OTHER'S PORT and the operating system chooses both, so the order
 * is fixed: this boots first, the reference boots carrying these urls in its document, and then
 * `allowOrigin` tells this one which origin may exchange a code. A server allowed to answer `*`
 * would let the exchange pass under a rule no real provider offers.
 */

import { join } from 'node:path';
import { repositoryRoot } from '../repo-root.js';
import { spawnServer } from '../spawn.js';
import { ALLOW_CONTROL_PATH } from './authorization-server.js';

/** A booted authorization server. */
export interface BootedAuthorizationServer {
  /** Origin the fixture document's flows point at. */
  readonly url: string;
  /** The other origin, which the redirecting mode sends the token request to. */
  readonly elsewhere: string;
  /** Names the origin permitted to exchange a code, once the reference is listening. */
  allowOrigin(origin: string): Promise<void>;
  stop(): Promise<void>;
}

/** Where the built entry sits, relative to the repository root. */
export const AUTHORIZATION_ENTRY = 'tools/browser-budget/dist/fixture/serve-authorization.js';

/**
 * Boots the fake authorization server on two free ports.
 *
 * @returns Both origins, a way to name the allowed origin, and a way to stop it
 * @throws Error when it fails to report both origins
 */
export async function bootAuthorizationServer(): Promise<BootedAuthorizationServer> {
  const root = repositoryRoot();

  const server = await spawnServer({
    entry: join(root, AUTHORIZATION_ENTRY),
    args: [],
    cwd: root,
    label: 'the fake authorization server',
    timeoutMs: 60_000,
  });

  const elsewhere = server.ready.elsewhere;
  if (typeof elsewhere !== 'string') {
    await server.stop();
    throw new Error('the fake authorization server reported no second origin');
  }

  const allowOrigin = async (origin: string): Promise<void> => {
    for (const host of [server.url, elsewhere]) {
      const response = await fetch(
        `${host}${ALLOW_CONTROL_PATH}?origin=${encodeURIComponent(origin)}`,
      );
      if (!response.ok) {
        throw new Error(`${host} refused to allow ${origin}: ${String(response.status)}`);
      }
    }
  };

  return { url: server.url, elsewhere, allowOrigin, stop: () => server.stop() };
}

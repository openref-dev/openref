/**
 * Booting the fixture reference server as a child process.
 *
 * IN A PROCESS OF ITS OWN, because the harness must not share a heap or a main thread with the
 * thing it measures. Peak client memory read from a process that is also parsing a 6.4 MB
 * specification would be a measurement of the measurer.
 */

import { join } from 'node:path';
import { repositoryRoot } from '../repo-root.js';
import { spawnServer } from '../spawn.js';
import type { FixtureDocument, FixtureOptions } from './app.js';

/** A booted fixture. */
export interface BootedFixture {
  readonly url: string;
  readonly document: FixtureDocument;
  /** Whether this boot sends the strict policy. */
  readonly policy: boolean;
  stop(): Promise<void>;
}

/** Where the built entry sits, relative to the repository root. */
export const FIXTURE_ENTRY = 'tools/browser-budget/dist/fixture/serve.js';

/**
 * Boots the fixture on a free port.
 *
 * @param document - Which document to serve
 * @param options - Whether the strict policy is sent
 * @returns Its url and a way to stop it
 * @throws Error when it fails to report a url, carrying whatever it printed instead
 */
export async function bootFixture(
  document: FixtureDocument,
  options: FixtureOptions = {},
): Promise<BootedFixture> {
  const root = repositoryRoot();
  const policy = options.policy !== false;

  const server = await spawnServer({
    entry: join(root, FIXTURE_ENTRY),
    args: [
      `--document=${document}`,
      '--port=0',
      `--policy=${policy ? 'on' : 'off'}`,
      ...(options.authorizationServer === undefined
        ? []
        : [
            `--auth=${options.authorizationServer}`,
            `--auth-connect=${options.allowAuthorizationConnect === false ? 'off' : 'on'}`,
          ]),
    ],
    cwd: root,
    label: `the ${document} fixture`,
    timeoutMs: 120_000,
  });

  return { url: server.url, document, policy, stop: () => server.stop() };
}

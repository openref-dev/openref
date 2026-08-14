/**
 * Booting the example NestJS application, which is what SPEC 2's first minute is about.
 *
 * NOT THE MEASUREMENT FIXTURE. `fixture/app.ts` serves a synthetic thousand node document over
 * express, because a budget needs a document of a known size and no framework in the way. This
 * boots `examples/nest-minimal`, a real NestJS application with a real controller behind it,
 * because the claim it serves is the opposite one: that an install and one line of setup give a
 * reader a page they can fire a request from, and that the request arrives at the controller.
 *
 * IT RESOLVES `@openref/nest` OUT OF ITS OWN `node_modules`, because it runs as a process of its
 * own rather than being imported into the test runner. A fixture imported here would resolve the
 * workspace alias to TypeScript source, which is not what a consumer installs, and the whole
 * point of the proof is that the artifact works.
 */

import { join } from 'node:path';
import { repositoryRoot } from './repo-root.js';
import { spawnServer, type SpawnedServer } from './spawn.js';

/** Where the built example sits, relative to the repository root. */
export const EXAMPLE_ENTRY = 'examples/nest-minimal/dist/serve.js';

/** The path the example mounts the reference under. */
export const EXAMPLE_BASE_PATH = '/docs';

/**
 * Boots the example on a free port.
 *
 * @param platform - `express` or `fastify`
 * @param env - Extra environment, such as `OPENREF_PROXY` for the proxy selection case
 * @returns Its url and a way to stop it
 * @throws Error when it fails to report a url
 */
export async function bootExampleApp(
  platform = 'express',
  env?: Readonly<Record<string, string>>,
): Promise<SpawnedServer> {
  const root = repositoryRoot();

  return spawnServer({
    entry: join(root, EXAMPLE_ENTRY),
    args: [`--adapter=${platform}`, '--port=0'],
    // The application's own directory, the way a real host runs, and since T033 the anchor
    // host named packages resolve from: the theme entry is the example's dependency, and a
    // process whose working directory is the repository root cannot see it.
    cwd: join(root, 'examples', 'nest-minimal'),
    label: `the ${platform} example application`,
    timeoutMs: 60_000,
    ...(env === undefined ? {} : { env }),
  });
}

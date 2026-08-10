/**
 * Booting a fixture application as a real process.
 *
 * IN A PROCESS OF ITS OWN, NOT IN THE TEST'S. That is what makes these tests say anything: a
 * fixture imported into the test runner would resolve `@openref/nest` through the workspace
 * alias to TypeScript source, which is not what a consumer installs. Spawned, it resolves the
 * built package through its own `node_modules`, which is exactly what a consumer gets, and the
 * NestJS 10 fixture resolves its own copy of the framework rather than the repository's 11.
 *
 * The port is chosen by the operating system and read back from the process, rather than
 * picked here. A fixed port races anything else on the machine, and a race in a boot test
 * reads as a broken adapter. {@link freePort} is the one exception, for the case where the
 * application has to declare its own origin before it starts listening on it, and it says at
 * its own definition why that trade is worth making there and nowhere else.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createServer } from 'node:net';
import type { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

/** A fixture application that can be booted. */
export interface FixtureApp {
  /** What it is, for a test name. */
  readonly label: string;
  /** Path of the entry, relative to the repository root. */
  readonly entry: string;
}

/** The two arms of the SPEC 23 compatibility matrix. */
export const FIXTURE_APPS: readonly FixtureApp[] = [
  { label: 'NestJS 11, @nestjs/swagger 11, ESM', entry: 'examples/nest-minimal/dist/serve.js' },
  { label: 'NestJS 10, @nestjs/swagger 8, CommonJS', entry: 'compat/nest10-cjs/dist/serve.js' },
];

/** A booted application. */
export interface BootedApp {
  readonly url: string;
  stop(): Promise<void>;
}

/**
 * A port nothing is listening on, released before it is handed over.
 *
 * There is a window between releasing it and the fixture binding it, so this is not a
 * guarantee. It is used only where the port has to be known before the process starts, which
 * is the case where the document must declare its own origin; everywhere else the fixture is
 * given zero and reports back what it got.
 *
 * @returns A port number
 */
export async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

/** How a boot can be varied. */
export interface BootOptions {
  /** Port to listen on. Zero, the default, lets the operating system pick one. */
  readonly port?: number;
  /** Extra environment for the process, such as the public url the document declares. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Boots a fixture on a free port.
 *
 * @param app - Which fixture
 * @param platform - `express` or `fastify`
 * @param options - Port and environment
 * @returns Its url and a way to stop it
 * @throws Error when it fails to report a url, carrying whatever it printed instead
 */
export async function bootApp(
  app: FixtureApp,
  platform: string,
  options: BootOptions = {},
): Promise<BootedApp> {
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    process.execPath,
    [join(repoRoot, app.entry), `--adapter=${platform}`, `--port=${String(options.port ?? 0)}`],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...options.env } },
  );

  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (err += chunk));

  const url = await new Promise<string>((resolve, reject) => {
    const fail = (reason: string): void => {
      child.kill('SIGKILL');
      reject(new Error(`${app.label} on ${platform} did not start: ${reason}\n${out}\n${err}`));
    };

    const timer = setTimeout(() => {
      fail('no url within 30 seconds');
    }, 30_000);

    child.on('exit', (code) => {
      clearTimeout(timer);
      fail(`it exited with code ${String(code)}`);
    });

    child.stdout.on('data', (chunk: string) => {
      out += chunk;

      for (const line of out.split('\n')) {
        if (!line.startsWith('{')) continue;

        const parsed = JSON.parse(line) as { url?: unknown };
        if (typeof parsed.url === 'string') {
          clearTimeout(timer);
          resolve(parsed.url);
          return;
        }
      }
    });
  });

  return {
    url,
    stop: () =>
      new Promise<void>((resolve) => {
        child.on('exit', () => {
          resolve();
        });
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      }),
  };
}

/**
 * Booting the fixture reference server as a child process.
 *
 * IN A PROCESS OF ITS OWN, because the harness must not share a heap or a main thread with the
 * thing it measures. Peak client memory read from a process that is also parsing a 6.4 MB
 * specification would be a measurement of the measurer.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { join } from 'node:path';
import { repositoryRoot } from '../repo-root.js';
import type { Readable } from 'node:stream';
import type { FixtureDocument } from './app.js';

/** A booted fixture. */
export interface BootedFixture {
  readonly url: string;
  readonly document: FixtureDocument;
  stop(): Promise<void>;
}

/** Where the built entry sits, relative to the repository root. */
export const FIXTURE_ENTRY = 'tools/browser-budget/dist/fixture/serve.js';

/**
 * Boots the fixture on a free port.
 *
 * @param document - Which of the two SPEC 20 documents to serve
 * @returns Its url and a way to stop it
 * @throws Error when it fails to report a url, carrying whatever it printed instead
 */
export async function bootFixture(document: FixtureDocument): Promise<BootedFixture> {
  const root = repositoryRoot();
  const entry = join(root, FIXTURE_ENTRY);

  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    process.execPath,
    [entry, `--document=${document}`, '--port=0'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let out = '';
  let err = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (err += chunk));

  const url = await new Promise<string>((resolve, reject) => {
    const fail = (reason: string): void => {
      child.kill('SIGKILL');
      reject(new Error(`the ${document} fixture did not start: ${reason}\n${out}\n${err}`));
    };

    const timer = setTimeout(() => {
      fail('no url within 120 seconds');
    }, 120_000);

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
    document,
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

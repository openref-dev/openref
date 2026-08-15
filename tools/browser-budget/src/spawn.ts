/**
 * Booting a server as a child process and reading the port it chose.
 *
 * ONE SPAWN FOR TWO CALLERS. The fixture reference server and the example NestJS application are
 * booted the same way and for the same reason: the harness must not share a heap or a main thread
 * with the thing it measures, and the port has to be chosen by the operating system rather than
 * picked here, because a fixed port races anything else on the machine and a race in a boot test
 * reads as a broken adapter.
 *
 * THE READY LINE IS JSON ON STDOUT and both servers already print one. Waiting on a log line
 * shaped like prose is how a boot helper comes to depend on a message nobody thinks of as an
 * interface.
 */

import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';

/** A booted server. */
export interface SpawnedServer {
  readonly url: string;
  /**
   * The whole ready line, for a server that reports more than one address.
   *
   * The fake authorization server of T035 listens on two origins, because "a token endpoint that
   * answers from an unexpected host" means another origin rather than another path, and a caller
   * that could only read `url` would have to guess the second one.
   */
  readonly ready: Readonly<Record<string, unknown>>;
  stop(): Promise<void>;
}

/** How one server is booted. */
export interface SpawnOptions {
  /** Absolute path of the entry to run under this Node. */
  readonly entry: string;
  /** Arguments after the entry. */
  readonly args: readonly string[];
  /** Working directory, normally the repository root. */
  readonly cwd: string;
  /** What it is, for the message when it does not start. */
  readonly label: string;
  /** How long to wait for the ready line. */
  readonly timeoutMs: number;
  /** Extra environment, such as a public url the document has to declare. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Boots a server and waits for it to report its url.
 *
 * @param options - What to run and how long to wait
 * @returns Its url and a way to stop it
 * @throws Error when it fails to report a url, carrying whatever it printed instead
 */
export async function spawnServer(options: SpawnOptions): Promise<SpawnedServer> {
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
    process.execPath,
    [options.entry, ...options.args],
    {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    },
  );

  let out = '';
  let err = '';
  let ready: Readonly<Record<string, unknown>> = {};
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => (err += chunk));

  const url = await new Promise<string>((resolve, reject) => {
    const fail = (reason: string): void => {
      child.kill('SIGKILL');
      reject(new Error(`${options.label} did not start: ${reason}\n${out}\n${err}`));
    };

    const timer = setTimeout(() => {
      fail(`no url within ${String(Math.round(options.timeoutMs / 1000))} seconds`);
    }, options.timeoutMs);

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
          ready = parsed;
          resolve(parsed.url);
          return;
        }
      }
    });
  });

  return {
    url,
    ready,
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

import { spawn, type ChildProcess } from 'node:child_process';
import type { Readable } from 'node:stream';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../src/index.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * Every example application, booted as its own process and asked for a page.
 *
 * NOT A SKIP WHEN A BUILD IS MISSING. An example whose `dist/serve.js` is absent fails here and
 * names the command that produces it, because a suite that skips itself when the artifact is
 * absent is green in exactly the situation it exists to catch: the run where nothing was built.
 *
 * THE PROCESS IS SPAWNED RATHER THAN IMPORTED, and that is what the class of defect found while
 * writing these examples demands. `OpenRefModule.setup` on an application built with the default
 * `abortOnError` can end the process rather than throwing, so an in-process boot would never see
 * it: the exit code is the observation. Every case below reads the address the process prints on
 * its first line and then fetches a real page over a real socket.
 */

/** How long a spawned application gets, from the project's own declaration. */
const TIMEOUT = SPAWNED_PROCESS_TIMEOUT_MS;

/** Where the examples live. */
const EXAMPLES = join(REPOSITORY_ROOT, 'examples');

/**
 * The applications that boot and listen.
 *
 * `nuxt-reference` is not here because it is a Nuxt project rather than a Nest application, and
 * `static-build` is not here because it builds and exits; both are covered by their own cases
 * below rather than left unmentioned.
 */
const SERVING_EXAMPLES: readonly string[] = [
  'nest-minimal',
  'runtime-intelligence',
  'custom-theme',
  'events',
  'federation',
];

let running: ChildProcess | undefined;

afterEach(() => {
  running?.kill('SIGKILL');
  running = undefined;
});

/** What one booted example told us. */
interface Booted {
  readonly url: string;
  readonly exitCode: number | null;
  readonly stderr: string;
}

/**
 * Boots one example and reads the address off its first stdout line.
 *
 * @param name - Directory under `examples/`
 * @returns The address it printed
 */
async function boot(name: string): Promise<Booted> {
  const entry = join(EXAMPLES, name, 'dist', 'serve.js');
  if (!existsSync(entry)) {
    throw new Error(`${name} is not built: ${entry} is absent. Run "pnpm build" first`);
  }

  const child: ChildProcess & { stdout: Readable; stderr: Readable } = spawn(
    process.execPath,
    [entry, '--port=0'],
    { cwd: join(EXAMPLES, name), stdio: ['ignore', 'pipe', 'pipe'] },
  );
  running = child;

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const deadline = Date.now() + TIMEOUT - 5_000;
  for (;;) {
    const first = stdout.split('\n')[0] ?? '';
    if (first.startsWith('{')) {
      const parsed: unknown = JSON.parse(first);
      const url = (parsed as { url?: unknown }).url;
      if (typeof url === 'string') return { url, exitCode: null, stderr };
      throw new Error(`${name} printed a first line with no url: ${first}`);
    }
    if (child.exitCode !== null) {
      return { url: '', exitCode: child.exitCode, stderr };
    }
    if (Date.now() > deadline) throw new Error(`${name} printed no address: ${stdout}${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('the example applications', () => {
  it('should be the whole of the examples directory, minus the two that do not listen', () => {
    // Given
    const directories = readdirSync(EXAMPLES).filter((entry) =>
      statSync(join(EXAMPLES, entry)).isDirectory(),
    );

    // Then, both directions: nothing here is unaccounted for, and nothing named is missing
    expect([...directories].sort()).toEqual(
      [...SERVING_EXAMPLES, 'nuxt-reference', 'static-build'].sort(),
    );
  });

  for (const name of SERVING_EXAMPLES) {
    it(
      `should boot ${name} and serve a rendered reference`,
      async () => {
        // Given
        const booted = await boot(name);

        // Then, the exit code first: an application that died has no address to fetch
        expect(booted.exitCode).toBeNull();
        expect(booted.url).toMatch(/^https?:\/\/\S+$/);

        // When
        const response = await fetch(`${booted.url}/docs`);
        const html = await response.text();

        // Then
        expect(response.status).toBe(200);
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('oref-root');
        expect(html).toContain('/docs/_assets/');
      },
      TIMEOUT,
    );
  }

  it(
    'should build the static example, once per hosting target',
    async () => {
      // Given
      const example = (await import(join(EXAMPLES, 'static-build', 'dist', 'build-all.js'))) as {
        readonly buildEveryTarget: () => number;
        readonly OUTPUT_ROOT: string;
        readonly TARGETS: readonly { readonly name: string; readonly rewrites: boolean }[];
      };

      rmSync(example.OUTPUT_ROOT, { recursive: true, force: true });

      // When
      const code = example.buildEveryTarget();

      // Then
      expect(code).toBe(0);
      expect(readdirSync(example.OUTPUT_ROOT).sort()).toEqual(
        example.TARGETS.map((target) => target.name).sort(),
      );
      for (const target of example.TARGETS) {
        expect(existsSync(join(example.OUTPUT_ROOT, target.name, 'index.html'))).toBe(true);
      }
    },
    TIMEOUT,
  );
});

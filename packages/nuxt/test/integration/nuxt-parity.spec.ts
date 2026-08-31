import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contentSecurityPolicy } from '@openref/render';
import { BUILD_MANIFEST_FILE } from '@openref/static';
import { builtCliProblem, BUILT_CLI_BIN } from '../../../../vitest.built-cli.ts';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';
import {
  GENERATED_DIRECTORY,
  generatedEntryFile,
  nitroProxyFile,
  PROXY_ENTRY,
} from '../../src/index';

/**
 * The claim T061 is finished by: the Nuxt path is a wrapper and not a fork.
 *
 * WHAT WOULD SETTLE IT AND WHAT WOULD NOT. Reading the module and seeing it call
 * `renderStaticSite` settles nothing: a wrapper that drifts is still a wrapper on the day it is
 * read. So one specification is built twice, once by `nuxt generate` and once by `openref build`,
 * and the two directories are compared file by file and byte by byte, in both directions. The
 * difference the comparison is allowed to find is enumerated in SPEC 16.4 and asserted as an
 * exact list rather than tolerated as a rule.
 *
 * AND THE SECOND HALF IS THE SERVED ONE, which the same suite runs because it is the same
 * example: the application built for a node server answers the reference from the route, under
 * the strict policy of SPEC 19.2, and the page it answers with is the page the build writes plus
 * the response nonce and nothing else. That last "and nothing else" is what a framework mounting
 * somebody else's markup usually breaks, so it is measured in bytes.
 *
 * IT NEEDS THE WORKSPACE BUILT AND REFUSES TO SKIP, per `vitest.built-cli.ts`: a skipped run and
 * a passing run look identical from the outside.
 */

const execFileAsync = promisify(execFile);

const EXAMPLE = fileURLToPath(new URL('../../../../examples/nuxt-reference/', import.meta.url));
const NUXT_BIN = join(EXAMPLE, 'node_modules', '.bin', 'nuxt');
const SPEC = join(EXAMPLE, 'openapi.yaml');
const PUBLIC_DIR = join(EXAMPLE, '.output', 'public');
const MOUNT = 'docs';
const BASE = '/docs';

/** The module's own build output, which the example loads as a package. */
const NUXT_MODULE_DIST = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

/**
 * Files the Nuxt output holds outside the mount, which are the application's own.
 *
 * ENUMERATED RATHER THAN IGNORED, per SPEC 16.4. `_nuxt` is the application's asset root and the
 * three html files are what its prerender writes; `_payload.json` is its hydration payload. None
 * of them is an artefact of the reference, and the assertion below is that the list is exactly
 * this, so a Nuxt version that starts writing something else is a failure and not a shrug.
 */
const APPLICATION_FILES: readonly string[] = [
  '200.html',
  '404.html',
  '_payload.json',
  'index.html',
];

/** Where the CLI built the same document. */
let cliOut: string | undefined;

/** The built server under test, and where it listens. */
let server: ChildProcess | undefined;
let origin: string;

/** What `nuxt generate` printed, for the one notice this configuration must produce. */
let generateOutput = '';

/** Every file under a directory, relative and with forward slashes. */
async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .sort();
}

/** An unused port, taken by binding and releasing one. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
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

/** Runs the Nuxt binary in the example, with telemetry off and the environment CI would have. */
async function runNuxt(command: string): Promise<string> {
  const { stdout, stderr } = await execFileAsync(NUXT_BIN, [command], {
    cwd: EXAMPLE,
    env: { ...process.env, NUXT_TELEMETRY_DISABLED: '1', CI: '1' },
    maxBuffer: 32 * 1024 * 1024,
  });

  return `${stdout}${stderr}`;
}

/** Boots the built server and waits for it to say where it is listening. */
async function bootServer(port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, [join(EXAMPLE, '.output', 'server', 'index.mjs')], {
    cwd: EXAMPLE,
    env: { ...process.env, PORT: String(port), NITRO_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    const fail = (cause: unknown): void => {
      reject(cause instanceof Error ? cause : new Error(String(cause)));
    };

    child.stdout.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes('Listening')) resolve();
    });
    child.on('error', fail);
    child.on('exit', (code) => {
      fail(new Error(`the built server exited with ${String(code)} before it listened`));
    });
  });

  return child;
}

beforeAll(async () => {
  const problem = builtCliProblem();
  if (problem !== undefined) throw new Error(problem);

  if (!existsSync(NUXT_MODULE_DIST)) {
    throw new Error(
      `${NUXT_MODULE_DIST} is not there, and the example loads the module as a package. Run \`pnpm build\` first. This suite refuses to skip itself, because a skipped run and a passing run look identical from the outside`,
    );
  }

  if (statSync(NUXT_MODULE_DIST).mtimeMs < newestSourceMs()) {
    throw new Error(
      `${NUXT_MODULE_DIST} is older than packages/nuxt/src, so this suite would report on a build nobody made. Run \`pnpm build\` first`,
    );
  }

  for (const directory of ['.output', '.nuxt', GENERATED_DIRECTORY]) {
    await rm(join(EXAMPLE, directory), { recursive: true, force: true });
  }

  generateOutput = await runNuxt('generate');

  cliOut = await mkdtemp(join(tmpdir(), 'openref-cli-'));
  await execFileAsync(process.execPath, [
    BUILT_CLI_BIN,
    'build',
    '--spec',
    SPEC,
    '--base',
    BASE,
    '--target',
    'nitro',
    '--out',
    cliOut,
  ]);
}, SPAWNED_PROCESS_TIMEOUT_MS);

afterAll(async () => {
  server?.kill();
  if (cliOut !== undefined) await rm(cliOut, { recursive: true, force: true });
});

/** The newest modification time under this package's sources. */
function newestSourceMs(): number {
  const root = fileURLToPath(new URL('../../src/', import.meta.url));
  const walk = (path: string): number => {
    const stats = statSync(path);
    if (!stats.isDirectory()) return stats.mtimeMs;

    let newest = stats.mtimeMs;
    for (const entry of readdirSync(path)) {
      newest = Math.max(newest, walk(join(path, entry)));
    }
    return newest;
  };

  return walk(root);
}

describe('static generation from Nuxt, against the CLI build of the same document', () => {
  it('should write the same files, byte for byte, with the enumerated difference and no other', async () => {
    // Given
    const built = await filesUnder(cliOut ?? '');
    const generated = await filesUnder(join(PUBLIC_DIR, MOUNT));

    // Then: both sides produced a site rather than an empty directory.
    expect(built.length).toBeGreaterThan(40);
    expect(generated.length).toBeGreaterThan(40);

    // When
    const missing = built.filter((file) => !generated.includes(file));
    const extra = generated.filter((file) => !built.includes(file));

    // Then: SPEC 16.4's one enumerated difference, and it is the server source.
    expect(missing).toEqual([nitroProxyFile(BASE)]);
    expect(extra).toEqual([]);

    const differing: string[] = [];
    for (const file of generated) {
      const fromCli = await readFile(join(cliOut ?? '', file));
      const fromNuxt = await readFile(join(PUBLIC_DIR, MOUNT, file));
      if (!fromCli.equals(fromNuxt)) differing.push(file);
    }

    expect(differing).toEqual([]);
  });

  it('should register the withheld server source as a route, with the generator bytes intact', async () => {
    // Given
    const fromCli = await readFile(join(cliOut ?? '', nitroProxyFile(BASE)), 'utf8');

    // When
    const registered = await readFile(
      join(EXAMPLE, GENERATED_DIRECTORY, generatedEntryFile(PROXY_ENTRY, BASE)),
      'utf8',
    );

    // Then
    expect(registered).toBe(fromCli);
    expect(registered).toContain('https://api.parcels.example.com/v1');
  });

  it('should hold nothing of the reference outside the mount, and nothing of Nuxt inside it', async () => {
    // Given
    const everything = await filesUnder(PUBLIC_DIR);

    // When
    const outside = everything.filter((file) => !file.startsWith(`${MOUNT}/`));
    const application = outside.filter((file) => !file.startsWith('_nuxt/'));

    // Then
    expect(application.sort()).toEqual([...APPLICATION_FILES].sort());
    expect(outside.length).toBeGreaterThan(APPLICATION_FILES.length);
  });

  it('should say out loud that a static deployment answers no proxy route', () => {
    // Then
    expect(generateOutput).toContain('a static deployment runs no server');
  });

  it('should carry a manifest of its own, so a second generation is incremental rather than blind', async () => {
    // Given
    const manifest = await readFile(join(PUBLIC_DIR, MOUNT, BUILD_MANIFEST_FILE), 'utf8');

    // When
    const parsed = JSON.parse(manifest) as { basePath: string; pages: unknown[] };

    // Then
    expect(parsed.basePath).toBe(BASE);
    expect(parsed.pages.length).toBeGreaterThan(10);
  });
});

describe('the example application serving the reference with SSR', () => {
  beforeAll(async () => {
    await runNuxt('build');
    const port = await freePort();
    server = await bootServer(port);
    origin = `http://127.0.0.1:${String(port)}`;
  }, SPAWNED_PROCESS_TIMEOUT_MS);

  it('should answer the overview and a node page from the route rather than from a file', async () => {
    // When
    const overview = await fetch(`${origin}${BASE}`);
    const node = await fetch(`${origin}${BASE}/get-parcels`);

    // Then
    expect(overview.status).toBe(200);
    expect(overview.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(overview.headers.get('cache-control')).toBe('no-cache');
    expect(node.status).toBe(200);
    expect(await node.text()).toContain('List parcels');
  });

  it('should serve the page the build writes, plus the response nonce and nothing else', async () => {
    // Given
    const generated = await readFile(join(cliOut ?? '', 'index.html'), 'utf8');

    // When
    const served = await (await fetch(`${origin}${BASE}`)).text();
    const nonces = [...served.matchAll(/ nonce="(?<value>[^"]+)"/gu)];

    // Then: the nonce is on every element that needs one, and it is one value.
    expect(nonces.length).toBeGreaterThan(1);
    expect(new Set(nonces.map((match) => match.groups?.value)).size).toBe(1);

    // Then: removing exactly the nonce attributes gives back the generated bytes.
    const withoutNonce = served.replaceAll(/ nonce="[^"]*"/gu, '');
    expect(withoutNonce).toBe(generated);
    expect(served.length - withoutNonce.length).toBe(
      nonces.reduce((total, match) => total + match[0].length, 0),
    );
  });

  it('should carry the strict policy of SPEC 19.2 with that same nonce', async () => {
    // When
    const response = await fetch(`${origin}${BASE}`);
    const policy = response.headers.get('content-security-policy') ?? '';
    const served = await response.text();
    const nonce = /nonce="(?<value>[^"]+)"/u.exec(served)?.groups?.value ?? '';

    // Then
    // Then: the header the deployment served and the policy this project owns are one string,
    // for the nonce that is actually in the page. A transcribed copy on either side desyncs here.
    expect(nonce).not.toBe('');
    expect(policy).toBe(contentSecurityPolicy(nonce));
    expect(policy).toContain("script-src 'self' 'nonce-");
    expect(policy).not.toContain('unsafe-inline');
  });

  it('should serve a page a strict policy can execute: no inline style attribute, no unnonced script', async () => {
    // When
    const served = await (await fetch(`${origin}${BASE}/get-parcels`)).text();
    const scripts = [...served.matchAll(/<script(?<attributes>[^>]*)>/gu)];
    const styles = [...served.matchAll(/<style(?<attributes>[^>]*)>/gu)];

    // Then: the subjects exist before their property is asserted.
    expect(scripts.length).toBeGreaterThan(0);

    for (const element of [...scripts, ...styles]) {
      const attributes = element.groups?.attributes ?? '';
      if (attributes.includes('src=')) continue;
      expect(attributes).toContain('nonce="');
    }

    expect(/<[a-z][^>]* style="/u.test(served)).toBe(false);
  });

  it('should link nothing off this origin, which is what zero external requests means in the markup', async () => {
    // When
    const served = await (await fetch(`${origin}${BASE}`)).text();
    const references = [
      ...served.matchAll(/<(?:script|link)[^>]*(?:src|href)="(?<value>[^"]+)"/gu),
    ].map((match) => match.groups?.value ?? '');

    // Then
    expect(references.length).toBeGreaterThan(1);
    for (const reference of references) {
      expect(reference.startsWith(`${BASE}/`)).toBe(true);
    }
  });

  it('should answer the assets from the deployment static layer, immutably', async () => {
    // Given
    const served = await (await fetch(`${origin}${BASE}`)).text();
    const stylesheet = /<link[^>]*href="(?<value>[^"]+\.css)"/u.exec(served)?.groups?.value;

    // Then
    expect(stylesheet).toBeDefined();

    // When
    const response = await fetch(`${origin}${stylesheet ?? ''}`);

    // Then
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/css');
    expect(await response.text()).toBe(
      await readFile(join(cliOut ?? '', (stylesheet ?? '').slice(BASE.length + 1)), 'utf8'),
    );
  });

  it('should answer an address the site does not hold with a 404 that says so', async () => {
    // When
    const response = await fetch(`${origin}${BASE}/no-such-operation`);

    // Then
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toContain('No page of that address is documented here.');
  });

  it('should let the generated proxy route answer under the reference, refusing an upstream it never pinned', async () => {
    // When
    const unknown = await fetch(`${origin}${BASE}/_proxy/u9/anything`);
    const missing = await fetch(`${origin}${BASE}/_proxy/nonsense`);

    // Then: the proxy route wins over the reference's catch all, and refuses by name.
    expect(unknown.status).toBe(403);
    expect(missing.status).toBe(403);
  });

  it('should leave the application its own root page', async () => {
    // When
    const response = await fetch(`${origin}/`);

    // Then
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Example application');
  });
});

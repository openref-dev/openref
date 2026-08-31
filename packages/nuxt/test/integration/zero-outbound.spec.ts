import { Socket } from 'node:net';
import { request as httpRequest } from 'node:http';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateSite, loadSpecification, resolveNuxtOptions } from '../../src/index';
import { createSite } from '../../src/runtime/site';

/**
 * SPEC 16.3's zero outbound requests, on both halves of the Nuxt module.
 *
 * THE TRAP IS PROVED BEFORE EITHER HALF IS JUDGED BY IT, which is the same discipline
 * `packages/static/test/integration/build-network.spec.ts` states at length: a recorder that
 * watched nothing would report zero and look exactly like a build that made none. It watches the
 * same two choke points for the same measured reason, `Socket.prototype.connect` for
 * `node:http`, `node:https` and `node:tls`, and `globalThis.fetch` beside it because undici
 * reaches the network through internal bindings rather than through the prototype.
 *
 * IT IS NOT IMPORTED FROM THAT FILE, AND THAT IS A LIMIT OF TEST CODE RATHER THAN A CHOICE: a
 * package's test mocks are not part of its published surface and this package may not reach into
 * another one's `test/`. What is shared is the doctrine, and the doctrine is stated in both.
 *
 * WHAT THIS SUITE DOES NOT CLAIM. It says nothing about what `nuxt build` itself does: that is
 * Nuxt's own process, and a trap installed here cannot see inside a spawned one. What it settles
 * is the part this repository wrote, which is the module's generation and the module's serving.
 */

/** What the trap saw. */
interface Recorder {
  readonly calls: string[];
  restore(): void;
}

/** Wraps the two choke points and records what was asked for, refusing each. */
function trapNetwork(): Recorder {
  const calls: string[] = [];

  const prototype = Socket.prototype as unknown as Record<string, unknown>;
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalConnect = prototype.connect;
  const originalFetch = globals.fetch;

  prototype.connect = (...args: unknown[]): never => {
    const target = args[0];
    const description =
      typeof target === 'object' && target !== null
        ? ((target as { host?: string }).host ?? JSON.stringify(target))
        : String(target);
    calls.push(`connect ${description}`);
    throw new Error('the Nuxt module opened a socket');
  };

  globals.fetch = (input: unknown): never => {
    calls.push(`fetch ${String(input)}`);
    throw new Error('the Nuxt module made an outbound request');
  };

  return {
    calls,
    restore(): void {
      prototype.connect = originalConnect;
      globals.fetch = originalFetch;
    },
  };
}

const SPEC_FIXTURE = fileURLToPath(
  new URL('../../../../examples/nuxt-reference/openapi.yaml', import.meta.url),
);

const CLIENT_BUNDLE = fileURLToPath(
  new URL('../../../nest/dist/browser/openref.js', import.meta.url),
);

let recorder: Recorder | null = null;
let root: string;

beforeEach(async () => {
  if (!(await stat(CLIENT_BUNDLE).catch(() => null))) {
    throw new Error(
      `${CLIENT_BUNDLE} is not there, and it is the client bundle every page links. Run \`pnpm build\` first. This suite refuses to skip itself, because a skipped run and a passing run look identical from the outside`,
    );
  }

  root = await mkdtemp(join(tmpdir(), 'openref-outbound-'));
  await cp(SPEC_FIXTURE, join(root, 'openapi.yaml'));
});

afterEach(async () => {
  recorder?.restore();
  recorder = null;
  await rm(root, { recursive: true, force: true });
});

describe('the trap', () => {
  it('should see a socket and a fetch, so a zero from it means something', () => {
    // Given
    recorder = trapNetwork();

    // When: both are refused where they are called, which is what makes them countable.
    expect(() => httpRequest('http://127.0.0.1:9/nowhere')).toThrow();
    expect(() => fetch('http://127.0.0.1:9/nowhere')).toThrow();

    // Then
    expect(recorder.calls).toHaveLength(2);
  });
});

describe('the generation half', () => {
  it('should write the whole site without opening a socket', async () => {
    // Given
    const options = resolveNuxtOptions({ spec: './openapi.yaml', base: '/docs', target: 'nitro' });
    const specification = await loadSpecification(options.spec, root);
    const publicDir = join(root, 'public');
    recorder = trapNetwork();

    // When
    const report = await generateSite(options, specification, publicDir, () => undefined);

    // Then: it did the work, and it did it without the network.
    expect(report.build.rendered.length).toBeGreaterThan(10);
    expect(recorder.calls).toEqual([]);
  });
});

describe('the served half', () => {
  it('should build its site and answer a page without opening a socket', async () => {
    // Given
    const specification = await loadSpecification('./openapi.yaml', root);
    const site = createSite({
      specification: specification.text,
      source: specification.path,
      base: '/docs',
      target: null,
      forwardCookies: false,
      lang: null,
      colorScheme: null,
      assets: {
        servedNames: { 'theme.css': 'theme.abc.css', 'openref.js': 'openref.def.js' },
        stylesheetNames: ['theme.css'],
        moduleName: 'openref.js',
      },
    });
    recorder = trapNetwork();

    // When
    const answer = await (await site()).answer('/docs');

    // Then
    expect(answer?.body).toContain('Parcels');
    expect(recorder.calls).toEqual([]);
  });
});

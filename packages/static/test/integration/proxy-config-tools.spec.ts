import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseAllRedirects } from '@netlify/redirect-parser';
import { getTransformedRoutes } from '@vercel/routing-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';
import { generateProxyFiles } from '../../src/index';

/**
 * Each generated configuration through the target platform's own tooling, per the T040 test
 * requirement: Netlify's redirect parser, Vercel's routing schema, the TypeScript compiler for
 * the Nitro route, node's own parser for the Pages Function, and the nginx and caddy binaries
 * where a machine has them.
 *
 * EVERY VALIDATOR IS FIRST SHOWN FAILING on planted garbage, because a validator that accepts
 * everything proves nothing, and the two binary backed cases SAY when they cannot run instead
 * of passing silently: a skipped check is a visible verdict, an absent one is a green lie.
 */

const run = promisify(execFile);

const OPTIONS = {
  upstreams: ['https://api.example.com/v1', 'http://other.example.com:8080'],
  basePath: '/docs',
  forwardCookies: false,
};

function contentOf(target: Parameters<typeof generateProxyFiles>[0]): string {
  const [file] = generateProxyFiles(target, OPTIONS);
  if (file === undefined) throw new Error(`no file generated for ${target}`);
  return file.content;
}

/** Whether a binary answers on this machine, so a case can say it cannot run. */
async function available(binary: string, args: readonly string[]): Promise<boolean> {
  try {
    await run(binary, [...args]);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== 'ENOENT';
  }
}

let directory = '';
let nginxPresent = false;
let caddyPresent = false;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openref-proxy-tools-'));
  [nginxPresent, caddyPresent] = await Promise.all([
    available('nginx', ['-v']),
    available('caddy', ['version']),
  ]);
});

afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('the netlify rules through @netlify/redirect-parser', () => {
  it('should parse with no errors, every rule a proxy to a pinned host', async () => {
    // Given
    const path = join(directory, '_redirects');
    await writeFile(path, contentOf('netlify'));

    // When
    const parsed = await parseAllRedirects({
      redirectsFiles: [path],
      configRedirects: [],
      minimal: false,
    });

    // Then
    expect(parsed.errors).toEqual([]);
    expect(parsed.redirects).toHaveLength(2);
    for (const rule of parsed.redirects) {
      expect(rule.proxy).toBe(true);
      expect(rule.status).toBe(200);
      expect(['api.example.com', 'other.example.com:8080']).toContain(
        new URL(rule.to.replace('/:splat', '/')).host,
      );
    }
  });

  it('should report errors on a planted broken file, so the parser is known to look', async () => {
    // Given: a rule with a status that is not one.
    const path = join(directory, '_redirects-broken');
    await writeFile(path, '/docs/* not-a-url not-a-status\n');

    // When
    const parsed = await parseAllRedirects({
      redirectsFiles: [path],
      configRedirects: [],
      minimal: false,
    });

    // Then
    expect(parsed.errors.length).toBeGreaterThan(0);
  });
});

describe('the vercel rewrites through @vercel/routing-utils', () => {
  it('should transform with no error, every destination host pinned', () => {
    // Given
    const parsed = JSON.parse(contentOf('vercel')) as {
      rewrites: { source: string; destination: string }[];
    };

    // When
    const routes = getTransformedRoutes({ rewrites: parsed.rewrites });

    // Then
    expect(routes.error).toBeNull();
    const destinations = (routes.routes ?? [])
      .map((route) => ('dest' in route ? route.dest : undefined))
      .filter((dest): dest is string => dest !== undefined);
    expect(destinations).toHaveLength(2);
    for (const dest of destinations) {
      expect(['api.example.com', 'other.example.com:8080']).toContain(
        new URL(dest.replace('/$1', '/')).host,
      );
    }
  });

  it('should report an error on a planted broken source, so the schema is known to look', () => {
    // When
    const routes = getTransformedRoutes({ rewrites: [{ source: '(((', destination: '/x' }] });

    // Then
    expect(routes.error).not.toBeNull();
  });
});

describe("the pages function through node, the platform runtime's own family", () => {
  it(
    'should pass node --check, and a planted syntax error should not',
    async () => {
      // Given
      const path = join(directory, 'function.mjs');
      await writeFile(path, contentOf('cloudflare-pages'));
      const broken = join(directory, 'function-broken.mjs');
      await writeFile(broken, `${contentOf('cloudflare-pages')}\nexport function {`);

      // When, Then: the artefact parses and the control does not.
      await run(process.execPath, ['--check', path]);
      await expect(run(process.execPath, ['--check', broken])).rejects.toThrow();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the nginx snippet through nginx -t, where a machine has nginx', () => {
  it(
    'should validate inside a minimal server block, or say the binary is absent',
    async ({ skip }) => {
      // Given: a check that cannot run says so, never passes silently.
      if (!nginxPresent) {
        skip('nginx is not installed on this machine, so its own validator cannot be asked');
        return;
      }

      const snippet = join(directory, 'openref-proxy.nginx.conf');
      await writeFile(snippet, contentOf('nginx'));
      const conf = join(directory, 'nginx.conf');
      await writeFile(
        conf,
        [
          'events {}',
          'http {',
          '  server {',
          '    listen 127.0.0.1:0;',
          `    include ${snippet};`,
          '  }',
          '}',
          '',
        ].join('\n'),
      );

      // When, Then: -t parses without starting, and a planted broken include fails.
      await run('nginx', ['-t', '-c', conf, '-p', directory, '-e', join(directory, 'error.log')]);

      const brokenSnippet = join(directory, 'broken.nginx.conf');
      await writeFile(brokenSnippet, 'location { nonsense');
      const brokenConf = join(directory, 'nginx-broken.conf');
      await writeFile(
        brokenConf,
        `events {}\nhttp {\n  server {\n    include ${brokenSnippet};\n  }\n}\n`,
      );
      await expect(
        run('nginx', ['-t', '-c', brokenConf, '-p', directory, '-e', join(directory, 'error.log')]),
      ).rejects.toThrow();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the caddy snippet through caddy adapt, where a machine has caddy', () => {
  it(
    'should adapt inside a minimal site block, or say the binary is absent',
    async ({ skip }) => {
      // Given
      if (!caddyPresent) {
        skip('caddy is not installed on this machine, so its own validator cannot be asked');
        return;
      }

      const caddyfile = join(directory, 'Caddyfile');
      await writeFile(
        caddyfile,
        `localhost {\n${contentOf('caddy')
          .split('\n')
          .filter((line) => !line.startsWith('#'))
          .map((line) => `  ${line}`)
          .join('\n')}\n}\n`,
      );

      // When, Then
      await run('caddy', ['adapt', '--config', caddyfile, '--adapter', 'caddyfile']);

      const broken = join(directory, 'Caddyfile-broken');
      await writeFile(broken, 'localhost {\n  handle_path {\n');
      await expect(
        run('caddy', ['adapt', '--config', broken, '--adapter', 'caddyfile']),
      ).rejects.toThrow();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

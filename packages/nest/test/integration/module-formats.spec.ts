import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The dual build of SPEC 23, checked by loading it rather than by reading the configuration.
 *
 * WHAT THE LOADING TESTS PROVE, AND WHAT THEY NO LONGER DO. They prove the built package
 * resolves and carries its public surface in both module systems, which is a real claim: it is
 * what caught `@noble/hashes` missing from `dependencies`. They no longer prove anything about
 * `ERR_REQUIRE_ESM`. SPEC 23 moved to Node 22.22.2 on 2026-08-10 and every version in that
 * range can `require` an ESM package natively, so a runtime check of that cannot fail on any
 * runtime this project supports. Rather than keep a test whose name promised a guarantee it had
 * stopped providing, the guarantee moved to the static assertion below, which reads the built
 * CommonJS file and fails on any Node at all. The load on the declared floor itself is
 * `tools/module-floor-check.mjs`, run by the `module-floor` job.
 *
 * THE EXTERNAL IMPORT CHECK IS HERE FOR A REASON THAT WAS FOUND THE HARD WAY. The build keeps
 * third party packages external and inlines the workspace ones, which means every dependency
 * of a bundled internal package has to be redeclared on this one. `@noble/hashes` was not, and
 * nothing noticed until an example application tried to boot: the unit suite runs from source,
 * where the dependency resolves through the package that actually declares it.
 */

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = join(packageRoot, '..', '..');

interface Manifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as Manifest;

/**
 * Reads a built file, refusing to pass when there is nothing to read.
 *
 * @param relative - Path inside the package
 * @returns The contents
 */
function built(relative: string): string {
  const path = join(packageRoot, relative);

  if (!existsSync(path)) {
    throw new Error(`${relative} is not built. Run pnpm build; a missing artifact is not a pass`);
  }

  return readFileSync(path, 'utf8');
}

/**
 * The two consumer projects the loading tests run inside.
 *
 * A real project rather than the repository root, and that is the point: only a package that
 * declares `@openref/nest` can resolve it, so running the snippet anywhere else would prove
 * something about the workspace layout instead of about the build. The ESM consumer is the
 * example of SPEC 2 and the CommonJS one is the NestJS 10 arm of the compatibility matrix,
 * which is what a NestJS application scaffolded by the CLI looks like.
 */
const CONSUMERS = {
  module: join(repoRoot, 'examples', 'nest-minimal'),
  commonjs: join(repoRoot, 'compat', 'nest10-cjs'),
} as const;

/**
 * Runs a snippet in a fresh Node process, inside a real consumer project.
 *
 * @param source - Program text
 * @param kind - Module system of the consumer
 * @returns Whatever it printed
 */
function runInNode(source: string, kind: 'module' | 'commonjs'): string {
  return execFileSync(process.execPath, [`--input-type=${kind}`, '-e', source], {
    cwd: CONSUMERS[kind],
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Dependencies that publish ESM only, and so cannot be `require`d below Node 20.19.
 *
 * Adding one here is what makes the check below able to fail. A package that gains an ESM only
 * major without being added would pass silently, so this list is part of the dependency review
 * rather than a convenience.
 */
const ESM_ONLY_DEPENDENCIES: readonly string[] = ['marked', 'shiki'];

/** Everything Node provides, so it is never mistaken for an undeclared dependency. */
const BUILTINS = new Set(builtinModules);

/** Bare package specifiers imported or required by a built file. */
function externalSpecifiers(code: string): string[] {
  const found = new Set<string>();
  const patterns = [
    /(?:^|[\s;{}])import\s+[^'"]*from\s*["']([^"']+)["']/g,
    /(?:^|[\s;{}=(])import\s*\(\s*["']([^"']+)["']\s*\)/g,
    /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1] ?? '';
      // Node builtins appear with and without the `node:` prefix, because esbuild strips it
      // in the CommonJS output. Both are the platform, not a dependency.
      if (specifier === '' || specifier.startsWith('.')) continue;
      if (specifier.startsWith('node:') || BUILTINS.has(specifier)) continue;
      found.add(specifier);
    }
  }

  return [...found].sort((a, b) => a.localeCompare(b));
}

/** Package name of a specifier, which may carry a subpath. */
function packageOf(specifier: string): string {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
}

describe('the dual build', () => {
  it('should resolve and expose its surface to an ESM consumer', () => {
    // Given
    const source = `
      const module = await import('@openref/nest');
      console.log(JSON.stringify({ name: module.PACKAGE_NAME, setup: typeof module.OpenRefModule.setup }));
    `;

    // When
    const printed = runInNode(source, 'module');

    // Then
    expect(JSON.parse(printed)).toEqual({ name: '@openref/nest', setup: 'function' });
  });

  it('should resolve and expose its surface to a CommonJS consumer', () => {
    // Given
    const source = `
      const module = require('@openref/nest');
      console.log(JSON.stringify({ name: module.PACKAGE_NAME, setup: typeof module.OpenRefModule.setup }));
    `;

    // When
    const printed = runInNode(source, 'commonjs');

    // Then
    expect(JSON.parse(printed)).toEqual({ name: '@openref/nest', setup: 'function' });
  });

  it('should render a page from CommonJS, which is the path the ESM only dependencies sit on', () => {
    // Given, the highlighter and the markdown renderer, the two paths that touch `shiki` and
    // `marked`. This exercises them from the CommonJS half; what it cannot do any more is fail
    // when they are reached with `require`, since every supported Node allows that.
    const source = `
      const { ReferenceService } = require('@openref/nest');
      const service = new ReferenceService({
        document: {
          openapi: '3.1.0',
          info: { title: 'T', version: '1' },
          paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } },
        },
        basePath: '/docs',
        assets: {
          sources: [{ name: 'openref.js', bytes: new TextEncoder().encode('x') }],
          stylesheetNames: [],
          moduleName: 'openref.js',
        },
      });
      service.handle('overview', { params: {}, headers: {} }).then((reply) => {
        console.log(JSON.stringify({ status: reply.status, html: String(reply.body).startsWith('<!DOCTYPE html>') }));
      });
    `;

    // When
    const printed = runInNode(source, 'commonjs');

    // Then
    expect(JSON.parse(printed)).toEqual({ status: 200, html: true });
  });

  it('should declare every package its built output reaches for', () => {
    // Given
    const declared = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);

    // When
    const reached = [
      ...new Set(
        [
          ...externalSpecifiers(built('dist/index.js')),
          ...externalSpecifiers(built('dist/index.cjs')),
        ].map(packageOf),
      ),
    ].sort((a, b) => a.localeCompare(b));
    const undeclared = reached.filter((name) => !declared.has(name));

    // Then
    expect(undeclared).toEqual([]);
    expect(reached.length).toBeGreaterThan(0);
  });

  it('should reach every ESM only dependency through import() and never through require()', () => {
    // Given, the assertion that does not depend on which Node runs it. `require(esm)` is
    // native from Node 20.19, so a runtime check of this on a modern runtime passes whether or
    // not the dynamic imports are there, and the reader this protects is on an older one. The
    // built CommonJS file either reaches for these with `import(` or it does not.
    const cjs = built('dist/index.cjs');

    // When
    const reachedByRequire = ESM_ONLY_DEPENDENCIES.filter((name) =>
      new RegExp(`require\\(\\s*["']${name}["']`).test(cjs),
    );
    const reachedByImport = ESM_ONLY_DEPENDENCIES.filter((name) =>
      new RegExp(`import\\(\\s*["']${name}["']`).test(cjs),
    );

    // Then
    expect(reachedByRequire).toEqual([]);
    expect(reachedByImport).toEqual([...ESM_ONLY_DEPENDENCIES]);
  });

  it('should keep the browser bundle free of any external import at all', () => {
    // Given, everything a page needs is in the file. An import left in it would be a request
    // to somewhere, and SPEC 19.4 puts outgoing requests from the client at zero.
    const bundle = built('dist/browser/openref.js');

    // When
    const external = externalSpecifiers(bundle);

    // Then
    expect(external).toEqual([]);
  });
});

import { builtinModules } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

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
 * A consumer with no NestJS at all, which is a supported way to use this package.
 *
 * `tools/browser-budget` depends on `@openref/nest` and boots Express directly, because what the
 * budgets measure is what a browser receives and NestJS puts nothing on the wire. `@nestjs/core`
 * is not resolvable from there, so it is also the one place in this repository where "the package
 * loads without the framework" can be run rather than reasoned about.
 */
const FRAMEWORK_FREE_CONSUMER = join(repoRoot, 'tools', 'browser-budget');

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
 * Runs a snippet in the consumer that has no NestJS, with `NODE_PATH` cleared.
 *
 * CLEARING IT IS WHAT MAKES THE TEST MEASURE WHAT IT CLAIMS. pnpm exports a `NODE_PATH` pointing
 * at its flat virtual store, so a child process it started can resolve every package in the
 * workspace regardless of what the consumer declares. A real consumer has no such variable, and
 * with it left in place this test would report that NestJS is reachable from a project that does
 * not depend on it, which is the opposite of the thing being checked.
 *
 * @param source - Program text
 * @returns Whatever it printed
 */
function runInFrameworkFreeConsumer(source: string): string {
  const environment = { ...process.env };
  delete environment.NODE_PATH;

  return execFileSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: FRAMEWORK_FREE_CONSUMER,
    env: environment,
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
  it(
    'should resolve and expose its surface to an ESM consumer',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given
      const source = `
      const module = await import('@openref/nest');
      console.log(JSON.stringify({ name: module.PACKAGE_NAME, setup: typeof module.OpenRefModule.setup }));
    `;

      // When
      const printed = runInNode(source, 'module');

      // Then
      expect(JSON.parse(printed)).toEqual({ name: '@openref/nest', setup: 'function' });
    },
  );

  it(
    'should resolve and expose its surface to a CommonJS consumer',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given
      const source = `
      const module = require('@openref/nest');
      console.log(JSON.stringify({ name: module.PACKAGE_NAME, setup: typeof module.OpenRefModule.setup }));
    `;

      // When
      const printed = runInNode(source, 'commonjs');

      // Then
      expect(JSON.parse(printed)).toEqual({ name: '@openref/nest', setup: 'function' });
    },
  );

  it(
    'should render a page from CommonJS, which is the path the ESM only dependencies sit on',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
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
    },
  );

  it(
    'should declare every package its built output reaches for',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
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
    },
  );

  it(
    'should reach every ESM only dependency through import() and never through require()',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
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
    },
  );

  it(
    'should load with no NestJS installed, reaching @nestjs/core only from inside forRoot',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given, TX-FORROOT's measurement: `tools/browser-budget` imports this package and boots
      // Express with no NestJS in its tree, which is how the browser budgets prove the package
      // puts no framework on the wire, and `@nestjs/core` is not resolvable from there. The load
      // is therefore lazy, and this is what keeps it lazy: a refactor that hoists it to the top of
      // the file breaks nothing in the unit suite and nothing here would go red without this.
      const esm = built('dist/index.js');
      const cjs = built('dist/index.cjs');

      // When
      const statik = [esm, cjs].flatMap((file) => [
        ...file.matchAll(/(?:^|[^.\w])(?:import|export)\s[^;]*?["'](@nestjs\/[^"']+)["']/g),
        ...file.matchAll(/(?:^|[^.\w])require\(\s*["'](@nestjs\/[^"']+)["']\s*\)/g),
      ]);
      // The CommonJS build shims `import.meta.url` into an expression carrying its own brackets,
      // so the argument cannot be matched as a bracket free run. One line is enough: both builds
      // emit the whole call on one.
      const lazy = [esm, cjs].filter((file) =>
        /createRequire[^\n]*\)\(\s*["']@nestjs\/core["']\s*\)/.test(file),
      );

      // Then, the file is a build before it is a build with no static import in it, per SPEC 0
      expect(esm).toContain('forRoot');
      expect(statik.map((match) => match[1])).toEqual([]);
      expect(lazy).toHaveLength(2);
    },
  );

  it(
    'should serve its route table from a consumer that cannot resolve NestJS at all',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given, run rather than reasoned about: this consumer has no `@nestjs/core` in its tree, so
      // a static import anywhere in the package's graph would make the import below throw. The
      // static assertion above says the same thing about the file; this says it about a process.
      const source = [
        "const { createRequire } = await import('node:module');",
        'let resolvable = true;',
        "try { createRequire(process.cwd() + '/x.js')('@nestjs/core'); } catch { resolvable = false; }",
        "const { OpenRefModule, referenceRoutes } = await import('@openref/nest');",
        "const routes = referenceRoutes('/docs').map((route) => route.id);",
        'console.log(JSON.stringify({ resolvable, setup: typeof OpenRefModule.setup, routes: routes.length }));',
      ].join('\n');

      // When
      const printed = JSON.parse(runInFrameworkFreeConsumer(source)) as {
        resolvable: boolean;
        setup: string;
        routes: number;
      };

      // Then, the first field is what makes the other two mean anything
      expect(printed.resolvable).toBe(false);
      expect(printed.setup).toBe('function');
      expect(printed.routes).toBeGreaterThan(0);
    },
  );

  it(
    'should keep the browser bundle free of any external import at all',
    { timeout: SPAWNED_PROCESS_TIMEOUT_MS },
    () => {
      // Given, everything a page needs is in the file. An import left in it would be a request
      // to somewhere, and SPEC 19.4 puts outgoing requests from the client at zero.
      const bundle = built('dist/browser/openref.js');

      // When
      const external = externalSpecifiers(bundle);

      // Then, the file is a bundle before it is a bundle with no imports in it. An empty or
      // truncated build has no external specifier either, per SPEC 0.
      expect(bundle).toContain('oref-app');
      expect(external).toEqual([]);
    },
  );
});

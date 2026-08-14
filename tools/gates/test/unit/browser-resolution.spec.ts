import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { browserResolutionGate } from '../../src/gates/browser-resolution.gate';
import { classifySpecifier, specifiersIn } from '../../src/lib/browser-specifiers';
import type { GateResult } from '../../src/types';

/**
 * The gate that asks the browser's question about a built chunk, and every way it could miss.
 *
 * WHAT IT EXISTS FOR HAPPENED. `sha256Hex` reached `@noble/hashes/sha2` by bare name, T028 called
 * it for the PKCE challenge, and the specifier landed in the chunk the first paint loads. The
 * build succeeded, the budgets were inside their limits, the CSP scan found nothing, the module
 * graph accounted for every file, and every suite ran under Node, where that specifier resolves.
 * A browser has no import map, so the entry stopped evaluating and the page did nothing.
 *
 * SO THE CASES BELOW ARE MOSTLY ABOUT A SCAN THAT READS NOTHING. A specifier form the regular
 * expression stopped matching would produce a gate that walks the right files, finds no problem
 * and passes, which is exactly the state the defect shipped in. The two directions are checked
 * separately: what the scan reports on material that is wrong, and what it does when the material
 * is not there at all.
 */

/** Where a synthetic tree is built, replaced per test. */
let root: string | undefined;

/**
 * Builds a repository shaped tree with browser chunks in it.
 *
 * The gate derives its roots from `packages/` through the committed `tools/dependency-rules.cjs`,
 * so the tree carries a module that re-exports the committed one rather than a second copy of the
 * derivation. That is the arrangement `package-coverage.spec.ts` arrived at, for the same reason:
 * a test that reimplements what it tests proves only that the copy agrees with itself.
 *
 * @param chunks - Repository relative path to source, one entry per file to write
 * @returns Absolute path of the tree root
 */
function plant(chunks: Readonly<Record<string, string>>): string {
  root = mkdtempSync(join(tmpdir(), 'openref-resolution-'));
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(
    join(root, 'tools', 'dependency-rules.cjs'),
    `module.exports = require(${JSON.stringify(join(import.meta.dirname, '..', '..', '..', 'dependency-rules.cjs'))});\n`,
    'utf8',
  );

  for (const [file, source] of Object.entries(chunks)) {
    const absolute = join(root, file);
    mkdirSync(join(absolute, '..'), { recursive: true });
    writeFileSync(absolute, source, 'utf8');
  }

  return root;
}

/**
 * Runs the gate over a planted tree.
 *
 * @param chunks - What to write into it
 * @returns The gate result
 */
async function runOver(chunks: Readonly<Record<string, string>>): Promise<GateResult> {
  return browserResolutionGate.run({ repoRoot: plant(chunks) });
}

/**
 * Every error message the gate produced, joined for matching.
 *
 * @param result - What the gate returned
 * @returns The error findings as one string
 */
function errorsOf(result: GateResult): string {
  return result.findings
    .filter((finding) => finding.level === 'error')
    .map((finding) => finding.message)
    .join('\n');
}

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe('classifySpecifier', () => {
  it('should call a package name bare, which is what a browser cannot resolve', () => {
    // Given, When, Then
    expect(classifySpecifier('@noble/hashes/sha2')).toBe('bare');
    expect(classifySpecifier('vue')).toBe('bare');
  });

  it('should accept the two forms a browser resolves on its own', () => {
    // Given a relative specifier, resolved against the importing module's url, and an absolute
    // path, resolved against the origin
    // When, Then
    expect(classifySpecifier('./chunk-A.js')).toBe('relative');
    expect(classifySpecifier('../shared/x.js')).toBe('relative');
    expect(classifySpecifier('/openref/browser/openref.js')).toBe('absolute-path');
  });

  it('should tell a remote url from a package name, because the two fail differently', () => {
    // Given. A bare specifier does not resolve at all; a url resolves and fetches from a server
    // that is not the one serving the page, which is the promise SPEC 19 makes.
    // When, Then
    expect(classifySpecifier('https://cdn.example.com/vue.js')).toBe('external-url');
    expect(classifySpecifier('//cdn.example.com/vue.js')).toBe('external-url');
    expect(classifySpecifier('data:text/javascript,')).toBe('external-url');
  });
});

describe('specifiersIn', () => {
  it('should read the minified forms a bundler emits, which have no whitespace to anchor on', () => {
    // Given the three shapes esbuild writes
    const source = `import"./a.js";import{x}from'./b.js';var q=()=>import("@noble/hashes/sha2");`;

    // When
    const found = specifiersIn(source);

    // Then
    expect(found.specifiers).toEqual([
      { specifier: '@noble/hashes/sha2', kind: 'bare', form: 'dynamic' },
      { specifier: './a.js', kind: 'relative', form: 'static' },
      { specifier: './b.js', kind: 'relative', form: 'static' },
    ]);
  });

  it('should count a dynamic import once rather than on both sides', () => {
    // Given, the shape that reads as two: `import("./x")` also matches the bare `import "./x"`
    const source = 'import("./lazy.js");';

    // When
    const found = specifiersIn(source);

    // Then
    expect(found.specifiers).toEqual([
      { specifier: './lazy.js', kind: 'relative', form: 'dynamic' },
    ]);
  });

  it('should report a dynamic import whose specifier is not a literal', () => {
    // Given a specifier this scan cannot read. A bundler does not emit one, so meeting one means
    // the question went unanswered for that edge, and an unanswered question is not a pass.
    const source = 'var load=(name)=>import(name);';

    // When
    const found = specifiersIn(source);

    // Then
    expect(found.unreadable).toHaveLength(1);
    expect(found.unreadable[0]).toContain('import(name)');
  });

  it('should read an export that re-exports from a bare specifier', () => {
    // Given, which is how a re-export reaches a chunk without any `import` keyword in front of it
    const source = `export{sha256Hex}from"@noble/hashes/sha2";`;

    // When
    const found = specifiersIn(source);

    // Then
    expect(found.specifiers).toEqual([
      { specifier: '@noble/hashes/sha2', kind: 'bare', form: 'static' },
    ]);
  });
});

describe('browserResolutionGate', () => {
  it('should fail on the bare specifier that killed the entry, naming the file and the specifier', async () => {
    // Given the defect as it shipped: the hashing module reached its dependency by name, and the
    // bundler left the name in the chunk the first paint loads
    const result = await runOver({
      'packages/nest/dist/browser/openref.js': `import"./chunk-A.js";import"@noble/hashes/sha2";`,
      'packages/nest/dist/browser/chunk-A.js': 'export var a=1;',
    });

    // When, Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('packages/nest/dist/browser/openref.js');
    expect(errorsOf(result)).toContain('@noble/hashes/sha2');
  });

  it('should fail on a bare specifier in a deferred chunk, which fails quietly rather than visibly', async () => {
    // Given the same defect one chunk further in. A dead entry is visible in the first second; a
    // dead deferred chunk fails when a reader presses Send, on their machine, while the page
    // around it goes on looking correct.
    const result = await runOver({
      'packages/nest/dist/browser/openref.js': `var f=()=>import("./TryItPanel-AAAA.js");`,
      'packages/nest/dist/browser/TryItPanel-AAAA.js': `import{h}from"@noble/hashes/sha2";`,
    });

    // When, Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('TryItPanel-AAAA.js');
  });

  it('should scan a chunk the module graph reaches from nothing', async () => {
    // Given an orphan chunk. The size budgets partition by reachability and would count this as
    // unaccounted; the question here is different and has no entry in it, because a chunk that
    // nothing imports today is imported by something tomorrow.
    const result = await runOver({
      'packages/nest/dist/browser/openref.js': 'export var a=1;',
      'packages/nest/dist/browser/orphan.js': `import"vue";`,
    });

    // When, Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('orphan.js');
  });

  it('should fail on a remote url, which resolves and then leaves the origin', async () => {
    // Given
    const result = await runOver({
      'packages/nest/dist/browser/openref.js': `import"https://cdn.example.com/vue.js";`,
    });

    // When, Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('external request');
  });

  it('should fail on a relative specifier naming a file that was not built', async () => {
    // Given a 404 with the same consequence as an unresolvable name: the module does not evaluate
    const result = await runOver({
      'packages/nest/dist/browser/openref.js': `import"./chunk-GONE.js";`,
    });

    // When, Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('was not built');
  });

  it('should pass the bundle as it is built today, with no exception list anywhere', async () => {
    // Given a bundle shaped like the shipped one, entry plus shared chunk plus deferred
    // feature, and the three single file bundles the registry declares beside it since T033
    const result = await runOver({
      'packages/nest/dist/browser/openref.js': `import"./chunk-A.js";var f=()=>import("./TryItPanel-AAAA.js");`,
      'packages/nest/dist/browser/chunk-A.js': 'export var a=1;',
      'packages/nest/dist/browser/TryItPanel-AAAA.js': `import"./chunk-A.js";`,
      'packages/nest/dist/browser-wc/openref-element.js': 'var element=1;export{element};',
      'packages/nest/dist/browser-iife/openref-element.iife.js': 'var element=1;',
      'packages/theme-telltale/dist/entry/entry.js': 'var entry=1;export{entry};',
    });

    // When, Then
    expect(result.status).toBe('pass');
  });

  it('should skip loudly when nothing has been built, rather than passing on an empty walk', async () => {
    // Given a checkout with no build in it. A scan of nothing finds no bare specifier, and that
    // reading as a pass is the failure this whole file is about.
    const result = await runOver({ 'packages/nest/package.json': '{}' });

    // When, Then
    expect(result.status).toBe('skip');
    expect(result.skipReason).toBe('artifact-absent');
  });

  it('should fail when the shipped entry is not among the files it scanned', async () => {
    // Given the roots gone stale: a bundle that writes its entry outside `dist/browser` is read by
    // nothing here while the gate goes on printing a file count and passing. The declaration of
    // what ships is asked whether the scan reached it, which is the check in the other direction.
    const result = await runOver({
      'packages/nest/dist/browser/chunk-A.js': 'export var a=1;',
    });

    // When, Then
    expect(result.status).toBe('fail');
    expect(errorsOf(result)).toContain('packages/nest/dist/browser/openref.js');
    expect(errorsOf(result)).toContain('did not read it');
  });
});

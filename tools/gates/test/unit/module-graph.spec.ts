import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { partitionModuleGraph, specifiersOf } from '../../src/lib/module-graph';

/**
 * The walker two gates now depend on, and every way it could be silently wrong.
 *
 * A PARTITION THAT FINDS NOTHING IS THE FAILURE MODE THAT LOOKS LIKE SUCCESS. If the specifier
 * scan stopped matching, the initial closure would be the entry alone, `client-js-raw` would
 * report the smallest bundle this project has ever produced, and the budgets gate would print OK
 * on both sides. So the cases below are mostly about what happens when the input is not what the
 * walker expects, rather than about the happy graph.
 */

let root: string;

/** Writes a module under the fake repository root. */
function write(relativePath: string, source: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, source, 'utf8');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openref-graph-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('specifiersOf', () => {
  it('should tell a dynamic import from a bare static one', () => {
    // Given, the shape esbuild emits: a bare `import "./x"` and an `import("./y")` differ by
    // parentheses alone, and a scan that read the first pattern loosely would count both twice.
    const source = 'import"./eager.js";import("./lazy.js");export{a}from"./named.js";';

    // When
    const found = specifiersOf(source);

    // Then
    expect(found.static.sort()).toEqual(['./eager.js', './named.js']);
    expect(found.dynamic).toEqual(['./lazy.js']);
  });

  it('should read the minified form, which has no whitespace to anchor on', () => {
    // Given
    const source = `import {d as d$3}from'./chunk-A.js';var q=()=>import('./B.js');`;

    // When
    const found = specifiersOf(source);

    // Then
    expect(found.static).toEqual(['./chunk-A.js']);
    expect(found.dynamic).toEqual(['./B.js']);
  });

  it('should ignore a bare specifier, which is a dependency and not a chunk', () => {
    // Given
    const source = `import"vue";import{x}from"@openref/core";`;

    // When
    const found = specifiersOf(source);

    // Then
    expect(found.static).toEqual([]);
  });
});

describe('partitionModuleGraph', () => {
  it('should put the static closure on one side and the dynamic reach on the other', () => {
    // Given a bundle shaped like the shipped one: an entry, a shared chunk, and a feature
    // behind a dynamic import that shares that chunk.
    write('dist/entry.js', `import"./shared.js";var f=()=>import("./feature.js");`);
    write('dist/shared.js', 'export var a=1;');
    write('dist/feature.js', `import"./shared.js";import"./feature-dep.js";`);
    write('dist/feature-dep.js', 'export var b=2;');
    const present = ['dist/entry.js', 'dist/shared.js', 'dist/feature.js', 'dist/feature-dep.js'];

    // When
    const split = partitionModuleGraph(root, 'dist/entry.js', present);

    // Then the shared chunk counts once, on the side that pays for it first
    expect(split.initial).toEqual(['dist/entry.js', 'dist/shared.js']);
    expect(split.deferred).toEqual(['dist/feature-dep.js', 'dist/feature.js']);
    expect(split.unaccounted).toEqual([]);
  });

  it('should follow a dynamic import out of a deferred chunk, not only out of the entry', () => {
    // Given
    write('dist/entry.js', `var f=()=>import("./a.js");`);
    write('dist/a.js', `var g=()=>import("./b.js");`);
    write('dist/b.js', 'export var b=1;');

    // When
    const split = partitionModuleGraph(root, 'dist/entry.js', [
      'dist/entry.js',
      'dist/a.js',
      'dist/b.js',
    ]);

    // Then
    expect(split.deferred).toEqual(['dist/a.js', 'dist/b.js']);
    expect(split.unaccounted).toEqual([]);
  });

  it('should name a file the graph never reaches rather than leaving it out', () => {
    // Given a chunk sitting beside the bundle that nothing imports. It is either dead output or
    // a specifier form this walker cannot read, and both are failures rather than a smaller
    // bundle. This is the case that makes the two figures above worth believing.
    write('dist/entry.js', 'export var a=1;');
    write('dist/orphan.js', 'export var b=2;');

    // When
    const split = partitionModuleGraph(root, 'dist/entry.js', ['dist/entry.js', 'dist/orphan.js']);

    // Then
    expect(split.initial).toEqual(['dist/entry.js']);
    expect(split.unaccounted).toEqual(['dist/orphan.js']);
  });

  it('should survive a cycle rather than walking it forever', () => {
    // Given, which a bundler does emit: two chunks that import each other's exports.
    write('dist/entry.js', `import"./a.js";`);
    write('dist/a.js', `import"./entry.js";export var a=1;`);

    // When
    const split = partitionModuleGraph(root, 'dist/entry.js', ['dist/entry.js', 'dist/a.js']);

    // Then
    expect(split.initial).toEqual(['dist/a.js', 'dist/entry.js']);
  });

  it('should throw when the entry itself cannot be read', () => {
    // Given, a build that did not run. Partitioning nothing would give two empty sides, and two
    // empty sides read as a bundle that costs nothing at all.
    // When, Then
    expect(() => partitionModuleGraph(root, 'dist/missing.js', [])).toThrow(/could not be read/);
  });

  it('should ignore a specifier that resolves to nothing rather than counting it', () => {
    // Given an entry naming a chunk that is not there, which is a 404 in the browser. It is not
    // this walker's job to report that: the unaccounted set reports files with no importer, and
    // the browser suite reports importers with no file.
    write('dist/entry.js', `import"./gone.js";`);

    // When
    const split = partitionModuleGraph(root, 'dist/entry.js', ['dist/entry.js']);

    // Then
    expect(split.initial).toEqual(['dist/entry.js']);
    expect(split.unaccounted).toEqual([]);
  });
});

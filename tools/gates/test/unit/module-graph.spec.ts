import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  partitionByGesture,
  partitionModuleGraph,
  specifiersOf,
  type DeferredGesture,
} from '../../src/lib/module-graph';

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

describe('partitionByGesture', () => {
  /**
   * The shipped bundle's shape, in miniature: an entry with four dynamic roots, one of which is
   * the runner, a chunk two features share, and a chunk the first paint already compiled.
   *
   * @returns The two sides, walked from the entry
   */
  function shippedShape(): ReturnType<typeof partitionModuleGraph> {
    write(
      'dist/entry.js',
      `import"./chunk-eager.js";var a=()=>import("./TryItPanel-AAAA.js"),` +
        `b=()=>import("./CommandPalette-BBBB.js"),c=()=>import("./SchemaView-CCCC.js"),` +
        `d=()=>import("./src-DDDD.js");`,
    );
    write('dist/chunk-eager.js', 'export var e=1;');
    write('dist/TryItPanel-AAAA.js', `import"./chunk-shared.js";import"./chunk-eager.js";`);
    write('dist/CommandPalette-BBBB.js', `import"./chunk-shared.js";`);
    write('dist/SchemaView-CCCC.js', 'export var s=1;');
    write('dist/src-DDDD.js', 'export var r=1;');
    write('dist/chunk-shared.js', 'export var h=1;');

    return partitionModuleGraph(root, 'dist/entry.js', [
      'dist/entry.js',
      'dist/chunk-eager.js',
      'dist/chunk-shared.js',
      'dist/TryItPanel-AAAA.js',
      'dist/CommandPalette-BBBB.js',
      'dist/SchemaView-CCCC.js',
      'dist/src-DDDD.js',
    ]);
  }

  const GESTURES: readonly DeferredGesture[] = [
    { id: 'send', roots: ['TryItPanel', 'src'] },
    { id: 'palette', roots: ['CommandPalette'] },
    { id: 'schema', roots: ['SchemaView'] },
  ];

  it('should give each gesture what a reader who makes only that one downloads', () => {
    // Given the shipped shape, where the runner is a dynamic root of the entry and is paid for by
    // the console arriving, which no graph can know and the declaration says
    const split = shippedShape();

    // When
    const divided = partitionByGesture(root, split, GESTURES);

    // Then, the runner is on the Send side and the chunk the first paint compiled is on nobody's
    expect(divided.byGesture.get('send')?.files).toEqual([
      'dist/TryItPanel-AAAA.js',
      'dist/chunk-shared.js',
      'dist/src-DDDD.js',
    ]);
    expect(divided.byGesture.get('schema')?.files).toEqual(['dist/SchemaView-CCCC.js']);
    expect(divided.unclaimed).toEqual([]);
  });

  it('should count a shared chunk in both gestures that fetch it', () => {
    // Given, the property that makes the three budgets readable one at a time: a reader who only
    // opens the palette downloads the shared chunk, and so does a reader who only presses Send.
    // Summing the three would be a quantity nobody pays, which is what the union cap was.
    const split = shippedShape();

    // When
    const divided = partitionByGesture(root, split, GESTURES);

    // Then
    expect(divided.byGesture.get('send')?.files).toContain('dist/chunk-shared.js');
    expect(divided.byGesture.get('palette')?.files).toContain('dist/chunk-shared.js');
  });

  it('should name a deferred chunk that no gesture downloads', () => {
    // Given a fourth feature deferred and never declared, which is how a chunk comes to be
    // budgeted by nobody once the single cap over the union is gone
    const split = shippedShape();
    write('dist/entry.js', 'import"./chunk-eager.js";var g=()=>import("./Ghost-EEEE.js");');
    write('dist/Ghost-EEEE.js', 'export var g=1;');
    const walked = partitionModuleGraph(root, 'dist/entry.js', [
      ...split.initial,
      ...split.deferred,
      'dist/Ghost-EEEE.js',
    ]);

    // When
    const divided = partitionByGesture(root, walked, GESTURES);

    // Then
    expect(divided.unclaimed).toEqual(['dist/Ghost-EEEE.js']);
  });

  it('should report a declared root that matches no chunk, rather than weighing nothing', () => {
    // Given the shape this takes in practice: a chunk renamed by the bundler, or a feature that
    // stopped being deferred. A budget over an empty set passes on every run.
    const split = shippedShape();

    // When
    const divided = partitionByGesture(root, split, [{ id: 'health', roots: ['HealthPanel'] }]);

    // Then
    expect(divided.byGesture.get('health')?.missingRoots).toEqual(['HealthPanel']);
    expect(divided.byGesture.get('health')?.files).toEqual([]);
  });

  it('should report a root that matches more than one chunk', () => {
    // Given two chunks whose names begin the same way, so what the budget weighs is undecided
    write('dist/entry.js', `var a=()=>import("./Try-1.js"),b=()=>import("./Try-2.js");`);
    write('dist/Try-1.js', 'export var a=1;');
    write('dist/Try-2.js', 'export var b=2;');
    const walked = partitionModuleGraph(root, 'dist/entry.js', [
      'dist/entry.js',
      'dist/Try-1.js',
      'dist/Try-2.js',
    ]);

    // When
    const divided = partitionByGesture(root, walked, [{ id: 'send', roots: ['Try'] }]);

    // Then
    expect(divided.byGesture.get('send')?.ambiguousRoots).toEqual([
      { root: 'Try', matches: ['dist/Try-1.js', 'dist/Try-2.js'] },
    ]);
  });
});

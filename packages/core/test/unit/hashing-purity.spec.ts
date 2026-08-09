import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The hashing path must never reach `JSON.stringify`, per BUILD T002.
 *
 * This walks the real module graph from the hashing entry point rather than checking one file,
 * so a helper added three imports away is caught too.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(here, '..', '..', 'src', 'hashing', 'domain', 'hash.ts');

const IMPORT_PATTERN = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*'([^']+)'/g;

interface Module {
  readonly path: string;
  /** Source with comments removed, so a comment mentioning a construct is not a hit. */
  readonly source: string;
  readonly specifiers: readonly string[];
}

/**
 * Removes block and line comments.
 *
 * Block comments go first, so a URL inside a doc comment cannot be mistaken for the start of
 * a line comment.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readModule(path: string): Module {
  const source = stripComments(readFileSync(path, 'utf8'));
  const specifiers: string[] = [];

  const pattern = new RegExp(IMPORT_PATTERN.source, IMPORT_PATTERN.flags);
  let match = pattern.exec(source);
  while (match !== null) {
    const specifier = match[1];
    if (specifier !== undefined) specifiers.push(specifier);
    match = pattern.exec(source);
  }

  return { path, source, specifiers };
}

function collectGraph(entry: string): Module[] {
  const visited = new Map<string, Module>();
  const queue = [entry];

  while (queue.length > 0) {
    const path = queue.shift();
    if (path === undefined || visited.has(path)) continue;

    const module = readModule(path);
    visited.set(path, module);

    for (const specifier of module.specifiers) {
      if (!specifier.startsWith('.')) continue;
      queue.push(`${resolve(dirname(path), specifier)}.ts`);
    }
  }

  return [...visited.values()];
}

describe('the hashing path', () => {
  it('should reach more than one module, so the walk is actually doing something', () => {
    // Given
    const entry = ENTRY;

    // When
    const graph = collectGraph(entry);

    // Then
    expect(graph.length).toBeGreaterThanOrEqual(4);
  });

  it('should never call JSON.stringify', () => {
    // Given
    const graph = collectGraph(ENTRY);

    // When
    const offenders = graph
      .filter((module) => module.source.includes('JSON.stringify'))
      .map((module) => module.path);

    // Then
    expect(offenders).toEqual([]);
  });

  it('should never call JSON.parse either, since parsing is not part of hashing', () => {
    // Given
    const graph = collectGraph(ENTRY);

    // When
    const offenders = graph
      .filter((module) => module.source.includes('JSON.parse'))
      .map((module) => module.path);

    // Then
    expect(offenders).toEqual([]);
  });

  it('should import nothing outside the package but the pinned hash dependency', () => {
    // Given, the one external import the hashing path is allowed. `@noble/hashes` supplies
    // the SHA-256 compression function: MIT, no dependencies of its own, synchronous, and
    // browser safe under the `browser` condition. Anything else appearing here is a
    // regression, which is what this list is for.
    const allowed = ['@noble/hashes/sha2'];
    const graph = collectGraph(ENTRY);

    // When
    const external = graph.flatMap((module) =>
      module.specifiers.filter(
        (specifier) => !specifier.startsWith('.') && !allowed.includes(specifier),
      ),
    );

    // Then
    expect(external).toEqual([]);
  });

  it('should reach the pinned hash dependency, so the allowance is not dead', () => {
    // Given
    const graph = collectGraph(ENTRY);

    // When
    const external = graph.flatMap((module) =>
      module.specifiers.filter((specifier) => !specifier.startsWith('.')),
    );

    // Then
    expect(external).toEqual(['@noble/hashes/sha2']);
  });

  it('should import nothing from Nest, Vue or the DOM', () => {
    // Given
    const graph = collectGraph(ENTRY);
    const forbidden = [
      '@nestjs/',
      "from 'vue'",
      '@vue/',
      'window.',
      'globalThis.document',
      'document.querySelector',
      'document.createElement',
    ];

    // When
    const offenders = graph.filter((module) =>
      forbidden.some((needle) => module.source.includes(needle)),
    );

    // Then
    expect(offenders.map((module) => module.path)).toEqual([]);
  });
});

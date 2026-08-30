import { describe, expect, it } from 'vitest';
import { canonicalize, normalizeSpecification, sha256Hex, type IRDocument } from '@openref/core';
import {
  agentHealthReport,
  buildLlmsFull,
  buildLlmsIndex,
  type LlmsTextOptions,
} from '../../src/index';
import { orderSource } from '../mocks/documents';

const mounted: LlmsTextOptions = { basePath: '/docs', agent: { llmsTxt: true, mcp: true } };

/**
 * A deterministic shuffle, so a failure reproduces from the seed rather than from a lucky run.
 *
 * `Math.random` WOULD MAKE THIS SUITE UNREPRODUCIBLE, which is the one thing a determinism suite
 * cannot be: a red run whose input nobody can rebuild is a red run nobody can fix.
 */
function shuffled<T>(entries: readonly T[], seed: number): T[] {
  const copy = [...entries];
  let state = seed + 1;

  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const target = state % (index + 1);
    const held = copy[index];
    const other = copy[target];
    if (held === undefined || other === undefined) continue;
    copy[index] = other;
    copy[target] = held;
  }

  return copy;
}

/**
 * The same source document with its object keys written in a different order.
 *
 * THE KEYS AND NOT THE VALUES, which is the whole question. A shuffled document is the same
 * document, so the normalizer has to produce the same hash and everything downstream has to
 * produce the same bytes; if either moved, an SSR cache and every consumer that diffs these files
 * would see a change nobody made.
 */
function reorderedSource(seed: number): Record<string, unknown> {
  const source = orderSource();
  const reorder = (value: unknown, depth: number): unknown => {
    if (Array.isArray(value)) return value.map((entry) => reorder(entry, depth + 1));
    if (typeof value !== 'object' || value === null) return value;

    const entries = shuffled(Object.entries(value as Record<string, unknown>), seed + depth);
    return Object.fromEntries(entries.map(([key, held]) => [key, reorder(held, depth + 1)]));
  };

  return reorder(source, 0) as Record<string, unknown>;
}

describe('the agent surface is deterministic for a given IR hash', () => {
  it('should produce one llms.txt over a thousand shuffled spellings of one document', () => {
    // Given a thousand documents that differ only in the order their keys were written in
    const hashes = new Set<string>();
    const indexes = new Set<string>();
    let reordered = 0;

    // When
    for (let seed = 0; seed < 1000; seed += 1) {
      const source = reorderedSource(seed);
      if (JSON.stringify(source) !== JSON.stringify(orderSource())) reordered += 1;
      const document: IRDocument = normalizeSpecification(source);
      hashes.add(document.hash);
      indexes.add(buildLlmsIndex(document, mounted));
    }

    // Then, with the presence half asserted first: a run over a thousand identical inputs would
    // pass this without the shuffle ever having done anything
    expect(reordered).toBeGreaterThan(900);
    expect(hashes.size).toBe(1);
    expect(indexes.size).toBe(1);
  });

  it('should produce one llms-full.txt over a thousand builds of one document', () => {
    // Given one normalized document, built once
    const document = normalizeSpecification(orderSource());
    const files = new Set<string>();

    // When
    for (let attempt = 0; attempt < 1000; attempt += 1) files.add(buildLlmsFull(document, mounted));

    // Then
    expect(files.size).toBe(1);
  });

  /**
   * THE BOUNDARY OF THE CLAIM, MEASURED RATHER THAN ASSUMED, AND IT IS NOT THIS FILE'S TO MOVE.
   *
   * `llms.txt` is a function of the document hash and the case above proves it. `llms-full.txt` is
   * not, and the reason is one level up: `canonicalize` sorts object keys by code point, so a
   * schema whose `properties` were written in a different order hashes the same, while the IR
   * keeps the order the document wrote and every consumer that walks `properties` inherits it.
   * Measured on the fixture below: one hash, two property orders.
   *
   * SORTING HERE WOULD BE THE WRONG FIX AND IS REFUSED FOR THE REASON THE `openapi.json` ROUTE
   * ALREADY RECORDS. That route was canonicalized once, and every schema's fields came out
   * alphabetical, so a generated SDK listed them in an order nobody chose. The full text is read
   * beside the schema page, the page walks the same order the document wrote, and a file that
   * disagreed with the page it describes would be worse than one that inherits the document's own
   * order. So the property is stated at its true strength, and the wider question, that the hash
   * the SPEC 12 render cache is keyed by does not pin this order for any consumer, is recorded in
   * SPEC 18.1 and belongs to whoever owns the canonical form.
   */
  it('should inherit the property order the document wrote, which the hash does not pin', () => {
    // Given two spellings of one document that differ only in the order of two properties
    const forward = normalizeSpecification(orderSource());
    const shuffledSource = orderSource();
    const components = shuffledSource.components as Record<string, Record<string, unknown>>;
    const schemas = components.schemas as Record<string, Record<string, unknown>>;
    const order = schemas.Order;
    if (order === undefined) throw new Error('the fixture lost its Order schema');
    const properties = order.properties as Record<string, unknown>;
    order.properties = Object.fromEntries(Object.entries(properties).reverse());
    const backward = normalizeSpecification(shuffledSource);

    // When
    const first = buildLlmsFull(forward, mounted);
    const second = buildLlmsFull(backward, mounted);

    // Then, with the presence half first: the two really are one hash, and the two really do
    // carry different property orders, so what follows is a statement about the hash
    expect(forward.hash).toBe(backward.hash);
    expect(Object.keys(forward.schemas.get('Order')?.normalized?.properties ?? {})).not.toEqual(
      Object.keys(backward.schemas.get('Order')?.normalized?.properties ?? {}),
    );
    expect(first).not.toBe(second);
    expect(buildLlmsIndex(forward, mounted)).toBe(buildLlmsIndex(backward, mounted));
  });

  it('should serialize the health resource to identical bytes on two reads', () => {
    // Given, a payload a consumer caches and diffs goes through the canonical form, per
    // CLAUDE.md's rule: `JSON.stringify` over a restructured object shuffles for no reason
    const document = normalizeSpecification(orderSource());

    // When
    const first = canonicalize(agentHealthReport(document));
    const second = canonicalize(agentHealthReport(document));

    // Then
    expect(sha256Hex(first)).toBe(sha256Hex(second));
  });
});

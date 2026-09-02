import { describe, expect, it } from 'vitest';
import { canonicalize, normalizeSpecification, sha256Hex, type IRDocument } from '@openref/core';
import {
  agentHealthReport,
  buildLlmsFull,
  buildLlmsIndex,
  type LlmsTextOptions,
} from '../../src/index';
import { createRandom, shuffleEquivalentKeys } from '../../../core/test/mocks/document.mock';
import { orderSource } from '../mocks/documents';

const mounted: LlmsTextOptions = { basePath: '/docs', agent: { llmsTxt: true, mcp: true } };

/**
 * The same source document with its object keys written in a different order.
 *
 * THE KEYS AND NOT THE VALUES, which is the whole question. A shuffled document is the same
 * document, so the normalizer has to produce the same hash and everything downstream has to
 * produce the same bytes; if either moved, an SSR cache and every consumer that diffs these files
 * would see a change nobody made.
 *
 * EXCEPT WHERE THE ORDER IS THE DOCUMENT'S OWN, since 2026-09-01. SPEC 5.3 has the hash carry the
 * key order a document wrote, so permuting `properties` is writing a different document rather than
 * spelling the same one differently, and the case below that reverses one on purpose is where that
 * half is proved.
 *
 * IT CALLS `@openref/core`'s OWN SHUFFLER RATHER THAN KEEPING A WALKER AND A LIST OF ITS OWN. Until
 * a review pointed it out this file held a third hand written copy of the authored names, answering
 * to nothing, while core kept two and reconciled them both ways against the record. A cross package
 * import between two test trees is outside the boundary rules, which anchor at
 * `^packages/<name>/src/`, so the rule now has one home and one runner.
 *
 * THE SEED STILL DRIVES IT, because a determinism suite whose red run cannot be rebuilt is the one
 * thing this file may not be: the seed makes the generator, the generator makes the shuffle.
 */
function reorderedSource(seed: number): Record<string, unknown> {
  return shuffleEquivalentKeys(orderSource(), createRandom(seed)) as Record<string, unknown>;
}

describe('the agent surface is deterministic for a given IR hash', () => {
  it('should produce one llms.txt and one llms-full.txt over a thousand spellings of one document', () => {
    // Given a thousand documents that differ only in the order their keys were written in
    const hashes = new Set<string>();
    const indexes = new Set<string>();
    const fulls = new Set<string>();
    let reordered = 0;

    // When
    for (let seed = 0; seed < 1000; seed += 1) {
      const source = reorderedSource(seed);
      if (JSON.stringify(source) !== JSON.stringify(orderSource())) reordered += 1;
      const document: IRDocument = normalizeSpecification(source);
      hashes.add(document.hash);
      indexes.add(buildLlmsIndex(document, mounted));
      fulls.add(buildLlmsFull(document, mounted));
    }

    // Then, with the presence half asserted first: a run over a thousand identical inputs would
    // pass this without the shuffle ever having done anything
    expect(reordered).toBeGreaterThan(900);
    expect(hashes.size).toBe(1);
    expect(indexes.size).toBe(1);

    // and `llms-full.txt` joins the claim, which is what SPEC 5.3's exception bought: before
    // 2026-09-01 this same loop read one hash and two full texts, and the difference was exactly
    // the two lines of one property list.
    expect(fulls.size).toBe(1);
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
   * THE CASE THAT MEASURED THE DEFECT, KEPT AND INVERTED RATHER THAN DELETED.
   *
   * Until 2026-09-01 this case read: one hash, two property orders, two `llms-full.txt`. That was
   * the measurement the maintainer ruled on, and the ruling was that the hash carries the order,
   * so the same fixture now has to read the other way round. Sorting the property list was refused
   * then and is refused still, for the reason the canonicalized `openapi.json` route records: the
   * full text is read beside the schema page, the page walks the order the document wrote, and a
   * file disagreeing with the page it describes is worse than one inheriting the author's order.
   * What changed is not the text; it is that the hash now covers what the text is drawn from.
   */
  it('should give two property orders two hashes, and two full texts to match', () => {
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

    // Then, with the presence half first: the two really do carry different property orders and
    // the same property names, so what follows is a statement about order and nothing else
    const forwardNames = Object.keys(forward.schemas.get('Order')?.normalized?.properties ?? {});
    const backwardNames = Object.keys(backward.schemas.get('Order')?.normalized?.properties ?? {});
    expect(forwardNames.length).toBeGreaterThan(1);
    expect([...backwardNames].sort()).toEqual([...forwardNames].sort());
    expect(backwardNames).not.toEqual(forwardNames);

    // Then the hash moves with the order, and the full text moves with it
    expect(forward.hash).not.toBe(backward.hash);
    expect(first).not.toBe(second);

    // and `llms.txt` moves too, but only in the one line that carries the digest: it lists
    // operations rather than properties, so the order reaches its body nowhere. Measured rather
    // than asserted as a whole file equality, which is what the first edition of this case got
    // wrong: the index prints `Document hash:` and always has.
    const firstIndex = buildLlmsIndex(forward, mounted).split('\n');
    const secondIndex = buildLlmsIndex(backward, mounted).split('\n');
    const differing = firstIndex
      .map((line, position) => (line === secondIndex[position] ? undefined : position))
      .filter((position): position is number => position !== undefined);
    expect(firstIndex).toHaveLength(secondIndex.length);
    expect(differing).toHaveLength(1);
    expect(firstIndex[differing[0] ?? 0]).toContain('Document hash:');
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

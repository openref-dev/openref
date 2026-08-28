import { describe, expect, it } from 'vitest';
import type { PageKind } from '@openref/render';
import { PAGE_KIND_CARDINALITY, planPages } from '../../src/index';
import { miniDocument } from '../mocks/documents';

/**
 * The plan held to the union it draws from, added by the pre-M4 review.
 *
 * The review counted three hand kept lists for one idea: sixteen route ids in `@openref/nest`,
 * seven kinds in `PageKind`, and seven `add` calls in `planPages`. All three agreed, and nothing
 * anywhere made them agree. The failure a missing tie allows is the quietest one this package
 * has: a kind the renderer can draw and the plan never writes is a directory that is simply not
 * there, so every link to it is a 404 on a site that otherwise builds, deploys and looks right.
 *
 * `PAGE_KIND_CARDINALITY` is the tie. It is total over `PageKind`, so a new kind fails to compile
 * until somebody says how many pages it produces, and the cases here fail until the plan produces
 * them. The document is the shared fixture: two operation nodes and one named schema, which is
 * one of everything the four cardinalities count.
 */
describe('planPages', () => {
  it('should produce every kind the cardinality record accounts for', () => {
    // Given a document carrying at least one node, one operation and one schema
    const document = miniDocument();

    // When
    const planned = new Set(planPages(document, '').map((page) => page.kind));

    // Then
    const missing = Object.entries(PAGE_KIND_CARDINALITY)
      .filter(([, cardinality]) => cardinality !== 'never')
      .map(([kind]) => kind)
      .filter((kind) => !planned.has(kind as PageKind));
    expect(missing).toEqual([]);
  });

  it('should produce no kind the cardinality record does not account for', () => {
    // Given
    const document = miniDocument();

    // When
    const planned = planPages(document, '');

    // Then the record is the whole vocabulary, in both directions
    const unaccounted = planned
      .map((page) => page.kind)
      .filter((kind) => !(kind in PAGE_KIND_CARDINALITY));
    expect([...new Set(unaccounted)]).toEqual([]);
  });

  it('should produce the count each cardinality promises', () => {
    // Given the fixture's own shape, counted from the document rather than assumed
    const document = miniDocument();
    const nodes = document.nodes.size;
    const operations = [...document.nodes.values()].filter(
      (node) => node.kind === 'operation',
    ).length;
    const schemas = document.schemas.size;
    const expected: Readonly<Record<string, number>> = {
      once: 1,
      'per-node': nodes,
      'per-operation': operations,
      'per-schema': schemas,
      never: 0,
    };

    // When
    const planned = planPages(document, '');
    const byKind = new Map<string, number>();
    for (const page of planned) byKind.set(page.kind, (byKind.get(page.kind) ?? 0) + 1);

    // Then
    for (const [kind, cardinality] of Object.entries(PAGE_KIND_CARDINALITY)) {
      expect(byKind.get(kind) ?? 0, `${kind} is ${cardinality}`).toBe(expected[cardinality]);
    }
  });
});

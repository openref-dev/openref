import {
  buildHealthReport,
  driftForNode,
  type IRDocument,
  type IRNode,
  type IRRateLimitReach,
} from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildParityRows } from '../../src/page/domain/parity-model';
import { buildRuntimeModel } from '../../src/page/domain/runtime-model';
import { runtimeDocument, runtimeNodeId } from '../mocks/documents';

/**
 * The three states of SPEC 6.2.3, on the row a reader is looking at.
 *
 * WHAT THIS HOLDS IS THAT THE ROW ANSWERS ITS OWN QUESTION. Before `IRRateLimitReach` the rate
 * limit row had one cell for three situations: a route with its own limit drew the number, and a
 * route governed by a globally registered guard drew exactly what a route nothing limits drew, an
 * empty cell and a sentence pointing at a different report on a different page. Measured on an
 * application where four of fifty eight routes carry a decorator, that was fifty four operations
 * whose reader was told to go and look somewhere else.
 *
 * THE SENTENCES ARE ASSERTED WHOLE AND NOT BY FRAGMENT, because they are the product here. A
 * substring match would pass on a sentence that had lost the clause refusing to attribute the
 * budget to the route, which is the clause that keeps the row inside SPEC 6.1.
 */

/**
 * The runtime fixture with the rate limit fact replaced by whatever a collector reported.
 *
 * @param reach - What the collector said about reach, or nothing when it said nothing
 * @param keepOwnLimit - Whether the route keeps the limit the fixture declares on it
 * @returns The document, rebuilt through the health report so the verdicts are a real pass's
 */
function documentWith(reach: IRRateLimitReach | undefined, keepOwnLimit = false): IRDocument {
  const base = runtimeDocument();
  const id = runtimeNodeId(base);
  const node = base.nodes.get(id);
  if (node?.kind !== 'operation') throw new Error('fixture moved');

  const { rateLimit, ...rest } = node.runtime ?? {};
  const nodes = new Map<string, IRNode>(base.nodes);
  nodes.set(id, {
    ...node,
    runtime: {
      ...rest,
      ...(keepOwnLimit && rateLimit !== undefined ? { rateLimit } : {}),
      ...(reach === undefined
        ? {}
        : {
            rateLimitReach: {
              value: reach,
              confidence: 'derived',
              collector: 'redisxRateLimitCollector',
            },
          }),
    },
  });

  const withFacts: IRDocument = {
    ...base,
    nodes,
    runtime: {
      collectors: ['guardsCollector', 'scopesCollector', 'redisxRateLimitCollector'],
    },
  };

  return { ...withFacts, health: buildHealthReport(withFacts, {}) };
}

/**
 * The rate limit row of the fixture's operation.
 *
 * @param document - The document to read
 * @returns The row
 */
function rateLimitRow(document: IRDocument): ReturnType<typeof buildParityRows>[number] {
  const node = document.nodes.get(runtimeNodeId(document));
  if (node?.kind !== 'operation') throw new Error('fixture moved');

  const found = driftForNode(document.health?.drift ?? [], node.id);
  const rows = buildParityRows(document, node, found, '');
  const row = rows.find((candidate) => candidate.kind === 'rate-limit');
  if (row === undefined) throw new Error('the scale lost its rate limit row');

  return row;
}

describe('the three states a rate limit row must tell apart', () => {
  it('should draw the number where the route declares its own limit', () => {
    // Given the first state, which is the only one that ever had a representation
    const document = documentWith(undefined, true);

    // When
    const row = rateLimitRow(document);

    // Then, and the row keeps the verdict the engine gave it: this operation documents no 429
    // against a limit it enforces, which is `ratelimit-undocumented` finding something to say.
    expect(row.runtime).toHaveLength(1);
    expect(row.runtime[0]?.text).toBe('100 / minute');
    expect(row.runtime[0]?.note).toBe('');
    expect(row.verdict).toBe('drift');
    expect(row.reason).toBe('');
  });

  it('should say what governs the route from outside, with the budget and where it was read', () => {
    // Given the second state: the motivating application's `GlobalRateLimitGuard` in front of the
    // whole application at 900 requests per 60000 ms, on a route that declares nothing
    const document = documentWith({
      kind: 'external',
      by: ['GlobalRateLimitGuard'],
      budget: { limit: 900, ttlMs: 60_000 },
      budgetSource: 'the provider under Symbol.for("RATE_LIMIT_PLUGIN_OPTIONS")',
    });

    // When
    const row = rateLimitRow(document);

    // Then the row states the guard, states the figure, and refuses the attribution in the same
    // breath, which is what keeps a budget nobody connected to this route out of `rateLimit`.
    expect(row.runtime).toHaveLength(1);
    expect(row.runtime[0]?.text).toBe(
      'No limit of its own; governed from outside by GlobalRateLimitGuard',
    );
    expect(row.runtime[0]?.note).toBe(
      'The module budget is 900 / minute, read from the provider under ' +
        'Symbol.for("RATE_LIMIT_PLUGIN_OPTIONS"). Whether this route is exempt, and at what ' +
        'budget, is decided inside guard code, which is never read.',
    );
  });

  it('should carry the provenance of the reach fact, like every other runtime value', () => {
    // Given the same row
    const document = documentWith({ kind: 'external', by: ['GlobalRateLimitGuard'] });

    // When
    const row = rateLimitRow(document);

    // Then, per SPEC 6.1: no value without a level and a name
    expect(row.runtime[0]?.confidence).toBe('derived');
    expect(row.runtime[0]?.collector).toBe('redisxRateLimitCollector');
  });

  it('should say plainly that nothing states a budget when nothing does', () => {
    // Given a guard in front and no configuration anywhere naming a number
    const document = documentWith({ kind: 'external', by: ['ThrottlerGuard'] });

    // When
    const row = rateLimitRow(document);

    // Then "no budget anywhere" and "a budget that is not this route's" are different answers
    expect(row.runtime[0]?.note).toBe(
      'Nothing states a budget anywhere. Whether this route is exempt, and at what budget, is ' +
        'decided inside guard code, which is never read.',
    );
  });

  it('should say the route is not rate limited where nothing anywhere limits it', () => {
    // Given the third state
    const document = documentWith({ kind: 'none' });

    // When
    const row = rateLimitRow(document);

    // Then
    expect(row.runtime).toHaveLength(1);
    expect(row.runtime[0]?.text).toBe('Not rate limited');
    expect(row.runtime[0]?.note).toBe(
      'This route declares no limit and nothing stands in front of the whole application.',
    );
  });

  it('should not send the reader to another page for any of the three', () => {
    // Given all three states
    const rows = [
      rateLimitRow(documentWith(undefined, true)),
      rateLimitRow(documentWith({ kind: 'external', by: ['GlobalRateLimitGuard'] })),
      rateLimitRow(documentWith({ kind: 'none' })),
    ];

    // Then, and this is the sentence the product owner read on an endpoint that is rate limited
    for (const row of rows) {
      expect(row.reason).not.toContain('doctor report');
      expect(`${row.runtime[0]?.text ?? ''} ${row.runtime[0]?.note ?? ''}`).not.toContain(
        'doctor report',
      );
    }
  });

  it('should tell a rule that found nothing to compare from a row with no rule at all', () => {
    // Given a governed route: `ratelimit-undocumented` compares a limit the route declares, and
    // this route declares none, so the rule runs and finds nothing here. Saying "no rule examines
    // this row yet" would name a gap in the catalogue that does not exist.
    const governed = rateLimitRow(documentWith({ kind: 'external', by: ['GlobalRateLimitGuard'] }));

    // Then
    expect(governed.verdict).toBe('unknown');
    expect(governed.reason).toBe(
      'The rules that judge this row found nothing on this operation to compare, so neither side ' +
        'is judged.',
    );
  });

  it('should keep the row out of the drift engine, since reach is never compared', () => {
    // Given, the subject is present: the fixture's operation documents a 429, which is what
    // `ratelimit-undocumented` compares an enforced limit against
    const document = documentWith({
      kind: 'external',
      by: ['GlobalRateLimitGuard'],
      budget: { limit: 900, ttlMs: 60_000 },
    });
    const node = document.nodes.get(runtimeNodeId(document));
    if (node?.kind !== 'operation') throw new Error('fixture moved');

    // When
    const findings = (document.health?.drift ?? []).filter(
      (issue) => issue.rule === 'ratelimit-undocumented',
    );

    // Then a budget nothing attributed to this route produces no finding about this route
    expect(node.runtime?.rateLimit).toBeUndefined();
    expect(findings).toEqual([]);
  });
});

describe('the labelled runtime block draws the same answer', () => {
  it('should give a governed route a rate limit row rather than no row', () => {
    // Given a node whose only rate limit fact is the reach
    const document = documentWith({
      kind: 'external',
      by: ['GlobalRateLimitGuard'],
      budget: { limit: 900, ttlMs: 60_000 },
    });
    // When
    const model = buildRuntimeModel(document, runtimeNodeId(document), '');

    // Then the block a theme reads says what the scale says, from one formatter
    const row = model?.rows.find((candidate) => candidate.kind === 'rate-limit');
    expect(row?.values[0]?.text).toBe(
      'No limit of its own; governed from outside by GlobalRateLimitGuard',
    );
  });

  it('should draw one rate limit row and never two, when a route has its own limit', () => {
    // Given a route that declares a limit AND stands behind a global guard, which the collectors
    // never produce together but the IR admits: the route's own decision is the answer.
    const base = documentWith({ kind: 'external', by: ['GlobalRateLimitGuard'] }, true);

    // When
    const model = buildRuntimeModel(base, runtimeNodeId(base), '');

    // Then
    const rows = model?.rows.filter((candidate) => candidate.kind === 'rate-limit') ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.values[0]?.text).toBe('100 / minute');
  });
});

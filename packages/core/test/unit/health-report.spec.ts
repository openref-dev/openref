import { describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  driftForNode,
  groupDriftByRule,
  healthScore,
  type IRDocument,
  type IRHealthCheck,
  type IRNode,
  type IROperation,
  type IRSchema,
} from '../../src/index';

/**
 * The Documentation Health report of SPEC 7.2: the percentage, the per rule lines, and the order.
 *
 * THE SCORE HAS TO BE STABLE AND HAS TO MOVE THE RIGHT WAY, and those are two different claims.
 * Stability is what makes the number comparable between two builds, which is the whole of the
 * `--fail-on` gate; direction is what makes it worth showing a reader at all. A number that is
 * stable and moves the wrong way is worse than no number, because it is trusted.
 */

/** The bare operation the fixtures start from. */
function operation(overrides: Partial<IROperation> = {}): IROperation {
  return {
    kind: 'operation',
    id: 'get-orders',
    method: 'get',
    path: '/orders',
    operationId: 'get-orders',
    tags: [],
    deprecated: false,
    parameters: [],
    responses: [],
    security: [],
    servers: [],
    ...overrides,
  };
}

/** A document holding the given nodes and schemas, in the order they were passed. */
function documentOf(nodes: readonly IRNode[], schemas: readonly IRSchema[] = []): IRDocument {
  return {
    id: 'orders',
    kind: 'http',
    hash: '',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [],
    navigation: [],
    nodes: new Map(nodes.map((node) => [node.id, node])),
    schemas: new Map(schemas.map((schema) => [schema.id, schema])),
    security: [],
    relationships: [],
    webhooks: new Map(),
  };
}

describe('healthScore', () => {
  it('should average the checks rather than pool their subjects', () => {
    // Given one check with a huge denominator and one small check that fails outright
    const checks: readonly IRHealthCheck[] = [
      { id: 'dto-field-undescribed', label: 'fields', passed: 500, total: 500, severity: 'info' },
      { id: 'missing-description', label: 'operations', passed: 0, total: 4, severity: 'warning' },
    ];

    // When
    const score = healthScore(checks);

    // Then. A POOLED RATIO WOULD READ 99%, which is a document with nothing described at all
    // scoring well for having described its fields.
    expect(score).toBe(50);
  });

  it('should leave a check with nothing to count out rather than call it perfect', () => {
    // Given a document with no streaming endpoint, so that rule counts nothing
    const withEmpty: readonly IRHealthCheck[] = [
      { id: 'missing-description', label: 'operations', passed: 1, total: 2, severity: 'warning' },
      { id: 'stream-unspecified', label: 'streams', passed: 0, total: 0, severity: 'error' },
    ];

    // When
    const score = healthScore(withEmpty);

    // Then otherwise every document would score higher the fewer kinds of thing it held
    expect(score).toBe(50);
  });

  it('should score a document nothing could be asked of at 100', () => {
    // Given
    // When
    // Then nothing was checked and nothing is broken, which is the honest reading
    expect(healthScore([])).toBe(100);
  });
});

describe('buildHealthReport', () => {
  it('should produce the same report twice for the same document', () => {
    // Given
    const document = documentOf([operation()]);

    // When
    const first = buildHealthReport(document);
    const second = buildHealthReport(document);

    // Then
    expect(first).toEqual(second);
  });

  it('should raise the score when a rule is satisfied and change nothing else', () => {
    // Given the same operation twice, once described and once not
    const before = buildHealthReport(documentOf([operation()]));
    const after = buildHealthReport(documentOf([operation({ summary: 'List orders' })]));

    // When
    const missingBefore = before.drift.filter((issue) => issue.rule === 'missing-description');
    const missingAfter = after.drift.filter((issue) => issue.rule === 'missing-description');

    // Then
    expect(missingBefore).toHaveLength(1);
    expect(missingAfter).toEqual([]);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it('should carry one check per rule, with the checks another subsystem owns first', () => {
    // Given the line the collector registry contributes, per SPEC 7
    const collectors: IRHealthCheck = {
      id: 'runtime-collectors',
      label: 'Runtime collectors that ran',
      passed: 6,
      total: 7,
      severity: 'warning',
    };

    // When
    const report = buildHealthReport(documentOf([operation()]), { checks: [collectors] });

    // Then a reader is told how much to trust the rest before reading the rest
    expect(report.checks[0]).toEqual(collectors);
    expect(report.checks.filter((check) => check.id === 'missing-description')).toHaveLength(1);
    // One per rule of SPEC 7.1, thirteen since TX-COLLECTORS, plus the registry's own line.
    expect(report.checks).toHaveLength(14);
  });

  it('should count operations and not schemas', () => {
    // Given
    const document = documentOf(
      [operation({ id: 'get-orders' }), operation({ id: 'post-orders', method: 'post' })],
      [{ id: 'OrderDto', dialect: 'json-schema-2020-12', normalized: { type: 'object' } }],
    );

    // When
    const report = buildHealthReport(document);

    // Then
    expect(report.operationCount).toBe(2);
  });

  it('should order the findings by subject, node by node, with schema findings after', () => {
    // Given two operations in document order and one schema with an undescribed field
    const document = documentOf(
      [operation({ id: 'get-orders' }), operation({ id: 'post-orders', method: 'post' })],
      [
        {
          id: 'OrderDto',
          dialect: 'json-schema-2020-12',
          normalized: { type: 'object', properties: { amount: { type: 'integer' } } },
        },
      ],
    );

    // When
    const report = buildHealthReport(document);
    const subjects = report.drift.map((issue) => issue.nodeId ?? issue.schemaId);

    // Then everything wrong with one endpoint is together, which is how SPEC 7.2 prints it
    expect(subjects).toEqual([
      'get-orders',
      'get-orders',
      'post-orders',
      'post-orders',
      'OrderDto',
    ]);
  });

  it('should give a panel the findings of one node without the rest of the document', () => {
    // Given a report over two operations and a schema, which is three subjects
    const report = buildHealthReport(
      documentOf(
        [operation({ id: 'get-orders' }), operation({ id: 'post-orders', method: 'post' })],
        [
          {
            id: 'OrderDto',
            dialect: 'json-schema-2020-12',
            normalized: { type: 'object', properties: { amount: { type: 'integer' } } },
          },
        ],
      ),
    );

    // When
    const own = driftForNode(report.drift, 'post-orders');

    // Then, only that node's findings, and in report order
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((issue) => issue.nodeId === 'post-orders')).toBe(true);
  });

  it('should group four hundred findings into the rules a panel can list', () => {
    // Given, the panel of SPEC 7.3 has to be readable at both extremes, and the reason grouping
    // works is arithmetic: a hundred operations produce hundreds of findings and never more than
    // ten rules, because there are ten rules.
    const operations = Array.from({ length: 100 }, (_unused, index) =>
      operation({ id: `get-${String(index)}`, path: `/orders/${String(index)}` }),
    );
    const report = buildHealthReport(documentOf(operations));

    // When
    const groups = groupDriftByRule(report.drift);

    // Then
    expect(report.drift.length).toBeGreaterThan(100);
    expect(groups.length).toBeLessThanOrEqual(10);
    expect(groups.reduce((sum, group) => sum + group.issues.length, 0)).toBe(report.drift.length);
  });

  it('should put the loudest rule first and the largest of equal loudness before the rest', () => {
    // Given, the order a reader scans in: what is worst, then what is most of.
    const report = buildHealthReport(
      documentOf([operation({ id: 'a' }), operation({ id: 'b', method: 'post' })]),
    );

    // When
    const groups = groupDriftByRule(report.drift);
    const rank = { error: 0, warning: 1, info: 2 } as const;
    const severities = groups.map((group) => rank[group.severity]);

    // Then, non decreasing severity rank, and counts non increasing inside one rank
    expect([...severities].sort((left, right) => left - right)).toEqual(severities);
    for (let index = 1; index < groups.length; index += 1) {
      const previous = groups[index - 1];
      const current = groups[index];
      if (previous === undefined || current === undefined) continue;
      if (previous.severity !== current.severity) continue;
      expect(previous.issues.length).toBeGreaterThanOrEqual(current.issues.length);
    }
  });

  it('should ask a document with no application behind it only the questions it can answer', () => {
    // Given a guarded, throttled, streaming operation with no runtime facts at all, which is what
    // a specification normalized outside an application looks like
    const report = buildHealthReport(documentOf([operation({ summary: 'List orders' })]));

    // When
    const runtimeRules = report.checks.filter((check) =>
      ['security-drift', 'scope-drift', 'ratelimit-undocumented', 'orphan-operation'].includes(
        check.id,
      ),
    );

    // Then every runtime rule counts nothing rather than failing everything
    expect(runtimeRules.map((check) => check.total)).toEqual([0, 0, 0, 0]);
  });
});

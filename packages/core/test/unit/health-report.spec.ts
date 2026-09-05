import { describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  driftForNode,
  groupDriftByCause,
  groupDriftByRule,
  healthScore,
  type IRDocument,
  type IRDriftIssue,
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
    // scoring well for having described its fields. The weights of SPEC 7.2 are `info` at 1 times
    // the root of 500, which is 22, against `warning` at 2 times the root of 4, which is 4, so the
    // big quiet question is worth five and a half of the small loud one rather than a hundred and
    // twenty five. THE RESIDUE IS NAMED RATHER THAN SMOOTHED: at four operations this is still a
    // high number, and the next case is why the bound is drawn where it is.
    expect(score).toBe(85);
  });

  it('should let no check outvote the rest by being asked of more subjects', () => {
    // Given SPEC 7.2's own scenario rather than an extreme of it: five hundred DTO fields and a
    // hundred and twenty seven operations, which is the pair the paragraph names when it refuses
    // the pooled ratio
    const fields: IRHealthCheck = {
      id: 'dto-field-undescribed',
      label: 'fields',
      passed: 500,
      total: 500,
      severity: 'info',
    };
    const operations: IRHealthCheck = {
      id: 'missing-description',
      label: 'operations',
      passed: 0,
      total: 127,
      severity: 'warning',
    };

    // When both are failed outright and then each in turn
    const fieldsFail = healthScore([
      { ...fields, passed: 0 },
      { ...operations, passed: 127 },
    ]);
    const operationsFail = healthScore([fields, operations]);

    // Then the two cost the same, which is the property: `info` at 1 times the root of 500 is 22,
    // and `warning` at 2 times the root of 127 is 22. A pooled ratio would have made the fields
    // worth four operations each.
    expect(fieldsFail).toBe(operationsFail);
    expect(fieldsFail).toBe(50);
  });

  it('should charge more for a check that failed sixty eight subjects than one that failed nine', () => {
    // Given the same rule failing outright at two sizes, beside one check that passes, so the two
    // scores are comparable. WHAT USED TO HAPPEN: the mean was unweighted, so a check scoring zero
    // cost one eleventh of the score whether its denominator was 9 or 68, and the number a reader
    // watches did not move when the count of unanswered subjects went up sixfold.
    const passing: IRHealthCheck = {
      id: 'orphan-operation',
      label: 'served',
      passed: 9,
      total: 9,
      severity: 'error',
    };
    const small: IRHealthCheck = {
      id: 'discovery-incomplete',
      label: 'stated',
      passed: 0,
      total: 9,
      severity: 'warning',
    };

    // When
    const nine = healthScore([passing, small]);
    const sixtyEight = healthScore([passing, { ...small, total: 68 }]);

    // Then the larger failure costs more. The two really are the same rule at the same severity,
    // differing only in how many subjects went unanswered, so nothing but the size moved.
    expect(sixtyEight).toBeLessThan(nine);
    expect(nine).toBe(67);
    expect(sixtyEight).toBe(43);
  });

  it('should charge more for a loud check than a quiet one of the same size', () => {
    // Given two checks of the same size failing outright, one at the severity of a rule a reader
    // must act on and one at the severity of a rule they may not. WHAT USED TO HAPPEN: severity
    // did not enter the score at all, so on the maintainer's application four `error` findings
    // cost 0.63 points while fifty three `info` findings cost 9.09.
    const passing: IRHealthCheck = {
      id: 'orphan-operation',
      label: 'served',
      passed: 58,
      total: 58,
      severity: 'error',
    };
    const loud: IRHealthCheck = {
      id: 'security-drift',
      label: 'guarded',
      passed: 0,
      total: 58,
      severity: 'error',
    };
    const quiet: IRHealthCheck = { ...loud, id: 'missing-example', severity: 'info' };

    // When
    const withLoud = healthScore([passing, loud]);
    const withQuiet = healthScore([passing, quiet]);

    // Then
    expect(withLoud).toBeLessThan(withQuiet);
    expect(withLoud).toBe(50);
    expect(withQuiet).toBe(80);
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
    // One per rule of SPEC 7.1, fifteen since `T054` added `discovery-incomplete` to the fourteen
    // `T043` left, plus the registry's own line. The count is pinned rather than derived so that a
    // rule added anywhere has to be acknowledged here, which is what happened at `T054`.
    expect(report.checks).toHaveLength(16);
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

describe('groupDriftByCause', () => {
  const base: IRDriftIssue = {
    rule: 'missing-example',
    severity: 'info',
    message: 'No request or response body of this operation carries an example.',
    suggestion: 'add example or examples to the media type',
    classification: { bucket: 'manual', reason: 'structural-ambiguity' },
    edit: 'nothing-to-write',
    basis: { kind: 'unobserved' },
  };

  it('should fold findings that differ only in their subject into one row', () => {
    // Given the shape the maintainer's application produced 53 of: one sentence, no measured side,
    // one subject each. WHAT USED TO HAPPEN: a reader opened the group and was handed 53 byte
    // identical rows one under the other.
    const issues: readonly IRDriftIssue[] = [
      { ...base, nodeId: 'get-orders' },
      { ...base, nodeId: 'post-orders' },
      { ...base, nodeId: 'get-orders-id' },
    ];

    // When
    const grouped = groupDriftByCause(issues);

    // Then one cause, its count, and every subject kept
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.count).toBe(3);
    expect(grouped[0]?.issues.map((issue) => issue.nodeId)).toEqual([
      'get-orders',
      'post-orders',
      'get-orders-id',
    ]);
    expect(grouped[0]?.issue).toBe(issues[0]);
  });

  it('should fold nothing when a side is measured, because then no two are copies', () => {
    // Given the shape `missing-operation-id` produces: the same sentence with each operation's own
    // `Controller.handler` beside it. This is the boundary of the class rather than an exception
    // to it: a finding whose measured side differs per subject is not a copy of any other.
    const issues: readonly IRDriftIssue[] = [
      { ...base, nodeId: 'a', runtimeValue: 'OrdersController.list' },
      { ...base, nodeId: 'b', runtimeValue: 'OrdersController.create' },
    ];

    // When
    const grouped = groupDriftByCause(issues);

    // Then. The subject is asserted present first: the two really do share their rule, severity,
    // message and suggestion, so only the measured side kept them apart.
    expect(issues[0]?.message).toBe(issues[1]?.message);
    expect(grouped).toHaveLength(2);
    expect(grouped.map((group) => group.count)).toEqual([1, 1]);
  });

  it('should fold nothing when the reasoning below the fold differs', () => {
    // Given two findings a reader would see as identical until they opened them
    const issues: readonly IRDriftIssue[] = [
      { ...base, nodeId: 'a', detail: 'One reason it cannot be read.' },
      { ...base, nodeId: 'b', detail: 'A different one.' },
    ];

    // When, Then
    expect(groupDriftByCause(issues)).toHaveLength(2);
  });

  it('should keep every finding, so folding can hide nothing', () => {
    // Given a mixed list, which is the property that matters more than any single grouping
    const issues: readonly IRDriftIssue[] = [
      { ...base, nodeId: 'a' },
      { ...base, nodeId: 'b' },
      { ...base, nodeId: 'c', severity: 'warning' },
      { ...base, nodeId: 'd', specValue: 'no operationId' },
    ];

    // When
    const grouped = groupDriftByCause(issues);

    // Then the counts sum to the input and every finding is in exactly one group
    expect(grouped.reduce((total, group) => total + group.count, 0)).toBe(issues.length);
    expect(grouped.flatMap((group) => group.issues)).toEqual(issues);
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildDoctorReport,
  buildHealthReport,
  canonicalize,
  DOCTOR_REPORT_VERSION,
  DRIFT_RULE_CODES,
  type IRDocument,
  type IRHealthCheck,
  type IRNode,
  type IROperation,
  type IRSchema,
  readDoctorReport,
} from '../../src/index';

/**
 * The doctor report of SPEC 7.2 and 7.4, made self contained and versioned per the `T037`
 * amendment in `ai-docs/BUILD-AMENDMENTS.md`.
 *
 * THE JOIN IS THE THING UNDER TEST, NOT THE RULES THEMSELVES. `drift.spec.ts` and
 * `health-report.spec.ts` already prove the rules and the report they build; this file proves
 * that `buildDoctorReport` reads that report correctly and adds exactly the fields a consumer with
 * no document cannot otherwise reach: the display code, a human subject, and the source link.
 */

/** The bare operation the fixtures start from, matching `health-report.spec.ts`'s own. */
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
function documentOf(
  nodes: readonly IRNode[],
  schemas: readonly IRSchema[] = [],
  overrides: Partial<IRDocument> = {},
): IRDocument {
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
    ...overrides,
  };
}

describe('buildDoctorReport', () => {
  it('should carry the report version', () => {
    // Given
    const document = documentOf([operation({ summary: 'List orders' })]);

    // When
    const report = buildDoctorReport(document);

    // Then
    expect(report.version).toBe(DOCTOR_REPORT_VERSION);
  });

  it('should carry the score and operation count straight from the health report', () => {
    // Given
    const document = documentOf([operation(), operation({ id: 'b', method: 'post' })]);
    const health = buildHealthReport(document);

    // When
    const report = buildDoctorReport(document);

    // Then
    expect(report.score).toBe(health.score);
    expect(report.operationCount).toBe(health.operationCount);
    expect(report.findings).toHaveLength(health.drift.length);
  });

  it('should attach the display code of SPEC 7.1 to every finding', () => {
    // Given an operation with nothing described, which fires missing-description
    const document = documentOf([operation()]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'missing-description');

    // Then
    expect(finding?.code).toBe(DRIFT_RULE_CODES['missing-description']);
    expect(finding?.code).toBe('DX010');
  });

  it('should attach the code to a rule check and leave a non rule check without one', () => {
    // Given the line the collector registry contributes, per SPEC 7, beside the rule checks
    const collectors: IRHealthCheck = {
      id: 'runtime-collectors',
      label: 'Runtime collectors that ran',
      passed: 1,
      total: 1,
      severity: 'warning',
    };
    const document = documentOf([operation({ summary: 'List orders' })], [], {
      health: buildHealthReport(documentOf([operation({ summary: 'List orders' })]), {
        checks: [collectors],
      }),
    });

    // When
    const report = buildDoctorReport(document);
    const registryCheck = report.checks.find((check) => check.id === 'runtime-collectors');
    const ruleCheck = report.checks.find((check) => check.id === 'missing-description');

    // Then
    expect(registryCheck?.code).toBeUndefined();
    expect(ruleCheck?.code).toBe('DX010');
  });

  it('should name an operation finding by method and path', () => {
    // Given
    const document = documentOf([operation({ method: 'post', path: '/orders/{id}/cancel' })]);

    // When
    const report = buildDoctorReport(document);

    // Then
    expect(report.findings[0]?.subject).toBe('POST /orders/{id}/cancel');
  });

  it('should name a schema finding by schema id and pointer', () => {
    // Given a schema with one undescribed field
    const schema: IRSchema = {
      id: 'OrderDto',
      dialect: 'json-schema-2020-12',
      normalized: { type: 'object', properties: { total: { type: 'integer' } } },
    };
    const document = documentOf([operation({ summary: 'List orders' })], [schema]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'dto-field-undescribed');

    // Then
    expect(finding?.subject).toBe('OrderDto/properties/total');
  });

  it('should carry confidence for a finding resting on a collected fact', () => {
    // Given a guard with nothing asserted in security, which fires security-drift at declared
    const document = documentOf([
      operation({
        runtime: {
          guards: [{ name: 'AuthGuard', scope: 'route', confidence: 'declared', collector: 'g' }],
        },
      }),
    ]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'security-drift');

    // Then
    expect(finding?.confidence).toBe('declared');
    expect(finding?.classification).toEqual({ bucket: 'silence' });
  });

  it('should leave confidence absent for a finding resting on no observation at all', () => {
    // Given an operation with no summary and no description, which fires missing-description on
    // no runtime fact whatsoever
    const document = documentOf([operation()]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'missing-description');

    // Then
    expect(finding?.confidence).toBeUndefined();
    expect(finding?.classification).toEqual({ bucket: 'manual', reason: 'no-observed-fact' });
  });

  it('should carry the source location and its expanded link when both are available', () => {
    // Given a node with a source location and a document configured with a link template
    const document = documentOf(
      [
        operation({
          runtime: {
            guards: [{ name: 'AuthGuard', scope: 'route', confidence: 'declared', collector: 'g' }],
            source: {
              controller: 'OrdersController',
              handler: 'list',
              file: 'orders.ts',
              line: 12,
            },
          },
        }),
      ],
      [],
      { runtime: { collectors: [], sourceLinkTemplate: 'https://example.test/{file}#L{line}' } },
    );

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'security-drift');

    // Then
    expect(finding?.source).toEqual({
      controller: 'OrdersController',
      handler: 'list',
      file: 'orders.ts',
      line: 12,
    });
    expect(finding?.sourceLink).toEqual({ url: 'https://example.test/orders.ts#L12' });
  });

  it('should carry the source location with a reason instead of a link when no template is set', () => {
    // Given a node with a source location and a document with no link template configured
    const document = documentOf([
      operation({
        runtime: {
          guards: [{ name: 'AuthGuard', scope: 'route', confidence: 'declared', collector: 'g' }],
          source: { controller: 'OrdersController', handler: 'list', file: 'orders.ts', line: 12 },
        },
      }),
    ]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'security-drift');

    // Then
    expect(finding?.source?.controller).toBe('OrdersController');
    expect(finding?.sourceLink?.url).toBeUndefined();
    expect(finding?.sourceLink?.reason).toBeDefined();
  });

  it('should leave source and sourceLink absent for a finding with no node behind it', () => {
    // Given a schema field finding, which is never about a handler
    const schema: IRSchema = {
      id: 'OrderDto',
      dialect: 'json-schema-2020-12',
      normalized: { type: 'object', properties: { total: { type: 'integer' } } },
    };
    const document = documentOf([operation({ summary: 'List orders' })], [schema]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((candidate) => candidate.rule === 'dto-field-undescribed');

    // Then
    expect(finding?.source).toBeUndefined();
    expect(finding?.sourceLink).toBeUndefined();
  });

  it('should fall back to computing health when the document carries none, as a bare specification does', () => {
    // Given a document nobody ran a runtime pass over, which is what `lint` always loads
    const document = documentOf([operation()]);
    expect(document.health).toBeUndefined();

    // When
    const report = buildDoctorReport(document);

    // Then the DX rule still fires over the bare specification
    expect(report.findings.some((finding) => finding.rule === 'missing-description')).toBe(true);
    // And a rule needing an application asks nothing, per SPEC 7.1's own scoping
    expect(report.findings.some((finding) => finding.rule === 'orphan-operation')).toBe(false);
  });

  it('should trust an existing health report rather than recompute it', () => {
    // Given a document whose attached health report an observation-only rule produced, which a
    // fresh computation with no observation could never reproduce
    const base = documentOf([operation({ summary: 'List orders' })]);
    const withObservation = buildHealthReport(base, {
      observation: { handledNodeIds: new Set() },
    });
    const document = documentOf([operation({ summary: 'List orders' })], [], {
      health: withObservation,
    });

    // When
    const report = buildDoctorReport(document);

    // Then the orphan-operation finding, which needs an observation, survived the join
    expect(report.findings.some((finding) => finding.rule === 'orphan-operation')).toBe(true);
    // And a fresh computation with no observation would not have produced it, which is the
    // difference this test exists to pin
    expect(buildHealthReport(base).drift.some((issue) => issue.rule === 'orphan-operation')).toBe(
      false,
    );
  });

  it('should produce the same report twice for the same document', () => {
    // Given
    const document = documentOf([operation()]);

    // When
    const first = buildDoctorReport(document);
    const second = buildDoctorReport(document);

    // Then
    expect(first).toEqual(second);
  });

  it('should serialize through canonicalize to the same string twice', () => {
    // Given
    const document = documentOf([operation(), operation({ id: 'b', method: 'post' })]);

    // When
    const first = canonicalize(buildDoctorReport(document));
    const second = canonicalize(buildDoctorReport(document));

    // Then
    expect(first).toBe(second);
    expect(() => {
      JSON.parse(first);
    }).not.toThrow();
  });
  it('should carry the assertion a rule named, so a fix mode never has to read the suggestion', () => {
    // Given
    const unnamed = operation({
      operationId: 'OrdersController_list',
      rawOperationId: 'OrdersController_list',
      runtime: { source: { controller: 'OrdersController', handler: 'list' } },
    });
    const document = documentOf([unnamed]);

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((entry) => entry.rule === 'missing-operation-id');

    // Then
    expect(finding?.assertion).toEqual({ kind: 'operation-id', operationId: 'list' });
  });
});

/**
 * The reader of the envelope, added by the pre-M4 review.
 *
 * `DOCTOR_REPORT_VERSION` had been written into every report since `T036` on the stated promise
 * that a consumer refuses a shape it does not recognise, and until these cases no consumer
 * anywhere refused anything: everything in this repository builds the report in process, and the
 * one place that crossed the JSON boundary crossed it with a cast. These cases and the `--fix`
 * integration suite are what make the field a check instead of a promise.
 */
describe('readDoctorReport', () => {
  it('should read back what buildDoctorReport wrote', () => {
    // Given a real report through the serialization the command uses
    const document = documentOf([operation({ operationId: 'list' })]);
    const written = canonicalize(buildDoctorReport(document));

    // When
    const read = readDoctorReport(written);

    // Then
    expect(read.ok).toBe(true);
    expect(read.ok ? read.report.version : undefined).toBe(DOCTOR_REPORT_VERSION);
  });

  it('should refuse a report from a version this build does not read', () => {
    // Given the shape of a future writer: same envelope, higher number
    const document = documentOf([operation({ operationId: 'list' })]);
    const future = { ...buildDoctorReport(document), version: DOCTOR_REPORT_VERSION + 1 };

    // When
    const read = readDoctorReport(JSON.stringify(future));

    // Then
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.reason).toContain(`version ${String(DOCTOR_REPORT_VERSION + 1)}`);
  });

  it.each([
    ['not JSON at all', 'Applied 0 findings in 0 files.', 'not valid JSON'],
    ['an array', '[]', 'not an object'],
    ['an envelope with no version', '{"score":100,"checks":[],"findings":[]}', 'version undefined'],
    [
      'an envelope with no score',
      `{"version":${String(DOCTOR_REPORT_VERSION)},"checks":[],"findings":[]}`,
      'no score or operation count',
    ],
    [
      'an envelope with no findings',
      `{"version":${String(DOCTOR_REPORT_VERSION)},"score":100,"operationCount":1,"checks":[]}`,
      'no checks or findings',
    ],
  ])('should refuse %s', (_case, serialized, reason) => {
    // Given / When
    const read = readDoctorReport(serialized);

    // Then
    expect(read.ok).toBe(false);
    expect(read.ok ? '' : read.reason).toContain(reason);
  });
});

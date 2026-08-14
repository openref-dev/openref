import { driftForNode, type IRDocument, type IROperation } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildParityRows } from '../../src/page/domain/parity-model';
import { buildRuntimeModel } from '../../src/page/domain/runtime-model';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';

/**
 * The parity scale of SPEC 6.3 and `TX-GUTTER`: eleven rows, verdicts traceable to the engine,
 * the FixBar with the SPEC 7.1 code, and the drawn absence of the collector-less rows.
 *
 * EVERY VERDICT IS TRACEABLE OR IT IS A LIE. `=` must mean the row's rule examined this
 * operation and stayed quiet, `≠` must mean a finding is recorded, `?` must mean the comparison
 * did not run. The cases below hold each of the three to its definition, including the document
 * nothing measured, whose every row answers `?` rather than borrowing a verdict from a run that
 * never happened.
 */

const NODE = runtimeNodeId();

/** The design's row order, which is the prototype's and is fixed. */
const ORDER = [
  'authentication',
  'scopes',
  'roles',
  'rate-limit',
  'response-codes',
  'required-headers',
  'validation',
  'timeout',
  'streaming',
  'unread-parameters',
  'source',
];

/** The operation the fixture puts facts on, with its recorded findings. */
function subject(document: IRDocument): {
  operation: IROperation;
  issues: ReturnType<typeof driftForNode>;
} {
  const node = document.nodes.get(NODE);
  if (node?.kind !== 'operation') throw new Error('fixture moved');

  return { operation: node, issues: driftForNode(document.health?.drift ?? [], NODE) };
}

describe('buildParityRows', () => {
  it('should draw the eleven rows in the design order, complete from the first day', () => {
    // Given
    const document = runtimeDocument();
    const { operation, issues } = subject(document);

    // When
    const rows = buildParityRows(document, operation, issues, '');

    // Then
    expect(rows.map((row) => row.kind)).toEqual(ORDER);
  });

  it('should draw the four collector-less rows as the empty side with the reason', () => {
    // Given
    const document = runtimeDocument();
    const { operation, issues } = subject(document);

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const empty = rows.filter((row) => row.runtime.length === 0);

    // Then, the absence is drawn and says why, and the phrase is about the instrument: a row
    // with no collector behind it answers `?` because the comparison cannot have run.
    expect(empty.map((row) => row.kind)).toEqual([
      'required-headers',
      'validation',
      'timeout',
      'unread-parameters',
    ]);
    for (const row of empty) {
      expect(row.reason).toContain('yet');
      expect(row.verdict).toBe('unknown');
      expect(row.fix).toBeNull();
    }
  });

  it('should answer drift with the FixBar exactly where a finding is recorded', () => {
    // Given, the fixture's stream has no item schema, which is a recorded finding
    const document = runtimeDocument();
    const { operation, issues } = subject(document);
    expect(issues.map((issue) => issue.rule)).toContain('stream-unspecified');

    // When
    const rows = buildParityRows(document, operation, issues, '/docs');
    const streaming = rows.find((row) => row.kind === 'streaming');

    // Then, the verdict is the recorded finding's, the strip carries its suggestion, and the
    // code is the SPEC 7.1 display code linking to the rule's anchored group in the panel.
    expect(streaming?.verdict).toBe('drift');
    expect(streaming?.severityClass).toBe('oref-drift-crit');
    expect(streaming?.fix?.code).toBe('RT040');
    expect(streaming?.fix?.href).toBe('/docs/health#oref-rule-stream-unspecified');
    expect(streaming?.fix?.text).toContain('@ApiStream');
  });

  it('should answer match only where the rule examined the operation and stayed quiet', () => {
    // Given a documented 429 whose limit agrees with the throttler, so `ratelimit-undocumented`
    // is in scope and quiet
    const base = runtimeDocument();
    const node = base.nodes.get(NODE);
    if (node?.kind !== 'operation') throw new Error('fixture moved');
    const quiet: IROperation = {
      ...node,
      responses: [...node.responses, { statusCode: '429', content: [] }],
    };

    // When
    const rows = buildParityRows(base, quiet, [], '');
    const limit = rows.find((row) => row.kind === 'rate-limit');

    // Then
    expect(limit?.verdict).toBe('match');
    expect(limit?.fix).toBeNull();
  });

  it('should answer unknown on every row of a document nothing measured', () => {
    // Given the same operation inside a document with no health report
    const measured = runtimeDocument();
    const { operation } = subject(measured);
    const { health, ...rest } = measured;
    expect(health).toBeDefined();
    const unmeasured: IRDocument = rest;

    // When
    const rows = buildParityRows(unmeasured, operation, [], '');

    // Then, no verdict claims a comparison a run never made
    expect(rows.every((row) => row.verdict === 'unknown')).toBe(true);
  });

  it('should answer unknown on the rows no rule compares yet, with both sides drawn', () => {
    // Given
    const document = runtimeDocument();
    const { operation, issues } = subject(document);

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const roles = rows.find((row) => row.kind === 'roles');
    const source = rows.find((row) => row.kind === 'source');

    // Then, the fact is drawn with its provenance and the gutter says the comparison did not
    // run, which is what no rule existing means; `=` there would claim an agreement nobody
    // computed.
    expect(roles?.runtime[0]?.text).toBe('admin');
    expect(roles?.runtime[0]?.confidence).toBe('derived');
    expect(roles?.verdict).toBe('unknown');
    expect(source?.runtime[0]?.text).toBe('OrdersController.findAll()');
    expect(source?.runtime[0]?.href).toContain('#L42');
    expect(source?.verdict).toBe('unknown');
  });

  it('should derive the response codes row from the contracts and the documented responses', () => {
    // Given
    const document = runtimeDocument();
    const { operation, issues } = subject(document);

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const codes = rows.find((row) => row.kind === 'response-codes');

    // Then, the spec side is what the document declares and the runtime side is the contract
    // groups, each value keeping its provenance and naming its group. The empty declared group
    // keeps its sentence, per SPEC 6.4: it is the one group that asserts something by being
    // empty.
    expect(codes?.spec.value).toContain('200');
    expect(codes?.runtime[0]?.text).toBe('This handler declares no errors');
    expect(codes?.runtime[1]?.text).toBe('429');
    expect(codes?.runtime[1]?.note).toBe('derived from runtime');
    expect(codes?.runtime[1]?.confidence).toBe('derived');
  });
});

describe('buildRuntimeModel, the parity wiring', () => {
  it('should hand an operation its scale and a factless node nothing, per SPEC 6.3', () => {
    // Given
    const document = runtimeDocument();

    // When
    const model = buildRuntimeModel(document, NODE, '');

    // Then
    expect(model?.parity.map((row) => row.kind)).toEqual(ORDER);
  });

  it('should carry the display code on every finding, per SPEC 7.1', () => {
    // Given
    const document = runtimeDocument();

    // When
    const model = buildRuntimeModel(document, NODE, '');

    // Then
    expect(model?.drift.length).toBeGreaterThan(0);
    for (const issue of model?.drift ?? []) {
      expect(issue.code).toMatch(/^(RT|SP|SC|DX)\d{3}$/);
    }
  });

  it('should still answer null for the document no collector reached', () => {
    // Given
    const document = smallDocument();

    // When
    const model = buildRuntimeModel(document, NODE, '');

    // Then
    expect(model).toBeNull();
  });
});

import {
  buildHealthReport,
  driftForNode,
  type IRDocument,
  type IRNode,
  type IRNodeRuntime,
  type IROperation,
} from '@openref/core';
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

  it('should draw the four fact-less rows as the empty side with the observed silence', () => {
    // Given a fixture whose collectors never attached the four TX-COLLECTORS facts
    const document = runtimeDocument();
    const { operation, issues } = subject(document);

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const empty = rows.filter((row) => row.runtime.length === 0);

    // Then, the absence is drawn and says which of the two silences it is. This fixture's meta
    // registers no collector for any of the four, so each names what would report it.
    expect(empty.map((row) => row.kind)).toEqual([
      'required-headers',
      'validation',
      'timeout',
      'unread-parameters',
    ]);
    for (const row of empty) {
      expect(row.reason).toContain('No registered collector reports');
      expect(row.verdict).toBe('unknown');
      expect(row.fix).toBeNull();
    }
    expect(empty.find((row) => row.kind === 'validation')?.reason).toBe(
      'No registered collector reports pipes. Add pipesCollector to the collectors option, or ' +
        'write one that does.',
    );
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

/**
 * The fixture's operation with the TX-COLLECTORS facts attached and the report rebuilt by the
 * real engine, the way the runtime pass would have built it. The shared `runtimeDocument` stays
 * without them on purpose: it is the document these collectors did not run on, which the hatch
 * cases above hold to the observed-silence phrase.
 */
function filledSubject(extra: Partial<IRNodeRuntime> = {}): {
  document: IRDocument;
  operation: IROperation;
  issues: ReturnType<typeof driftForNode>;
} {
  const base = runtimeDocument();
  const node = base.nodes.get(NODE);
  if (node?.kind !== 'operation') throw new Error('fixture moved');

  const success = node.responses[0]?.statusCode ?? '200';
  const runtime: IRNodeRuntime = {
    ...node.runtime,
    pipes: [
      { name: 'TrimPipe', scope: 'route', confidence: 'derived', collector: 'pipesCollector' },
      {
        name: 'CurrencyPipe',
        scope: 'parameter',
        confidence: 'derived',
        collector: 'pipesCollector',
      },
      {
        name: 'ValidationPipe',
        scope: 'global',
        confidence: 'derived',
        collector: 'pipesCollector',
      },
    ],
    timeout: { value: { ms: 5000 }, confidence: 'derived', collector: 'timeoutCollector' },
    requiredHeaders: {
      value: ['X-Internal-Token'],
      confidence: 'inferred',
      collector: 'headersCollector',
    },
    parameterReads: {
      value: {
        parameters: [
          { in: 'query', name: 'currency', verdict: 'read' },
          { in: 'query', name: 'sort', verdict: 'not-seen-read' },
        ],
      },
      confidence: 'inferred',
      collector: 'handlerScanCollector',
    },
    statusCode: { value: Number(success), confidence: 'derived', collector: 'httpCodeCollector' },
    ...extra,
  };

  const nodes = new Map<string, IRNode>();
  for (const [id, held] of base.nodes) {
    nodes.set(id, id === NODE ? { ...held, runtime } : held);
  }
  const withFacts: IRDocument = { ...base, nodes };
  const document: IRDocument = {
    ...withFacts,
    health: buildHealthReport(withFacts, {
      observation: { handledNodeIds: new Set(base.nodes.keys()) },
    }),
  };

  return { document, ...subject(document) };
}

describe('buildParityRows, the rows TX-COLLECTORS filled', () => {
  it('should draw the four facts in their rows, with the scope and the confidence visible', () => {
    // Given
    const { document, operation, issues } = filledSubject();

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const byKind = new Map(rows.map((row) => [row.kind, row]));

    // Then the validation row says which decision each pipe was, per SPEC 6.2.1
    const validation = byKind.get('validation');
    expect(validation?.runtime.map((value) => [value.text, value.note])).toEqual([
      ['TrimPipe', ''],
      ['CurrencyPipe', 'parameter level'],
      ['ValidationPipe', 'application wide'],
    ]);
    // And no rule examines it yet, so the fact stands under `?`, the roles precedent, and since
    // `TX-INSTRUMENT` the row says that in words rather than only in an `aria-label`
    expect(validation?.verdict).toBe('unknown');
    expect(validation?.reason).toBe(
      'No rule of the drift catalogue examines this row yet, so neither side is judged.',
    );

    // And the timeout row draws the milliseconds at derived, under `?` for the same reason
    const timeout = byKind.get('timeout');
    expect(timeout?.runtime[0]?.text).toBe('5000 ms');
    expect(timeout?.runtime[0]?.confidence).toBe('derived');
    expect(timeout?.verdict).toBe('unknown');

    // And the required headers row carries the inferred claim with its wording
    const headers = byKind.get('required-headers');
    expect(headers?.runtime[0]?.text).toBe('X-Internal-Token');
    expect(headers?.runtime[0]?.note).toBe('named required in guard metadata');
    expect(headers?.runtime[0]?.confidence).toBe('inferred');

    // And the scan row counts, and names what was not seen read
    const unread = byKind.get('unread-parameters');
    expect(unread?.runtime[0]?.text).toBe('1 of 2 seen read');
    expect(unread?.runtime[0]?.note).toBe('not seen read: sort');
    expect(unread?.runtime[0]?.confidence).toBe('inferred');
  });

  it('should close the two SP rows with their FixBars where the report carries findings', () => {
    // Given the fixture's document, whose GET declares no X-Internal-Token header and no `sort`
    // reading, so SP011 and SP010 both record findings
    const { document, operation, issues } = filledSubject();
    expect(issues.map((issue) => issue.rule)).toContain('header-requiredness-drift');
    expect(issues.map((issue) => issue.rule)).toContain('parameter-unread');

    // When
    const rows = buildParityRows(document, operation, issues, '/docs');
    const byKind = new Map(rows.map((row) => [row.kind, row]));

    // Then each row's verdict is the recorded finding's, closed by its own display code
    expect(byKind.get('required-headers')?.verdict).toBe('drift');
    expect(byKind.get('required-headers')?.fix?.code).toBe('SP011');
    expect(byKind.get('unread-parameters')?.verdict).toBe('drift');
    expect(byKind.get('unread-parameters')?.fix?.code).toBe('SP010');
  });

  it('should give the response codes row the success value and a two rule verdict', () => {
    // Given an explicit code among the documented responses, so `status-drift` examined and
    // stayed quiet while `error-undocumented` is out of scope: one quiet examiner is enough
    const { document, operation, issues } = filledSubject();
    const clean = issues.filter(
      (issue) => issue.rule !== 'header-requiredness-drift' && issue.rule !== 'parameter-unread',
    );

    // When
    const rows = buildParityRows(document, operation, clean, '');
    const codes = rows.find((row) => row.kind === 'response-codes');

    // Then the first value is the explicit success, and the verdict is the engine's `=`
    expect(codes?.runtime[0]?.text).toMatch(/^success \d+$/);
    expect(codes?.runtime[0]?.note).toBe('explicit @HttpCode');
    expect(codes?.verdict).toBe('match');
  });

  it('should keep the second finding of a two rule row out of the FixBar and in the list', () => {
    // Given an explicit code no response documents, on an operation whose declared errors also
    // carry an undocumented one, so both rules of the row record findings
    const { document, operation } = filledSubject({
      statusCode: { value: 299, confidence: 'derived', collector: 'httpCodeCollector' },
      errors: {
        declared: [
          {
            status: 402,
            title: 'Payment Required',
            origin: 'declared',
            confidence: 'declared',
            collector: 'declarationsCollector',
          },
        ],
        runtimeDerived: [],
        global: [],
      },
    });
    const issues = driftForNode(document.health?.drift ?? [], NODE);
    expect(issues.map((issue) => issue.rule)).toContain('error-undocumented');
    expect(issues.map((issue) => issue.rule)).toContain('status-drift');

    // When
    const rows = buildParityRows(document, operation, issues, '');
    const codes = rows.find((row) => row.kind === 'response-codes');

    // Then the FixBar carries the first recorded finding, in catalogue order, and the second
    // stays a finding the panel's card list keeps, because its code was consumed by no row
    expect(codes?.verdict).toBe('drift');
    expect(codes?.fix?.code).toBe('RT050');
    const model = buildRuntimeModel(document, NODE, '');
    expect(model?.drift.map((issue) => issue.code)).toContain('SP012');
    expect(model?.parity.map((row) => row.fix?.code)).not.toContain('SP012');
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

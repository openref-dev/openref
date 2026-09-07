import {
  buildHealthReport,
  groupDriftByCause,
  groupDriftByRule,
  normalizeOpenApiDocument,
  type IRDocument,
  type IRNode,
} from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  buildHealthModel,
  buildRuntimeModel,
  rateLimitLabel,
  streamingLabel,
} from '../../src/page/domain/runtime-model';
import { runtimeDocument, runtimeNodeId, smallDocument } from '../mocks/documents';

/** The node the fixtures put facts on, read off the document rather than typed out. */
const NODE = runtimeNodeId();

/**
 * The runtime block and the Health panel as a model, per SPEC 6.3, 6.4 and 7.2.
 *
 * These are the assertions that decide what a reader is shown rather than how it is drawn: that
 * an application with no collectors gets no block at all, that a group which asserts nothing is
 * left out while the one that asserts something is kept, and that a link which could not be
 * built arrives as the reason instead of as a link that lands on a 404.
 */

/** The document with one operation replaced. */
function withRuntime(id: string, runtime: NonNullable<IRNode['runtime']>): IRDocument {
  const base = smallDocument();
  const nodes = new Map(base.nodes);
  const node = nodes.get(id);
  if (node !== undefined) nodes.set(id, { ...node, runtime });

  return { ...base, nodes };
}

/** One operation, with a response body and with or without the example that stops a finding. */
function operation(index: number, example: boolean): Record<string, unknown> {
  const schema = { type: 'object', properties: { name: { type: 'string' } } };
  const media = example ? { schema, example: { name: 'a' } } : { schema };

  return {
    get: {
      operationId: `ThingsController_read${String(index)}`,
      summary: 'Read a thing',
      responses: { '200': { description: 'ok', content: { 'application/json': media } } },
    },
  };
}

/** A document measured by the drift rules, with one operation per path. */
function measured(count: number, example: boolean): IRDocument {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < count; index += 1)
    paths[`/thing-${String(index)}`] = operation(index, example);

  const document = normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Things', version: '1.0.0' },
    paths,
  });

  return {
    ...document,
    health: buildHealthReport(document, {
      observation: { handledNodeIds: new Set(document.nodes.keys()) },
    }),
  };
}

/**
 * A document whose findings fold: several operations miss an example for one identical reason.
 *
 * The fold is what makes the heading's two counts differ, so a fixture that does not fold would
 * assert nothing about the sentence under test.
 */
function foldedDocument(): IRDocument {
  return measured(3, false);
}

/** A document where every finding names its own subject and so stands alone. */
function unfoldedDocument(): IRDocument {
  return measured(3, true);
}

describe('buildRuntimeModel', () => {
  it('should draw no block at all when no collector reached the node', () => {
    // Given, what a reader arriving from plain @nestjs/swagger has: a normalized document and no
    // application behind it. SPEC 6.3: a scaffold of labelled slots with dashes in them reads as
    // a broken product rather than as a feature nobody switched on.
    const document = smallDocument();

    // When
    const model = buildRuntimeModel(document, NODE, '');

    // Then
    expect(model).toBeNull();
  });

  it('should draw a block for a record that carries only an empty errors record', () => {
    // Given, SPEC 6.4: the field being there means somebody was asked
    const document = withRuntime(NODE, {
      errors: { declared: [], runtimeDerived: [], global: [] },
    });

    // When
    const model = buildRuntimeModel(document, NODE, '');

    // Then, one row, and it says so in words rather than being blank. The words are about the
    // application and not about the collector, per SPEC 6.4: the value states what the handler
    // does and the aside names the decorator that changes it.
    expect(model?.rows.map((row) => row.label)).toEqual(['Errors, declared']);
    expect(model?.rows[0]?.values[0]?.text).toBe('This handler declares no errors');
    expect(model?.rows[0]?.values[0]?.note).toContain('@ApiErrors');
  });

  it('should leave out an empty derived group and an empty global one', () => {
    // Given, a group that asserts nothing by being empty. Only `declared` is a person's promise,
    // so only `declared` says anything by being empty.
    const document = withRuntime(NODE, {
      errors: {
        declared: [
          {
            status: 404,
            title: 'OrderNotFound',
            origin: 'declared',
            confidence: 'declared',
            collector: 'errorsCollector',
          },
        ],
        runtimeDerived: [],
        global: [],
      },
    });

    // When
    const labels = buildRuntimeModel(document, NODE, '')?.rows.map((row) => row.label);

    // Then
    expect(labels).toEqual(['Errors, declared']);
  });

  it('should draw one handler policy row holding every policy, each with its own mark', () => {
    // Given a handler carrying a cache from one collector and a lock from another, which is the
    // case the IR member is a list for
    const document = withRuntime(NODE, {
      handlerPolicies: [
        {
          kind: 'cache',
          key: 'orders:{0}',
          settings: [
            { name: 'ttlMs', value: 60_000 },
            { name: 'tags', value: ['orders', 'lists'] },
          ],
          reach: 'handler',
          confidence: 'derived',
          collector: 'redisxCacheCollector',
        },
        {
          kind: 'lock',
          key: 'order:{0}',
          settings: [{ name: 'onFailure', value: 'throw' }],
          reach: 'handler',
          confidence: 'derived',
          collector: 'redisxLockCollector',
        },
      ],
    });

    // When
    const row = buildRuntimeModel(document, NODE, '')?.rows.find(
      (candidate) => candidate.label === 'Handler policies',
    );

    // Then two values and NOT one joined line, which is where this parts company with the guard
    // row: two behaviours with two sets of numbers cannot share a text
    expect(row?.kind).toBe('handler-policies');
    expect(row?.values.map((value) => value.text)).toEqual([
      'Cached on orders:{0}',
      'Locked on order:{0}',
    ]);
    expect(row?.values.map((value) => value.note)).toEqual([
      'ttlMs 60000, tags orders, lists',
      'onFailure throw',
    ]);
    expect(row?.values.map((value) => value.collector)).toEqual([
      'redisxCacheCollector',
      'redisxLockCollector',
    ]);
  });

  it('should say on the row that an unbound declaration binds nothing today', () => {
    // Given the half of `@nestjs-redisx/cache` whose interceptor the library registers nowhere.
    // A ttl beside it would be read as a window this route's responses are served in, so the
    // collector reports no settings and the row leads with the sentence.
    const document = withRuntime(NODE, {
      handlerPolicies: [
        {
          kind: 'cache',
          settings: [{ name: 'declaredBy', value: '@Cacheable' }],
          reach: 'unbound',
          confidence: 'derived',
          collector: 'redisxCacheCollector',
        },
      ],
    });

    // When
    const row = buildRuntimeModel(document, NODE, '')?.rows.find(
      (candidate) => candidate.label === 'Handler policies',
    );

    // Then the value names the behaviour with no key after it, and the note refuses it
    expect(row?.values[0]?.text).toBe('Cached');
    expect(row?.values[0]?.note).toBe(
      'Declared and bound by nothing here, so this route does not behave this way today. ' +
        'declaredBy @Cacheable',
    );
  });

  it('should show a detail two contracts share once, on the first of them', () => {
    // Given the pair SPEC 6.4 derives from one fact: 401 and 403 differ by their title and by
    // nothing else, so the block printed the same sentence twice under two codes and read as a
    // repetition rather than as two contracts. Found in a browser on the demo.
    const shared = 'This route is behind ScopesGuard, so it can refuse a caller.';
    const derived = [401, 403].map((status) => ({
      status,
      title: status === 401 ? 'Unauthorized' : 'Forbidden',
      detail: shared,
      origin: 'runtime-derived' as const,
      confidence: 'derived' as const,
      collector: 'guardsCollector',
    }));
    const document = withRuntime(NODE, {
      errors: { declared: [], runtimeDerived: derived, global: [] },
    });

    // When
    const row = buildRuntimeModel(document, NODE, '')?.rows.find(
      (candidate) => candidate.label === 'Errors, runtime-derived',
    );

    // Then both contracts are still here, with their own status and their own mark, and the
    // sentence is on the first of them only
    expect(row?.values.map((value) => value.status)).toEqual(['401', '403']);
    expect(row?.values.map((value) => value.confidence)).toEqual(['derived', 'derived']);
    expect(row?.values.map((value) => value.note)).toEqual([shared, '']);
  });

  it('should keep a detail that only looks like the one above it', () => {
    // Given two contracts in one group whose details differ by a word. This is the plant for the
    // case above: a deduplication that compared anything looser than the whole string would drop
    // a sentence a reader needs, and nothing else would notice.
    const document = withRuntime(NODE, {
      errors: {
        declared: [],
        runtimeDerived: [],
        global: [401, 403].map((status) => ({
          status,
          title: status === 401 ? 'Unauthorized' : 'Forbidden',
          detail: `The caller is ${status === 401 ? 'unknown' : 'known'} to this application.`,
          origin: 'global' as const,
          confidence: 'declared' as const,
          collector: 'errorsCollector',
        })),
      },
    });

    // When
    const row = buildRuntimeModel(document, NODE, '')?.rows.find(
      (candidate) => candidate.label === 'Errors, global',
    );

    // Then
    expect(row?.values.map((value) => value.note)).toEqual([
      'The caller is unknown to this application.',
      'The caller is known to this application.',
    ]);
  });

  it('should carry each fact with the confidence and the collector that produced it', () => {
    // Given the document with an application behind it. THE TWO FACTS TRAVEL AND THE THREE
    // STRINGS DRAWN FROM THEM DO NOT, since `TX-SLOTWIRE`: `ProvenanceTag` is declared in terms
    // of `confidence` and `collector`, so a value carrying a formatted class and a formatted
    // tooltip could not supply its own position's props.
    const document = runtimeDocument();

    // When
    const model = buildRuntimeModel(document, NODE, '');
    const marked = (model?.rows ?? []).flatMap((row) =>
      row.values.filter((value) => value.confidence !== null),
    );

    // Then every fact carries a provenance, and every provenance names its collector
    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every((value) => value.collector !== '')).toBe(true);
    expect(new Set(marked.map((value) => value.confidence))).toEqual(
      new Set(['declared', 'derived', 'inferred']),
    );
  });

  it('should fold guards read by one collector into one row and not one row each', () => {
    // Given two guards from one collector, which is one observation of two names
    const document = runtimeDocument();

    // When
    const guards = buildRuntimeModel(document, NODE, '')?.rows.find(
      (row) => row.label === 'Guards',
    );

    // Then
    expect(guards?.values).toHaveLength(1);
    expect(guards?.values[0]?.text).toBe('JwtAuthGuard, RolesGuard');
  });

  it('should draw a globally registered guard on its own row, per SPEC 6.2.1', () => {
    // Given a route with its own guard inside an application that registers one for everything.
    // One row holding both would answer "is it protected" and lose "did anyone decide that here",
    // which is the same thing T021 refused to do to the three groups of error contracts.
    const document = runtimeDocument();
    const node = document.nodes.get(NODE);
    const guarded = new Map(document.nodes);
    guarded.set(NODE, {
      ...node,
      runtime: {
        ...node?.runtime,
        guards: [
          ...(node?.runtime?.guards ?? []),
          {
            name: 'ReadonlyGuard',
            scope: 'global',
            confidence: 'derived',
            collector: 'guardsCollector',
          },
        ],
      },
    } as IRNode);

    // When
    const rows = buildRuntimeModel({ ...document, nodes: guarded }, NODE, '')?.rows ?? [];

    // Then, two rows, and the route's own one keeps its unqualified label
    expect(rows.filter((row) => row.label.startsWith('Guards')).map((row) => row.label)).toEqual([
      'Guards',
      'Guards, global',
    ]);
    expect(rows.find((row) => row.label === 'Guards')?.values[0]?.text).toBe(
      'JwtAuthGuard, RolesGuard',
    );
    expect(rows.find((row) => row.label === 'Guards, global')?.values[0]?.text).toBe(
      'ReadonlyGuard',
    );
  });

  it('should expand the source link against the template the document carries', () => {
    // Given
    const document = runtimeDocument();

    // When
    const source = buildRuntimeModel(document, NODE, '')?.rows.find(
      (row) => row.label === 'Source',
    );

    // Then
    expect(source?.values[0]?.text).toBe('OrdersController.findAll()');
    expect(source?.values[0]?.href).toBe(
      'https://github.com/org/repo/blob/abc123/src/orders.controller.ts#L42',
    );
    expect(source?.values[0]?.note).toBe('');
  });

  it('should show why there is no source link rather than a link that cannot work', () => {
    // Given a source with no template configured, which is the ordinary case. SPEC 6.3: a link
    // carrying an unfilled placeholder is clickable, lands on a 404, and the reader blames the
    // repository rather than the reference.
    const document = withRuntime(NODE, {
      source: { controller: 'OrdersController', handler: 'findAll', file: 'a.ts', line: 1 },
    });

    // When
    const source = buildRuntimeModel(document, NODE, '')?.rows[0];

    // Then
    expect(source?.values[0]?.href).toBe('');
    expect(source?.values[0]?.note).toContain('no source link template');
  });

  it('should report a link that reaches the file and not the line', () => {
    // Given a build with no source map, which is the case the degradation exists for and also
    // the signal that the headline feature of this milestone is only half working
    const base = withRuntime(NODE, {
      source: { controller: 'OrdersController', handler: 'findAll', file: 'a.ts' },
    });
    const document: IRDocument = {
      ...base,
      runtime: { collectors: [], sourceLinkTemplate: 'https://host/{file}#L{line}' },
    };

    // When
    const source = buildRuntimeModel(document, NODE, '')?.rows[0];

    // Then
    expect(source?.values[0]?.href).toBe('https://host/a.ts');
    expect(source?.values[0]?.note).toBe('file only, no source map');
  });

  it('should read the findings of one node out of the document report', () => {
    // Given, the rules run once over the document and the findings live on the report; a node
    // page shows the same report one subject at a time.
    const document = runtimeDocument();

    // When
    const model = buildRuntimeModel(document, NODE, '');

    // Then
    expect(model?.drift.length).toBeGreaterThan(0);
    expect(model?.drift.every((issue) => issue.suggestion !== '')).toBe(true);
    // No link and no subject: the page is already about the subject.
    expect(model?.drift.every((issue) => issue.href === '')).toBe(true);
  });
});

describe('buildHealthModel', () => {
  it('should draw no panel at all when nothing measured the document', () => {
    // Given, SPEC 7.3: a score of zero says the documentation is bad, and no panel says nothing
    // looked at it, and those are different statements.
    const document = smallDocument();

    // When
    const model = buildHealthModel(document, '');

    // Then
    expect(model).toBeNull();
  });

  it('should group the findings by rule and give each one a jump to its subject', () => {
    // Given
    const document = runtimeDocument();

    // When
    const model = buildHealthModel(document, '/docs');

    // Then
    expect(model?.rules.length).toBeGreaterThan(0);
    const nodeFindings = (model?.rules ?? [])
      .flatMap((rule) => rule.findings)
      .filter((finding) => finding.subject !== '');
    expect(nodeFindings.length).toBeGreaterThan(0);
    expect(nodeFindings.every((finding) => finding.href.startsWith('/docs/'))).toBe(true);
  });

  it('should print the count a closed group stands for, so nothing is hidden by folding it', () => {
    // Given, the panel folds and never truncates: a group that showed the first twenty of its
    // findings would read as coverage while hiding the tail. Since SPEC 7.2 the rows inside a
    // group are its causes rather than its findings, so the heading's count is the sum of the
    // rows' counts rather than the number of rows.
    const document = runtimeDocument();

    // When
    const model = buildHealthModel(document, '');

    // Then. The subject is asserted present first: there really are groups here to be folded.
    expect((model?.rules ?? []).length).toBeGreaterThan(0);
    const mismatched = (model?.rules ?? []).filter(
      (rule) =>
        rule.count !==
        String(rule.findings.reduce((total, finding) => total + Number(finding.count), 0)),
    );
    expect(mismatched).toEqual([]);

    // And every row names as many subjects as it stands for, so nothing folded away
    const rows = (model?.rules ?? []).flatMap((rule) => rule.findings);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.subjects.length === Number(row.count))).toBe(true);
  });

  it('should keep a failed collector among the checks and out of the findings', () => {
    // Given a registry line reporting that one collector of two ran, which is SPEC 7's rule: a
    // broken tool is a health check and never a drift row, because a drift row sends a reader to
    // edit their own code.
    const document = runtimeDocument();
    const health = document.health;
    const withCollectorCheck: IRDocument = {
      ...document,
      health: {
        ...(health ?? { score: 100, operationCount: 0, checks: [], drift: [] }),
        checks: [
          {
            id: 'runtime-collectors',
            label: 'collectors ran',
            passed: 1,
            total: 2,
            severity: 'warning',
          },
          ...(health?.checks ?? []),
        ],
      },
    };

    // When
    const model = buildHealthModel(withCollectorCheck, '');

    // Then
    expect(model?.checks[0]?.count).toBe('1 / 2');
    expect((model?.rules ?? []).flatMap((rule) => rule.findings.map((f) => f.rule))).not.toContain(
      'runtime-collectors',
    );
  });

  it('should drop a check that had nothing to count rather than render the instrument', () => {
    // Given, SPEC 7.2's 2026-08-14 line: a zero denominator check is out of the score and out
    // of the panel. The row used to render `n/a`, which reports on the instrument in a column
    // where every other row reports on the application, the class F26 named; a question that
    // applied to nothing asserts nothing about the application, so it renders nothing.
    const document = runtimeDocument();
    const report = document.health;

    // When
    const model = buildHealthModel(document, '');
    const rows = model?.checks ?? [];

    // Then the empty checks exist in the report and none of them reaches the panel
    const empty = (report?.checks ?? []).filter((check) => check.total === 0).map((c) => c.label);
    expect(empty.length).toBeGreaterThan(0);
    const drawn = rows.map((row) => row.label);
    for (const label of empty) expect(drawn).not.toContain(label);
    for (const row of rows) expect(row.count).toMatch(/^\d+ \/ \d+$/);
  });

  it('should name the causes it draws beside the findings they cover, so two counts cannot disagree', () => {
    // Given a document whose findings fold, which is the state the heading contradicted: SPEC 7.2
    // folds findings of one cause into one row and deliberately leaves `IRHealthReport.drift` a
    // flat list, so on the maintainer's application the heading said 186 findings above 68 rows
    // and a reader who counted was told two different numbers by one page.
    const document = foldedDocument();
    const report = document.health;
    const findings = report?.drift ?? [];
    const causes = groupDriftByRule(findings).flatMap((group) => groupDriftByCause(group.issues));

    // Then the subject is present before anything is claimed about it: this document really does
    // fold, so the two counts really are different here.
    expect(findings.length).toBeGreaterThan(causes.length);

    // When
    const model = buildHealthModel(document, '');

    // Then the heading states both quantities and the rows a reader can count are the causes it
    // names, so neither number is a lie and neither has to be reconciled against the other.
    expect(model?.title).toBe(
      `Documentation health, ${String(report?.operationCount ?? 0)} operations, ` +
        `${String(findings.length)} findings in ${String(causes.length)} causes`,
    );
    expect((model?.rules ?? []).flatMap((rule) => rule.findings)).toHaveLength(causes.length);
  });

  it('should say findings once when nothing folded, rather than print one number twice', () => {
    // Given a document where every finding is its own cause, which is the ordinary small case.
    // "6 findings in 6 causes" is not a contradiction, but it is one quantity written twice, and
    // the clause exists to tell two quantities apart.
    const document = unfoldedDocument();
    const report = document.health;
    const findings = report?.drift ?? [];
    const causes = groupDriftByRule(findings).flatMap((group) => groupDriftByCause(group.issues));

    // Then the subject is present: there are findings here, and none of them folded
    expect(findings.length).toBeGreaterThan(0);
    expect(causes).toHaveLength(findings.length);

    // When
    const model = buildHealthModel(document, '');

    // Then
    expect(model?.title).toBe(
      `Documentation health, ${String(report?.operationCount ?? 0)} operations, ` +
        `${String(findings.length)} findings`,
    );
  });
});

describe('rateLimitLabel and streamingLabel', () => {
  it('should name the window a reader would name', () => {
    // Given
    const limit = { limit: 100, ttlMs: 60_000 };

    // When
    const label = rateLimitLabel(limit);

    // Then
    expect(label).toBe('100 / minute');
  });

  it('should print a window with no name as seconds rather than inventing one', () => {
    // Given
    const limit = { limit: 5, ttlMs: 30_000, name: 'burst' };

    // When
    const label = rateLimitLabel(limit);

    // Then
    expect(label).toBe('5 / 30 s (burst)');
  });

  it('should name the transport and say nothing about an item schema it was not given', () => {
    // Given, SPEC 13.6: a stream with no declared item type is the subject of a drift rule, and
    // printing a shape here would be the guess that rule exists to report.
    const streaming = { transport: 'sse' } as const;

    // When
    const label = streamingLabel(streaming);

    // Then
    expect(label).toBe('SSE');
  });

  it('should carry a declared heartbeat, which is a fact and not a guess', () => {
    // Given
    const streaming = { transport: 'sse', heartbeatMs: 15_000 } as const;

    // When
    const label = streamingLabel(streaming);

    // Then
    expect(label).toBe('SSE, heartbeat 15 s');
  });
});

describe('the model of a document that never met an application', () => {
  it('should leave every node without a block and the page without a panel', () => {
    // Given a corpus shaped document: normalized, complete, and never near a NestJS process
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Plain', version: '1.0.0' },
      paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } },
    });

    // When
    const blocks = [...document.nodes.keys()].map((id) => buildRuntimeModel(document, id, ''));

    // Then
    expect(blocks).toEqual(blocks.map(() => null));
    expect(buildHealthModel(document, '')).toBeNull();
  });
});

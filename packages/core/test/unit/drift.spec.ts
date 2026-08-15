import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  classifyDrift,
  collectDrift,
  isMechanicallyFixable,
  OPERATION_DRIFT_RULES,
  operationRuleOutcome,
  runDriftRules,
  type DriftObservation,
  type IRDocument,
  type IRDriftIssue,
  type IRDriftRule,
  type IRNode,
  type IROperation,
  type IRSchema,
} from '../../src/index';

/**
 * SPEC 7.1, rule by rule, and the classification of SPEC 7.4 that sits on every finding.
 *
 * EVERY RULE HAS A POSITIVE FIXTURE AND A PAIRED NEGATIVE ONE, which is the definition of done of
 * T022 rather than a habit. A rule that never stays quiet is noise, and a health panel that always
 * has work to show is one a reader stops opening; the only way to know a rule can stay quiet is to
 * hold a document it stays quiet about.
 *
 * THE BUCKET IS CHECKED AGAINST `ai-docs/REMEDIATION.md` SECTION 5, WHICH IS ITS SPECIFICATION.
 * That table is deliberately not in the source: a table from rule id to bucket is exactly the
 * defect the maintainer's correction removed, so it lives here, where it pins the behaviour rather
 * than producing it. The two rules that reach two buckets have a fixture for each state.
 */

/** The bare operation every fixture starts from: nothing declared, nothing observed. */
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

/** A pass that found a handler for every node of the document. */
function observed(document: IRDocument, guardSchemes?: Record<string, string>): DriftObservation {
  return {
    handledNodeIds: new Set(document.nodes.keys()),
    ...(guardSchemes === undefined ? {} : { guardSchemes: new Map(Object.entries(guardSchemes)) }),
  };
}

/** Every finding one rule produced over one document. */
function issuesFor(
  rule: IRDriftRule,
  document: IRDocument,
  observation?: DriftObservation,
): readonly IRDriftIssue[] {
  return collectDrift(document, observation).filter((issue) => issue.rule === rule);
}

/** The single finding one rule produced, which the caller expects there to be exactly one of. */
function onlyIssue(
  rule: IRDriftRule,
  document: IRDocument,
  observation?: DriftObservation,
): IRDriftIssue {
  const issues = issuesFor(rule, document, observation);
  expect(issues).toHaveLength(1);

  const only = issues[0];
  if (only === undefined) throw new Error(`no ${rule} finding, and the length assertion passed`);

  return only;
}

/** A media type carrying a schema and nothing else, so `missing-example` has something to count. */
const JSON_BODY = { mediaType: 'application/json' } as const;

describe('security-drift', () => {
  it('should fire when a guard stands on an operation the specification says nothing about', () => {
    // Given a guarded route and a document asserting no security at all
    const document = documentOf([
      operation({
        runtime: {
          guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'g' }],
        },
      }),
    ]);

    // When
    const issue = onlyIssue('security-drift', document, observed(document));

    // Then it is a silence: the specification is empty and the edit adds to nothing
    expect(issue.classification).toEqual({ bucket: 'silence' });
    expect(issue.runtimeValue).toBe('ScopesGuard');
    expect(issue.specValue).toBe('security: undefined');
    expect(issue.suggestion).toContain('DocumentBuilder');
  });

  it('should stay quiet when the operation already requires the scheme the guard maps to', () => {
    // Given the same guard, a mapping, and a document that requires that scheme
    const document = documentOf([
      operation({
        security: [{ schemeId: 'bearer', scopes: [] }],
        runtime: {
          guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'g' }],
        },
      }),
    ]);

    // When
    const issues = issuesFor(
      'security-drift',
      document,
      observed(document, { ScopesGuard: 'bearer' }),
    );

    // Then
    expect(issues).toEqual([]);
  });

  it('should call it a contradiction when the operation requires a different scheme', () => {
    // Given a document asserting `apiKey` where the guard maps to `bearer`
    const document = documentOf([
      operation({
        security: [{ schemeId: 'apiKey', scopes: [] }],
        runtime: {
          guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'g' }],
        },
      }),
    ]);

    // When
    const issue = onlyIssue(
      'security-drift',
      document,
      observed(document, { ScopesGuard: 'bearer' }),
    );

    // Then. THE SAME RULE PRODUCED A SILENCE ABOVE AND A CONTRADICTION HERE, which is the whole
    // reason the bucket belongs to the finding: classified by rule name, this one would have been
    // handed to a fix mode and had `@ApiBearerAuth` written beside a conflicting requirement.
    expect(issue.classification).toEqual({ bucket: 'contradiction' });
    expect(issue.specValue).toBe('security: apiKey');
  });

  it('should stay quiet about a scheme it was never told how to compare', () => {
    // Given a guarded operation that already asserts security, and no mapping configured
    const document = documentOf([
      operation({
        security: [{ schemeId: 'apiKey', scopes: [] }],
        runtime: {
          guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'g' }],
        },
      }),
    ]);

    // When
    const issues = issuesFor('security-drift', document, observed(document));

    // Then a guard class name does not name a scheme, so there is nothing to disagree with
    expect(issues).toEqual([]);
  });

  it('should carry the strongest confidence among the guards, since the claim is existential', () => {
    // Given one guard read at `declared` beside one read at `derived`
    const document = documentOf([
      operation({
        runtime: {
          guards: [
            { name: 'Weak', scope: 'route', confidence: 'derived', collector: 'g' },
            { name: 'Strong', scope: 'route', confidence: 'declared', collector: 'g' },
          ],
        },
      }),
    ]);

    // When
    const issue = onlyIssue('security-drift', document, observed(document));

    // Then one guard named at `declared` makes "this route is guarded" true on its own
    expect(issue.basis).toEqual({ kind: 'collected', confidence: 'declared' });
  });
});

describe('scope-drift', () => {
  it('should fire when a declared scope is on no security requirement', () => {
    // Given
    const document = documentOf([
      operation({
        security: [{ schemeId: 'bearer', scopes: [] }],
        runtime: { scopes: { value: ['orders:read'], confidence: 'derived', collector: 's' } },
      }),
    ]);

    // When
    const issue = onlyIssue('scope-drift', document);

    // Then an empty scope list is itself a statement, so the edit narrows rather than fills
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'structural-ambiguity' });
    expect(issue.runtimeValue).toBe('orders:read');
  });

  it('should stay quiet when the requirement lists the declared scope', () => {
    // Given
    const document = documentOf([
      operation({
        security: [{ schemeId: 'bearer', scopes: ['orders:read'] }],
        runtime: { scopes: { value: ['orders:read'], confidence: 'derived', collector: 's' } },
      }),
    ]);

    // When
    const issues = issuesFor('scope-drift', document);

    // Then
    expect(issues).toEqual([]);
  });

  it('should leave an operation with no security requirement to security-drift', () => {
    // Given scopes declared and nothing asserted about security at all
    const document = documentOf([
      operation({
        runtime: { scopes: { value: ['orders:read'], confidence: 'derived', collector: 's' } },
      }),
    ]);

    // When
    const issues = issuesFor('scope-drift', document);

    // Then the same silence reported twice reads as two problems, and only one has an edit
    expect(issues).toEqual([]);
  });
});

describe('ratelimit-undocumented', () => {
  it('should fire as a silence when no 429 is documented', () => {
    // Given
    const document = documentOf([
      operation({
        runtime: {
          rateLimit: { value: { limit: 30, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
        },
      }),
    ]);

    // When
    const issue = onlyIssue('ratelimit-undocumented', document);

    // Then
    expect(issue.classification).toEqual({ bucket: 'silence' });
    expect(issue.suggestion).toContain('@ApiResponse({ status: 429');
  });

  it('should stay quiet when a 429 is documented and asserts no limit of its own', () => {
    // Given
    const document = documentOf([
      operation({
        responses: [{ statusCode: '429', content: [] }],
        runtime: {
          rateLimit: { value: { limit: 30, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
        },
      }),
    ]);

    // When
    const issues = issuesFor('ratelimit-undocumented', document);

    // Then
    expect(issues).toEqual([]);
  });

  it('should call it a contradiction when the documented limit disagrees with the enforced one', () => {
    // Given a 429 whose rate limit header pins a number the throttler does not apply
    const document = documentOf([
      operation({
        responses: [
          {
            statusCode: '429',
            content: [],
            headers: [
              {
                name: 'RateLimit-Limit',
                required: false,
                schema: {
                  kind: 'inline',
                  schema: {
                    id: 'limit',
                    dialect: 'json-schema-2020-12',
                    normalized: { type: 'integer', const: 10 },
                  },
                },
              },
            ],
          },
        ],
        runtime: {
          rateLimit: { value: { limit: 30, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
        },
      }),
    ]);

    // When
    const issue = onlyIssue('ratelimit-undocumented', document);

    // Then. THE SECOND RULE THAT REACHES TWO BUCKETS, and the one whose name most invites the
    // wrong answer: "undocumented" reads as a silence, and this node is not one.
    expect(issue.classification).toEqual({ bucket: 'contradiction' });
    expect(issue.specValue).toContain('10');
  });

  it('should not read a limit out of prose', () => {
    // Given a 429 whose description states a limit and whose schema asserts nothing
    const document = documentOf([
      operation({
        responses: [
          { statusCode: '429', description: 'At most 10 requests per minute.', content: [] },
        ],
        runtime: {
          rateLimit: { value: { limit: 30, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
        },
      }),
    ]);

    // When
    const issues = issuesFor('ratelimit-undocumented', document);

    // Then reading a number out of a sentence is the guess SPEC 6.1 refuses
    expect(issues).toEqual([]);
  });
});

describe('stream-unspecified', () => {
  it('should fire when the route streams and nothing states what it streams', () => {
    // Given
    const document = documentOf([
      operation({
        runtime: {
          streaming: { value: { transport: 'sse' }, confidence: 'declared', collector: 'st' },
        },
      }),
    ]);

    // When
    const issue = onlyIssue('stream-unspecified', document);

    // Then no collector observed an item type, so there is nothing a tool could write
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'no-observed-fact' });
    expect(issue.basis).toEqual({ kind: 'unobserved' });
  });

  it('should call it confidence starvation when only the plugin knows the item type', () => {
    // Given the compile time plugin's answer, which SPEC 6.1 puts at `inferred`
    const document = documentOf([
      operation({
        runtime: {
          streaming: {
            value: { transport: 'sse', itemSchema: { kind: 'named', schemaId: 'OrderEventDto' } },
            confidence: 'inferred',
            collector: 'st',
          },
        },
      }),
    ]);

    // When
    const issue = onlyIssue('stream-unspecified', document);

    // Then writing a guess into source as a decorator would promote it to `declared` for good
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'confidence-starvation' });
  });

  it('should stay quiet when the item type was declared', () => {
    // Given
    const document = documentOf([
      operation({
        runtime: {
          streaming: {
            value: { transport: 'sse', itemSchema: { kind: 'named', schemaId: 'OrderEventDto' } },
            confidence: 'declared',
            collector: 'st',
          },
        },
      }),
    ]);

    // When
    const issues = issuesFor('stream-unspecified', document);

    // Then
    expect(issues).toEqual([]);
  });
});

describe('error-undocumented', () => {
  it('should fire when a declared error has no response', () => {
    // Given
    const document = documentOf([
      operation({
        responses: [{ statusCode: '200', content: [] }],
        runtime: {
          errors: {
            declared: [
              {
                status: 404,
                title: 'Not Found',
                origin: 'declared',
                confidence: 'declared',
                collector: 'errorsCollector',
              },
            ],
            runtimeDerived: [],
            global: [],
          },
        },
      }),
    ]);

    // When
    const issue = onlyIssue('error-undocumented', document);

    // Then the source already says it, so the gap is downstream of where a tool may write
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'structural-ambiguity' });
    expect(issue.runtimeValue).toBe('404');
  });

  it('should stay quiet when the declared error has a response', () => {
    // Given
    const document = documentOf([
      operation({
        responses: [{ statusCode: '404', content: [] }],
        runtime: {
          errors: {
            declared: [
              {
                status: 404,
                title: 'Not Found',
                origin: 'declared',
                confidence: 'declared',
                collector: 'errorsCollector',
              },
            ],
            runtimeDerived: [],
            global: [],
          },
        },
      }),
    ]);

    // When
    const issues = issuesFor('error-undocumented', document);

    // Then
    expect(issues).toEqual([]);
  });

  it('should ignore the observed and the global groups, which are not promises', () => {
    // Given a route observed to answer 401 and told to answer 500, documenting neither
    const document = documentOf([
      operation({
        responses: [{ statusCode: '200', content: [] }],
        runtime: {
          errors: {
            declared: [],
            runtimeDerived: [
              {
                status: 401,
                title: 'Unauthorized',
                origin: 'runtime-derived',
                confidence: 'derived',
                collector: 'guardsCollector',
              },
            ],
            global: [
              {
                status: 500,
                title: 'Internal Server Error',
                origin: 'global',
                confidence: 'declared',
                collector: 'errorsCollector',
              },
            ],
          },
        },
      }),
    ]);

    // When
    const issues = issuesFor('error-undocumented', document);

    // Then an observation is not a promise, and a rule keyed on the global group would fire on
    // every operation of the application at once, which is the noise SPEC 7.1 refuses
    expect(issues).toEqual([]);
  });
});

describe('orphan-operation', () => {
  it('should fire on a documented operation the application serves no handler for', () => {
    // Given a pass that found handlers for nothing
    const document = documentOf([operation()]);

    // When
    const issue = onlyIssue('orphan-operation', document, { handledNodeIds: new Set() });

    // Then the only edit would be a deletion, which is how a removed endpoint stops being noticed
    expect(issue.classification).toEqual({ bucket: 'contradiction' });
    expect(issue.edit).toBe('deleted-assertion');
  });

  it('should stay quiet for a handler the document does not describe', () => {
    // Given a document built with `include`, describing one of the application's two controllers.
    // THE ROUTE THE DOCUMENT LEAVES OUT CANNOT REACH THIS RULE, because `DriftObservation` has
    // nowhere to carry it. That is the guarantee, and the assertion below is on the type.
    const document = documentOf([operation()]);

    // When
    const issues = issuesFor('orphan-operation', document, observed(document));

    // Then
    expect(issues).toEqual([]);
    expectTypeOf<keyof DriftObservation>().toEqualTypeOf<'handledNodeIds' | 'guardSchemes'>();
  });

  it('should stay quiet when no pass ran at all', () => {
    // Given a document normalized with no application behind it
    const document = documentOf([operation()]);

    // When
    const issues = issuesFor('orphan-operation', document);

    // Then every operation would otherwise be reported as having no handler
    expect(issues).toEqual([]);
  });
});

describe('missing-description', () => {
  it('should fire when the operation has neither a summary nor a description', () => {
    // Given
    const document = documentOf([operation()]);

    // When
    const issue = onlyIssue('missing-description', document);

    // Then nothing in a runtime knows the sentence a person would write
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'no-observed-fact' });
  });

  it('should stay quiet for an operation carrying only a summary', () => {
    // Given the shape `@ApiOperation({ summary })` produces, which is the ordinary NestJS one
    const document = documentOf([operation({ summary: 'List orders' })]);

    // When
    const issues = issuesFor('missing-description', document);

    // Then a rule firing on every operation of an ordinary document is a panel nobody reads
    expect(issues).toEqual([]);
  });
});

describe('missing-example', () => {
  it('should fire when no body of the operation carries an example', () => {
    // Given
    const document = documentOf([
      operation({ responses: [{ statusCode: '200', content: [JSON_BODY] }] }),
    ]);

    // When
    const issue = onlyIssue('missing-example', document);

    // Then
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'no-observed-fact' });
  });

  it('should stay quiet when a media type carries one', () => {
    // Given
    const document = documentOf([
      operation({
        responses: [
          {
            statusCode: '200',
            content: [{ mediaType: 'application/json', example: { id: 'ord_1' } }],
          },
        ],
      }),
    ]);

    // When
    const issues = issuesFor('missing-example', document);

    // Then
    expect(issues).toEqual([]);
  });

  it('should not ask an operation with no body at all for one', () => {
    // Given a 204
    const document = documentOf([operation({ responses: [{ statusCode: '204', content: [] }] })]);

    // When
    const results = runDriftRules(document);
    const rule = results.find((result) => result.rule === 'missing-example');

    // Then it is out of scope rather than failing, so it is in no denominator
    expect(rule?.total).toBe(0);
  });
});

describe('missing-operation-id', () => {
  it('should fire on the id the generator produced and name the handler in the fix', () => {
    // Given the shape `@nestjs/swagger` writes by default
    const document = documentOf([
      operation({
        rawOperationId: 'OrdersController_list',
        runtime: { source: { controller: 'OrdersController', handler: 'list' } },
      }),
    ]);

    // When
    const issue = onlyIssue('missing-operation-id', document);

    // Then the pair is read literally, so it is a silence a tool could fill
    expect(issue.classification).toEqual({ bucket: 'silence' });
    expect(issue.basis).toEqual({ kind: 'collected', confidence: 'declared' });
    expect(issue.suggestion).toContain("operationId: 'list'");
  });

  it('should have nothing to write when no source was collected', () => {
    // Given the same document with no runtime pass behind it
    const document = documentOf([operation({ rawOperationId: 'OrdersController_list' })]);

    // When
    const issue = onlyIssue('missing-operation-id', document);

    // Then
    expect(issue.classification).toEqual({ bucket: 'manual', reason: 'no-observed-fact' });
  });

  it('should stay quiet for an id somebody wrote by hand', () => {
    // Given
    const document = documentOf([operation({ rawOperationId: 'listOrders' })]);

    // When
    const issues = issuesFor('missing-operation-id', document);

    // Then
    expect(issues).toEqual([]);
  });
});

describe('dto-field-undescribed', () => {
  /** A named schema with two properties, one of them described. */
  const schema: IRSchema = {
    id: 'OrderDto',
    name: 'OrderDto',
    dialect: 'json-schema-2020-12',
    normalized: {
      type: 'object',
      properties: {
        amount: { type: 'integer' },
        currency: { type: 'string', description: 'ISO 4217 code.' },
      },
    },
  };

  it('should fire once per undescribed field and name it with a pointer', () => {
    // Given
    const document = documentOf([], [schema]);

    // When
    const issues = issuesFor('dto-field-undescribed', document);

    // Then
    expect(issues).toHaveLength(1);
    expect(issues[0]?.schemaId).toBe('OrderDto');
    expect(issues[0]?.pointer).toBe('/properties/amount');
    expect(issues[0]?.nodeId).toBeUndefined();
  });

  it('should stay quiet when every field is described', () => {
    // Given
    const described: IRSchema = {
      id: 'CustomerDto',
      dialect: 'json-schema-2020-12',
      normalized: {
        type: 'object',
        properties: { email: { type: 'string', description: 'Where receipts are sent.' } },
      },
    };

    // When
    const issues = issuesFor('dto-field-undescribed', documentOf([], [described]));

    // Then
    expect(issues).toEqual([]);
  });

  it('should treat a field whose schema is a reference as described by its type', () => {
    // Given a property that is nothing but a reference, per SPEC 5.1.1
    const referring: IRSchema = {
      id: 'OrderDto',
      dialect: 'json-schema-2020-12',
      normalized: { type: 'object', properties: { customer: { $ref: 'CustomerDto' } } },
    };

    // When
    const issues = issuesFor('dto-field-undescribed', documentOf([], [referring]));

    // Then reporting it would report one missing sentence once per use site
    expect(issues).toEqual([]);
  });
});

describe('the scope discipline of every rule in the catalogue', () => {
  /**
   * NO RULE ANSWERS `clean` FROM A PATH WHERE ITS SUBJECT WAS NEVER OBSERVED. T035 found two
   * doing exactly that: `security-drift` answered `clean` with no guard to scheme mapping to
   * compare against (finding B1), and `parameter-unread` answered `clean` over a scan that
   * accounted for nothing (finding B2). Both now answer `out-of-scope`, and the maintainer's
   * session 63 instruction is the generalization this sweep pins: `clean` is the verdict the
   * parity scale draws `=` from and the health denominator counts as passed, so it may only come
   * from a rule that examined something. The sweep iterates the catalogue, so a rule added later
   * is asked the same question on the day it lands.
   *
   * THE DEEPER SHAPE OF B1 AND B2, a fact that is present with an observation half that is
   * empty, has no general construction: `unaccounted` is a vocabulary only `parameterReads`
   * carries, and a second observation channel is something only `security-drift` has. Those two
   * paths stay pinned one by one, in `rule-codes.spec.ts` and `sp-rules.spec.ts`.
   */
  it('should never answer clean about the bare operation nothing was observed about', () => {
    // Given the bare operation, carrying no runtime fact, asked with no observation at all
    const bare = operation();

    // When every rule of the catalogue is asked
    const answered = OPERATION_DRIFT_RULES.map((rule) => ({
      rule: rule.id,
      outcome: operationRuleOutcome(bare, rule.id),
    }));

    // Then no rule claims it examined something and found it fine. A rule about the document's
    // own text may find, since the text is in hand, and every other rule is out of scope.
    expect(answered.length).toBeGreaterThan(0);
    expect(answered.filter((entry) => entry.outcome === 'clean')).toEqual([]);
  });

  it('should never answer clean when the pass that ran observed nothing about the operation', () => {
    // Given the same bare operation and a pass that really ran, finding no handler and no mapping
    const bare = operation();
    const emptyPass: DriftObservation = { handledNodeIds: new Set() };

    // When every rule of the catalogue is asked with that observation
    const answered = OPERATION_DRIFT_RULES.map((rule) => ({
      rule: rule.id,
      outcome: operationRuleOutcome(bare, rule.id, emptyPass),
    }));

    // Then an empty pass is a real report of absence, so `orphan-operation` may find, and still
    // nothing answers clean
    expect(answered.filter((entry) => entry.outcome === 'clean')).toEqual([]);
  });
});

describe('the classification of every rule in SPEC 7.1', () => {
  it('should be computed from the finding and never read off the rule id', () => {
    // Given every finding this suite can produce, from documents in every state above
    const documents: readonly IRDocument[] = [
      documentOf([
        operation({
          runtime: {
            guards: [
              { name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'g' },
            ],
          },
        }),
      ]),
      documentOf([
        operation({
          security: [{ schemeId: 'bearer', scopes: [] }],
          runtime: { scopes: { value: ['orders:read'], confidence: 'derived', collector: 's' } },
        }),
      ]),
      documentOf(
        [operation()],
        [
          {
            id: 'OrderDto',
            dialect: 'json-schema-2020-12',
            normalized: { type: 'object', properties: { amount: { type: 'integer' } } },
          },
        ],
      ),
    ];

    // When
    const issues = documents.flatMap((document) => [
      ...collectDrift(document, { handledNodeIds: new Set() }),
    ]);

    // Then. THIS IS THE ASSERTION THAT A TABLE FROM RULE ID TO BUCKET CANNOT HAVE BEEN USED: every
    // bucket recomputes from the two things the finding carries, and neither of them is a rule id.
    expect(issues.length).toBeGreaterThan(0);
    for (const issue of issues) {
      expect(issue.classification).toEqual(classifyDrift(issue.edit, issue.basis));
    }
  });

  it('should give one rule two buckets in a single run', () => {
    // Given two operations, one documenting no 429 and one documenting a disagreeing limit
    const document = documentOf([
      operation({
        id: 'get-orders',
        runtime: {
          rateLimit: { value: { limit: 30, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
        },
      }),
      operation({
        id: 'post-orders',
        method: 'post',
        responses: [
          {
            statusCode: '429',
            content: [],
            headers: [
              {
                name: 'X-RateLimit-Limit',
                required: false,
                schema: {
                  kind: 'inline',
                  schema: {
                    id: 'limit',
                    dialect: 'json-schema-2020-12',
                    normalized: { type: 'integer', const: 5 },
                  },
                },
              },
            ],
          },
        ],
        runtime: {
          rateLimit: { value: { limit: 30, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
        },
      }),
    ]);

    // When
    const issues = issuesFor('ratelimit-undocumented', document);

    // Then
    expect(issues.map((issue) => issue.classification.bucket)).toEqual([
      'silence',
      'contradiction',
    ]);
  });
});

describe('classifyDrift', () => {
  it('should judge a contradiction before it looks at confidence', () => {
    // Given a conflicting assertion resting on a guess
    // When
    const classification = classifyDrift('conflicting-assertion', {
      kind: 'collected',
      confidence: 'inferred',
    });

    // Then. SPEC 7.4 says a contradiction is never auto-fixable at any confidence, ever, and
    // `confidence-starvation` is the one bucket a better collector is allowed to empty.
    expect(classification).toEqual({ bucket: 'contradiction' });
  });

  it('should refuse to call a silence anything a collector did not observe', () => {
    // Given
    // When
    const classification = classifyDrift('new-assertion', { kind: 'unobserved' });

    // Then
    expect(classification).toEqual({ bucket: 'manual', reason: 'no-observed-fact' });
  });
});

describe('isMechanicallyFixable', () => {
  it('should admit only a silence resting on a fact at derived confidence or above', () => {
    // Given
    // When
    // Then
    expect(
      isMechanicallyFixable({ bucket: 'silence' }, { kind: 'collected', confidence: 'derived' }),
    ).toBe(true);
    expect(
      isMechanicallyFixable({ bucket: 'silence' }, { kind: 'collected', confidence: 'inferred' }),
    ).toBe(false);
    expect(
      isMechanicallyFixable(
        { bucket: 'contradiction' },
        { kind: 'collected', confidence: 'declared' },
      ),
    ).toBe(false);
    expect(isMechanicallyFixable({ bucket: 'silence' }, { kind: 'unobserved' })).toBe(false);
  });
});

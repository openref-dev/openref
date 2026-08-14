import { describe, expect, it } from 'vitest';
import {
  isMechanicallyFixable,
  runDriftRules,
  type IRDocument,
  type IRDriftIssue,
  type IRDriftRule,
  type IRNode,
  type IROperation,
  type IRParameter,
  type IRParameterRead,
  type IRSchema,
} from '../../src/index';

/**
 * The three SP rules of SPEC 7.1, built in TX-COLLECTORS: the specification asserting what the
 * runtime does not do.
 *
 * WHAT IS PINNED HARDEST IS THE SCAN'S DISCIPLINE ON `parameter-unread`: a finding on
 * `not-seen-read`, never on `unaccounted`, and a header the `requiredHeaders` fact names counts
 * as read, because the guard reading it is the application reading it. And on every rule, the
 * bucket per SPEC 7.4: which findings a fix mode may never touch is the product's own promise.
 */

/** The bare operation every fixture starts from. */
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

/** One declared parameter, with the serialization defaults of its location. */
function parameter(
  overrides: Partial<IRParameter> & Pick<IRParameter, 'name' | 'in'>,
): IRParameter {
  return {
    required: false,
    style: overrides.in === 'query' ? 'form' : 'simple',
    explode: overrides.in === 'query',
    ...overrides,
  };
}

/** A document holding the given nodes. */
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

/** The result one rule produced over one document. */
function resultOf(rule: IRDriftRule, document: IRDocument) {
  const found = runDriftRules(document).find((result) => result.rule === rule);
  if (found === undefined) throw new Error(`the rule ${rule} is not in the catalogue`);

  return found;
}

/** A parameterReads fact over the given verdicts, at inferred, as the scan emits it. */
function reads(parameters: readonly IRParameterRead[]) {
  return {
    value: { parameters },
    confidence: 'inferred' as const,
    collector: 'handlerScanCollector',
  };
}

describe('parameter-unread', () => {
  it('should stay out of scope without the fact, since a blind scan says nothing', () => {
    // Given an operation with declared parameters and no scan fact
    const document = documentOf([
      operation({ parameters: [parameter({ name: 'sort', in: 'query' })] }),
    ]);

    // When
    const result = resultOf('parameter-unread', document);

    // Then it is not in the denominator, per SPEC 7.1's scope
    expect(result.total).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it('should stay quiet when every declared parameter was seen read', () => {
    // Given
    const document = documentOf([
      operation({
        parameters: [parameter({ name: 'sort', in: 'query' })],
        runtime: { parameterReads: reads([{ in: 'query', name: 'sort', verdict: 'read' }]) },
      }),
    ]);

    // When
    const result = resultOf('parameter-unread', document);

    // Then
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });

  it('should report not-seen-read parameters as a contradiction at inferred', () => {
    // Given two declarations the scan accounted for and did not see read
    const document = documentOf([
      operation({
        parameters: [
          parameter({ name: 'sort', in: 'query' }),
          parameter({ name: 'page', in: 'query' }),
        ],
        runtime: {
          parameterReads: reads([
            { in: 'query', name: 'sort', verdict: 'not-seen-read' },
            { in: 'query', name: 'page', verdict: 'not-seen-read' },
          ]),
        },
      }),
    ]);

    // When
    const issue: IRDriftIssue | undefined = resultOf('parameter-unread', document).issues[0];

    // Then one finding names both, and the edit that would satisfy it deletes an assertion, so
    // it is a contradiction and no fix mode touches it at any confidence
    expect(issue?.runtimeValue).toBe('not seen read: query sort, query page');
    expect(issue?.edit).toBe('deleted-assertion');
    expect(issue?.classification).toEqual({ bucket: 'contradiction' });
    expect(issue?.basis).toEqual({ kind: 'collected', confidence: 'inferred' });
    if (issue !== undefined) {
      expect(isMechanicallyFixable(issue.classification, issue.basis)).toBe(false);
    }
  });

  it('should never fire on unaccounted, which is the scan speaking about itself', () => {
    // Given a location the scan could not follow
    const document = documentOf([
      operation({
        parameters: [parameter({ name: 'session', in: 'cookie' })],
        runtime: {
          parameterReads: reads([{ in: 'cookie', name: 'session', verdict: 'unaccounted' }]),
        },
      }),
    ]);

    // When
    const result = resultOf('parameter-unread', document);

    // Then examined and quiet: the absence of sight is not an absence of reading
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });

  it('should take a header the requiredHeaders fact names as read, case insensitively', () => {
    // Given a header the handler never binds and the guard metadata requires
    const document = documentOf([
      operation({
        parameters: [parameter({ name: 'X-Internal-Token', in: 'header' })],
        runtime: {
          parameterReads: reads([
            { in: 'header', name: 'X-Internal-Token', verdict: 'not-seen-read' },
          ]),
          requiredHeaders: {
            value: ['x-internal-token'],
            confidence: 'inferred',
            collector: 'headersCollector',
          },
        },
      }),
    ]);

    // When
    const result = resultOf('parameter-unread', document);

    // Then the guard reading it is the application reading it
    expect(result.passed).toBe(1);
    expect(result.issues).toEqual([]);
  });
});

describe('header-requiredness-drift', () => {
  const fact = {
    value: ['X-Internal-Token'],
    confidence: 'inferred' as const,
    collector: 'headersCollector',
  };

  it('should stay out of scope without the fact', () => {
    // Given
    const document = documentOf([
      operation({ parameters: [parameter({ name: 'X-Internal-Token', in: 'header' })] }),
    ]);

    // When, Then
    expect(resultOf('header-requiredness-drift', document).total).toBe(0);
  });

  it('should stay quiet when the required header is documented required, case insensitively', () => {
    // Given the document's own spelling differing in case
    const document = documentOf([
      operation({
        parameters: [parameter({ name: 'x-internal-token', in: 'header', required: true })],
        runtime: { requiredHeaders: fact },
      }),
    ]);

    // When
    const result = resultOf('header-requiredness-drift', document);

    // Then
    expect(result.total).toBe(1);
    expect(result.passed).toBe(1);
  });

  it('should report a header documented optional as a contradiction', () => {
    // Given `required: false`, which is an assertion the runtime contradicts
    const document = documentOf([
      operation({
        parameters: [parameter({ name: 'X-Internal-Token', in: 'header', required: false })],
        runtime: { requiredHeaders: fact },
      }),
    ]);

    // When
    const issue = resultOf('header-requiredness-drift', document).issues[0];

    // Then never auto-fixed, at any confidence
    expect(issue?.edit).toBe('conflicting-assertion');
    expect(issue?.classification).toEqual({ bucket: 'contradiction' });
    expect(issue?.specValue).toBe('X-Internal-Token: required false');
  });

  it('should report an undeclared required header as a new assertion the classifier holds back', () => {
    // Given a header the specification does not carry at all
    const document = documentOf([operation({ runtime: { requiredHeaders: fact } })]);

    // When
    const issue = resultOf('header-requiredness-drift', document).issues[0];

    // Then the edit is a silence shape, and the `inferred` basis is what keeps `--fix` away:
    // confidence starvation, per SPEC 7.4, which a better collector may one day empty
    expect(issue?.edit).toBe('new-assertion');
    expect(issue?.classification).toEqual({
      bucket: 'manual',
      reason: 'confidence-starvation',
    });
    expect(issue?.suggestion).toContain("@ApiHeader({ name: 'X-Internal-Token'");
  });
});

describe('status-drift', () => {
  const fact = { value: 204, confidence: 'derived' as const, collector: 'httpCodeCollector' };

  it('should stay out of scope without the fact, so framework defaults never fire it', () => {
    // Given an ordinary POST with no decorator
    const document = documentOf([operation({ method: 'post' })]);

    // When, Then
    expect(resultOf('status-drift', document).total).toBe(0);
  });

  it('should stay quiet when the explicit code is documented, or default is', () => {
    // Given
    const documented = documentOf([
      operation({
        responses: [{ statusCode: '204', content: [] }],
        runtime: { statusCode: fact },
      }),
    ]);
    const fallback = documentOf([
      operation({
        responses: [{ statusCode: 'default', content: [] }],
        runtime: { statusCode: fact },
      }),
    ]);

    // When, Then
    expect(resultOf('status-drift', documented).passed).toBe(1);
    expect(resultOf('status-drift', fallback).passed).toBe(1);
  });

  it('should report a different documented success as a contradiction', () => {
    // Given `@HttpCode(204)` beside a documented 200
    const document = documentOf([
      operation({
        responses: [{ statusCode: '200', content: [] }],
        runtime: { statusCode: fact },
      }),
    ]);

    // When
    const issue = resultOf('status-drift', document).issues[0];

    // Then
    expect(issue?.runtimeValue).toBe('@HttpCode(204)');
    expect(issue?.specValue).toBe('200');
    expect(issue?.edit).toBe('conflicting-assertion');
    expect(issue?.classification).toEqual({ bucket: 'contradiction' });
  });

  it('should report an undocumented code with no success as the one fixable silence here', () => {
    // Given no success response at all
    const document = documentOf([
      operation({
        responses: [{ statusCode: '404', content: [] }],
        runtime: { statusCode: fact },
      }),
    ]);

    // When
    const issue = resultOf('status-drift', document).issues[0];

    // Then a silence at `derived`: the observed fact may be written where nothing stands
    expect(issue?.edit).toBe('new-assertion');
    expect(issue?.classification).toEqual({ bucket: 'silence' });
    expect(issue?.suggestion).toContain('@ApiResponse({ status: 204 })');
    if (issue !== undefined) {
      expect(isMechanicallyFixable(issue.classification, issue.basis)).toBe(true);
    }
  });
});

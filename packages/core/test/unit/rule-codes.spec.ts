import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DRIFT_RULE_CODES,
  operationRuleOutcome,
  runDriftRules,
  type IROperation,
} from '../../src/index';

/**
 * The display codes of SPEC 7.1 and the render time outcome, per `TX-GUTTER`.
 *
 * THE TABLE IN SPEC IS THE SPECIFICATION AND THIS FILE HOLDS THE CODE TO IT. A code that lives
 * only in source is a code nobody can cite, so the maintainer's decision put the mapping in
 * SPEC 7.1 beside the rules; a mapping written twice is a mapping that drifts, so the test
 * reads the SPEC table and requires the constant to be exactly it, both ways.
 */

const SPEC = join(import.meta.dirname, '..', '..', '..', '..', 'ai-docs', 'SPEC.md');

/** The `| `CODE` | `rule` |` rows of the SPEC 7.1 table, as a record. */
function specTable(): Record<string, string> {
  const text = readFileSync(SPEC, 'utf8');
  const rows = [...text.matchAll(/^\| `([A-Z]{2}\d{3})` \| `([a-z-]+)` \|$/gm)];
  return Object.fromEntries(rows.map((row) => [row[2] ?? '', row[1] ?? '']));
}

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

describe('DRIFT_RULE_CODES', () => {
  it('should be exactly the table SPEC 7.1 carries, in both directions', () => {
    // Given
    const documented = specTable();

    // Then, an entry in either place with no twin in the other is a drift between the product
    // and its own specification, which is the defect class this product exists to report.
    expect(DRIFT_RULE_CODES).toEqual(documented);
  });

  it('should assign codes in catalogue order with gaps of ten, so relatives can land nearby', () => {
    // Given
    const codes = Object.values(DRIFT_RULE_CODES);

    // Then every code is a group prefix and a number, the numbers are multiples of ten, and no
    // code repeats: the gap is what lets a later rule related to an existing one take a
    // neighbouring number instead of the end of the list.
    for (const code of codes) {
      expect(code).toMatch(/^(RT|SP|SC|DX)\d{3}$/);
      expect(Number(code.slice(2)) % 10).toBe(0);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe('operationRuleOutcome', () => {
  it('should answer out-of-scope where the rule does not apply', () => {
    // Given an operation with no guards
    const subject = operation();

    // When
    const outcome = operationRuleOutcome(subject, 'security-drift');

    // Then
    expect(outcome).toBe('out-of-scope');
  });

  it('should answer clean where the rule looked and stayed quiet', () => {
    // Given a described operation, which missing-description examines and passes
    const subject = operation({ summary: 'Lists the orders' });

    // When
    const outcome = operationRuleOutcome(subject, 'missing-description');

    // Then
    expect(outcome).toBe('clean');
  });

  it('should answer finding exactly where the engine records one', () => {
    // Given a guarded operation whose specification asserts no security
    const subject = operation({
      runtime: {
        guards: [
          { name: 'JwtAuthGuard', scope: 'route', confidence: 'declared', collector: 'guards' },
        ],
      },
    });

    // When
    const outcome = operationRuleOutcome(subject, 'security-drift');

    // Then
    expect(outcome).toBe('finding');
  });

  it('should agree with runDriftRules about scope, so no second predicate exists to drift', () => {
    // Given an operation inside a document
    const subject = operation({ summary: 'Lists the orders' });
    const document = {
      id: 'orders',
      kind: 'http' as const,
      hash: '',
      info: { title: 'Orders', version: '1.0.0' },
      servers: [],
      navigation: [],
      nodes: new Map([[subject.id, subject]]),
      schemas: new Map(),
      security: [],
      relationships: [],
      webhooks: new Map(),
    };

    // When the engine runs and the outcome is asked per rule
    const results = runDriftRules(document);

    // Then a rule that counted the operation answers clean or finding, and a rule that did not
    // count it answers out of scope, for every operation rule at once.
    for (const result of results) {
      if (result.rule === 'dto-field-undescribed') continue;

      const outcome = operationRuleOutcome(subject, result.rule);
      if (result.total === 0) expect(outcome).toBe('out-of-scope');
      else expect(['clean', 'finding']).toContain(outcome);
    }
  });

  it('should answer out-of-scope for the rule whose subject is not an operation', () => {
    // Given
    const subject = operation();

    // When
    const outcome = operationRuleOutcome(subject, 'dto-field-undescribed');

    // Then
    expect(outcome).toBe('out-of-scope');
  });
});

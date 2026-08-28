import { existsSync, readFileSync } from 'node:fs';
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

/**
 * Whether the maintainer's private documents are in this checkout.
 *
 * `ai-docs/` IS GIT EXCLUDED, SO CI NEVER HAS IT, and until the pre-M4 review this file read
 * SPEC.md unconditionally. Measured by moving the directory aside and running the suite: this case
 * threw `ENOENT` and took the whole run red, which means `pnpm test` and the coverage gate behind
 * it were red on every checkout but one. A case that cannot see its subject skips and says so; it
 * does not fail, and it does not quietly pass either, which is what the `it.skipIf` idiom this
 * repository already uses for the demo application is for.
 */
const HAVE_SPEC = existsSync(SPEC);

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
  it.skipIf(!HAVE_SPEC)('should be exactly the table SPEC 7.1 carries, in both directions', () => {
    // Given
    const documented = specTable();

    // Then, an entry in either place with no twin in the other is a drift between the product
    // and its own specification, which is the defect class this product exists to report.
    expect(DRIFT_RULE_CODES).toEqual(documented);
  });

  it('should assign codes in catalogue order with gaps of ten, so relatives can land nearby', () => {
    // Given
    const codes = Object.values(DRIFT_RULE_CODES);

    // Then every code is a group prefix and a number and no code repeats. The numbers are NOT
    // asserted to be multiples of ten, and that assertion used to stand here: the gap of ten
    // exists so a later rule related to an existing one can take a neighbouring number, which
    // is exactly what SP011 and SP012 did in TX-COLLECTORS, so a test requiring round numbers
    // forbade the mechanism the gap is for.
    for (const code of codes) {
      expect(code).toMatch(/^(RT|SP|SC|DX)\d{3}$/);
    }
    expect(new Set(codes).size).toBe(codes.length);

    // And within each group the numbers ascend in catalogue order, which is the half of the
    // rule that must hold whatever number a relative takes.
    const grouped = new Map<string, number[]>();
    for (const code of codes) {
      const group = code.slice(0, 2);
      grouped.set(group, [...(grouped.get(group) ?? []), Number(code.slice(2))]);
    }
    for (const numbers of grouped.values()) {
      expect(numbers).toEqual([...numbers].sort((left, right) => left - right));
    }
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

describe('a rule that could not compare, at the moment a renderer re-asks it', () => {
  it('should answer out-of-scope for security-drift with no guard to scheme mapping', () => {
    // Given an operation with a guard and a declared security requirement, and no observation,
    // which is exactly how `buildParityRows` re-asks every rule
    const guarded = operation({
      security: [{ schemeId: 'bearer', scopes: [] }],
      runtime: {
        guards: [
          {
            name: 'AuthGuard',
            scope: 'route',
            confidence: 'derived',
            collector: 'guardsCollector',
          },
        ],
      },
    });

    // When the renderer asks without an observation
    const outcome = operationRuleOutcome(guarded, 'security-drift');

    // Then it says it did not look. It answered `clean` until T035, and the parity scale reads
    // `clean` as "a rule examined this and stayed quiet", so the authentication row drew `=` with
    // `aria-label="match"` over a comparison of scheme identity that never happened, on every
    // operation carrying a guard and a requirement.
    expect(outcome).toBe('out-of-scope');
  });

  it('should still compare when a mapping was observed', () => {
    // Given the same operation and an observation naming what the guard maps to
    const guarded = operation({
      security: [{ schemeId: 'bearer', scopes: [] }],
      runtime: {
        guards: [
          {
            name: 'AuthGuard',
            scope: 'route',
            confidence: 'derived',
            collector: 'guardsCollector',
          },
        ],
      },
    });

    // When the report asks, which is the caller that has one
    const outcome = operationRuleOutcome(guarded, 'security-drift', {
      handledNodeIds: new Set<string>(),
      guardSchemes: new Map([['AuthGuard', 'bearer']]),
    });

    // Then the comparison ran and agreed, and `=` there is earned
    expect(outcome).toBe('clean');
  });
});

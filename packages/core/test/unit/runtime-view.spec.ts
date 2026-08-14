import { describe, expect, it } from 'vitest';
import {
  hasRuntimeFacts,
  RUNTIME_FACT_FIELDS,
  type IRDriftIssue,
  type IRNodeRuntime,
} from '../../src/index';
import type { RUNTIME_FIELDS_ARE_PARTITIONED } from '../../src/runtime/domain/runtime-view';

/**
 * Whether there is anything to draw, per SPEC 6.3.
 *
 * The predicate has one home because two packages ask it: the renderer decides whether to emit
 * the runtime block, and `useRuntime` in `@openref/vue` lets a theme decide the same about its
 * own markup. What is asserted here is the boundary the two would otherwise disagree about, which
 * is not "does this node have guards" but "was anybody asked".
 */

const finding: IRDriftIssue = {
  rule: 'missing-description',
  severity: 'warning',
  nodeId: 'get-orders',
  message: 'no summary and no description',
  suggestion: 'add @ApiOperation({ summary })',
  classification: { bucket: 'manual', reason: 'no-observed-fact' },
  edit: 'nothing-to-write',
  basis: { kind: 'unobserved' },
};

describe('hasRuntimeFacts', () => {
  it('should report nothing to draw when no collector reached the node', () => {
    // Given, the ordinary state of a reference mounted on a plain @nestjs/swagger document
    const runtime = undefined;

    // When
    const result = hasRuntimeFacts(runtime);

    // Then
    expect(result).toBe(false);
  });

  it('should report nothing to draw for a record carrying findings and no facts', () => {
    // Given, a finding is a statement about two documents disagreeing, not an observation of the
    // application, so a node with nothing but findings has nothing to put in a runtime block.
    const runtime: IRNodeRuntime = { drift: [finding] };

    // When
    const result = hasRuntimeFacts(runtime);

    // Then
    expect(result).toBe(false);
  });

  it('should report something to draw for an errors record whose groups are all empty', () => {
    // Given, SPEC 6.4: the field being present means a collector examined the route. An empty
    // declared group is the assertion that nobody declared anything, which is a sentence worth
    // printing, and it is a different claim from the field being absent.
    const runtime: IRNodeRuntime = { errors: { declared: [], runtimeDerived: [], global: [] } };

    // When
    const result = hasRuntimeFacts(runtime);

    // Then
    expect(result).toBe(true);
  });

  it('should report something to draw for every fact valued field on its own', () => {
    // Given, one record per field, each carrying only that field
    const records: Readonly<Record<string, IRNodeRuntime>> = {
      source: { source: { controller: 'OrdersController', handler: 'findAll' } },
      guards: {
        guards: [
          { name: 'JwtAuthGuard', scope: 'route', confidence: 'derived', collector: 'guards' },
        ],
      },
      scopes: { scopes: { value: ['orders:read'], confidence: 'declared', collector: 'scopes' } },
      roles: { roles: { value: ['admin'], confidence: 'derived', collector: 'roles' } },
      rateLimit: {
        rateLimit: { value: { limit: 100, ttlMs: 60_000 }, confidence: 'derived', collector: 't' },
      },
      errors: { errors: { declared: [], runtimeDerived: [], global: [] } },
      streaming: {
        streaming: { value: { transport: 'sse' }, confidence: 'declared', collector: 's' },
      },
    };

    // When
    const missed = RUNTIME_FACT_FIELDS.filter((field) => !hasRuntimeFacts(records[field]));

    // Then
    expect(missed).toEqual([]);
  });

  it('should name every field of the record as a fact or as drift, at compile time', () => {
    // Given, the partition is a type and not a list this test retypes: a field added to
    // IRNodeRuntime and not named in RUNTIME_FACT_FIELDS makes the alias below `never`, so the
    // assignment stops compiling. That is what catches a fact the runtime block would refuse to
    // draw, which is a defect no assertion over today's fields could see.
    const partitioned: RUNTIME_FIELDS_ARE_PARTITIONED = true;

    // When
    const fields = [...RUNTIME_FACT_FIELDS];

    // Then
    expect(partitioned).toBe(true);
    expect(fields).not.toContain('drift');
  });
});

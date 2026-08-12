import { describe, expect, it } from 'vitest';
import type { IRErrorContract, IRNodeRuntime } from '../../src/index';
import {
  deriveRuntimeErrorContracts,
  EMPTY_ERROR_CONTRACTS,
  errorContractGroup,
  groupErrorContracts,
  hasErrorContracts,
  problemDetailsSchema,
  PROBLEM_JSON_MEDIA_TYPE,
  withRuntimeErrorContracts,
} from '../../src/index';

/**
 * SPEC 6.4, the half of it that is pure: the RFC 9457 shape and the derivation over merged facts.
 *
 * WHAT THIS FILE IS REALLY GUARDING IS THE REFUSALS. Deriving 429 from a rate limit is four lines
 * and could hardly be got wrong; deriving it from nothing, or deriving an endpoint's error list
 * from an exception filter, is what SPEC 6.1 forbids and what a later session will be tempted to
 * add because a panel looks empty. So every rule below is paired with the case where the fact it
 * reads is absent, and those cases are the ones that matter.
 */

/** A contract, with everything the assertions do not care about filled in. */
function contract(overrides: Partial<IRErrorContract> = {}): IRErrorContract {
  return {
    status: 404,
    title: 'Not Found',
    origin: 'declared',
    confidence: 'declared',
    collector: 'errorsCollector',
    ...overrides,
  };
}

describe('errorContractGroup', () => {
  it('should map every origin onto a field of the record, with nothing left over', () => {
    // Given the three origins SPEC 6.4 admits
    // Then, and this is the one translation between the two spellings of a group
    expect(errorContractGroup('declared')).toBe('declared');
    expect(errorContractGroup('runtime-derived')).toBe('runtimeDerived');
    expect(errorContractGroup('global')).toBe('global');
  });
});

describe('groupErrorContracts', () => {
  it('should sort contracts into the three groups by their own origin', () => {
    // Given one of each, deliberately out of order
    const contracts = [
      contract({ status: 500, origin: 'global', title: 'Server Error' }),
      contract({ status: 429, origin: 'runtime-derived', title: 'Too Many Requests' }),
      contract({ status: 404, origin: 'declared', title: 'Not Found' }),
    ];

    // When
    const grouped = groupErrorContracts(contracts);

    // Then
    expect(grouped.declared.map((one) => one.status)).toEqual([404]);
    expect(grouped.runtimeDerived.map((one) => one.status)).toEqual([429]);
    expect(grouped.global.map((one) => one.status)).toEqual([500]);
  });

  it('should put every member of a group in the group its origin names', () => {
    // Given. THE REDUNDANCY BETWEEN `origin` AND THE FIELD IS WHAT THIS PINS. A contract carries
    // its origin so it can travel alone, in a drift finding for instance, and the two spellings
    // are only safe while they cannot disagree.
    const grouped = groupErrorContracts([
      contract({ origin: 'declared' }),
      contract({ origin: 'runtime-derived' }),
      contract({ origin: 'global' }),
      contract({ origin: 'declared', status: 409 }),
    ]);

    // Then
    for (const one of grouped.declared) expect(one.origin).toBe('declared');
    for (const one of grouped.runtimeDerived) expect(one.origin).toBe('runtime-derived');
    for (const one of grouped.global) expect(one.origin).toBe('global');
  });

  it('should keep the arrival order inside each group', () => {
    // Given two declarations on one route
    const grouped = groupErrorContracts([
      contract({ status: 404, title: 'Not Found' }),
      contract({ status: 409, title: 'Conflict' }),
    ]);

    // Then the order somebody wrote them in survives, since that is the only order there is
    expect(grouped.declared.map((one) => one.title)).toEqual(['Not Found', 'Conflict']);
  });

  it('should give three empty groups for no contracts at all', () => {
    // When
    const grouped = groupErrorContracts([]);

    // Then
    expect(grouped).toEqual(EMPTY_ERROR_CONTRACTS);
    expect(hasErrorContracts(grouped)).toBe(false);
  });
});

describe('problemDetailsSchema', () => {
  it('should name the media type RFC 9457 defines, once', () => {
    // Then
    expect(PROBLEM_JSON_MEDIA_TYPE).toBe('application/problem+json');
  });

  it('should carry the five members of RFC 9457 and require none of them', () => {
    // Given no contract, which is the format itself rather than one use of it
    const schema = problemDetailsSchema();

    // Then. SECTION 3.1 OF THE RFC SAYS A CONSUMER MUST NOT RELY ON ANY MEMBER BEING PRESENT, so
    // a schema marking `status` required would describe something stricter than the media type.
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual([
      'detail',
      'instance',
      'status',
      'title',
      'type',
    ]);
    expect(schema.required).toBeUndefined();
    expect(schema.additionalProperties).toBe(true);
  });

  it('should pin the members a contract already states, and only those', () => {
    // Given a contract with no `type` and no `detail`
    const schema = problemDetailsSchema(contract({ status: 409, title: 'Conflict' }));

    // Then the two it states are constants, because that is a restatement of the declaration
    expect(schema.properties?.status?.const).toBe(409);
    expect(schema.properties?.title?.const).toBe('Conflict');

    // And the two it does not state are left open rather than filled in with a plausible value
    expect(schema.properties?.type?.const).toBeUndefined();
    expect(schema.properties?.detail?.const).toBeUndefined();
  });
});

describe('deriveRuntimeErrorContracts', () => {
  it('should derive 429 from a rate limit, naming the collector that supplied it', () => {
    // Given a route the throttler collector reported a limit for
    const runtime: IRNodeRuntime = {
      rateLimit: {
        value: { limit: 30, ttlMs: 60_000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
    };

    // When
    const derived = deriveRuntimeErrorContracts(runtime);

    // Then. THE COLLECTOR IS THE ONE THAT HAD THE FACT, not the derivation: a reader who wants to
    // know why 429 is here is looking for the throttler, which is the thing that can show them.
    expect(derived).toHaveLength(1);
    expect(derived[0]?.status).toBe(429);
    expect(derived[0]?.origin).toBe('runtime-derived');
    expect(derived[0]?.confidence).toBe('derived');
    expect(derived[0]?.collector).toBe('throttlerCollector');
    expect(derived[0]?.detail).toContain('30');
    expect(derived[0]?.detail).toContain('60000 ms');
  });

  it('should derive 401 and 403 from guards, and say nothing about what a guard decides', () => {
    // Given a guarded route
    const runtime: IRNodeRuntime = {
      guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' }],
    };

    // When
    const derived = deriveRuntimeErrorContracts(runtime);

    // Then both, at `derived`, attributed to the collector that named the guard
    expect(derived.map((one) => one.status)).toEqual([401, 403]);
    for (const one of derived) {
      expect(one.origin).toBe('runtime-derived');
      expect(one.confidence).toBe('derived');
      expect(one.collector).toBe('guardsCollector');
      expect(one.detail).toContain('ScopesGuard');
      // SPEC 6.1's first prohibition, stated in the text a reader sees rather than only in a
      // comment: what the guard decides is in its code and is never read.
      expect(one.detail).toContain('never read');
    }
  });

  it('should derive nothing at all from a node with no rate limit and no guards', () => {
    // Given a route about which the collectors found source and a scope and nothing else
    const runtime: IRNodeRuntime = {
      source: { controller: 'OrdersController', handler: 'page' },
      scopes: {
        value: ['orders:read'],
        confidence: 'declared',
        collector: 'declarationsCollector',
      },
    };

    // When, Then. An endpoint does not answer 401 because the application has guards somewhere.
    expect(deriveRuntimeErrorContracts(runtime)).toEqual([]);
  });

  it('should derive both rules at once when both facts are present', () => {
    // Given a throttled route behind a guard, which is the example application's listing route
    const runtime: IRNodeRuntime = {
      guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' }],
      rateLimit: {
        value: { limit: 30, ttlMs: 60_000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
    };

    // When, Then
    expect(deriveRuntimeErrorContracts(runtime).map((one) => one.status)).toEqual([429, 401, 403]);
  });

  it('should give every derived contract the RFC 9457 body', () => {
    // Given
    const runtime: IRNodeRuntime = {
      rateLimit: {
        value: { limit: 1, ttlMs: 1000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
    };

    // When
    const [only] = deriveRuntimeErrorContracts(runtime);

    // Then the format is one format for all three groups, per SPEC 6.4
    expect(only?.schema?.kind).toBe('inline');
    expect(only?.schema?.kind === 'inline' ? only.schema.schema.normalized?.title : '').toBe(
      'Problem Details',
    );
  });
});

describe('withRuntimeErrorContracts', () => {
  it('should fill the runtime derived group and leave the other two alone', () => {
    // Given a node an error collector already examined
    const runtime: IRNodeRuntime = {
      guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' }],
      errors: {
        declared: [contract({ status: 404 })],
        runtimeDerived: [],
        global: [contract({ status: 500, origin: 'global', title: 'Server Error' })],
      },
    };

    // When
    const withDerived = withRuntimeErrorContracts(runtime);

    // Then the two groups somebody wrote are carried across untouched
    expect(withDerived.errors?.declared.map((one) => one.status)).toEqual([404]);
    expect(withDerived.errors?.global.map((one) => one.status)).toEqual([500]);
    expect(withDerived.errors?.runtimeDerived.map((one) => one.status)).toEqual([401, 403]);
  });

  it('should never merge the three groups into one list', () => {
    // Given a node carrying a member of each group
    const runtime: IRNodeRuntime = {
      rateLimit: {
        value: { limit: 5, ttlMs: 1000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
      errors: {
        declared: [contract({ status: 404 })],
        runtimeDerived: [],
        global: [contract({ status: 500, origin: 'global', title: 'Server Error' })],
      },
    };

    // When
    const groups = withRuntimeErrorContracts(runtime).errors;

    // Then. THE STRUCTURE IS THE ASSERTION: there is no array anywhere in the result that holds
    // members of two groups, and there is no field a reader could mistake for one.
    expect(Object.keys(groups ?? {}).sort()).toEqual(['declared', 'global', 'runtimeDerived']);
    expect(groups?.declared.every((one) => one.origin === 'declared')).toBe(true);
    expect(groups?.runtimeDerived.every((one) => one.origin === 'runtime-derived')).toBe(true);
    expect(groups?.global.every((one) => one.origin === 'global')).toBe(true);
  });

  it('should leave a node with no errors record untouched, however many facts it carries', () => {
    // Given a guarded and throttled route in an application that never registered an error
    // collector. NOTHING ASKED ABOUT ERRORS HERE, so writing a record would put an empty
    // `declared` group on the node, and an empty declared group is a claim: examined, nothing
    // declared. Deriving would make that claim on behalf of a collector that never ran.
    const runtime: IRNodeRuntime = {
      guards: [{ name: 'ScopesGuard', scope: 'route', confidence: 'derived', collector: 'guardsCollector' }],
      rateLimit: {
        value: { limit: 30, ttlMs: 60_000 },
        confidence: 'derived',
        collector: 'throttlerCollector',
      },
    };

    // When, Then
    expect(withRuntimeErrorContracts(runtime)).toBe(runtime);
    expect(withRuntimeErrorContracts(runtime).errors).toBeUndefined();
  });

  it('should replace a stale derived group rather than appending to it', () => {
    // Given a record whose derived group holds something no fact supports any more
    const runtime: IRNodeRuntime = {
      errors: {
        declared: [],
        runtimeDerived: [contract({ status: 429, origin: 'runtime-derived', title: 'stale' })],
        global: [],
      },
    };

    // When, Then the group is a function of the facts present, so an absent fact empties it
    expect(withRuntimeErrorContracts(runtime).errors?.runtimeDerived).toEqual([]);
  });
});

import type { IRConfidence, IRFact, IRNode, IRNodeRuntime } from '@openref/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  FACT_FIELDS,
  GROUPED_FIELDS,
  isRuntimeCollector,
  isSkippedCollector,
  LIST_FIELDS,
  mergeContributions,
} from '../../src/index';
import type {
  CollectorContext,
  CollectorRegistration,
  ControllerLike,
  HandlerLike,
  IRuntimeCollector,
  ModuleRefLike,
  ReflectorLike,
  SkippedCollector,
} from '../../src/index';

/**
 * The collector contract is public API, per SPEC 6.2 and CLAUDE.md rule 10.
 *
 * THIS FILE IS THE PIN, and `pnpm lint` typechecks the test tree, so changing the contract makes
 * these assertions fail to compile rather than silently breaking every ecosystem collector built
 * against it. `@openref/collector-throttler`, `-casl` and `-access-control` are separate packages
 * by design, which means a consumer can be running a collector compiled against an older copy of
 * these types than the one in their tree. Anything changed here is a major version, deliberately,
 * not incidentally.
 *
 * THE SECOND CLAIM IT PINS IS THAT NO FACT CAN ENTER THE IR WITHOUT A SOURCE. That is a type
 * level property rather than a rule somebody remembers, and the cases below are the proof: every
 * attempt to hand a bare value to a runtime field is a compile error, marked with `@ts-expect-e`
 * so that the day one of them starts compiling, this file goes red.
 */

describe('the collector contract', () => {
  it('should be exactly a name and a collect, so a third party implements two members', () => {
    // Given
    type Members = keyof IRuntimeCollector;

    // Then, growing what a collector can do is a change to the context rather than to the
    // interface every third party has already implemented
    expectTypeOf<Members>().toEqualTypeOf<'name' | 'collect'>();
    expectTypeOf<IRuntimeCollector['name']>().toEqualTypeOf<string>();
  });

  it('should hand a collector what SPEC 6.2 says it gets, and no more', () => {
    // Given
    type Given = keyof CollectorContext;

    // THE LIST GREW BY TWO IN T018 AND THE GROWTH IS THE SANCTIONED DIRECTION. The interface a
    // third party implements is still `name` and `collect`, pinned above and unchanged; what grew
    // is what they are handed. A collector only ever reads a context, so one compiled against the
    // shorter list still compiles and still runs, which is why this is an addition rather than a
    // major version. Removing or retyping a field here is not, and this assertion is where that
    // would be caught.
    //
    // `declaredOn` and `handlerName` are here because SPEC 6.3's `source` needs both: the class
    // the method is written on, which is the base class for an inherited handler, and the name the
    // prototype holds rather than whatever a wrapping decorator called its wrapper.
    //
    // AND BY ONE MORE IN TX-GLOBALGUARD, WHICH IS THE SAME DIRECTION AGAIN. `globalGuards` is the
    // list of classes registered under `APP_GUARD`, read once for the application by the pass,
    // because it is one registration and identical on every node. This assertion is what made the
    // addition visible rather than silent, which is what it is for.
    //
    // AND BY `globalPipes` IN TX-COLLECTORS, the same walk over the other enhancer token, on the
    // context for the same one-registration-per-application reason.

    // Then
    expectTypeOf<Given>().toEqualTypeOf<
      | 'node'
      | 'controller'
      | 'declaredOn'
      | 'handler'
      | 'handlerName'
      | 'reflector'
      | 'moduleRef'
      | 'globalGuards'
      | 'globalPipes'
      | 'fact'
    >();
    expectTypeOf<CollectorContext['node']>().toEqualTypeOf<IRNode>();
    expectTypeOf<CollectorContext['controller']>().toEqualTypeOf<ControllerLike>();
    expectTypeOf<CollectorContext['declaredOn']>().toEqualTypeOf<ControllerLike>();
    expectTypeOf<CollectorContext['handler']>().toEqualTypeOf<HandlerLike>();
    expectTypeOf<CollectorContext['handlerName']>().toEqualTypeOf<string>();
    expectTypeOf<CollectorContext['reflector']>().toEqualTypeOf<ReflectorLike>();
    expectTypeOf<CollectorContext['moduleRef']>().toEqualTypeOf<ModuleRefLike>();
    expectTypeOf<CollectorContext['globalGuards']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<CollectorContext['globalPipes']>().toEqualTypeOf<readonly string[]>();
  });

  it('should return the runtime contract of SPEC 6.3, or nothing', () => {
    // Given
    type Returned = ReturnType<IRuntimeCollector['collect']>;

    // Then
    expectTypeOf<Returned>().toEqualTypeOf<IRNodeRuntime | undefined>();
  });

  it('should build a fact carrying all three of value, confidence and collector', () => {
    // Given
    type Built = ReturnType<CollectorContext['fact']>;

    // Then
    expectTypeOf<Built>().toExtend<IRFact<unknown>>();
    expectTypeOf<IRFact<string>>().toHaveProperty('value');
    expectTypeOf<IRFact<string>>().toHaveProperty('confidence');
    expectTypeOf<IRFact<string>>().toHaveProperty('collector');
    expectTypeOf<IRFact<string>['confidence']>().toEqualTypeOf<IRConfidence>();
  });

  it('should admit three confidence levels and no fourth, per SPEC 6.1', () => {
    // Then
    expectTypeOf<IRConfidence>().toEqualTypeOf<'declared' | 'derived' | 'inferred'>();
  });
});

describe('the merge partition', () => {
  it('should name every field of the runtime contract, so a new one cannot be dropped in silence', () => {
    // Given the two lists the merge folds over, plus `source`, which competes on neither axis
    // because there is nothing to be uncertain about: the handler was found or it was not.
    type Handled =
      | 'source'
      | (typeof FACT_FIELDS)[number]
      | (typeof LIST_FIELDS)[number]
      | (typeof GROUPED_FIELDS)[number];

    // Then, this is the partition check of TX-PARTITION at the type level. A field added to
    // `IRNodeRuntime` in core and not added to a list here fails to compile, rather than being
    // dropped by a merge that looks like it handles everything.
    expectTypeOf<keyof IRNodeRuntime>().toEqualTypeOf<Handled>();
  });

  it('should fold each named fact field, rather than name one it does not touch', () => {
    // Given a contribution carrying every fact valued field at once
    const everything = mergeContributions([
      {
        collector: 'testCollector',
        runtime: {
          scopes: { value: ['a'], confidence: 'declared', collector: 'testCollector' },
          roles: { value: ['b'], confidence: 'declared', collector: 'testCollector' },
          rateLimit: {
            value: { limit: 1, ttlMs: 2 },
            confidence: 'derived',
            collector: 'testCollector',
          },
          rateLimitReach: {
            value: { kind: 'external', by: ['GlobalRateLimitGuard'] },
            confidence: 'derived',
            collector: 'testCollector',
          },
          timeout: { value: { ms: 5000 }, confidence: 'derived', collector: 'testCollector' },
          requiredHeaders: {
            value: ['If-Match'],
            confidence: 'inferred',
            collector: 'testCollector',
          },
          parameterReads: {
            value: { parameters: [{ in: 'query', name: 'sort', verdict: 'read' }] },
            confidence: 'inferred',
            collector: 'testCollector',
          },
          statusCode: { value: 201, confidence: 'derived', collector: 'testCollector' },
          streaming: {
            value: { transport: 'sse' },
            confidence: 'declared',
            collector: 'testCollector',
          },
        },
      },
    ]);

    // Then a name in the list that the merge does not actually read shows up as a missing key
    expect(Object.keys(everything ?? {}).sort()).toEqual([...FACT_FIELDS].sort());
  });

  it('should fold each named list field, for the same reason', () => {
    // Given a contribution carrying every list valued field at once
    const everything = mergeContributions([
      {
        collector: 'testCollector',
        runtime: {
          guards: [
            {
              name: 'JwtAuthGuard',
              scope: 'route',
              confidence: 'derived',
              collector: 'testCollector',
            },
          ],
          pipes: [
            {
              name: 'ValidationPipe',
              scope: 'route',
              confidence: 'derived',
              collector: 'testCollector',
            },
          ],
          drift: [
            {
              rule: 'scope-drift',
              severity: 'warning',
              message: 'scopes differ',
              suggestion: 'list the scopes on the security requirement',
              classification: { bucket: 'manual', reason: 'structural-ambiguity' },
              edit: 'narrowed-assertion',
              basis: { kind: 'collected', confidence: 'derived' },
            },
          ],
        },
      },
    ]);

    // Then
    expect(Object.keys(everything ?? {}).sort()).toEqual([...LIST_FIELDS].sort());
  });

  it('should fold each named grouped field, which is the third shape a runtime field has', () => {
    // Given a contribution carrying every grouped field at once. `errors` LEFT `LIST_FIELDS` IN
    // T021 and this case is what stops the move from being invisible: a field that is three lists
    // is folded three times, and a partition that still called it a list would fold it once and
    // drop two thirds of it without failing to compile.
    const everything = mergeContributions([
      {
        collector: 'testCollector',
        runtime: {
          errors: {
            declared: [
              {
                status: 404,
                title: 'not_found',
                origin: 'declared',
                confidence: 'declared',
                collector: 'testCollector',
              },
            ],
            runtimeDerived: [],
            global: [],
          },
        },
      },
    ]);

    // Then
    expect(Object.keys(everything ?? {}).sort()).toEqual([...GROUPED_FIELDS].sort());
  });
});

describe('a fact without provenance', () => {
  it('should not compile as a bare value on a fact valued field', () => {
    // Given a collector trying to return what SPEC 6.1 forbids. Each case is a compile error,
    // and `@ts-expect-error` turns "it does not compile" into an assertion: if any of them ever
    // starts compiling, TypeScript reports the unused directive and this file goes red.
    const bare: IRuntimeCollector = {
      name: 'wrongCollector',
      collect: () => ({
        // @ts-expect-error a bare array is not an IRFact, so it cannot reach the IR
        scopes: ['orders:read'],
      }),
    };

    const bareRoles: IRuntimeCollector = {
      name: 'wrongCollector',
      collect: () => ({
        // @ts-expect-error same for roles
        roles: ['admin'],
      }),
    };

    const bareLimit: IRuntimeCollector = {
      name: 'wrongCollector',
      collect: () => ({
        // @ts-expect-error and for a rate limit, where the bare shape is the tempting one
        rateLimit: { limit: 100, ttlMs: 60_000 },
      }),
    };

    // Then, they are values so the compiler checks them, and the runtime assertion is only here
    // to keep the case honest about what it is testing
    expect([bare.name, bareRoles.name, bareLimit.name]).toEqual([
      'wrongCollector',
      'wrongCollector',
      'wrongCollector',
    ]);
  });

  it('should not compile as a fact missing its collector or its confidence', () => {
    // Given
    const noCollector: IRuntimeCollector = {
      name: 'wrongCollector',
      collect: () => ({
        // @ts-expect-error a fact with no collector has no provenance, which is the whole point
        scopes: { value: ['orders:read'], confidence: 'declared' },
      }),
    };

    const noConfidence: IRuntimeCollector = {
      name: 'wrongCollector',
      collect: () => ({
        // @ts-expect-error and a fact with no confidence level is a guess wearing a source
        scopes: { value: ['orders:read'], collector: 'wrongCollector' },
      }),
    };

    const fourthLevel: IRuntimeCollector = {
      name: 'wrongCollector',
      collect: () => ({
        // @ts-expect-error there is no fourth confidence level, per SPEC 6.1
        scopes: { value: ['orders:read'], confidence: 'probably', collector: 'wrongCollector' },
      }),
    };

    // Then
    expect([noCollector.name, noConfidence.name, fourthLevel.name]).toHaveLength(3);
  });
});

describe('the registration union', () => {
  it('should tell a collector from one that declined to load', () => {
    // Given
    const collector: CollectorRegistration = { name: 'a', collect: () => undefined };
    const declined: CollectorRegistration = { name: 'b', skipped: 'not installed' };

    // Then
    expect(isRuntimeCollector(collector)).toBe(true);
    expect(isRuntimeCollector(declined)).toBe(false);
    expect(isSkippedCollector(declined)).toBe(true);
    expect(isSkippedCollector(collector)).toBe(false);
    expect(isRuntimeCollector(undefined)).toBe(false);
    expect(isSkippedCollector(undefined)).toBe(false);
  });

  it('should narrow to the collector after the guard, with no cast at the call site', () => {
    // Given, which is what makes the guard worth having rather than a boolean. Two bindings and
    // not one, so neither narrowing can borrow the other's.
    const one: CollectorRegistration = { name: 'a', collect: () => undefined };
    const other: CollectorRegistration = { name: 'b', skipped: 'not installed' };

    // When
    if (isRuntimeCollector(one)) {
      // Then
      expectTypeOf(one).toEqualTypeOf<IRuntimeCollector>();
    }

    if (isSkippedCollector(other)) {
      expectTypeOf(other).toEqualTypeOf<SkippedCollector>();
    }

    expect(isRuntimeCollector(one)).toBe(true);
  });
});

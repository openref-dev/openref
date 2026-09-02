/**
 * A third party collector, written and fully annotated out of one package.
 *
 * THIS FILE IS THE PIN AND ITS COMPILATION IS THE ASSERTION. SPEC 4 promises that a collector
 * author installs one package, the way it promises a theme author does, and until T064 that promise
 * was false: `IRuntimeCollector.collect` returns `IRNodeRuntime`, `@openref/nest` re-exported no IR
 * type at all, and an author who wrote the return annotation the contract asks for installed
 * `@openref/core` for one type name. `pnpm lint` typechecks the test tree, so a name removed from
 * the re-export list fails to compile here rather than failing in an ecosystem package nobody in
 * this repository builds.
 *
 * THE IMPORT LIST IS THE SUBJECT, NOT THE CODE. Every type below comes from `@openref/nest` and
 * from nowhere else, and the collector annotates every position an author would: the context, the
 * return, the confidence, the fact, and the two class shapes the context hands over. A single
 * `@openref/core` import anywhere in this file would defeat the whole case, which is why there is
 * a case asserting the file has none.
 */

import { readFileSync } from 'node:fs';
import type {
  CollectorContext,
  ControllerLike,
  HandlerLike,
  IRConfidence,
  IRFact,
  IRNode,
  IRNodeRuntime,
  IRuntimeCollector,
  ModuleRefLike,
  ReflectorLike,
  SkippedCollector,
} from '@openref/nest';
import { isRuntimeCollector, isSkippedCollector } from '@openref/nest';
import { describe, expect, it } from 'vitest';

/** The metadata key this collector reads, as an ecosystem collector would declare one. */
const SCOPES_KEY = 'example:scopes';

/**
 * What an author writes: every position annotated, nothing inferred, one package imported.
 *
 * @param confidence - The level the host's decorator justifies, per SPEC 6.1
 * @returns The collector, annotated with the contract's own interface
 */
function exampleScopesCollector(confidence: IRConfidence = 'derived'): IRuntimeCollector {
  return {
    name: 'exampleScopesCollector',
    collect(context: CollectorContext): IRNodeRuntime | undefined {
      // Every member an author would touch, named in the types the one package exports.
      const node: IRNode = context.node;
      const controller: ControllerLike = context.controller;
      const declaredOn: ControllerLike = context.declaredOn;
      const handler: HandlerLike = context.handler;
      const reflector: ReflectorLike = context.reflector;
      const moduleRef: ModuleRefLike = context.moduleRef;
      const globals: readonly string[] = [...context.globalGuards, ...context.globalPipes];

      const read: unknown = reflector.getAllAndOverride(SCOPES_KEY, [
        handler,
        declaredOn,
        controller,
      ]);

      const scopes: readonly string[] = Array.isArray(read) ? read.map(String) : [];
      if (scopes.length === 0 || node.id === '') return undefined;
      if (globals.length < 0 || Object.keys(moduleRef).length < 0) return undefined;

      const fact: IRFact<readonly string[]> = context.fact(scopes, confidence);

      return { scopes: fact };
    },
  };
}

/** The other half of the contract, also annotated out of the one package. */
function unavailableCollector(): SkippedCollector {
  return { name: 'exampleScopesCollector', skipped: 'the example package is not installed' };
}

describe('a collector written against the published package alone', () => {
  it('should name every type it annotates in @openref/nest and import nothing else', () => {
    // Given, the subject is this file's own import list. Asserted from disk rather than reasoned
    // about, because a compile time promise with no reader is the class this repository removes.
    const source = readFileSync(import.meta.filename, 'utf8');

    // When
    const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);

    // Then
    const scoped = [...new Set(specifiers.filter((name) => name?.startsWith('@openref/')))];

    expect(scoped).toEqual(['@openref/nest']);
  });

  it('should be recognised by the registry as a collector that will run', () => {
    // Given
    const collector = exampleScopesCollector();

    // When
    const runs = isRuntimeCollector(collector);

    // Then
    expect(runs).toBe(true);
    expect(isSkippedCollector(collector)).toBe(false);
  });

  it('should produce a fact carrying the confidence and the collector name', () => {
    // Given
    const collector = exampleScopesCollector('declared');
    const context = contextFor(['orders:read']);

    // When
    const runtime = collector.collect(context);

    // Then
    expect(runtime?.scopes?.value).toEqual(['orders:read']);
    expect(runtime?.scopes?.confidence).toBe('declared');
    expect(runtime?.scopes?.collector).toBe('exampleScopesCollector');
  });

  it('should say nothing about a node whose metadata key is absent', () => {
    // Given
    const collector = exampleScopesCollector();
    const context = contextFor(undefined);

    // When
    const runtime = collector.collect(context);

    // Then
    expect(runtime).toBeUndefined();
  });

  it('should let an author declare a collector that did not load, in the same package', () => {
    // Given
    const skipped = unavailableCollector();

    // When
    const willRun = isRuntimeCollector(skipped);

    // Then
    expect(willRun).toBe(false);
    expect(isSkippedCollector(skipped)).toBe(true);
  });
});

/**
 * A context an author's collector would be handed, built from the contract's own types.
 *
 * @param scopes - What the reflector will report for the metadata key, or undefined for absent
 * @returns The context
 */
function contextFor(scopes: readonly string[] | undefined): CollectorContext {
  class OrdersController {
    findOne(): string {
      return 'ord_1024';
    }
  }

  const node = { id: 'get-orders-id' } as unknown as IRNode;
  const controller = OrdersController as unknown as ControllerLike;
  const handler = Object.getOwnPropertyDescriptor(OrdersController.prototype, 'findOne')
    ?.value as HandlerLike;

  return {
    node,
    controller,
    declaredOn: controller,
    handler,
    handlerName: 'findOne',
    reflector: {
      get: () => undefined,
      getAll: () => [],
      getAllAndMerge: () => [],
      getAllAndOverride: (): unknown => scopes,
    } as unknown as ReflectorLike,
    moduleRef: {} as ModuleRefLike,
    globalGuards: [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: 'exampleScopesCollector',
    }),
  };
}

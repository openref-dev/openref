import { describe, expect, it } from 'vitest';
import { hashDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument } from '@openref/core';
import { runRuntimePass } from '../../src/runtime/application/services/runtime-pass.service';
import { NEST_ROUTE_METADATA } from '../../src/shared/types/nest-surface';
import type {
  DiscoveryServiceLike,
  ModuleRefLike,
  ReflectorLike,
} from '../../src/shared/types/nest-surface';
import type { IRuntimeCollector } from '../../src/runtime/application/ports/collector.port';
import { errorsCollector } from '../../src/runtime/infrastructure/collectors/errors.collector';
import { guardsCollector } from '../../src/runtime/infrastructure/collectors/guards.collector';
import { specification } from '../mocks/fixtures';

/**
 * The pass end to end, over the fixture document and a controller that serves it.
 *
 * THE HASH IS THE ASSERTION THAT MATTERS MOST HERE. Facts attached under the old hash would be
 * served from the SPEC 12 cache as the page from before the pass, forever, and nothing else in
 * the suite would notice: the document would be right, the page would be stale, and the two
 * would agree with each other.
 */

/** A controller that serves `GET /orders/{id}`, which is what the fixture document describes. */
class OrdersController {
  readOrder(): string {
    return 'an order';
  }
}

const prototype = OrdersController.prototype as unknown as Record<string, unknown>;

const metadata = new Map<unknown, Record<string, unknown>>([
  [OrdersController, { [NEST_ROUTE_METADATA.path]: 'orders' }],
  [prototype.readOrder, { [NEST_ROUTE_METADATA.method]: 0, [NEST_ROUTE_METADATA.path]: ':id' }],
]);

const reflector: ReflectorLike = {
  get: (key, target) => metadata.get(target)?.[String(key)] ?? undefined,
  getAllAndOverride: () => undefined,
};

const moduleRef: ModuleRefLike = { get: () => undefined };

const discovery: DiscoveryServiceLike = {
  getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
  getProviders: () => [],
};

/** A guard nobody declared on any route, which is how an application wide policy is written. */
class ReadonlyGuard {
  canActivate(): boolean {
    return true;
  }
}

/** The same container, plus one provider registered under `APP_GUARD`, per SPEC 6.2.1. */
const withGlobalGuard: DiscoveryServiceLike = {
  getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
  getProviders: () => [
    {
      token: 'APP_GUARD (UUID: 5c034508718fe21f57dcd)',
      subtype: 'guard',
      metatype: ReadonlyGuard,
      instance: new ReadonlyGuard(),
    },
  ],
};

/**
 * NestJS's own application configuration, by the name and the accessor the walk matches on.
 *
 * The real one is asserted to be in the container's enumeration by `nest-value-surface.spec.ts`,
 * which boots an application; this stands in for it here for the reason every other double in this
 * file does, which is that the pass is a pure function of the two structural interfaces.
 */
class ApplicationConfig {
  constructor(private readonly prefix: string) {}

  getGlobalPrefix(): string {
    return this.prefix;
  }
}

/** A collector that reports one scope, so there is something to look for in the IR. */
const scopes: IRuntimeCollector = {
  name: 'scopesCollector',
  collect: (context) => ({ scopes: context.fact(['orders:read'], 'declared') }),
};

function document(): IRDocument {
  return normalizeOpenApiDocument(specification());
}

describe('runRuntimePass', () => {
  it('should attach a collector fact to the node the handler serves', () => {
    // Given
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    const node = [...result.document.nodes.values()][0];
    expect(node?.runtime?.scopes).toEqual({
      value: ['orders:read'],
      confidence: 'declared',
      collector: 'scopesCollector',
    });
    expect(result.nodesWithFacts).toBe(1);
  });

  it('should retake the document hash, because the cache is keyed by it', () => {
    // Given
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    expect(result.document.hash).not.toBe(before.hash);
    expect(result.document.hash).toBe(hashDocument(result.document));
  });

  it('should record what the collectors were, so a reader can tell empty from unasked', () => {
    // Given
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes, { name: 'throttlerCollector', skipped: '@nestjs/throttler is absent' }],
      discovery,
      reflector,
      moduleRef,
      sourceLinkTemplate: 'https://host/blob/{ref}/{file}#L{line}',
      nestVersion: '11.1.28',
    });

    // Then
    expect(result.document.runtime).toEqual({
      collectors: ['scopesCollector', 'throttlerCollector'],
      nestVersion: '11.1.28',
      sourceLinkTemplate: 'https://host/blob/{ref}/{file}#L{line}',
      skipped: [{ collector: 'throttlerCollector', reason: '@nestjs/throttler is absent' }],
    });
  });

  it('should leave every node alone when no collector was registered', () => {
    // Given, a host that imports forRoot for `sourceLink` alone is the M1 default
    const before = document();

    // When
    const result = runRuntimePass(before, { collectors: [], discovery, reflector, moduleRef });

    // Then, the pairing still ran and still reports, and no node grew a runtime block
    expect(result.pairing.targets).toHaveLength(1);
    expect([...result.document.nodes.values()].every((node) => node.runtime === undefined)).toBe(
      true,
    );
    expect(result.nodesWithFacts).toBe(0);
  });

  it('should report an operation the application does not serve rather than dropping it', () => {
    // Given, a document describing an endpoint no controller answers
    const before = document();

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery: { getControllers: () => [], getProviders: () => [] },
      reflector,
      moduleRef,
    });

    // Then
    expect(result.pairing.nodesWithoutRoute).toHaveLength(1);
    expect(result.nodesWithFacts).toBe(0);
  });

  it('should keep the hash stable when it is run twice over the same application', () => {
    // Given, a deterministic pass is what makes the SPEC 12 cache survive a restart
    const first = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // When
    const second = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    expect(second.document.hash).toBe(first.document.hash);
  });
});

/**
 * The Documentation Health report of SPEC 7.2, as the pass hangs it on the document.
 *
 * WHAT IS BEING GUARDED HERE IS THE INPUT TO `orphan-operation` AND NOT THE RULE ITSELF, which is
 * tested in `core` against hand built documents. The pass is the only thing that knows which nodes
 * the application actually serves, and getting that wrong does not produce a missing finding: it
 * produces a finding telling a reader to delete documentation that is correct.
 */
describe('runRuntimePass, the health report', () => {
  it('should hang a report on the document and take the hash over it', () => {
    // Given
    // When
    const result = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then a document whose hash predates its own panel is a cache key that never changes
    expect(result.document.health?.operationCount).toBe(1);
    expect(result.document.hash).toBe(hashDocument(result.document));
  });

  it('should count the collector registry as a check of its own', () => {
    // Given a collector that declined, per SPEC 7
    const result = runRuntimePass(document(), {
      collectors: [scopes, { name: 'throttlerCollector', skipped: '@nestjs/throttler is absent' }],
      discovery,
      reflector,
      moduleRef,
    });

    // When
    const check = result.document.health?.checks[0];

    // Then a failed collector is a health check and never a drift finding, per SPEC 7
    expect(check).toEqual({
      id: 'runtime-collectors',
      label: 'Runtime collectors that reported a fact',
      passed: 1,
      total: 2,
      severity: 'warning',
    });
    expect(result.document.health?.drift.some((issue) => issue.rule === 'orphan-operation')).toBe(
      false,
    );
  });

  it('should call a node with no handler an orphan', () => {
    // Given an application serving nothing the document describes
    const result = runRuntimePass(document(), {
      collectors: [scopes],
      discovery: { getControllers: () => [], getProviders: () => [] },
      reflector,
      moduleRef,
    });

    // When
    const orphans = result.document.health?.drift.filter(
      (issue) => issue.rule === 'orphan-operation',
    );

    // Then
    expect(orphans).toHaveLength(1);
    expect(orphans?.[0]?.classification).toEqual({ bucket: 'contradiction' });
  });

  it('should not call a paired node an orphan just because no collector had anything to say', () => {
    // Given, THE MISTAKE THIS PINS IS READING `node.runtime` INSTEAD OF THE PAIRING. A route that
    // was found and that every collector declined to describe still has a handler, and a document
    // whose host registered no collectors would otherwise report every operation as removed.
    const result = runRuntimePass(document(), { collectors: [], discovery, reflector, moduleRef });

    // When
    const orphans = result.document.health?.drift.filter(
      (issue) => issue.rule === 'orphan-operation',
    );

    // Then
    expect(result.nodesWithFacts).toBe(0);
    expect(orphans).toEqual([]);
  });

  it('should carry the guard to scheme mapping through to security-drift', () => {
    // Given a guarded route, a document requiring a different scheme, and the host's mapping
    const guards: IRuntimeCollector = {
      name: 'guardsCollector',
      collect: () => ({
        guards: [
          {
            name: 'JwtAuthGuard',
            scope: 'route',
            confidence: 'derived',
            collector: 'guardsCollector',
          },
        ],
      }),
    };
    const withSecurity = document();
    const secured = new Map(withSecurity.nodes);
    for (const [id, node] of secured) {
      if (node.kind === 'operation') {
        secured.set(id, { ...node, security: [{ schemeId: 'apiKey', scopes: [] }] });
      }
    }

    // When
    const result = runRuntimePass(
      { ...withSecurity, nodes: secured },
      {
        collectors: [guards],
        discovery,
        reflector,
        moduleRef,
        guardSecuritySchemes: { JwtAuthGuard: 'bearer' },
      },
    );

    // Then without the mapping this operation is quiet, because a guard class name names no scheme
    const found = result.document.health?.drift.filter((issue) => issue.rule === 'security-drift');
    expect(found).toHaveLength(1);
    expect(found?.[0]?.classification).toEqual({ bucket: 'contradiction' });

    // And the mapping travels on the document, so a renderer re-asking this rule after the pass
    // ends compares the same two things the report compared. Without it the parity gutter drew
    // `?` over the operations the health page had already counted as passed.
    expect(result.document.runtime?.guardSchemes).toEqual({ JwtAuthGuard: 'bearer' });
  });

  it('should leave the guard mapping off a document whose host configured none', () => {
    // Given, an absent field is the claim that there is nothing to compare with, which is what
    // `security-drift` reads it as
    const result = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then
    expect(result.document.runtime?.guardSchemes).toBeUndefined();
  });

  it('should put a guard registered under APP_GUARD on a route that declares none', () => {
    // Given the shape TX-GLOBALGUARD was found on. The controller carries no `__guards__`, and
    // the container holds one provider whose token is the rewritten `APP_GUARD` one.
    const result = runRuntimePass(document(), {
      collectors: [guardsCollector()],
      discovery: withGlobalGuard,
      reflector,
      moduleRef,
    });

    // Then the fact reaches the node, at the level SPEC 6.2.1 puts it
    const node = [...result.document.nodes.values()][0];
    expect(node?.runtime?.guards).toEqual([
      {
        name: 'ReadonlyGuard',
        scope: 'global',
        confidence: 'derived',
        collector: 'guardsCollector',
      },
    ]);

    // And the rule that carries the product's central claim fires, which is the whole point: on
    // this document it printed a clean line while every route was behind that guard
    const drift = result.document.health?.drift.filter((issue) => issue.rule === 'security-drift');
    expect(drift).toHaveLength(1);
    expect(drift?.[0]?.runtimeValue).toBe('ReadonlyGuard (application wide)');
  });

  it('should derive 401 and 403 from a global guard, the same as from a route one', () => {
    // Given. SPEC 6.4 derives the pair from the existence of a guard and not from its scope, so a
    // globally guarded application gains them on every operation. That is the cost the amendment
    // names out loud, and this is where it would be lost if a later change filtered by scope.
    // `errorsCollector` is registered because the derivation only fills a record an error
    // collector opened, per SPEC 6.4: no collector, no facts.
    const result = runRuntimePass(document(), {
      collectors: [guardsCollector(), errorsCollector()],
      discovery: withGlobalGuard,
      reflector,
      moduleRef,
    });

    // Then
    const node = [...result.document.nodes.values()][0];
    expect(node?.runtime?.errors?.runtimeDerived.map((contract) => contract.status)).toEqual([
      401, 403,
    ]);
  });

  it('should report an unnameable global guard once for the application, not once per route', () => {
    // Given `{ provide: APP_GUARD, useValue: { canActivate } }`, which protects everything with
    // something that has no class name. A row saying `Object` would be a name nobody wrote.
    const anonymous: DiscoveryServiceLike = {
      getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
      getProviders: () => [{ subtype: 'guard', instance: { canActivate: () => true } }],
    };

    // When
    const result = runRuntimePass(document(), {
      collectors: [guardsCollector()],
      discovery: anonymous,
      reflector,
      moduleRef,
    });

    // Then, one problem for the application rather than one per node
    expect(result.discoveryProblems).toHaveLength(1);
    expect(result.discoveryProblems[0]?.subject).toBe('the application');
    expect(result.discoveryProblems[0]?.reason).toContain('APP_GUARD');
    expect([...result.document.nodes.values()][0]?.runtime?.guards).toBeUndefined();
  });

  it('should recognise a global guard by its token when the subtype is absent', () => {
    // Given a wrapper carrying only the rewritten token. `subtype` is undocumented and the token
    // prefix is the shape a host wrote, so either alone is enough: requiring both would take the
    // reading quiet on a guarded application the first time one of them moved.
    const byToken: DiscoveryServiceLike = {
      getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
      getProviders: () => [
        { token: 'APP_GUARD (UUID: 5c034508718fe21f57dcd)', instance: new ReadonlyGuard() },
        { token: 'OrdersService', instance: new OrdersController() },
      ],
    };

    // When
    const result = runRuntimePass(document(), {
      collectors: [guardsCollector()],
      discovery: byToken,
      reflector,
      moduleRef,
    });

    // Then, and the ordinary provider beside it is not mistaken for one
    expect([...result.document.nodes.values()][0]?.runtime?.guards?.map((one) => one.name)).toEqual(
      ['ReadonlyGuard'],
    );
  });
});

/**
 * The three pairing lists, which the pass built and nothing read until `TX-PAIRING`.
 *
 * WHAT A READER SAW BEFORE. A route that matched two operations was attributed to neither in
 * silence, and the operation it should have carried was drawn as `orphan-operation`, severity
 * `error`, saying no handler was found for it. The handler had been found. It was matched twice
 * and discarded, and the one sentence a reader was given named the one thing that had not
 * happened.
 */
describe('runRuntimePass, the pairing problems reaching a reader', () => {
  /** Two operations under different prefixes, which is what makes the suffix rule ambiguous. */
  function twoPrefixes(): Record<string, unknown> {
    return {
      openapi: '3.1.0',
      info: { title: 'Orders', version: '1.0.0' },
      paths: {
        '/public/orders/{id}': {
          get: { summary: 'Public', responses: { '200': { description: 'ok' } } },
        },
        '/internal/orders/{id}': {
          get: { summary: 'Internal', responses: { '200': { description: 'ok' } } },
        },
      },
    };
  }

  it('should put an ambiguous pairing on the document, naming both candidates', () => {
    // Given one route reaching two operations by the last rule, which has no anchor
    const before = normalizeOpenApiDocument(twoPrefixes());

    // When
    const result = runRuntimePass(before, {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then the reader is told what happened, rather than being left with a fact that is missing
    const problems = result.document.runtime?.problems ?? [];
    const ambiguity = problems.find((problem) => problem.subject === 'GET /orders/{id}');
    expect(ambiguity?.reason).toContain('it matches 2 operations');
    expect(ambiguity?.action).toBeDefined();
    expect(result.nodesWithFacts).toBe(0);
  });

  it('should say each candidate lost its handler, not that none was found', () => {
    // Given the same pass
    const result = runRuntimePass(normalizeOpenApiDocument(twoPrefixes()), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // When, reading what is said about the operations themselves rather than about the route
    const problems = result.document.runtime?.problems ?? [];
    const nodes = problems.filter((problem) => problem.subject.startsWith('get-'));

    // Then, and the subjects are asserted present first so an empty list cannot pass as a clean one
    expect(nodes).toHaveLength(2);
    expect(nodes.map((problem) => problem.reason)).toEqual([
      'GET /orders/{id} matched it and other operations, so it was attributed to none',
      'GET /orders/{id} matched it and other operations, so it was attributed to none',
    ]);
    expect(nodes.every((problem) => problem.reason.includes('no handler was found'))).toBe(false);
  });

  it('should report a route the document does not describe, which include produces on purpose', () => {
    // Given a document holding an operation this controller does not serve
    const result = runRuntimePass(normalizeOpenApiDocument(twoPrefixes()), {
      collectors: [scopes],
      discovery: {
        getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
        getProviders: () => [{ instance: new ApplicationConfig('/nowhere') }],
      },
      reflector,
      moduleRef,
    });

    // Then, with the prefix read, rule two probes `/nowhere/orders/{id}` and the last rule still
    // matches both, so the route is refused and said to be refused
    const problems = result.document.runtime?.problems ?? [];
    expect(problems.map((problem) => problem.subject)).toContain('GET /orders/{id}');
  });

  it('should say the prefix could not be read only when a route was left unpaired', () => {
    // Given a container with no ApplicationConfig, which is every double in this file, and a
    // document whose single operation the controller does serve
    const paired = runRuntimePass(document(), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // When, and then: nothing was lost, so nothing is said
    expect(paired.discoveryProblems).toEqual([]);

    // When the same container leaves a route unpaired
    const unpaired = runRuntimePass(normalizeOpenApiDocument(twoPrefixes()), {
      collectors: [scopes],
      discovery,
      reflector,
      moduleRef,
    });

    // Then it is named, with the count, and with what to do about it
    const said = unpaired.discoveryProblems.find(
      (problem) => problem.subject === 'the application',
    );
    expect(said?.reason).toBe(
      'the global prefix could not be read, and 1 route(s) were left unpaired',
    );
    expect(said?.action).toContain('setGlobalPrefix');
  });

  it('should pair a prefixed application exactly, where the suffix rule refused both', () => {
    // Given the maintainer's shape: `setGlobalPrefix` on the application and a document written
    // with it, plus a second operation the unanchored rule cannot tell apart from the first
    const prefixed: DiscoveryServiceLike = {
      getControllers: () => [{ metatype: OrdersController, instance: new OrdersController() }],
      getProviders: () => [{ instance: new ApplicationConfig('public') }],
    };

    // When
    const result = runRuntimePass(normalizeOpenApiDocument(twoPrefixes()), {
      collectors: [scopes],
      discovery: prefixed,
      reflector,
      moduleRef,
    });

    // Then the right node carries the fact and nothing is reported as ambiguous
    const withFacts = [...result.document.nodes.values()].filter(
      (node) => node.runtime?.scopes !== undefined,
    );
    expect(withFacts.map((node) => (node.kind === 'operation' ? node.path : node.id))).toEqual([
      '/public/orders/{id}',
    ]);
    expect(result.pairing.ambiguous).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { RUNTIME_FACT_COLLECTORS } from '@openref/core';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  CASL_COLLECTOR_NAME,
  caslCollector,
  type CaslCollector,
  type CaslCollectorRegistration,
} from '../../src/index';

/**
 * `caslCollector`, and mostly what it refuses.
 *
 * THE REAL RESOLVER IS CHECKED AGAINST THE REAL REPOSITORY, WHICH IS THE HALF THAT BROKE. The
 * standing rule about a test asserting behaviour under an absent resource asks for the absence to
 * be real, and it cannot be here: `@casl/ability` has to be installed for anything else in this
 * file to be worth running, and one checkout cannot both have it and not. So the direction is
 * inverted. The seam covers absence, and the case that is asserted against the truth is presence,
 * because presence is the one the first implementation got wrong: it resolved
 * `@casl/ability/package.json`, which the library's `exports` map does not publish, so an
 * installed copy reported as missing and the collector skipped itself in every project that has
 * CASL. A test that only exercised the seam would have passed on that.
 */

const ABILITY_KEY = 'app:abilities';

class OrdersController {
  list(): undefined {
    return undefined;
  }
}
const list = function list(): undefined {
  return undefined;
};

/** A context whose reflector answers with one metadata value. */
function contextOf(metadata: unknown): CollectorContext {
  return {
    node: { id: 'orders.list' } as unknown as IRNode,
    controller: OrdersController,
    declaredOn: OrdersController,
    handler: list,
    handlerName: 'list',
    reflector: {
      get: () => undefined,
      getAllAndOverride: (key: unknown) => (key === ABILITY_KEY ? metadata : undefined),
    },
    moduleRef: { get: () => undefined },
    globalGuards: [],
    globalPipes: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: CASL_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: CaslCollectorRegistration): CaslCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector past the resolvability check, so that the reading rules can be exercised. */
function installed(): CaslCollector {
  return running(caslCollector({ metadataKey: ABILITY_KEY, isInstalled: () => true }));
}

describe('caslCollector', () => {
  it('should run against a copy that is installed, which the manifest path did not', () => {
    // Given this repository, which has @casl/ability. The first version asked for
    // `@casl/ability/package.json`, and that library's exports map does not publish it, so Node
    // refused the path and the collector skipped itself wherever CASL was actually present.
    const registration = caslCollector({ metadataKey: ABILITY_KEY });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should skip rather than fail the build when the library is absent', () => {
    // Given the case SPEC 6.2 names. It is reached through the seam because the presence case
    // above needs the library installed, and one checkout cannot be both.
    const registration = caslCollector({ metadataKey: ABILITY_KEY, isInstalled: () => false });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(CASL_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain('not installed');
  });

  it('should decline to run at all without a metadata key', () => {
    // Given. CASL ships no decorator, so the key is the application's in every project.
    const registration = caslCollector({ metadataKey: '', isInstalled: () => true });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect('skipped' in registration ? registration.skipped : '').toContain('never guesses one');
  });

  it('should read declarative abilities in the object form as derived scopes', () => {
    // Given the shape an ability decorator writes
    const collector = installed();

    // When
    const produced = collector.collect(
      contextOf([
        { action: 'read', subject: 'Order' },
        { action: 'update', subject: 'Order' },
      ]),
    );

    // Then
    expect(produced?.scopes?.value).toEqual(['read:Order', 'update:Order']);
    expect(produced?.scopes?.confidence).toBe('derived');
    expect(produced?.scopes?.collector).toBe(CASL_COLLECTOR_NAME);
  });

  it('should read the tuple form, and name a subject given as a class', () => {
    // Given
    class Order {
      readonly id = 1;
    }
    const collector = installed();

    // When
    const produced = collector.collect(contextOf([['read', Order]]));

    // Then
    expect(produced?.scopes?.value).toEqual(['read:Order']);
  });

  it('should refuse a policy handler and say why, rather than reading the function', () => {
    // Given the usual CASL integration, which is guard logic. SPEC 6.1 forbids reading it without
    // qualification, and a parser over the function's source would be right most of the time.
    const collector = installed();

    // When
    const produced = collector.collect(contextOf([() => true]));

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.subject).toBe('OrdersController.list');
    expect(collector.problems()[0]?.reason).toContain('never read');
  });

  it('should keep the readable abilities and report the unreadable ones beside them', () => {
    // Given a route with one of each, which is what a partial migration looks like
    const collector = installed();

    // When
    const produced = collector.collect(
      contextOf([{ action: 'read', subject: 'Order' }, () => true]),
    );

    // Then
    expect(produced?.scopes?.value).toEqual(['read:Order']);
    expect(collector.problems()).toHaveLength(1);
  });

  it('should report nothing when the key is absent', () => {
    // Given
    const collector = installed();

    // When
    const produced = collector.collect(contextOf(undefined));

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()).toEqual([]);
  });

  it('should drop an entry it cannot name rather than rendering a partial pair', () => {
    // Given an ability with no subject, which is not an ability
    const collector = installed();

    // When
    const produced = collector.collect(contextOf([{ action: 'read' }]));

    // Then
    expect(produced).toBeUndefined();
  });
});

/**
 * The name this collector stamps is the name `@openref/core` names for its fact.
 *
 * IT IS ASSERTED HERE BECAUSE THE TWO LISTS LIVE IN TWO PACKAGES. `@openref/render` writes the
 * sentence "no registered collector reports X" against a table in `core`, and cannot import this
 * package to check it. A name that drifted would offer a reader an instrument that does not exist.
 */
describe('the name `@openref/core` names for this fact', () => {
  it('should be the name this collector stamps', () => {
    // Given, the subject is present: core names something for the fact
    expect(RUNTIME_FACT_COLLECTORS.scopes.length).toBeGreaterThan(0);

    // When, Then
    expect(RUNTIME_FACT_COLLECTORS.scopes).toContain(CASL_COLLECTOR_NAME);
  });
});

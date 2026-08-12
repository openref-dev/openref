import { describe, expect, it } from 'vitest';
import type { IRConfidence, IRFact, IRNode } from '@openref/core';
import type { CollectorContext } from '@openref/nest';
import { isRuntimeCollector } from '@openref/nest';
import {
  ACCESS_CONTROL_COLLECTOR_NAME,
  accessControlCollector,
  type AccessControlCollector,
  type AccessControlCollectorRegistration,
} from '../../src/index';

/**
 * `accessControlCollector`, and mostly what it refuses.
 *
 * PRESENCE IS ASSERTED AGAINST THE REAL REPOSITORY AND ABSENCE THROUGH THE SEAM, which is the
 * arrangement the CASL collector's tests explain: one checkout cannot both have the library and
 * not, and presence is the direction the first implementation got wrong.
 *
 * ONLY THE ROLES COME OUT, AND THAT IS PINNED HERE. A grant carries four fields and
 * `IRNodeRuntime.roles` is a list of strings, so rendering the whole grant would put a vocabulary
 * this project does not define into a field a reader compares against the specification's security
 * requirements.
 */

const GRANTS_KEY = 'app:grants';

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
      getAllAndOverride: (key: unknown) => (key === GRANTS_KEY ? metadata : undefined),
    },
    moduleRef: { get: () => undefined },
    globalGuards: [],
    fact: <T>(value: T, confidence: IRConfidence): IRFact<T> => ({
      value,
      confidence,
      collector: ACCESS_CONTROL_COLLECTOR_NAME,
    }),
  };
}

/**
 * Narrows a registration to the collector, failing loudly when it declined.
 *
 * @param registration - What the factory returned
 * @returns The collector
 */
function running(registration: AccessControlCollectorRegistration): AccessControlCollector {
  if (!isRuntimeCollector(registration)) throw new Error('the collector declined to run');

  return registration;
}

/** A collector past the resolvability check, so that the reading rules can be exercised. */
function installed(): AccessControlCollector {
  return running(accessControlCollector({ metadataKey: GRANTS_KEY, isInstalled: () => true }));
}

describe('accessControlCollector', () => {
  it('should run against a copy that is installed', () => {
    // Given this repository, which has accesscontrol
    const registration = accessControlCollector({ metadataKey: GRANTS_KEY });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(true);
  });

  it('should skip rather than fail the build when the library is absent', () => {
    // Given the case SPEC 6.2 names, reached through the seam for the reason above
    const registration = accessControlCollector({
      metadataKey: GRANTS_KEY,
      isInstalled: () => false,
    });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect(registration.name).toBe(ACCESS_CONTROL_COLLECTOR_NAME);
    expect('skipped' in registration ? registration.skipped : '').toContain('not installed');
  });

  it('should decline to run at all without a metadata key', () => {
    // Given
    const registration = accessControlCollector({ metadataKey: '', isInstalled: () => true });

    // When, Then
    expect(isRuntimeCollector(registration)).toBe(false);
    expect('skipped' in registration ? registration.skipped : '').toContain('never guesses one');
  });

  it('should take the role names out of declarative grants, at derived', () => {
    // Given the shape a grant decorator writes
    const collector = installed();

    // When
    const produced = collector.collect(
      contextOf([
        { role: 'admin', resource: 'order', action: 'read' },
        { role: 'auditor', resource: 'order', action: 'read' },
      ]),
    );

    // Then
    expect(produced?.roles?.value).toEqual(['admin', 'auditor']);
    expect(produced?.roles?.confidence).toBe('derived');
    expect(produced?.roles?.collector).toBe(ACCESS_CONTROL_COLLECTOR_NAME);
  });

  it('should accept a grant naming several roles, and a bare string', () => {
    // Given both spellings the library admits
    const collector = installed();

    // When
    const produced = collector.collect(contextOf([{ role: ['admin', 'auditor'] }, 'operator']));

    // Then
    expect(produced?.roles?.value).toEqual(['admin', 'auditor', 'operator']);
  });

  it('should report each role once, however many grants name it', () => {
    // Given
    const collector = installed();

    // When
    const produced = collector.collect(
      contextOf([
        { role: 'admin', action: 'read' },
        { role: 'admin', action: 'update' },
      ]),
    );

    // Then
    expect(produced?.roles?.value).toEqual(['admin']);
  });

  it('should refuse a grant written as a function and say why', () => {
    // Given a permission computed at request time, which is guard logic
    const collector = installed();

    // When
    const produced = collector.collect(contextOf([() => true]));

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('never read');
  });

  it('should record a grant that names no role rather than dropping it silently', () => {
    // Given a grant that says who may not do something rather than who may
    const collector = installed();

    // When
    const produced = collector.collect(contextOf([{ resource: 'order', action: 'read' }]));

    // Then
    expect(produced).toBeUndefined();
    expect(collector.problems()[0]?.reason).toContain('name no role');
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
});

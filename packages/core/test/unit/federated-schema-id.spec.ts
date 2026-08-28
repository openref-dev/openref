import { describe, expect, it } from 'vitest';
import {
  federatedSchemaId,
  isFederationServiceId,
  schemaIdForReference,
  schemaNameFromId,
} from '../../src/index';

/**
 * SPEC 15's third id space, and the property it exists for.
 *
 * The claim is the one SPEC 5.1.1 makes about its two spaces, extended to three: a document
 * cannot produce an id that a merge would produce, so a namespaced schema id is free by
 * construction rather than after a collision check. The cases below drive the construction
 * rather than restate it, over names chosen to attack the marker itself.
 */

/** Names built to imitate a marker, plus the ordinary ones a real document carries. */
const HOSTILE_NAMES = [
  'Order',
  'account_annual_revenue',
  '~',
  '~~',
  '~s',
  '~x',
  '~s2a3f0b1c~Order',
  '~x1b4f0e98~Order',
  '~~s2a3f0b1c~Order',
  's2a3f0b1c~Order',
  '~sdeadbeef~account_annual_revenue',
  'billing_Order',
] as const;

const SERVICES = ['billing', 'orders', 'account', 'a', 'z-9'] as const;

function internalIdOf(name: string): string {
  const id = schemaIdForReference(`#/components/schemas/${encodeURIComponent(name)}`);
  if (id === undefined) throw new Error(`no internal id for ${name}`);
  return id;
}

function externalIdOf(name: string): string {
  const id = schemaIdForReference(`common.yaml#/components/schemas/${encodeURIComponent(name)}`);
  if (id === undefined) throw new Error(`no external id for ${name}`);
  return id;
}

describe('the federated schema id space, per SPEC 15', () => {
  it('should never produce an id a document could have produced for a schema of its own', () => {
    // Given every hostile name, filed as this document's own schema
    const internal = new Set(HOSTILE_NAMES.map(internalIdOf));

    // When each of those names is also namespaced for each service
    const federated = SERVICES.flatMap((service) =>
      HOSTILE_NAMES.map((name) => federatedSchemaId(service, internalIdOf(name))),
    );

    // Then no federated id is one the document itself could claim
    expect(federated).not.toHaveLength(0);
    for (const id of federated) expect(internal.has(id)).toBe(false);
  });

  it('should never produce an id the external space could have produced', () => {
    // Given every hostile name, filed as a target of another document
    const external = new Set(HOSTILE_NAMES.map(externalIdOf));

    // When the same names are namespaced by a service
    const federated = SERVICES.flatMap((service) =>
      HOSTILE_NAMES.map((name) => federatedSchemaId(service, externalIdOf(name))),
    );

    // Then the two spaces do not meet either
    expect(federated).not.toHaveLength(0);
    for (const id of federated) expect(external.has(id)).toBe(false);
  });

  it('should give two services two ids for one schema name, and never the same id', () => {
    // Given one schema name held by several services
    // When each is namespaced
    const ids = SERVICES.map((service) => federatedSchemaId(service, internalIdOf('Order')));

    // Then every service has its own, so nothing has to be escaped after a collision
    expect(new Set(ids).size).toBe(SERVICES.length);
  });

  it('should refuse the underscore analogy the measurement rules out', () => {
    // Given the shape that made the node prefix look transferable: a service named after the
    // prefix of a real Stripe schema
    const stripeOwnId = internalIdOf('account_annual_revenue');
    const naive = `account_${internalIdOf('annual_revenue')}`;

    // When the service's schema is namespaced by the construction instead
    const built = federatedSchemaId('account', internalIdOf('annual_revenue'));

    // Then the naive form is exactly the id Stripe already holds, and the built one is not
    expect(naive).toBe(stripeOwnId);
    expect(built).not.toBe(stripeOwnId);
  });

  it('should show the reader the human part through all three spaces', () => {
    // Given a name that needs escaping, in each space and in the nested case
    const internal = internalIdOf('~odd~name');
    const external = externalIdOf('~odd~name');

    // When the reader is shown the name
    // Then the markers and the escapes are gone in every one of them
    expect(schemaNameFromId(internal)).toBe('~odd~name');
    expect(schemaNameFromId(external)).toBe('~odd~name');
    expect(schemaNameFromId(federatedSchemaId('billing', internal))).toBe('~odd~name');
    expect(schemaNameFromId(federatedSchemaId('billing', external))).toBe('~odd~name');
  });

  it('should strip the federated marker exactly once', () => {
    // Given a document whose own schema is named like a federated id
    const imitation = internalIdOf('~s2a3f0b1c~Order');

    // When it is shown to a reader
    // Then the imitation is displayed as the name it is, not read as a marker
    expect(schemaNameFromId(imitation)).toBe('~s2a3f0b1c~Order');
  });

  it('should hold a service id to the alphabet the node prefix depends on', () => {
    // Given ids inside and outside SPEC 15's alphabet
    // When each is checked
    // Then only the ones a node prefix stays unambiguous under are accepted
    expect(isFederationServiceId('billing')).toBe(true);
    expect(isFederationServiceId('z-9')).toBe(true);
    expect(isFederationServiceId('has_underscore')).toBe(false);
    expect(isFederationServiceId('Billing')).toBe(false);
    expect(isFederationServiceId('has~tilde')).toBe(false);
    expect(isFederationServiceId('has.dot')).toBe(false);
    expect(isFederationServiceId('')).toBe(false);
  });
});

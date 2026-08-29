import { describe, expect, it } from 'vitest';
import { federatedSchemaId } from '@openref/core';
import type { IRSchema } from '@openref/core';
import { classifySchemas, mergeDocuments } from '../../src/index';
import type { SchemaEntry } from '../../src/index';
import { buildDocument, namedSchema, operation } from '../mocks/documents';

/**
 * Deduplication by what a schema means rather than by what its body says.
 *
 * THE CASE THIS SUITE EXISTS FOR IS THE THIRD ONE. `User` is byte identical in two services and
 * points at an `Address` that is not, so a single hash of the body says they are one component and
 * they are not. Getting that wrong would show every reader of the second service the first
 * service's model, under the second service's name, with nothing anywhere saying so.
 */

/** Turns a per service map of schemas into the flat entry list `classifySchemas` takes. */
function entriesOf(services: Readonly<Record<string, readonly IRSchema[]>>): SchemaEntry[] {
  return Object.entries(services).flatMap(([serviceId, schemas]) =>
    schemas.map((schema) => ({ serviceId, schemaId: schema.id, schema })),
  );
}

/** The classes as service and id pairs, sorted, so an assertion reads as the grouping it is. */
function grouping(entries: readonly SchemaEntry[]): string[][] {
  return classifySchemas(entries)
    .map((schemaClass) =>
      schemaClass.members.map((member) => `${member.serviceId}:${member.schemaId}`),
    )
    .sort((left, right) => (left.join() < right.join() ? -1 : 1));
}

describe('classifySchemas', () => {
  it('should put two identical schemas in one class', () => {
    // Given the same Money in two services
    const money = namedSchema('Money', {
      type: 'object',
      properties: { amount: { type: 'integer' } },
    });

    // When they are classified
    const classes = grouping(entriesOf({ billing: [money], orders: [money] }));

    // Then they are one component
    expect(classes).toEqual([['billing:Money', 'orders:Money']]);
  });

  it('should keep two schemas that differ by one field apart', () => {
    // Given a Money that gained a property in one service
    const billing = namedSchema('Money', {
      type: 'object',
      properties: { amount: { type: 'integer' } },
    });
    const orders = namedSchema('Money', {
      type: 'object',
      properties: { amount: { type: 'integer' }, precision: { type: 'integer' } },
    });

    // When they are classified
    const classes = grouping(entriesOf({ billing: [billing], orders: [orders] }));

    // Then they are two components
    expect(classes).toEqual([['billing:Money'], ['orders:Money']]);
  });

  it('should keep two identical bodies apart when what they reference is not the same', () => {
    // Given a User that is byte identical in both services and an Address that is not
    const user = namedSchema('User', {
      type: 'object',
      properties: { home: { $ref: 'Address' } },
    });
    const billingAddress = namedSchema('Address', {
      type: 'object',
      properties: { street: { type: 'string' } },
    });
    const ordersAddress = namedSchema('Address', {
      type: 'object',
      properties: { street: { type: 'string' }, country: { type: 'string' } },
    });

    // When they are classified
    const classes = grouping(
      entriesOf({ billing: [user, billingAddress], orders: [user, ordersAddress] }),
    );

    // Then neither the users nor the addresses are one component
    expect(classes).toEqual([
      ['billing:Address'],
      ['billing:User'],
      ['orders:Address'],
      ['orders:User'],
    ]);
  });

  it('should put two identical bodies together when what they reference is also the same', () => {
    // Given the same User and the same Address in both services
    const user = namedSchema('User', { type: 'object', properties: { home: { $ref: 'Address' } } });
    const address = namedSchema('Address', {
      type: 'object',
      properties: { street: { type: 'string' } },
    });

    // When they are classified
    const classes = grouping(entriesOf({ billing: [user, address], orders: [user, address] }));

    // Then both pairs collapse
    expect(classes).toEqual([
      ['billing:Address', 'orders:Address'],
      ['billing:User', 'orders:User'],
    ]);
  });

  it('should reach an answer for a reference cycle instead of recursing', () => {
    // Given a pair of schemas that point at each other, in two services, differing only deep inside
    const left = namedSchema('Left', { type: 'object', properties: { right: { $ref: 'Right' } } });
    const right = (extra: boolean): IRSchema =>
      namedSchema('Right', {
        type: 'object',
        properties: extra
          ? { left: { $ref: 'Left' }, note: { type: 'string' } }
          : { left: { $ref: 'Left' } },
      });

    // When both services are classified
    const classes = grouping(
      entriesOf({ billing: [left, right(false)], orders: [left, right(true)] }),
    );

    // Then the difference inside the cycle separates both members of it
    expect(classes).toEqual([
      ['billing:Left'],
      ['billing:Right'],
      ['orders:Left'],
      ['orders:Right'],
    ]);
  });

  it('should collapse two identical cycles', () => {
    // Given the same mutually referencing pair in two services
    const left = namedSchema('Left', { type: 'object', properties: { right: { $ref: 'Right' } } });
    const right = namedSchema('Right', { type: 'object', properties: { left: { $ref: 'Left' } } });

    // When both services are classified
    const classes = grouping(entriesOf({ billing: [left, right], orders: [left, right] }));

    // Then each pair is one component
    expect(classes).toEqual([
      ['billing:Left', 'orders:Left'],
      ['billing:Right', 'orders:Right'],
    ]);
  });

  it('should keep two structurally identical components with different names apart', () => {
    // Given a Money and a Price with the same body
    const money = namedSchema('Money', { type: 'integer' });
    const price = namedSchema('Price', { type: 'integer' });

    // When they are classified
    const classes = grouping(entriesOf({ billing: [money], orders: [price] }));

    // Then they stay two, because collapsing them would delete a name a document uses
    expect(classes).toEqual([['billing:Money'], ['orders:Price']]);
  });

  it('should give a schema whose raw cannot be hashed a class of its own', () => {
    // Given two schemas whose non JSON dialect source is a value canonical form refuses
    const unhashable = (): IRSchema => ({
      id: 'Avro',
      name: 'Avro',
      dialect: 'avro',
      raw: { made: () => undefined },
    });

    // When two services carry the same one
    const classes = grouping(entriesOf({ billing: [unhashable()], orders: [unhashable()] }));

    // Then neither is merged into the other, which loses nothing and guesses nothing
    expect(classes).toEqual([['billing:Avro'], ['orders:Avro']]);
  });

  it('should classify nothing when there is nothing', () => {
    // Given no schemas at all
    // When they are classified
    const classes = classifySchemas([]);

    // Then there are no classes, rather than one empty one
    expect(classes).toEqual([]);
  });
});

describe('mergeDocuments, deduplication through the engine', () => {
  it('should not merge two Users whose Address differs, and should say so in the ids', () => {
    // Given the byte identical User of the case above, in two whole documents
    const user = namedSchema('User', { type: 'object', properties: { home: { $ref: 'Address' } } });
    const billing = buildDocument({
      id: 'billing-api',
      schemas: [
        user,
        namedSchema('Address', { type: 'object', properties: { street: { type: 'string' } } }),
      ],
      nodes: [
        operation({
          id: 'get-user',
          path: '/user',
          responses: [
            {
              statusCode: '200',
              content: [
                { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'User' } },
              ],
            },
          ],
        }),
      ],
    });
    const orders = buildDocument({
      id: 'orders-api',
      schemas: [
        user,
        namedSchema('Address', {
          type: 'object',
          properties: { street: { type: 'string' }, country: { type: 'string' } },
        }),
      ],
      nodes: [
        operation({
          id: 'get-user',
          path: '/user',
          responses: [
            {
              statusCode: '200',
              content: [
                { mediaType: 'application/json', schema: { kind: 'named', schemaId: 'User' } },
              ],
            },
          ],
        }),
      ],
    });

    // When they are merged
    const { document, report } = mergeDocuments(
      [
        { id: 'billing', document: billing },
        { id: 'orders', document: orders },
      ],
      { id: 'platform', info: { title: 'Platform', version: '1' } },
    );

    // Then four schemas survive and each service's operation answers with its own
    const billingNode = document.nodes.get('billing_get-user');
    const ordersNode = document.nodes.get('orders_get-user');

    expect([...document.schemas.keys()].sort()).toEqual(
      [
        federatedSchemaId('billing', 'Address'),
        federatedSchemaId('billing', 'User'),
        federatedSchemaId('orders', 'Address'),
        federatedSchemaId('orders', 'User'),
      ].sort(),
    );
    expect(report.deduplicated).toEqual([]);
    expect(
      billingNode?.kind === 'operation' ? billingNode.responses[0]?.content[0]?.schema : undefined,
    ).toEqual({ kind: 'named', schemaId: federatedSchemaId('billing', 'User') });
    expect(
      ordersNode?.kind === 'operation' ? ordersNode.responses[0]?.content[0]?.schema : undefined,
    ).toEqual({ kind: 'named', schemaId: federatedSchemaId('orders', 'User') });
    expect(
      document.schemas.get(federatedSchemaId('billing', 'User'))?.normalized?.properties?.home,
    ).toEqual({ $ref: federatedSchemaId('billing', 'Address') });
  });
});

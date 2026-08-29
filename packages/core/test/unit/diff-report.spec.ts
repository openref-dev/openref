import { describe, expect, it } from 'vitest';
import type { IRDiffChange, IRDiffReport, IRDocument } from '../../src/index';
import {
  buildDiffReport,
  normalizeAsyncApiDocument,
  normalizeOpenApiDocument,
} from '../../src/index';
import { createRandom, shuffleKeys } from '../mocks/document.mock';

/**
 * The classification matrix of SPEC 17.1, each covered change kind in both directions, plus the
 * two properties the task names: reordering never registers, and only the SPEC set breaks.
 */

/** A raw OpenAPI document around the given paths and schemas. */
function raw(
  paths: Record<string, unknown>,
  schemas: Record<string, unknown> = {},
  securitySchemes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Diff fixture', version: '1.0.0' },
    paths,
    components: { schemas, securitySchemes },
  };
}

function normalize(document: Record<string, unknown>): IRDocument {
  return normalizeOpenApiDocument(document);
}

function diff(older: Record<string, unknown>, newer: Record<string, unknown>): IRDiffReport {
  return buildDiffReport(normalize(older), normalize(newer));
}

function kinds(changes: readonly IRDiffChange[]): readonly string[] {
  return changes.map((change) => `${change.kind} ${change.subject}`);
}

/** A GET operation returning the named schema, so the schema is response reachable. */
function readsUser(schema = 'User'): Record<string, unknown> {
  return {
    '/users/{id}': {
      get: {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'one user',
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
          },
        },
      },
    },
  };
}

/** A POST operation taking the named schema, so the schema is request reachable. */
function writesUser(schema = 'CreateUser'): Record<string, unknown> {
  return {
    '/users': {
      post: {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
        },
        responses: { '201': { description: 'created' } },
      },
    },
  };
}

describe('buildDiffReport', () => {
  it('should report nothing for two identical documents', () => {
    // Given
    const older = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const newer = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should classify a removed operation as breaking, subject method and path', () => {
    // Given
    const shared = {
      '/users': { get: { responses: { '200': { description: 'ok' } } } },
    };
    const older = raw({
      ...shared,
      '/users/{id}': { delete: { responses: { '204': { description: 'gone' } } } },
    });
    const newer = raw(shared);

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      { kind: 'operation-removed', classification: 'breaking', subject: 'DELETE /users/{id}' },
    ]);
  });

  it('should classify an added operation as non breaking', () => {
    // Given
    const older = raw({ '/users': { get: { responses: { '200': { description: 'ok' } } } } });
    const newer = raw({
      '/users': { get: { responses: { '200': { description: 'ok' } } } },
      '/users/search': { get: { responses: { '200': { description: 'ok' } } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([
      { kind: 'operation-added', classification: 'non-breaking', subject: 'GET /users/search' },
    ]);
  });

  it('should call a field removed from a response reachable schema a removed response field', () => {
    // Given
    const older = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } },
    });
    const newer = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      { kind: 'response-field-removed', classification: 'breaking', subject: 'User.email' },
    ]);
  });

  it('should keep a field removed from a request only schema off the gate', () => {
    // Given
    const older = raw(writesUser(), {
      CreateUser: {
        type: 'object',
        properties: { name: { type: 'string' }, hint: { type: 'string' } },
      },
    });
    const newer = raw(writesUser(), {
      CreateUser: { type: 'object', properties: { name: { type: 'string' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([
      { kind: 'property-removed', classification: 'non-breaking', subject: 'CreateUser.hint' },
    ]);
  });

  it('should classify a changed type on a reachable schema as breaking, old to new', () => {
    // Given
    const older = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const newer = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'number' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'type-changed',
        classification: 'breaking',
        subject: 'User.id',
        oldValue: 'string',
        newValue: 'number',
      },
    ]);
  });

  it('should keep a changed type on a schema no operation reaches off the gate', () => {
    // Given, the same edit on a schema nothing refers to
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const older = raw(paths, {
      Orphan: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const newer = raw(paths, {
      Orphan: { type: 'object', properties: { id: { type: 'number' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual(['type-changed Orphan.id']);
  });

  it('should classify a new required property on a request reachable schema as breaking', () => {
    // Given
    const older = raw(writesUser(), {
      CreateUser: { type: 'object', properties: { name: { type: 'string' } } },
    });
    const newer = raw(writesUser(), {
      CreateUser: {
        type: 'object',
        required: ['country'],
        properties: { name: { type: 'string' }, country: { type: 'string' } },
      },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'required-property-added',
        classification: 'breaking',
        subject: 'CreateUser.country',
      },
    ]);
  });

  it('should keep a new required property on a response only schema off the gate', () => {
    // Given, the server now always returns more, which obliges nobody
    const older = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const newer = raw(readsUser(), {
      User: {
        type: 'object',
        required: ['createdAt'],
        properties: { id: { type: 'string' }, createdAt: { type: 'string' } },
      },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual(['required-property-added User.createdAt']);
  });

  it('should report a new optional property as non breaking', () => {
    // Given
    const older = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const newer = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'string' }, avatar: { type: 'string' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.nonBreaking).toEqual([
      { kind: 'optional-property-added', classification: 'non-breaking', subject: 'User.avatar' },
    ]);
  });

  it('should classify a property becoming required in a request schema as breaking, and the reverse not', () => {
    // Given
    const optional = {
      CreateUser: { type: 'object', properties: { name: { type: 'string' } } },
    };
    const required = {
      CreateUser: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
    };

    // When
    const tightened = diff(raw(writesUser(), optional), raw(writesUser(), required));
    const relaxed = diff(raw(writesUser(), required), raw(writesUser(), optional));

    // Then
    expect(tightened.breaking).toEqual([
      {
        kind: 'requiredness-changed',
        classification: 'breaking',
        subject: 'CreateUser.name',
        oldValue: 'optional',
        newValue: 'required',
      },
    ]);
    expect(relaxed.breaking).toEqual([]);
    expect(kinds(relaxed.nonBreaking)).toEqual(['requiredness-changed CreateUser.name']);
  });

  it('should classify a narrowed enum as breaking only where a sender can hit it', () => {
    // Given one enum edit on a request schema and the same edit on a response schema
    const wide = {
      type: 'object',
      properties: { status: { type: 'string', enum: ['active', 'pending'] } },
    };
    const narrow = { type: 'object', properties: { status: { type: 'string', enum: ['active'] } } };

    // When
    const onRequest = diff(
      raw(writesUser(), { CreateUser: wide }),
      raw(writesUser(), { CreateUser: narrow }),
    );
    const onResponse = diff(raw(readsUser(), { User: wide }), raw(readsUser(), { User: narrow }));

    // Then
    expect(onRequest.breaking).toEqual([
      {
        kind: 'enum-narrowed',
        classification: 'breaking',
        subject: 'CreateUser.status',
        values: ['pending'],
      },
    ]);
    expect(onResponse.breaking).toEqual([]);
    expect(kinds(onResponse.nonBreaking)).toEqual(['enum-narrowed User.status']);
  });

  it('should report a widened enum as non breaking', () => {
    // Given
    const older = raw(writesUser(), {
      CreateUser: { type: 'object', properties: { status: { type: 'string', enum: ['active'] } } },
    });
    const newer = raw(writesUser(), {
      CreateUser: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['active', 'draft'] } },
      },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([
      {
        kind: 'enum-widened',
        classification: 'non-breaking',
        subject: 'CreateUser.status',
        values: ['draft'],
      },
    ]);
  });

  // THIS CASE PINNED THE OPPOSITE RULE UNTIL THE PRE-M4 REVIEW, and it is here in its reversed
  // form rather than deleted, so the reversal is visible in one place. It asserted that a `type`
  // or an `enum` arriving where there was none is recorded and never gates, on the argument that
  // the keyword's arrival is documentation tightening as often as it is a contract change. SPEC
  // 17.1 names a changed type of a reachable schema and a narrowed enum in a request schema as
  // breaking, and never carried that exception; it lived in a comment on the implementation. The
  // spec won, and it moved before this file did.
  it('should gate on a type or an enum arriving on a schema reachable from requests', () => {
    // Given a property that accepted anything and now accepts one string
    const older = raw(writesUser(), {
      CreateUser: { type: 'object', properties: { status: {}, name: { type: 'string' } } },
    });
    const newer = raw(writesUser(), {
      CreateUser: {
        type: 'object',
        properties: { status: { type: 'string', enum: ['active'] }, name: { type: 'string' } },
      },
    });

    // When
    const report = diff(older, newer);

    // Then the type move is reported and the walk stops there, as it does for any type change
    expect(report.breaking).toEqual([
      {
        kind: 'type-changed',
        classification: 'breaking',
        subject: 'CreateUser.status',
        oldValue: 'untyped',
        newValue: 'string',
      },
    ]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should gate on an enum arriving under a type that did not move', () => {
    // Given the same arrival with the type already declared on both sides
    const older = raw(writesUser(), {
      CreateUser: { type: 'object', properties: { status: { type: 'string' } } },
    });
    const newer = raw(writesUser(), {
      CreateUser: { type: 'object', properties: { status: { type: 'string', enum: ['active'] } } },
    });

    // When
    const report = diff(older, newer);

    // Then it is the `enum` constraint narrowing, named and with both sides printed
    expect(report.breaking).toEqual([
      {
        kind: 'constraint-narrowed',
        classification: 'breaking',
        subject: 'enum of CreateUser.status',
        oldValue: 'any value',
        newValue: 'active',
      },
    ]);
    expect(report.nonBreaking).toEqual([]);
  });

  /**
   * The constraint direction matrix of SPEC 17.1, added by the pre-M4 review.
   *
   * Every row is the same schema position moved one keyword at a time, once in each direction,
   * on a body reachable from requests. Before this the whole table produced one line,
   * `CHANGED constraints of CreateUser.field`, on both sides of every row, and none of it gated:
   * the tightening and its own reverse were the same output. The rows are written as a table
   * rather than as fourteen cases because the property under test is the direction, and a table
   * makes a keyword landing on the wrong side visible as one line in a diff.
   */
  const CONSTRAINT_ROWS: readonly {
    readonly keyword: string;
    readonly loose: Record<string, unknown>;
    readonly tight: Record<string, unknown>;
    readonly looseText: string;
    readonly tightText: string;
  }[] = [
    {
      keyword: 'maxLength',
      loose: { maxLength: 255 },
      tight: { maxLength: 32 },
      looseText: '255',
      tightText: '32',
    },
    {
      keyword: 'minLength',
      loose: { minLength: 0 },
      tight: { minLength: 8 },
      looseText: '0',
      tightText: '8',
    },
    {
      keyword: 'maxItems',
      loose: { maxItems: 100 },
      tight: { maxItems: 10 },
      looseText: '100',
      tightText: '10',
    },
    {
      keyword: 'minItems',
      loose: { minItems: 0 },
      tight: { minItems: 1 },
      looseText: '0',
      tightText: '1',
    },
    {
      keyword: 'maxProperties',
      loose: { maxProperties: 9 },
      tight: { maxProperties: 4 },
      looseText: '9',
      tightText: '4',
    },
    {
      keyword: 'minProperties',
      loose: { minProperties: 0 },
      tight: { minProperties: 2 },
      looseText: '0',
      tightText: '2',
    },
    {
      keyword: 'maximum',
      loose: { maximum: 100 },
      tight: { maximum: 10 },
      looseText: '100',
      tightText: '10',
    },
    {
      keyword: 'minimum',
      loose: { minimum: 0 },
      tight: { minimum: 18 },
      looseText: '0',
      tightText: '18',
    },
    {
      keyword: 'exclusiveMaximum',
      loose: { exclusiveMaximum: 100 },
      tight: { exclusiveMaximum: 10 },
      looseText: '100',
      tightText: '10',
    },
    {
      keyword: 'exclusiveMinimum',
      loose: { exclusiveMinimum: 0 },
      tight: { exclusiveMinimum: 18 },
      looseText: '0',
      tightText: '18',
    },
    {
      keyword: 'pattern',
      loose: {},
      tight: { pattern: '^[a-z]+$' },
      looseText: 'any value',
      tightText: '^[a-z]+$',
    },
    {
      keyword: 'format',
      loose: {},
      tight: { format: 'email' },
      looseText: 'any value',
      tightText: 'email',
    },
    {
      keyword: 'multipleOf',
      loose: {},
      tight: { multipleOf: 5 },
      looseText: 'any value',
      tightText: '5',
    },
    {
      keyword: 'uniqueItems',
      loose: { uniqueItems: false },
      tight: { uniqueItems: true },
      looseText: 'false',
      tightText: 'true',
    },
  ];

  it.each(CONSTRAINT_ROWS)(
    'should gate on $keyword tightening in a request schema and not on it loosening',
    ({ keyword, loose, tight, looseText, tightText }) => {
      // Given one property carrying the keyword, compared in both directions
      const at = (constraint: Record<string, unknown>): Record<string, unknown> =>
        raw(writesUser(), {
          CreateUser: { type: 'object', properties: { field: { ...constraint } } },
        });

      // When
      const tightened = diff(at(loose), at(tight));
      const loosened = diff(at(tight), at(loose));

      // Then
      expect(tightened.breaking).toEqual([
        {
          kind: 'constraint-narrowed',
          classification: 'breaking',
          subject: `${keyword} of CreateUser.field`,
          oldValue: looseText,
          newValue: tightText,
        },
      ]);
      expect(tightened.nonBreaking).toEqual([]);
      expect(loosened.breaking).toEqual([]);
      expect(loosened.nonBreaking).toEqual([
        {
          kind: 'constraint-widened',
          classification: 'non-breaking',
          subject: `${keyword} of CreateUser.field`,
          oldValue: tightText,
          newValue: looseText,
        },
      ]);
    },
  );

  it('should gate on additionalProperties closing in a request schema', () => {
    // Given a body that accepted unknown members and now refuses them
    const at = (value: boolean): Record<string, unknown> =>
      raw(writesUser(), {
        CreateUser: { type: 'object', additionalProperties: value, properties: {} },
      });

    // When
    const report = diff(at(true), at(false));

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'constraint-narrowed',
        classification: 'breaking',
        subject: 'additionalProperties of CreateUser',
        oldValue: 'true',
        newValue: 'false',
      },
    ]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should name a tightening on a response only schema and still not gate on it', () => {
    // Given the direction rule: a shorter maximum on the way out does not break a reader
    const at = (maxLength: number): Record<string, unknown> =>
      raw(readsUser(), {
        User: { type: 'object', properties: { name: { type: 'string', maxLength } } },
      });

    // When
    const report = diff(at(255), at(32));

    // Then the move is still called a narrowing, because that is what it is; only the side moves
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual(['constraint-narrowed maxLength of User.name']);
  });

  it('should leave an additionalProperties schema to the residual block', () => {
    // Given the one constraint keyword that can hold a schema instead of a flag
    const at = (type: string): Record<string, unknown> =>
      raw(writesUser(), {
        CreateUser: { type: 'object', properties: {}, additionalProperties: { type } },
      });

    // When
    const report = diff(at('string'), at('integer'));

    // Then it is recorded, once, by the block that does not claim to know the direction
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual(['constraints-changed CreateUser']);
  });

  it('should gate on a oneOf arriving in a request schema and not on it leaving', () => {
    // Given a body that accepted any shape and now accepts one of two
    const at = (schema: Record<string, unknown>): Record<string, unknown> =>
      raw(writesUser(), { CreateUser: schema });
    const open = { type: 'object', properties: { payload: {} } };
    const closed = {
      type: 'object',
      properties: { payload: { oneOf: [{ title: 'Card' }, { title: 'Bank' }] } },
    };

    // When
    const narrowed = diff(at(open), at(closed));
    const widened = diff(at(closed), at(open));

    // Then
    expect(narrowed.breaking).toEqual([
      {
        kind: 'constraint-narrowed',
        classification: 'breaking',
        subject: 'oneOf of CreateUser.payload',
        oldValue: 'any value',
        newValue: 'Bank | Card',
      },
    ]);
    expect(widened.breaking).toEqual([]);
    expect(kinds(widened.nonBreaking)).toEqual(['constraint-widened oneOf of CreateUser.payload']);
  });

  /**
   * Response headers, out of scope until the pre-M4 review measured what that meant.
   *
   * A document whose response lost `X-Rate-Limit` printed `No changes.`, which is the one line
   * SPEC 17.1 reserves for a run that found nothing. The three cases below are the three that
   * were measured printing it.
   */
  function readsWithHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    return {
      '/users': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              headers,
              content: { 'application/json': { schema: { type: 'string' } } },
            },
          },
        },
      },
    };
  }

  it('should gate on a removed response header', () => {
    // Given a documented rate limit header that goes away
    const older = raw(
      readsWithHeaders({
        'X-Rate-Limit': { required: true, schema: { type: 'integer' } },
        'X-Trace': { schema: { type: 'string' } },
      }),
    );
    const newer = raw(readsWithHeaders({ 'X-Trace': { schema: { type: 'string' } } }));

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'response-header-removed',
        classification: 'breaking',
        subject: 'header X-Rate-Limit of response 200 of GET /users',
      },
    ]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should gate on a response header whose declared type moves', () => {
    // Given
    const older = raw(readsWithHeaders({ 'X-Rate-Limit': { schema: { type: 'integer' } } }));
    const newer = raw(readsWithHeaders({ 'X-Rate-Limit': { schema: { type: 'string' } } }));

    // When
    const report = diff(older, newer);

    // Then
    expect(kinds(report.breaking)).toEqual([
      'type-changed header X-Rate-Limit of response 200 of GET /users',
    ]);
  });

  it('should record an added response header and a case only respelling without gating', () => {
    // Given one header arriving, and one whose name changes case only
    const older = raw(readsWithHeaders({ 'X-Trace': { schema: { type: 'string' } } }));
    const newer = raw(
      readsWithHeaders({
        'x-trace': { schema: { type: 'string' } },
        'X-Rate-Limit': { schema: { type: 'integer' } },
      }),
    );

    // When
    const report = diff(older, newer);

    // Then HTTP field names are case insensitive, so the respelling is not a change
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual([
      'response-header-added header X-Rate-Limit of response 200 of GET /users',
    ]);
  });

  it('should classify parameter requiredness like the commit that motivated it', () => {
    // Given the shape of swagger-petstore 9fb97b1: a query parameter becomes required
    const optional = raw({
      '/pets': {
        get: {
          parameters: [
            { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    });
    const required = raw({
      '/pets': {
        get: {
          parameters: [{ name: 'status', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    });

    // When
    const tightened = diff(optional, required);
    const relaxed = diff(required, optional);

    // Then
    expect(tightened.breaking).toEqual([
      {
        kind: 'requiredness-changed',
        classification: 'breaking',
        subject: 'query parameter status of GET /pets',
        oldValue: 'optional',
        newValue: 'required',
      },
    ]);
    expect(relaxed.breaking).toEqual([]);
  });

  it('should classify a new parameter by its own requiredness and a removed one as recorded', () => {
    // Given
    const none = raw({ '/pets': { get: { responses: { '200': { description: 'ok' } } } } });
    const withRequired = raw({
      '/pets': {
        get: {
          parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    });
    const withOptional = raw({
      '/pets': {
        get: {
          parameters: [
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer' } },
          ],
          responses: { '200': { description: 'ok' } },
        },
      },
    });

    // When
    const addedRequired = diff(none, withRequired);
    const addedOptional = diff(none, withOptional);
    const removed = diff(withOptional, none);

    // Then
    expect(addedRequired.breaking).toEqual([
      {
        kind: 'required-parameter-added',
        classification: 'breaking',
        subject: 'query parameter limit of GET /pets',
      },
    ]);
    expect(addedOptional.breaking).toEqual([]);
    expect(kinds(addedOptional.nonBreaking)).toEqual([
      'optional-parameter-added query parameter limit of GET /pets',
    ]);
    expect(removed.breaking).toEqual([]);
    expect(kinds(removed.nonBreaking)).toEqual([
      'parameter-removed query parameter limit of GET /pets',
    ]);
  });

  it('should treat a renamed path template variable as no change at all', () => {
    // Given the same operation with `{id}` renamed to `{userId}`
    const older = raw({
      '/users/{id}': {
        get: {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    });
    const newer = raw({
      '/users/{userId}': {
        get: {
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'ok' } },
        },
      },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should classify a request body becoming required as breaking', () => {
    // Given
    const without = raw({
      '/orders': { post: { responses: { '201': { description: 'created' } } } },
    });
    const withRequired = raw({
      '/orders': {
        post: {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: { type: 'object' } } },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    });

    // When
    const report = diff(without, withRequired);

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'requiredness-changed',
        classification: 'breaking',
        subject: 'request body of POST /orders',
        oldValue: 'none',
        newValue: 'required',
      },
    ]);
  });

  it('should classify security scheme membership and wire changes, and record soft ones', () => {
    // Given
    const apiKey = { ApiKey: { type: 'apiKey', name: 'X-Key', in: 'header' } };
    const oauth = {
      ApiKey: {
        type: 'oauth2',
        flows: { implicit: { authorizationUrl: 'https://a.example/o', scopes: {} } },
      },
    };
    const movedUrl = {
      ApiKey: {
        type: 'oauth2',
        flows: { implicit: { authorizationUrl: 'https://b.example/o', scopes: {} } },
      },
    };
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };

    // When
    const removed = diff(raw(paths, {}, apiKey), raw(paths, {}, {}));
    const added = diff(raw(paths, {}, {}), raw(paths, {}, apiKey));
    const retyped = diff(raw(paths, {}, apiKey), raw(paths, {}, oauth));
    const soft = diff(raw(paths, {}, oauth), raw(paths, {}, movedUrl));

    // Then
    expect(removed.breaking).toEqual([
      {
        kind: 'security-scheme-removed',
        classification: 'breaking',
        subject: 'security scheme ApiKey',
      },
    ]);
    expect(added.breaking).toEqual([]);
    expect(kinds(added.nonBreaking)).toEqual(['security-scheme-added security scheme ApiKey']);
    expect(retyped.breaking).toEqual([
      {
        kind: 'security-scheme-changed',
        classification: 'breaking',
        subject: 'security scheme ApiKey',
        oldValue: 'apiKey header X-Key',
        newValue: 'oauth2',
      },
    ]);
    expect(soft.breaking).toEqual([]);
    expect(kinds(soft.nonBreaking)).toEqual(['security-scheme-changed security scheme ApiKey']);
  });

  it('should record a changed operation security list without gating on it', () => {
    // Given documenting auth is the most common repair a diff cannot tell from a new obligation
    const schemes = { ApiKey: { type: 'apiKey', name: 'X-Key', in: 'header' } };
    const open = raw(
      { '/ping': { get: { responses: { '200': { description: 'ok' } } } } },
      {},
      schemes,
    );
    const guarded = raw(
      {
        '/ping': {
          get: { security: [{ ApiKey: [] }], responses: { '200': { description: 'ok' } } },
        },
      },
      {},
      schemes,
    );

    // When
    const report = diff(open, guarded);

    // Then
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual(['operation-security-changed security of GET /ping']);
  });

  it('should record a moved base url as one non breaking server change, in both directions', () => {
    // Given the same document served from a new base url, per the T038 rework ruling
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const relative = { ...raw(paths), servers: [{ url: '/v3' }] };
    const absolute = { ...raw(paths), servers: [{ url: 'https://api.example/v3' }] };

    // When
    const moved = diff(relative, absolute);
    const movedBack = diff(absolute, relative);

    // Then, registered rather than silent, and never gating
    expect(moved.breaking).toEqual([]);
    expect(moved.nonBreaking).toEqual([
      {
        kind: 'server-changed',
        classification: 'non-breaking',
        subject: 'server',
        oldValue: '/v3',
        newValue: 'https://api.example/v3',
      },
    ]);
    expect(movedBack.breaking).toEqual([]);
    expect(movedBack.nonBreaking).toEqual([
      {
        kind: 'server-changed',
        classification: 'non-breaking',
        subject: 'server',
        oldValue: 'https://api.example/v3',
        newValue: '/v3',
      },
    ]);
  });

  it('should record server membership as non breaking, in both directions', () => {
    // Given a mirror deployment appearing next to the primary
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const one = { ...raw(paths), servers: [{ url: 'https://api.example' }] };
    const two = {
      ...raw(paths),
      servers: [{ url: 'https://api.example' }, { url: 'https://mirror.example' }],
    };

    // When
    const gained = diff(one, two);
    const lost = diff(two, one);

    // Then
    expect(gained.breaking).toEqual([]);
    expect(gained.nonBreaking).toEqual([
      {
        kind: 'server-added',
        classification: 'non-breaking',
        subject: 'server https://mirror.example',
      },
    ]);
    expect(lost.breaking).toEqual([]);
    expect(lost.nonBreaking).toEqual([
      {
        kind: 'server-removed',
        classification: 'non-breaking',
        subject: 'server https://mirror.example',
      },
    ]);
  });

  it('should register nothing for a server description, presence proved first', () => {
    // Given one server whose url never moves, and first a real edit under that url, a narrowed
    // variable enum, so the silence below is the description being an annotation per SPEC 17.1
    // rather than the matcher never comparing a same url pair at all
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const base = {
      url: '/v3',
      description: 'Staging',
      variables: { tier: { default: 'free', enum: ['free', 'pro'] } },
    };
    const wired = {
      ...base,
      variables: { tier: { default: 'free', enum: ['free'] } },
    };
    const retitled = { ...base, description: 'Production' };

    // When
    const presence = diff({ ...raw(paths), servers: [base] }, { ...raw(paths), servers: [wired] });
    const silence = diff(
      { ...raw(paths), servers: [base] },
      { ...raw(paths), servers: [retitled] },
    );

    // Then
    expect(presence.breaking).toEqual([]);
    expect(presence.nonBreaking).toEqual([
      { kind: 'server-changed', classification: 'non-breaking', subject: 'server /v3' },
    ]);
    expect(silence.breaking).toEqual([]);
    expect(silence.nonBreaking).toEqual([]);
  });

  it('should record a moved server protocol as one non breaking change, on an OpenAPI document', () => {
    // Given one server whose url never moves and whose protocol does. OpenAPI's Server Object
    // declares no `protocol`, and SPEC 5.4 records that this IR reads one when a document writes
    // one; the reading is asserted on the normalized document below, so a green case here cannot
    // mean the key was dropped on the way in and the two sides compared as equal
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const before = { url: '/v3', protocol: 'https' };
    const after = { url: '/v3', protocol: 'wss' };

    // When
    const moved = diff({ ...raw(paths), servers: [before] }, { ...raw(paths), servers: [after] });
    const movedBack = diff(
      { ...raw(paths), servers: [after] },
      { ...raw(paths), servers: [before] },
    );

    // Then the fact really is in the IR of an HTTP document, and moving it registers once per
    // direction as non breaking, exactly as a moved base url does
    expect(normalize({ ...raw(paths), servers: [before] }).servers[0]?.protocol).toBe('https');
    expect(moved.breaking).toEqual([]);
    expect(moved.nonBreaking).toEqual([
      { kind: 'server-changed', classification: 'non-breaking', subject: 'server /v3' },
    ]);
    expect(movedBack.breaking).toEqual([]);
    expect(movedBack.nonBreaking).toEqual([
      { kind: 'server-changed', classification: 'non-breaking', subject: 'server /v3' },
    ]);
  });

  it('should record a moved server protocolVersion as one non breaking change, on an OpenAPI document', () => {
    // Given the sibling of the case above, on the member that carried no documentation at all
    // until the reading was recorded. The url and the protocol are held still, so the only thing
    // the two documents disagree about is the version
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const before = { url: '/v3', protocol: 'https', protocolVersion: '1.1' };
    const after = { url: '/v3', protocol: 'https', protocolVersion: '2' };

    // When
    const moved = diff({ ...raw(paths), servers: [before] }, { ...raw(paths), servers: [after] });
    const movedBack = diff(
      { ...raw(paths), servers: [after] },
      { ...raw(paths), servers: [before] },
    );

    // Then
    expect(normalize({ ...raw(paths), servers: [before] }).servers[0]?.protocolVersion).toBe('1.1');
    expect(moved.breaking).toEqual([]);
    expect(moved.nonBreaking).toEqual([
      { kind: 'server-changed', classification: 'non-breaking', subject: 'server /v3' },
    ]);
    expect(movedBack.breaking).toEqual([]);
    expect(movedBack.nonBreaking).toEqual([
      { kind: 'server-changed', classification: 'non-breaking', subject: 'server /v3' },
    ]);
  });

  it('should register nothing when two OpenAPI servers agree on the protocol pair', () => {
    // Given the falsification pair for the two cases above: the same server, both members
    // present and equal, so the silence is the comparison finding them equal rather than the
    // matcher never reaching a same url pair, which the two cases above already showed it does
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const server = { url: '/v3', protocol: 'https', protocolVersion: '1.1' };

    // When
    const report = diff({ ...raw(paths), servers: [server] }, { ...raw(paths), servers: [server] });

    // Then
    expect(normalize({ ...raw(paths), servers: [server] }).servers[0]?.protocol).toBe('https');
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should register nothing for a reordered servers array, presence proved first', () => {
    // Given two servers, and first a real url edit on one of them, so the silence below is the
    // matcher declining a reorder rather than never looking at servers at all
    const paths = { '/ping': { get: { responses: { '200': { description: 'ok' } } } } };
    const servers = [{ url: 'https://a.example' }, { url: 'https://b.example' }];
    const edited = [{ url: 'https://a.example' }, { url: 'https://c.example' }];
    const reordered = [{ url: 'https://b.example' }, { url: 'https://a.example' }];

    // When
    const presence = diff({ ...raw(paths), servers }, { ...raw(paths), servers: edited });
    const silence = diff({ ...raw(paths), servers }, { ...raw(paths), servers: reordered });

    // Then
    expect(kinds(presence.nonBreaking)).toEqual(['server-changed server']);
    expect(silence.breaking).toEqual([]);
    expect(silence.nonBreaking).toEqual([]);
  });

  it('should stay silent when a reference moves to a structurally identical schema', () => {
    // Given a pure rename: the wire contract is byte for byte the same
    const body = { type: 'object', properties: { line1: { type: 'string' } } };
    const older = raw(
      {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Address' } },
                },
              },
            },
          },
        },
      },
      { Address: body },
    );
    const newer = raw(
      {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/PostalAddress' } },
                },
              },
            },
          },
        },
      },
      { PostalAddress: body },
    );

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should classify a reference moving to a structurally different schema as a type change', () => {
    // Given
    const older = raw(readsUser('User'), {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    });
    const newer = raw(readsUser('Account'), {
      Account: { type: 'object', properties: { id: { type: 'string' }, iban: { type: 'string' } } },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      {
        kind: 'type-changed',
        classification: 'breaking',
        subject: 'response 200 of GET /users/{id}',
        oldValue: 'User',
        newValue: 'Account',
      },
    ]);
  });

  it('should classify oneOf branches as a set, a removed shape narrowing and a new one widening', () => {
    // Given
    const both = {
      CreateUser: {
        oneOf: [
          { title: 'ByEmail', type: 'object', properties: { email: { type: 'string' } } },
          { title: 'ByPhone', type: 'object', properties: { phone: { type: 'string' } } },
        ],
      },
    };
    const one = {
      CreateUser: {
        oneOf: [{ title: 'ByEmail', type: 'object', properties: { email: { type: 'string' } } }],
      },
    };

    // When
    const narrowed = diff(raw(writesUser(), both), raw(writesUser(), one));
    const widened = diff(raw(writesUser(), one), raw(writesUser(), both));

    // Then
    expect(narrowed.breaking).toEqual([
      {
        kind: 'variant-removed',
        classification: 'breaking',
        subject: 'CreateUser',
        values: ['ByPhone'],
      },
    ]);
    expect(widened.breaking).toEqual([]);
    expect(kinds(widened.nonBreaking)).toEqual(['variant-added CreateUser']);
  });

  it('should record response code and media type membership without gating on either', () => {
    // Given
    const older = raw({
      '/pets': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { type: 'object' } },
                'application/xml': { schema: { type: 'object' } },
              },
            },
            '404': { description: 'missing' },
          },
        },
      },
    });
    const newer = raw({
      '/pets': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { type: 'object' } } },
            },
            '429': { description: 'slow down' },
          },
        },
      },
    });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect([...kinds(report.nonBreaking)].sort()).toEqual([
      'media-type-removed media type application/xml of response 200 of GET /pets',
      'response-added response 429 of GET /pets',
      'response-removed response 404 of GET /pets',
    ]);
  });

  it('should classify a change to a named schema once, under its name, however many sites use it', () => {
    // Given one schema behind two response codes of two operations
    const uses = {
      '/users': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
          },
        },
      },
      '/me': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
          },
        },
      },
    };
    const older = raw(uses, {
      User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } },
    });
    const newer = raw(uses, { User: { type: 'object', properties: { id: { type: 'string' } } } });

    // When
    const report = diff(older, newer);

    // Then
    expect(report.breaking).toEqual([
      { kind: 'response-field-removed', classification: 'breaking', subject: 'User.email' },
    ]);
  });

  it('should order each section by kind, the way the SPEC 17.1 example reads', () => {
    // Given edits producing one change of several kinds at once
    const older = raw(
      {
        ...readsUser(),
        '/users/{id}/x': { delete: { responses: { '204': { description: 'gone' } } } },
      },
      {
        User: { type: 'object', properties: { id: { type: 'string' }, email: { type: 'string' } } },
      },
    );
    const newer = raw(readsUser(), {
      User: { type: 'object', properties: { id: { type: 'number' }, avatar: { type: 'string' } } },
    });

    // When
    const report = diff(older, newer);

    // Then, removed operation before removed field before changed type
    expect(report.breaking.map((change) => change.kind)).toEqual([
      'operation-removed',
      'response-field-removed',
      'type-changed',
    ]);
    expect(report.nonBreaking.map((change) => change.kind)).toEqual(['optional-property-added']);
  });
});

describe('buildDiffReport and document order', () => {
  /** A document with enough set shaped material for reordering to have somewhere to hide. */
  function orderable(): Record<string, unknown> {
    return raw(
      {
        '/orders': {
          get: {
            parameters: [
              { name: 'status', in: 'query', required: false, schema: { type: 'string' } },
              { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
              },
              '404': { description: 'missing' },
              default: { description: 'error' },
            },
          },
          post: {
            security: [{ Auth: ['orders:write', 'orders:read'] }],
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
      {
        Order: {
          type: 'object',
          required: ['id', 'total'],
          properties: {
            id: { type: 'string' },
            total: { type: 'number' },
            status: { type: 'string', enum: ['new', 'paid', 'shipped'] },
            payment: {
              oneOf: [
                { title: 'Card', type: 'object', properties: { pan: { type: 'string' } } },
                { title: 'Cash', type: 'object' },
              ],
            },
          },
        },
      },
      {
        Auth: {
          type: 'oauth2',
          flows: {
            implicit: {
              authorizationUrl: 'https://auth.example/o',
              scopes: { 'orders:write': 'write', 'orders:read': 'read' },
            },
          },
        },
      },
    );
  }

  it('should see a real change in the orderable fixture, so the empty diffs below prove something', () => {
    // Given the fixture with one enum value actually removed
    const older = orderable();
    const newer = orderable();
    const schemas = (
      newer.components as { schemas: { Order: { properties: { status: { enum: string[] } } } } }
    ).schemas;
    schemas.Order.properties.status.enum = ['new', 'paid'];

    // When
    const report = buildDiffReport(normalize(older), normalize(newer));

    // Then
    expect(report.breaking.map((change) => change.kind)).toEqual(['enum-narrowed']);
  });

  it('should produce an empty diff for a document against its key shuffled self, the T002 payoff', () => {
    // Given every object of the raw document with its keys in a different order
    const older = orderable();
    const shuffled = shuffleKeys(orderable(), createRandom(20260827)) as Record<string, unknown>;

    // When
    const report = buildDiffReport(normalize(older), normalize(shuffled));

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should produce an empty diff when set shaped arrays are reversed', () => {
    // Given required, enum, oneOf, parameters, security and scopes each in reverse order
    const older = orderable();
    const newer = orderable();
    const paths = newer.paths as Record<string, Record<string, Record<string, unknown>>>;
    const getOp = paths['/orders']?.get as { parameters: unknown[] };
    getOp.parameters.reverse();
    const postOp = paths['/orders']?.post as { security: { Auth: string[] }[] };
    postOp.security[0]?.Auth.reverse();
    const components = newer.components as {
      schemas: {
        Order: {
          required: string[];
          properties: { status: { enum: string[] }; payment: { oneOf: unknown[] } };
        };
      };
    };
    components.schemas.Order.required.reverse();
    components.schemas.Order.properties.status.enum.reverse();
    components.schemas.Order.properties.payment.oneOf.reverse();

    // When
    const report = buildDiffReport(normalize(older), normalize(newer));

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });
});

/**
 * The differ over an events document, which is the first thing to run one over channels.
 *
 * `IRServer.protocol` and `IRServer.protocolVersion` have been part of the facing record since
 * T038, and the comparison of them is what had no runner. Both have had a producer since T004:
 * `normalizeOpenApiDocument` reads either member off a server entry, and
 * `openapi-normalizer-details.spec.ts` asserts both. What no case exercised was the differ over a
 * move of either, so the two members sat in `serverFacing` with nothing proving they were read
 * there. These are their runner, and an events document is where a protocol moves in practice.
 */
describe('buildDiffReport over an events document', () => {
  /** An AsyncAPI document around the given brokers, with one channel so it is not an empty one. */
  function events(servers: Record<string, unknown>): IRDocument {
    return normalizeAsyncApiDocument({
      asyncapi: '3.0.0',
      info: { title: 'Orders Events', version: '1.0.0' },
      servers,
      channels: { orderPlaced: { address: 'orders.placed' } },
    });
  }

  it('should report a broker protocol version change as one non breaking server change', () => {
    // Given one broker at one address, upgraded. Both sides carry the same url, so the pair is
    // matched by url and `protocolVersion` is the only member of the facing record that moves.
    const older = events({
      broker: { host: 'kafka.example.com:9092', protocol: 'kafka', protocolVersion: '3.5' },
    });
    const newer = events({
      broker: { host: 'kafka.example.com:9092', protocol: 'kafka', protocolVersion: '3.7' },
    });
    expect(older.servers).toEqual([
      { url: 'kafka://kafka.example.com:9092', protocol: 'kafka', protocolVersion: '3.5' },
    ]);
    expect(newer.servers.map((server) => server.url)).toEqual(
      older.servers.map((server) => server.url),
    );

    // When
    const report = buildDiffReport(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([
      {
        kind: 'server-changed',
        classification: 'non-breaking',
        subject: 'server kafka://kafka.example.com:9092',
      },
    ]);
  });

  it('should report a broker protocol change, which per SPEC 8.2 moves the url with it', () => {
    // Given the same host reached over a different protocol. AsyncAPI 3 writes no url, so the
    // normalizer builds one as `<protocol>://<host><pathname>` and a protocol edit is never the
    // sole difference: the two brokers meet as the leftover of one removal and one addition
    // rather than under a shared url, and the change names both addresses.
    const older = events({
      broker: { host: 'broker.example.com', protocol: 'mqtt', protocolVersion: '3.1.1' },
    });
    const newer = events({
      broker: { host: 'broker.example.com', protocol: 'amqp', protocolVersion: '3.1.1' },
    });
    expect(older.servers.map((server) => server.protocol)).toEqual(['mqtt']);
    expect(newer.servers.map((server) => server.protocol)).toEqual(['amqp']);

    // When
    const report = buildDiffReport(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([
      {
        kind: 'server-changed',
        classification: 'non-breaking',
        subject: 'server',
        oldValue: 'mqtt://broker.example.com',
        newValue: 'amqp://broker.example.com',
      },
    ]);
  });

  it('should register nothing when two brokers agree, presence proved by the pair above', () => {
    // Given two documents whose brokers carry the same protocol and the same protocol version,
    // and one description edit, which SPEC 17.1 keeps as an annotation. The two cases above are
    // the presence half: this differ does read a broker's protocol pair and does report it, so
    // the silence here is agreement rather than the servers never being compared at all.
    const broker = {
      host: 'kafka.example.com:9092',
      protocol: 'kafka',
      protocolVersion: '3.5',
    };
    const older = events({ broker: { ...broker, description: 'staging broker' } });
    const newer = events({ broker: { ...broker, description: 'production broker' } });
    expect(older.servers[0]?.protocolVersion).toBe(newer.servers[0]?.protocolVersion);
    expect(older.servers[0]?.description).not.toBe(newer.servers[0]?.description);

    // When
    const report = buildDiffReport(older, newer);

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });
});

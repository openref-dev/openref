import { describe, expect, it } from 'vitest';
import type { IRDiffChange, IRDiffReport, IRDocument } from '../../src/index';
import { buildDiffReport, normalizeOpenApiDocument } from '../../src/index';
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

  it('should record an enum or a type appearing where there was none instead of gating on it', () => {
    // Given documentation tightening: the keyword arrives, the values may always have been so
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

    // Then
    expect(report.breaking).toEqual([]);
    expect(kinds(report.nonBreaking)).toEqual(['constraints-changed CreateUser.status']);
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

import { describe, expect, it } from 'vitest';
import { buildDiffReport, normalizeOpenApiDocument, type IRDocument } from '../../src/index';

/**
 * The two `diff` surfaces `T043`'s task text names, committed rather than only measured.
 *
 * A MEASURED NEGATIVE THAT IS NOT WRITTEN DOWN IS NOT EVIDENCE. Both of these were driven by hand
 * during the adversarial pass and both held; a property nothing runs is a property that stops
 * being true on the first change nobody connected to it.
 */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** The specification both cases start from: one read, one write, three named schemas. */
function baseSpec(): Record<string, unknown> {
  return {
    openapi: '3.0.3',
    info: { title: 'Diff', version: '1.0.0' },
    paths: {
      '/users/{id}': {
        get: {
          tags: ['users'],
          operationId: 'getUser',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
          },
        },
      },
      '/users': {
        post: {
          tags: ['users'],
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/CreateUser' } },
            },
          },
          responses: { 201: { description: 'created' } },
        },
      },
    },
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            profile: { $ref: '#/components/schemas/Profile' },
          },
        },
        Profile: { type: 'object', properties: { nickname: { type: 'string' } } },
        CreateUser: {
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string' }, country: { type: 'string' } },
        },
      },
    },
  };
}

const normalized = (spec: Record<string, unknown>): IRDocument => normalizeOpenApiDocument(spec);

describe('buildDiffReport, a specification reorganized wholesale without changing behaviour', () => {
  it('should report no change at all, so a refactor does not fail a gate', () => {
    // Given the same contract said five different ways: a referenced schema inlined at its use
    // site, a schema split into an allOf of two fragments, a component renamed with every
    // reference updated, and paths and properties written in another order.
    const older = baseSpec();
    const newer = clone(older);
    const components = newer.components as { schemas: Record<string, unknown> };
    const paths = newer.paths as Record<string, Record<string, Record<string, unknown>>>;

    const user = components.schemas.User as { properties: Record<string, unknown> };
    user.properties.profile = { type: 'object', properties: { nickname: { type: 'string' } } };
    delete components.schemas.Profile;

    components.schemas.PersonCreate = {
      allOf: [
        { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
        { type: 'object', properties: { country: { type: 'string' } } },
      ],
    };
    delete components.schemas.CreateUser;
    const post = paths['/users']?.post as {
      requestBody: { content: Record<string, { schema: unknown }> };
    };
    const media = post.requestBody.content['application/json'];
    if (media !== undefined) media.schema = { $ref: '#/components/schemas/PersonCreate' };

    newer.paths = { '/users': paths['/users'], '/users/{id}': paths['/users/{id}'] };
    user.properties = {
      profile: user.properties.profile,
      email: user.properties.email,
      id: user.properties.id,
    };

    // When
    const report = buildDiffReport(normalized(older), normalized(newer));

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });

  it('should report no change when a path template variable is renamed', () => {
    // Given: path parameters pair positionally, per SPEC 17.1.
    const older = baseSpec();
    const newer = clone(older);
    const paths = newer.paths as Record<string, unknown>;
    paths['/users/{userId}'] = paths['/users/{id}'];
    delete paths['/users/{id}'];
    const renamed = paths['/users/{userId}'] as { get: { parameters: { name: string }[] } };
    const first = renamed.get.parameters[0];
    if (first !== undefined) first.name = 'userId';

    // When
    const report = buildDiffReport(normalized(older), normalized(newer));

    // Then
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking).toEqual([]);
  });
});

describe('buildDiffReport, a breaking change disguised as a widening', () => {
  it('should catch a type widened at the schema and narrowed again at the use site', () => {
    // Given: `User.id` was a string. The named schema now says string or number, which reads as a
    // widening on its own, while the operation's own response narrows it back to a number through
    // an allOf at the use site. On the wire `id` is a number and every string client breaks.
    const older = baseSpec();
    const newer = clone(older);
    const components = newer.components as { schemas: Record<string, unknown> };
    const user = components.schemas.User as { properties: Record<string, unknown> };
    user.properties.id = { type: ['string', 'number'] };

    const paths = newer.paths as Record<string, Record<string, Record<string, unknown>>>;
    const get = paths['/users/{id}']?.get as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    };
    const media = get.responses['200']?.content['application/json'];
    if (media !== undefined) {
      media.schema = {
        allOf: [
          { $ref: '#/components/schemas/User' },
          { type: 'object', properties: { id: { type: 'number' } } },
        ],
      };
    }

    // When
    const report = buildDiffReport(normalized(older), normalized(newer));

    // Then: the gate fails, and it says which type moved.
    expect(report.breaking.length).toBeGreaterThan(0);
    expect(report.breaking.map((change) => change.kind)).toContain('type-changed');
    expect(report.breaking.map((change) => change.subject)).toContain('User.id');
  });

  it('should catch a whole schema reachable from a response losing a field', () => {
    // Given
    const older = baseSpec();
    const newer = clone(older);
    const components = newer.components as { schemas: Record<string, unknown> };
    delete components.schemas.Profile;
    const user = components.schemas.User as { properties: Record<string, unknown> };
    delete user.properties.profile;

    // When
    const report = buildDiffReport(normalized(older), normalized(newer));

    // Then
    expect(report.breaking.map((change) => change.kind)).toContain('response-field-removed');
  });
});

import { describe, expect, it } from 'vitest';
import { buildDiffReport, buildDoctorReport, normalizeOpenApiDocument } from '../../src/index';

/**
 * SPEC 7.1's `operation-key-unread`, added by `T043`.
 *
 * THE FINDING WAS TWO THINGS AT ONCE, and both are here. A path item key spelled `GET` rather
 * than `get` dropped the operation out of the IR with nothing anywhere recording it, so `lint`
 * exited 0 over a document missing an endpoint; and `diff` against the previous version then
 * reported the operation as removed and failed the gate on a breaking change nobody made.
 */

/** One document, with the method key spelled as given. */
function documentWithKey(key: string): ReturnType<typeof normalizeOpenApiDocument> {
  return normalizeOpenApiDocument({
    openapi: '3.0.3',
    info: { title: 'Method', version: '1.0.0' },
    paths: {
      '/users': { [key]: { operationId: 'listUsers', responses: { 200: { description: 'ok' } } } },
    },
  });
}

describe('normalizeOpenApiDocument, a path item key that is a method in the wrong case', () => {
  it('should record the key rather than drop the operation in silence', () => {
    // Given
    const document = documentWithKey('GET');

    // When
    const unread = document.unreadKeys ?? [];

    // Then: still not read, and now named.
    expect(document.nodes.size).toBe(0);
    expect(unread).toEqual([{ path: '/users', key: 'GET', method: 'get', position: 'paths' }]);
  });

  it('should record nothing for a document whose keys are spelled the way OpenAPI spells them', () => {
    // Given
    const document = documentWithKey('get');

    // When
    const unread = document.unreadKeys;

    // Then
    expect(document.nodes.size).toBe(1);
    expect(unread).toBeUndefined();
  });

  it('should not mistake an ordinary path item field for a misspelled method', () => {
    // Given
    const document = normalizeOpenApiDocument({
      openapi: '3.0.3',
      info: { title: 'Fields', version: '1.0.0' },
      paths: {
        '/users': {
          summary: 'Users',
          description: 'The users collection.',
          parameters: [],
          get: { operationId: 'listUsers', responses: { 200: { description: 'ok' } } },
        },
      },
    });

    // When
    const unread = document.unreadKeys;

    // Then
    expect(unread).toBeUndefined();
  });
});

describe('buildDoctorReport, the rule that reports an unread key', () => {
  it('should report DX050 so lint fails over a bare specification', () => {
    // Given
    const document = documentWithKey('GET');

    // When
    const report = buildDoctorReport(document);
    const finding = report.findings.find((entry) => entry.code === 'DX050');

    // Then
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('"GET"');
    expect(finding?.suggestion).toContain('get');
  });

  it('should say nothing for a document whose keys were all read', () => {
    // Given
    const document = documentWithKey('get');

    // When
    const report = buildDoctorReport(document);

    // Then
    expect(report.findings.filter((entry) => entry.code === 'DX050')).toEqual([]);
  });
});

describe('buildDiffReport, an operation whose key changed case', () => {
  it('should not report a removal nobody made, which failed the gate before', () => {
    // Given
    const older = documentWithKey('get');
    const newer = documentWithKey('GET');

    // When
    const report = buildDiffReport(older, newer);

    // Then: the run says something, and the something is not breaking.
    expect(report.breaking).toEqual([]);
    expect(report.nonBreaking.map((change) => change.kind)).toContain('operation-unread');
    expect(report.nonBreaking[0]?.subject).toBe('GET /users');
  });

  it('should still report a real removal as breaking, so the suppression is not a hole', () => {
    // Given
    const older = documentWithKey('get');
    const newer = normalizeOpenApiDocument({
      openapi: '3.0.3',
      info: { title: 'Method', version: '1.0.0' },
      paths: {},
    });

    // When
    const report = buildDiffReport(older, newer);

    // Then
    expect(report.breaking.map((change) => change.kind)).toEqual(['operation-removed']);
  });
});

describe('buildDiffReport, the downgrade matched to one operation rather than to a bucket', () => {
  it('should not hide a real removal behind a misspelled key on its sibling', () => {
    // Given: `/users/{id}` and `/users/{name}` erase to one matching key, so a downgrade keyed on
    // the matching key would have covered both. Here one key is misspelled and the other
    // operation is genuinely gone, which is exactly the removal a gate exists to catch.
    const older = normalizeOpenApiDocument({
      openapi: '3.0.3',
      info: { title: 'Bucket', version: '1.0.0' },
      paths: {
        '/users/{id}': { get: { operationId: 'byId', responses: { 200: { description: 'ok' } } } },
        '/users/{name}': {
          get: { operationId: 'byName', responses: { 200: { description: 'ok' } } },
        },
      },
    });
    const newer = normalizeOpenApiDocument({
      openapi: '3.0.3',
      info: { title: 'Bucket', version: '1.0.0' },
      paths: {
        '/users/{id}': { GET: { operationId: 'byId', responses: { 200: { description: 'ok' } } } },
      },
    });

    // Then, before the assertion: both sides really are one bucket.
    expect(older.nodes.size).toBe(2);
    expect(newer.unreadKeys).toEqual([
      { path: '/users/{id}', key: 'GET', method: 'get', position: 'paths' },
    ]);

    // When
    const report = buildDiffReport(older, newer);

    // Then: one downgraded, one still breaking.
    expect(report.breaking.map((change) => change.kind)).toEqual(['operation-removed']);
    expect(report.nonBreaking.map((change) => change.kind)).toContain('operation-unread');
  });
});

import { describe, expect, it } from 'vitest';
import type { IRDiffChange, IRDiffChangeKind, IRDiffReport } from '@openref/core';
import {
  NO_CHANGES_LINE,
  renderDiffChange,
  renderDiffReport,
} from '../../src/cli/api/commands/diff-report-text';

/**
 * The SPEC 17.1 grammar, one case per kind, so a wording change is a deliberate edit here and
 * never an accident somewhere else.
 */

function change(
  partial: Partial<IRDiffChange> & Pick<IRDiffChange, 'kind' | 'subject'>,
): IRDiffChange {
  return { classification: 'non-breaking', ...partial };
}

describe('renderDiffChange', () => {
  const lines: readonly [IRDiffChange, string][] = [
    [change({ kind: 'operation-removed', subject: 'DELETE /users/{id}' }), 'DELETE /users/{id}'],
    [change({ kind: 'operation-added', subject: 'GET /users/search' }), 'ADDED GET /users/search'],
    [
      change({ kind: 'response-field-removed', subject: 'User.email' }),
      'REMOVED response field User.email',
    ],
    [
      change({ kind: 'property-removed', subject: 'CreateUser.hint' }),
      'REMOVED property CreateUser.hint',
    ],
    [
      change({ kind: 'required-property-added', subject: 'CreateUser.country' }),
      'ADDED required property CreateUser.country',
    ],
    [
      change({ kind: 'optional-property-added', subject: 'User.avatar' }),
      'ADDED optional property User.avatar',
    ],
    [
      change({ kind: 'type-changed', subject: 'User.id', oldValue: 'string', newValue: 'number' }),
      'CHANGED User.id  string → number',
    ],
    [
      change({
        kind: 'requiredness-changed',
        subject: 'query parameter q of GET /users',
        oldValue: 'optional',
        newValue: 'required',
      }),
      'CHANGED query parameter q of GET /users  optional → required',
    ],
    [
      change({ kind: 'enum-narrowed', subject: 'User.status', values: ['pending', 'stale'] }),
      'NARROWED enum User.status  removed pending, stale',
    ],
    [
      change({ kind: 'enum-widened', subject: 'User.status', values: ['draft'] }),
      'WIDENED enum User.status  added draft',
    ],
    [
      change({ kind: 'variant-removed', subject: 'CreateUser', values: ['ByPhone'] }),
      'NARROWED union CreateUser  removed ByPhone',
    ],
    [
      change({ kind: 'variant-added', subject: 'CreateUser', values: ['ByPhone'] }),
      'WIDENED union CreateUser  added ByPhone',
    ],
    [
      change({ kind: 'required-parameter-added', subject: 'query parameter limit of GET /pets' }),
      'ADDED required query parameter limit of GET /pets',
    ],
    [
      change({ kind: 'optional-parameter-added', subject: 'query parameter limit of GET /pets' }),
      'ADDED optional query parameter limit of GET /pets',
    ],
    [
      change({ kind: 'parameter-removed', subject: 'query parameter limit of GET /pets' }),
      'REMOVED query parameter limit of GET /pets',
    ],
    [
      change({ kind: 'response-removed', subject: 'response 404 of GET /pets' }),
      'REMOVED response 404 of GET /pets',
    ],
    [
      change({ kind: 'response-added', subject: 'response 429 of GET /pets' }),
      'ADDED response 429 of GET /pets',
    ],
    [
      change({
        kind: 'media-type-removed',
        subject: 'media type application/xml of response 200 of GET /pets',
      }),
      'REMOVED media type application/xml of response 200 of GET /pets',
    ],
    [
      change({
        kind: 'media-type-added',
        subject: 'media type text/csv of request body of POST /pets',
      }),
      'ADDED media type text/csv of request body of POST /pets',
    ],
    [
      change({ kind: 'security-scheme-removed', subject: 'security scheme apiKey' }),
      'REMOVED security scheme apiKey',
    ],
    [
      change({ kind: 'security-scheme-added', subject: 'security scheme oauth' }),
      'ADDED security scheme oauth',
    ],
    [
      change({
        kind: 'security-scheme-changed',
        subject: 'security scheme apiKey',
        oldValue: 'apiKey header X-Key',
        newValue: 'oauth2',
      }),
      'CHANGED security scheme apiKey  apiKey header X-Key → oauth2',
    ],
    [
      change({ kind: 'security-scheme-changed', subject: 'security scheme oauth' }),
      'CHANGED security scheme oauth',
    ],
    [
      change({ kind: 'server-removed', subject: 'server https://mirror.example' }),
      'REMOVED server https://mirror.example',
    ],
    [
      change({ kind: 'server-added', subject: 'server https://mirror.example' }),
      'ADDED server https://mirror.example',
    ],
    [
      change({
        kind: 'server-changed',
        subject: 'server',
        oldValue: '/v3',
        newValue: 'https://petstore3.swagger.io/api/v3',
      }),
      'CHANGED server  /v3 → https://petstore3.swagger.io/api/v3',
    ],
    [change({ kind: 'server-changed', subject: 'server /v3' }), 'CHANGED server /v3'],
    [
      change({ kind: 'operation-security-changed', subject: 'security of GET /ping' }),
      'CHANGED security of GET /ping',
    ],
    [
      change({ kind: 'constraints-changed', subject: 'User.name' }),
      'CHANGED constraints of User.name',
    ],
    [
      change({
        kind: 'constraint-narrowed',
        subject: 'maxLength of CreateUser.email',
        oldValue: '255',
        newValue: '32',
      }),
      'NARROWED maxLength of CreateUser.email: 255 → 32',
    ],
    [
      change({
        kind: 'constraint-widened',
        subject: 'maxLength of CreateUser.email',
        oldValue: '32',
        newValue: '255',
      }),
      'WIDENED maxLength of CreateUser.email: 32 → 255',
    ],
    [
      change({ kind: 'response-header-removed', subject: 'header X-Rate-Limit of response 200' }),
      'REMOVED header X-Rate-Limit of response 200',
    ],
    [
      change({ kind: 'response-header-added', subject: 'header X-Trace of response 200' }),
      'ADDED header X-Trace of response 200',
    ],
    // Found by the totality check below on the run that introduced it: the renderer has printed
    // this line since T038 and no case pinned its wording.
    [
      change({ kind: 'operation-unread', subject: 'QUERY /search of /search' }),
      'UNREAD QUERY /search of /search  declared under a key OpenAPI does not spell that way',
    ],
  ];

  for (const [input, expected] of lines) {
    it(`should render ${input.kind} as its SPEC 17.1 line`, () => {
      // Given the change
      // When
      const line = renderDiffChange(input);

      // Then
      expect(line).toBe(expected);
    });
  }

  /**
   * The table above is hand written, and until the pre-M4 review nothing held it to the union.
   * The renderer's own switch is exhaustive, so a new kind fails the build there; this table
   * would simply have carried on covering the kinds it already knew. The record below is total
   * over `IRDiffChangeKind`, so adding a kind fails to compile until it is listed, and the
   * assertion then fails until the table renders it.
   */
  it('should have a line for every kind the union carries', () => {
    // Given the union, spelled out once
    const everyKind: Record<IRDiffChangeKind, true> = {
      'operation-removed': true,
      'operation-added': true,
      'response-field-removed': true,
      'type-changed': true,
      'required-property-added': true,
      'optional-property-added': true,
      'property-removed': true,
      'requiredness-changed': true,
      'enum-narrowed': true,
      'enum-widened': true,
      'variant-removed': true,
      'variant-added': true,
      'constraint-narrowed': true,
      'constraint-widened': true,
      'response-header-removed': true,
      'response-header-added': true,
      'required-parameter-added': true,
      'optional-parameter-added': true,
      'parameter-removed': true,
      'response-removed': true,
      'response-added': true,
      'media-type-removed': true,
      'media-type-added': true,
      'security-scheme-removed': true,
      'security-scheme-added': true,
      'security-scheme-changed': true,
      'server-removed': true,
      'server-added': true,
      'server-changed': true,
      'operation-security-changed': true,
      'operation-unread': true,
      'constraints-changed': true,
    };

    // When
    const rendered = new Set(lines.map(([input]) => input.kind));

    // Then
    expect(
      Object.keys(everyKind).filter((kind) => !rendered.has(kind as IRDiffChangeKind)),
    ).toEqual([]);
  });
});

describe('renderDiffReport', () => {
  it('should print both sections with a blank line between them', () => {
    // Given
    const report: IRDiffReport = {
      breaking: [
        { kind: 'operation-removed', classification: 'breaking', subject: 'DELETE /users/{id}' },
      ],
      nonBreaking: [
        { kind: 'operation-added', classification: 'non-breaking', subject: 'GET /users/search' },
      ],
    };

    // When
    const text = renderDiffReport(report);

    // Then
    expect(text).toBe('BREAKING\n  DELETE /users/{id}\n\nNON-BREAKING\n  ADDED GET /users/search');
  });

  it('should omit an empty section rather than print a header over nothing', () => {
    // Given
    const report: IRDiffReport = {
      breaking: [],
      nonBreaking: [
        { kind: 'operation-added', classification: 'non-breaking', subject: 'GET /users/search' },
      ],
    };

    // When
    const text = renderDiffReport(report);

    // Then
    expect(text).toBe('NON-BREAKING\n  ADDED GET /users/search');
  });

  it('should say No changes. when there is nothing at all, so a clean run is visible', () => {
    // Given
    const report: IRDiffReport = { breaking: [], nonBreaking: [] };

    // When
    const text = renderDiffReport(report);

    // Then
    expect(text).toBe(NO_CHANGES_LINE);
  });
});

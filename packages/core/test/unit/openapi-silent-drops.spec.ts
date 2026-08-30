import { describe, expect, it } from 'vitest';
import {
  buildDiffReport,
  buildDoctorReport,
  CycleDepthError,
  ErrorCode,
  NormalizeError,
  RefResolutionError,
  normalizeOpenApiDocument,
  type IRDocument,
} from '../../src/index';

/**
 * The seven places the OpenAPI reader dropped a member of a document in silence, per SPEC 5.4's
 * disposition table, written 2026-08-30 ahead of this code.
 *
 * WHAT THE SEVEN HAD IN COMMON is what makes them one file: the document said something, the reader
 * did not read it, and nothing anywhere, not `unreadKeys`, not the doctor, not a refusal, said a
 * member had been there. A reader saw a finished page. Each case below drives one row and asserts
 * both halves of its disposition: what is now produced or refused, and the address the refusal
 * carries, because "somewhere in this document" is not something a reader can act on.
 *
 * The events side answered the same question in `T051` and `T052`. These cases exist so that one
 * product stops giving two answers to it.
 */

const PATH_ITEM = { get: { operationId: 'read', responses: { 200: { description: 'ok' } } } };

function openapi(extra: Record<string, unknown>): IRDocument {
  return normalizeOpenApiDocument({
    openapi: '3.1.0',
    info: { title: 'Drops', version: '1.0.0' },
    paths: {},
    ...extra,
  });
}

describe('a Path Item written as a reference under paths', () => {
  it('should resolve to the same IR and the same hash as the same document written inline', () => {
    // Given one document written both ways, with nothing else different
    const inline = openapi({ paths: { '/a': PATH_ITEM } });
    const referenced = openapi({
      paths: { '/a': { $ref: '#/components/pathItems/P' } },
      components: { pathItems: { P: PATH_ITEM } },
    });

    // When
    const nodes = [...referenced.nodes.keys()];

    // Then: the reference spelling used to give zero nodes with `unreadKeys` empty. The hash is the
    // assertion that matters, because it is taken over the whole canonical document rather than
    // over the fields this case remembered to compare.
    expect(nodes).toEqual(['get-a']);
    expect(referenced.hash).toBe(inline.hash);
    expect(referenced.unreadKeys).toBeUndefined();
  });

  it('should let members written beside the reference lie over the target', () => {
    // Given a reference carrying its own summary, which OpenAPI 3.1.1 says overrides the target's
    const document = openapi({
      paths: { '/a': { $ref: '#/components/pathItems/P', summary: 'The one at the use site' } },
      components: { pathItems: { P: { ...PATH_ITEM, summary: 'The one at the definition' } } },
    });

    // When
    const node = document.nodes.get('get-a');

    // Then
    expect(node?.kind === 'operation' ? node.summary : undefined).toBe('The one at the use site');
  });

  it('should refuse a reference that resolves to nothing, naming the path it was written under', () => {
    // Given
    const build = (): IRDocument =>
      openapi({ paths: { '/a': { $ref: '#/components/pathItems/Nope' } } });

    // Then
    expect(build).toThrow(RefResolutionError);
    expect(build).toThrow(/path item "\/a"/);
    expect(build).toThrow(/#\/components\/pathItems\/Nope/);
  });

  it('should refuse a reference that leaves the document, because a path item elsewhere has no id space', () => {
    // Given
    const build = (): IRDocument =>
      openapi({ paths: { '/a': { $ref: 'other.yaml#/components/pathItems/P' } } });

    // Then
    expect(build).toThrow(RefResolutionError);
    expect(build).toThrow(/path item "\/a"/);
  });

  it('should refuse a reference landing on something that is not a Path Item Object', () => {
    // Given
    const build = (): IRDocument =>
      openapi({
        paths: { '/a': { $ref: '#/info/title' } },
      });

    // Then
    expect(build).toThrow(RefResolutionError);
    expect(build).toThrow(/is not a Path Item Object/);
  });

  it('should refuse a chain of references that stands on itself', () => {
    // Given
    const build = (): IRDocument =>
      openapi({
        paths: { '/a': { $ref: '#/components/pathItems/P' } },
        components: { pathItems: { P: { $ref: '#/components/pathItems/P' } } },
      });

    // Then
    expect(build).toThrow(CycleDepthError);
  });
});

describe('a Path Item written as a reference under webhooks', () => {
  it('should resolve to the same IR and the same hash as the same document written inline', () => {
    // Given
    const inline = openapi({ webhooks: { w: PATH_ITEM } });
    const referenced = openapi({
      webhooks: { w: { $ref: '#/components/pathItems/P' } },
      components: { pathItems: { P: PATH_ITEM } },
    });

    // When
    const webhooks = [...referenced.webhooks.keys()];

    // Then: zero webhooks before, with `unreadKeys` empty
    expect(webhooks).toEqual(['webhook-get-w']);
    expect(referenced.hash).toBe(inline.hash);
  });

  it('should refuse a dangling reference, naming the webhook it was written under', () => {
    // Given
    const build = (): IRDocument =>
      openapi({ webhooks: { w: { $ref: '#/components/pathItems/Nope' } } });

    // Then
    expect(build).toThrow(RefResolutionError);
    expect(build).toThrow(/webhook "w"/);
  });
});

describe('a Path Item written as a reference inside a callback', () => {
  const callbackOf = (item: unknown): Record<string, unknown> => ({
    paths: {
      '/a': {
        post: {
          operationId: 'place',
          responses: { 200: { description: 'ok' } },
          callbacks: { onEvent: { '{$request.body#/url}': item } },
        },
      },
    },
  });

  it('should resolve to the same IR and the same hash as the same callback written inline', () => {
    // Given
    const inline = openapi(callbackOf({ post: { responses: { 200: { description: 'ok' } } } }));
    const referenced = openapi({
      ...callbackOf({ $ref: '#/components/pathItems/P' }),
      components: { pathItems: { P: { post: { responses: { 200: { description: 'ok' } } } } } },
    });

    // When
    const nodes = [...referenced.nodes.keys()];

    // Then: the parent operation alone before, with no callback node and `unreadKeys` empty
    expect(nodes).toEqual(['post-a', 'callback-post-a-onevent-post-request-body-url']);
    expect(referenced.hash).toBe(inline.hash);
  });

  it('should refuse a dangling reference, naming the expression, the callback and the operation', () => {
    // Given
    const build = (): IRDocument => openapi(callbackOf({ $ref: '#/components/pathItems/Nope' }));

    // Then
    expect(build).toThrow(RefResolutionError);
    expect(build).toThrow(/path item "\{\$request\.body#\/url\}"/);
    expect(build).toThrow(/of callback "onEvent"/);
    expect(build).toThrow(/of operation "post-a"/);
  });
});

describe('a path item key that is no method spelling at all', () => {
  it('should record the key with no method, because there is no method to record', () => {
    // Given
    const document = openapi({
      paths: { '/a': { fetch: { responses: { 200: { description: 'ok' } } } } },
    });

    // When
    const unread = document.unreadKeys;

    // Then: zero nodes and `unreadKeys` empty before, so the operation left with nothing said
    expect(document.nodes.size).toBe(0);
    expect(unread).toEqual([{ path: '/a', key: 'fetch', position: 'paths' }]);
    expect(unread?.[0]?.method).toBeUndefined();
  });

  it('should record the position, so a key under webhooks is not read as a path', () => {
    // Given
    const document = openapi({
      webhooks: { newOrder: { PSOT: { responses: { 200: { description: 'ok' } } } } },
    });

    // When
    const unread = document.unreadKeys;

    // Then
    expect(document.webhooks.size).toBe(0);
    expect(unread).toEqual([{ path: 'newOrder', key: 'PSOT', position: 'webhooks' }]);
  });

  it('should record a wrong case key under webhooks, which the wrapper used to throw away', () => {
    // Given: `T043` gave this defect a rule under `paths`, and the webhook block collected the same
    // keys and returned only the operations, so the same misspelling stayed silent one member over.
    const document = openapi({
      webhooks: { newOrder: { GET: { responses: { 200: { description: 'ok' } } } } },
    });

    // When
    const unread = document.unreadKeys;

    // Then
    expect(unread).toEqual([{ path: 'newOrder', key: 'GET', method: 'get', position: 'webhooks' }]);
  });

  it('should record the callback and the operation a key inside a callback hangs off', () => {
    // Given
    const document = openapi({
      paths: {
        '/a': {
          post: {
            responses: { 200: { description: 'ok' } },
            callbacks: {
              onEvent: {
                '{$request.body#/url}': { PSOT: { responses: { 200: { description: 'ok' } } } },
              },
            },
          },
        },
      },
    });

    // When
    const unread = document.unreadKeys;

    // Then: the expression alone would have been read as a path, which it is not
    expect(unread).toEqual([
      {
        path: '{$request.body#/url}',
        key: 'PSOT',
        position: 'callback',
        callback: 'onEvent',
        parentId: 'post-a',
      },
    ]);
  });

  it('should record nothing for the members a Path Item Object declares, nor for an extension', () => {
    // Given every non operation member OpenAPI names, plus an extension and a member that is not an
    // object, which is the absence of an operation rather than one under a key nobody reads
    const document = openapi({
      paths: {
        '/a': {
          summary: 'A',
          description: 'B',
          servers: [{ url: 'https://example.com' }],
          parameters: [],
          'x-internal': { note: 'not an operation' },
          notAnObject: 'a string',
          get: { responses: { 200: { description: 'ok' } } },
        },
      },
    });

    // When
    const unread = document.unreadKeys;

    // Then
    expect(document.nodes.size).toBe(1);
    expect(unread).toBeUndefined();
  });
});

describe('the doctor and the diff over a key that names no method', () => {
  it('should print DX050 with a sentence that does not offer a spelling it does not have', () => {
    // Given
    const document = openapi({
      paths: { '/a': { fetch: { responses: { 200: { description: 'ok' } } } } },
    });

    // When
    const finding = buildDoctorReport(document).findings.find((entry) => entry.code === 'DX050');

    // Then
    expect(finding).toBeDefined();
    expect(finding?.message).toContain('"fetch"');
    expect(finding?.message).toContain('OpenAPI names no path item field by that key');
    expect(finding?.suggestion).not.toContain('undefined');
  });

  it('should name the callback in the finding, rather than the runtime expression alone', () => {
    // Given
    const document = openapi({
      paths: {
        '/a': {
          post: {
            responses: { 200: { description: 'ok' } },
            callbacks: {
              onEvent: {
                '{$request.body#/url}': { GET: { responses: { 200: { description: 'ok' } } } },
              },
            },
          },
        },
      },
    });

    // When
    const finding = buildDoctorReport(document).findings.find((entry) => entry.code === 'DX050');

    // Then
    expect(finding?.message).toContain('of callback "onEvent"');
    expect(finding?.message).toContain('on operation "post-a"');
  });

  it('should still report a removal as breaking when the operation moved to webhooks under a bad key', () => {
    // Given the pair the webhook filter in `unreadKeysOf` exists for, which had no runner until a
    // blind review deleted the line and watched all of `core` stay green. `GET /a` really is gone
    // from the API's paths; a webhook named `/a` carrying a wrong case key is a different member of
    // the document, and letting its unread key stand in for the operation would downgrade a real
    // removal to a non breaking note.
    const older = openapi({
      paths: { '/a': { get: { operationId: 'read', responses: { 200: { description: 'ok' } } } } },
    });
    const newer = openapi({
      paths: {},
      webhooks: {
        '/a': { GET: { operationId: 'read', responses: { 200: { description: 'ok' } } } },
      },
    });

    // Then, before the assertion: the unread key really is the one that would have matched
    expect(newer.unreadKeys).toEqual([
      { path: '/a', key: 'GET', method: 'get', position: 'webhooks' },
    ]);

    // When
    const report = buildDiffReport(older, newer);

    // Then
    expect(report.breaking.map((change) => change.kind)).toEqual(['operation-removed']);
  });

  it('should not let a method literally spelled undefined match a key that carries no method', () => {
    // Given the pair the method guard in `unreadKeysOf` exists for, which the second blind review
    // reported as reddening nothing. It reddens nothing in the suite as it stood; it is not inert.
    // OpenAPI 3.2 keys `additionalOperations` by method names the specification does not enumerate,
    // and a document may write `undefined` there, which produces an operation whose method is the
    // string "undefined". A key with no method renders as the same string, so without the guard the
    // two match and a real removal is downgraded to a note.
    const older = normalizeOpenApiDocument({
      openapi: '3.2.0',
      info: { title: 'Drops', version: '1.0.0' },
      paths: {
        '/a': {
          additionalOperations: { undefined: { responses: { 200: { description: 'ok' } } } },
        },
      },
    });
    const newer = openapi({
      paths: { '/a': { fetch: { responses: { 200: { description: 'ok' } } } } },
    });

    // Then, before the assertion: both halves of the collision really are present
    const node = [...older.nodes.values()][0];
    expect(node?.kind === 'operation' ? node.method : '').toBe('undefined');
    expect(newer.unreadKeys).toEqual([{ path: '/a', key: 'fetch', position: 'paths' }]);

    // When
    const report = buildDiffReport(older, newer);

    // Then the operation really is gone, and it is reported as gone
    expect(report.breaking.map((change) => change.kind)).toEqual(['operation-removed']);
  });

  it('should still report a removal as breaking when the key that replaced it names no method', () => {
    // Given: the downgrade exists for a key that changed case. A key that is no method at all pairs
    // with no operation, so suppressing the removal would hide a real one behind a typo.
    const older = openapi({
      paths: { '/a': { get: { operationId: 'read', responses: { 200: { description: 'ok' } } } } },
    });
    const newer = openapi({
      paths: {
        '/a': { fetch: { operationId: 'read', responses: { 200: { description: 'ok' } } } },
      },
    });

    // When
    const report = buildDiffReport(older, newer);

    // Then
    expect(report.breaking.map((change) => change.kind)).toEqual(['operation-removed']);
  });
});

describe('a security scheme whose type OpenAPI does not declare', () => {
  it('should refuse, naming the type written and the position it was written at', () => {
    // Given: skipping left `document.security` empty, and an empty table says the document declares
    // no scheme. The document declared one, so the skip printed a false statement, not a missing one
    const build = (): IRDocument =>
      openapi({ components: { securitySchemes: { magic: { type: 'magicLink' } } } });

    // Then
    expect(build).toThrow(NormalizeError);
    expect(build).toThrow(/components\.securitySchemes\.magic/);
    expect(build).toThrow(/"magicLink"/);
  });

  it('should refuse a scheme with no type at all, saying it is missing rather than interpolating it', () => {
    // Given: the first version said "declares the security scheme type undefined", printing a word
    // the document does not contain and sending a reader to look for it. A member never written is
    // missing, which is a different sentence from a member written wrongly.
    const build = (): IRDocument =>
      openapi({ components: { securitySchemes: { blank: { description: 'nothing said' } } } });

    // Then
    expect(build).toThrow(NormalizeError);
    expect(build).toThrow(/components\.securitySchemes\.blank writes no type/);
    expect(build).not.toThrow(/undefined/);
  });

  it('should carry the position and the type on the error, not only in its sentence', () => {
    // Given
    let caught: unknown;
    try {
      openapi({ components: { securitySchemes: { magic: { type: 'magicLink' } } } });
    } catch (error) {
      caught = error;
    }

    // Then
    expect(caught).toBeInstanceOf(NormalizeError);
    expect((caught as NormalizeError).code).toBe(ErrorCode.NORM_DOCUMENT_INVALID);
    expect((caught as NormalizeError).context).toEqual({
      position: 'components.securitySchemes.magic',
      type: 'magicLink',
    });
  });

  it('should follow a reference to a scheme rather than read it as a scheme with no type', () => {
    // Given the spelling `components.securitySchemes` permits
    const document = openapi({
      components: {
        securitySchemes: {
          declared: { type: 'apiKey', name: 'X-Api-Key', in: 'header' },
          alias: { $ref: '#/components/securitySchemes/declared' },
        },
      },
    });

    // When
    const ids = document.security.map((scheme) => scheme.id);

    // Then
    expect(ids).toEqual(['alias', 'declared']);
  });

  it('should still skip a member that is not an object, which is no scheme rather than a bad one', () => {
    // Given
    const document = openapi({
      components: {
        securitySchemes: {
          real: { type: 'http', scheme: 'bearer' },
          nonsense: 'not an object',
        },
      },
    });

    // When
    const ids = document.security.map((scheme) => scheme.id);

    // Then
    expect(ids).toEqual(['real']);
  });
});

describe('a security requirement naming a scheme nobody declared', () => {
  const withScheme = { securitySchemes: { key: { type: 'apiKey', name: 'k', in: 'header' } } };

  it('should refuse at the document level, naming the position and the missing scheme', () => {
    // Given: the node used to carry `{ schemeId: 'nowhere' }` against an empty table, with nothing
    // anywhere saying the two did not join
    const build = (): IRDocument => openapi({ security: [{ nowhere: [] }] });

    // Then
    expect(build).toThrow(NormalizeError);
    expect(build).toThrow(/security\[0\]/);
    expect(build).toThrow(/"nowhere"/);
    expect(build).toThrow(/components\.securitySchemes does not declare it/);
  });

  it('should refuse at an operation, naming the path and the method as well', () => {
    // Given
    const build = (): IRDocument =>
      openapi({
        paths: {
          '/a': {
            get: {
              security: [{ key: [] }, { nowhere: [] }],
              responses: { 200: { description: 'ok' } },
            },
          },
        },
        components: withScheme,
      });

    // Then
    expect(build).toThrow(NormalizeError);
    expect(build).toThrow(/paths\."\/a"\.get\.security\[1\]/);
    expect(build).toThrow(/"nowhere"/);
  });

  it('should refuse at a webhook and inside a callback, so no position is left out', () => {
    // Given
    const webhook = (): IRDocument =>
      openapi({
        webhooks: {
          onOrder: {
            post: { security: [{ nowhere: [] }], responses: { 200: { description: 'ok' } } },
          },
        },
      });
    const callback = (): IRDocument =>
      openapi({
        paths: {
          '/a': {
            post: {
              responses: { 200: { description: 'ok' } },
              callbacks: {
                onEvent: {
                  '{$request.body#/url}': {
                    post: {
                      security: [{ nowhere: [] }],
                      responses: { 200: { description: 'ok' } },
                    },
                  },
                },
              },
            },
          },
        },
      });

    // Then
    expect(webhook).toThrow(/webhooks\."onOrder"\.post\.security\[0\]/);
    expect(callback).toThrow(
      /callbacks\."onEvent"\."\{\$request\.body#\/url\}"\.post\.security\[0\]/,
    );
  });

  it('should accept a requirement that names a declared scheme, so the check is not a ban', () => {
    // Given
    const document = openapi({
      security: [{ key: ['orders:read'] }],
      paths: { '/a': { get: { responses: { 200: { description: 'ok' } } } } },
      components: withScheme,
    });

    // When
    const node = document.nodes.get('get-a');

    // Then
    expect(node?.kind === 'operation' ? node.security : []).toEqual([
      { schemeId: 'key', scopes: ['orders:read'] },
    ]);
  });

  it('should accept the empty requirement object, which names nothing and means optional', () => {
    // Given
    const document = openapi({
      paths: {
        '/a': { get: { security: [{}], responses: { 200: { description: 'ok' } } } },
      },
    });

    // When
    const node = document.nodes.get('get-a');

    // Then
    expect(node?.kind === 'operation' ? node.security : ['unread']).toEqual([]);
  });
});

describe('the eighth drop, a standard method under additionalOperations, per SPEC 5.4 and T059', () => {
  it('should record a standard method written under additionalOperations rather than skip it in silence', () => {
    // Given a 3.2 document that writes an enumerated method in the member for unenumerated ones
    const document = openapi({
      openapi: '3.2.0',
      paths: {
        '/a': {
          additionalOperations: { GET: { responses: { 200: { description: 'ok' } } } },
        },
      },
    });

    // When
    // Then it is loud, and the position tells it from the wrong-case key of the fourth row, which
    // records the byte-identical `{ path, key, method }` under a different member of the document.
    // Measured before the fix: 0 nodes and an empty `unreadKeys`.
    expect([...document.nodes.keys()]).toEqual([]);
    expect(document.unreadKeys).toEqual([
      { path: '/a', key: 'GET', method: 'get', position: 'additional-operations' },
    ]);
  });

  it('should record the lower case spelling too, since the position is what is wrong and not the case', () => {
    // Given
    const document = openapi({
      openapi: '3.2.0',
      paths: {
        '/a': { additionalOperations: { get: { responses: { 200: { description: 'ok' } } } } },
      },
    });

    // When
    // Then
    expect(document.unreadKeys).toEqual([
      { path: '/a', key: 'get', method: 'get', position: 'additional-operations' },
    ]);
  });

  it('should still read an unenumerated method there, which is what the member is for', () => {
    // Given the control: without it the two cases above would pass over a reader that read nothing
    const document = openapi({
      openapi: '3.2.0',
      paths: {
        '/a': { additionalOperations: { LOCK: { responses: { 200: { description: 'ok' } } } } },
      },
    });

    // When
    // Then
    expect([...document.nodes.keys()]).toEqual(['lock-a']);
    expect(document.unreadKeys).toBeUndefined();
  });

  it('should suggest moving the operation rather than renaming a key that is already spelled right', () => {
    // Given the sentence the fourth row's branch would have printed: a rename of `get` to `get`
    const document = openapi({
      openapi: '3.2.0',
      paths: {
        '/a': { additionalOperations: { get: { responses: { 200: { description: 'ok' } } } } },
      },
    });

    // When
    const finding = buildDoctorReport(document).findings.find(
      (entry) => entry.rule === 'operation-key-unread',
    );

    // Then
    expect(finding?.message).toContain('additionalOperations');
    expect(finding?.suggestion).toContain('move the operation');
    expect(finding?.suggestion).not.toContain('rename');
  });
});

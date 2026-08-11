import { describe, expect, it } from 'vitest';
import {
  ErrorCode,
  hashDocument,
  MAX_SPECIFICATION_LENGTH,
  NormalizeError,
  normalizeOpenApiDocument,
  OpenRefError,
  parseSpecification,
} from '../../src/index';

/**
 * Documents that are hostile rather than merely malformed, per T016.
 *
 * The distinction this file is about: a malformed document is refused, and refusing is cheap.
 * A hostile one is well formed and expensive, and the failure it produces is a process that
 * does not come back rather than an error anybody sees. Every case here was measured before it
 * was written down.
 */

function wideDocument(operations: number): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  for (let index = 0; index < operations; index += 1) {
    paths[`/resource${String(index)}`] = {
      get: {
        operationId: `get${String(index)}`,
        summary: `Get resource ${String(index)}`,
        tags: [`tag${String(index % 20)}`],
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Thing' } } },
          },
        },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Wide', version: '1.0.0' },
    paths,
    components: { schemas: { Thing: { type: 'object', properties: { id: { type: 'string' } } } } },
  };
}

describe('a document of ten thousand operations', () => {
  it('should normalize every operation into a node, once', () => {
    // Given
    const source = wideDocument(10_000);

    // When
    const document = normalizeOpenApiDocument(source);

    // Then, one node each and one schema in total, because a named schema is registered once
    // however many use sites point at it. A count that grew with the operations would be the
    // inlining that SPEC 5.1.1 replaced, back again.
    expect(document.nodes.size).toBe(10_000);
    expect(document.schemas.size).toBe(1);
  }, 120_000);

  it('should hash a document of ten thousand operations', () => {
    // Given, the hash is the SSR cache key, so a width that cannot be hashed is a width that
    // cannot be served.
    const document = normalizeOpenApiDocument(wideDocument(10_000));

    // When
    const digest = hashDocument(document);

    // Then
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  }, 120_000);

  it('should give the same hash on two runs over the same width', () => {
    // Given
    const source = wideDocument(2_000);

    // When
    const hashes = [
      hashDocument(normalizeOpenApiDocument(source)),
      hashDocument(normalizeOpenApiDocument(source)),
    ];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  }, 120_000);
});

describe('a document larger than intake will read', () => {
  it('should refuse a document past the declared length with a code', () => {
    // Given, a document of 50 MB of the shape measured in T016 had not returned from a single
    // synchronous parse after ten minutes. There was no refusal at any size.
    const text = `openapi: 3.1.0\n${'#'.repeat(MAX_SPECIFICATION_LENGTH)}`;

    // When
    const parse = (): unknown => parseSpecification(text);

    // Then
    expect(parse).toThrow(NormalizeError);
    try {
      parse();
    } catch (error) {
      expect((error as NormalizeError).code).toBe(ErrorCode.NORM_DOCUMENT_TOO_LARGE);
    }
  }, 120_000);

  it('should refuse before parsing rather than after, which is the whole point', () => {
    // Given, a document that is both too long and unparseable. If the size check ran after
    // the parse, the parse is what would be reported, and only if it ever finished.
    const text = `{{{{ not json ${'x'.repeat(64)}`;

    // When
    let code: ErrorCode | undefined;
    try {
      parseSpecification(text, { maxLength: 16 });
    } catch (error) {
      code = (error as OpenRefError).code;
    }

    // Then
    expect(code).toBe(ErrorCode.NORM_DOCUMENT_TOO_LARGE);
  });

  it('should leave the largest document in the corpus far below the limit', () => {
    // Given, Stripe is 6.4 MB. A limit that a real document could reach would be a limit that
    // refuses real work.
    const stripeBytes = 6_364_174;

    // When
    const headroom = MAX_SPECIFICATION_LENGTH / stripeBytes;

    // Then
    expect(headroom).toBeGreaterThan(4);
  });
});

describe('a YAML document that expands as it is read', () => {
  it('should refuse an alias bomb rather than expand it', () => {
    // Given, six levels of ten aliases each, which expands to a million copies of the anchor.
    const bomb = [
      'openapi: 3.1.0',
      'info:',
      '  title: Bomb',
      '  version: "1"',
      `  description: &a "${'x'.repeat(1000)}"`,
      'x-b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]',
      'x-c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
      'x-d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]',
      'x-e: &e [*d,*d,*d,*d,*d,*d,*d,*d,*d,*d]',
      'x-f: &f [*e,*e,*e,*e,*e,*e,*e,*e,*e,*e]',
      'x-g: &g [*f,*f,*f,*f,*f,*f,*f,*f,*f,*f]',
      'paths: {}',
    ].join('\n');

    // When
    const parse = (): unknown => parseSpecification(bomb);

    // Then, refused, and refused as one of ours rather than as whatever the parser threw
    expect(parse).toThrow(OpenRefError);
    expect(parse).toThrow(NormalizeError);
  }, 60_000);

  it('should refuse a mapping that declares the same key twice', () => {
    // Given, two `get` operations under one path. Silently keeping one of them would make the
    // rendered reference disagree with the document about what the API offers.
    const text = [
      'openapi: 3.1.0',
      'info: {title: Dup, version: "1"}',
      'paths:',
      '  /a:',
      '    get: {operationId: one, responses: {"200": {description: ok}}}',
      '    get: {operationId: two, responses: {"200": {description: ok}}}',
    ].join('\n');

    // When
    const parse = (): unknown => parseSpecification(text);

    // Then
    expect(parse).toThrow(NormalizeError);
  });
});

import { describe, expect, it } from 'vitest';
import { canonicalize, hash, hashDocument, normalizeOpenApiDocument } from '../../src/index';
import { createDocumentFixture, createRandom, shuffleKeys } from '../mocks/document.mock';
import { createExternalReferenceSource, createForgedExternalIdSource } from '../mocks/openapi.mock';

describe('determinism of the document hash', () => {
  it('should produce one hash for 1000 shuffled variants of the same document', () => {
    // Given
    const document = createDocumentFixture();
    const random = createRandom(20260809);
    const expected = hashDocument(document);

    // When
    const hashes = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      hashes.add(hash(shuffleKeys({ ...document, hash: '' }, random)));
    }

    // Then
    expect(hashes.size).toBe(1);
    expect([...hashes]).toEqual([expected]);
  });

  it('should ignore the hash field itself, so the field stays verifiable', () => {
    // Given
    const document = createDocumentFixture();
    const stamped = { ...document, hash: 'deadbeef' };

    // When
    const hashes = [hashDocument(document), hashDocument(stamped)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('should hash a response map written in either key order identically', () => {
    // Given
    const ascending = { responses: { '200': 'ok', '404': 'gone', default: 'other' } };
    const descending = { responses: { '404': 'gone', default: 'other', '200': 'ok' } };

    // When
    const hashes = [hash(ascending), hash(descending)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });

  it('should produce a different hash for a document that actually differs', () => {
    // Given
    const document = createDocumentFixture();
    const changed = {
      ...document,
      info: { ...document.info, version: '1.4.1' },
    };

    // When
    const hashes = [hashDocument(document), hashDocument(changed)];

    // Then
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('should notice a change buried inside a map value', () => {
    // Given
    const document = createDocumentFixture();
    const node = document.nodes.get('get-orders');
    const nodes = new Map(document.nodes);
    if (node?.kind === 'operation') {
      nodes.set('get-orders', { ...node, deprecated: true });
    }

    // When
    const hashes = [hashDocument(document), hashDocument({ ...document, nodes })];

    // Then
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('should canonicalize a shuffled variant to byte identical text', () => {
    // Given
    const document = createDocumentFixture();
    const random = createRandom(7);

    // When
    const original = canonicalize(document);
    const shuffledText = canonicalize(shuffleKeys(document, random));

    // Then
    expect(shuffledText).toBe(original);
  });

  it('should be stable across a rebuild of the same fixture', () => {
    // Given
    const first = createDocumentFixture();
    const second = createDocumentFixture();

    // When
    const hashes = [hashDocument(first), hashDocument(second)];

    // Then
    expect(hashes[0]).toBe(hashes[1]);
  });
});

/**
 * The half of the determinism mandate that was never taken, per SPEC 5.3 as amended by T016.
 *
 * Everything above shuffles an IR document that was built by hand. Nothing above ever built one
 * from a source document, and nothing above carried an external reference, so the construction
 * of the external id space had no test at all. F1 lived in that gap from T002 until the
 * adversarial pass, and the corpus could not have caught it either: not one of its documents
 * has an external `$ref` in it.
 */
describe('determinism of a document carrying external references', () => {
  it('should produce one hash for 1000 shuffled variants of a document with external references', () => {
    // Given
    const source = createExternalReferenceSource();
    const random = createRandom(20260811);

    // When
    const hashes = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      const shuffled = shuffleKeys(source.root, random);
      hashes.add(
        normalizeOpenApiDocument(shuffled, { externalDocuments: source.externalDocuments }).hash,
      );
    }

    // Then
    expect(hashes.size).toBe(1);
  }, 60_000);

  it('should produce one hash for 1000 shuffled variants of a document that forges an external id', () => {
    // Given, `~x20b4b690~Order` is the id `common.yaml#/components/schemas/Order` is filed
    // under. Before the amendment its equivalent took that id, the registry dropped whichever
    // body the walk reached second, and the graph followed the order of two properties.
    const source = createForgedExternalIdSource();
    const random = createRandom(20260811);

    // When
    const hashes = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      const shuffled = shuffleKeys(source.root, random);
      hashes.add(
        normalizeOpenApiDocument(shuffled, { externalDocuments: source.externalDocuments }).hash,
      );
    }

    // Then
    expect(hashes.size).toBe(1);
  }, 60_000);

  it('should keep both bodies when a document names a schema after an external id', () => {
    // Given
    const source = createForgedExternalIdSource();

    // When
    const document = normalizeOpenApiDocument(source.root, {
      externalDocuments: source.externalDocuments,
    });

    // Then, the external target keeps the id it earns and the imitation escapes into the
    // internal space beside it. Neither is lost and neither renders as the other.
    expect(document.schemas.get('~x20b4b690~Order')?.normalized).toMatchObject({
      title: 'THE REAL ORDER',
      type: 'object',
    });
    expect(document.schemas.get('~~x20b4b690~~Order')?.normalized).toMatchObject({
      title: 'ATTACKER BODY',
      type: 'string',
    });
  });

  it('should hash a forged document differently from the honest one it imitates', () => {
    // Given, absorbing the forgery silently would be the same defect wearing a new id scheme.
    const honest = createExternalReferenceSource();
    const forged = createForgedExternalIdSource();

    // When
    const hashes = [
      normalizeOpenApiDocument(honest.root, { externalDocuments: honest.externalDocuments }).hash,
      normalizeOpenApiDocument(forged.root, { externalDocuments: forged.externalDocuments }).hash,
    ];

    // Then
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('should give one id to two references written with different percent encoding', () => {
    // Given, the same target twice. Comparing reference text rather than the parsed target
    // would report this as a collision and refuse a document that breaks no rule.
    const source = createExternalReferenceSource();
    const root = {
      ...source.root,
      paths: {
        '/orders': {
          get: {
            operationId: 'listOrders',
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Problem' } },
                  'application/problem+json': {
                    schema: { $ref: '#/components/schemas/Proble%6D' },
                  },
                },
              },
            },
          },
        },
      },
    };

    // When
    const document = normalizeOpenApiDocument(root, {
      externalDocuments: source.externalDocuments,
    });

    // Then
    const problems = [...document.schemas.keys()].filter((id) => id.includes('Proble'));
    expect(problems).toEqual(['Problem']);
  });
});

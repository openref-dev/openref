import { describe, expect, it } from 'vitest';
import { CANONICAL_MAP_ORDER } from '../../src/hashing/domain/canonical-order';
import { canonicalize, hash, hashDocument, normalizeOpenApiDocument } from '../../src/index';
import type { IRSchema } from '../../src/index';
import {
  AUTHORED_KEY_MEMBERS,
  AUTHORED_ORDER_MEMBERS,
  AUTHORED_TREE_MEMBERS,
  createDocumentFixture,
  createRandom,
  shuffleEquivalentKeys,
} from '../mocks/document.mock';
import { createExternalReferenceSource, createForgedExternalIdSource } from '../mocks/openapi.mock';

/**
 * An order sensitive rendering of a value, for asserting that a shuffle actually shuffled.
 *
 * `JSON.stringify` cannot do this job: it writes a `Map` as `{}`, so the entry order of the three
 * document maps would be invisible and a degenerate shuffle could hide inside the figure.
 */
function spelling(value: unknown): string {
  if (value instanceof Map) {
    const entries = [...(value as Map<unknown, unknown>).entries()];
    return `M[${entries.map(([key, held]) => `${String(key)}:${spelling(held)}`).join(',')}]`;
  }
  if (Array.isArray(value)) {
    return `A[${(value as readonly unknown[]).map((item) => spelling(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const keys = Object.keys(source);
    return `O{${keys.map((key) => `${key}:${spelling(source[key])}`).join(',')}}`;
  }
  return String(value);
}

describe('determinism of the document hash', () => {
  it('should produce one hash for 1000 equivalently shuffled variants of the same document', () => {
    // Given
    const document = createDocumentFixture();
    const random = createRandom(20260809);
    const expected = hashDocument(document);

    // When
    const hashes = new Set<string>();
    const spellings = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      const shuffled = shuffleEquivalentKeys({ ...document, hash: '' }, random);
      spellings.add(spelling(shuffled));
      hashes.add(hash(shuffled));
    }

    // Then, the spellings really were different first. A shuffle that had degenerated to the
    // identity would satisfy every other assertion in this case while proving nothing.
    expect(spellings.size).toBeGreaterThan(900);
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

  it('should canonicalize an equivalently shuffled variant to byte identical text', () => {
    // Given
    const document = createDocumentFixture();
    const random = createRandom(7);
    const shuffledDocument = shuffleEquivalentKeys(document, random);

    // When
    const original = canonicalize(document);
    const shuffledText = canonicalize(shuffledDocument);

    // Then, the input moved and the output did not.
    expect(spelling(shuffledDocument)).not.toBe(spelling(document));
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
 * The other half of SPEC 5.3, and the half that did not exist until 2026-09-01.
 *
 * A suite that only proves shuffling changes nothing proves the hash is stable, not that it is the
 * document's identity. The exception has to be shown from both sides: an order the document wrote
 * moves the hash, and an order it did not write does not. Either case alone would stay green if
 * the exception covered every map or none of them.
 */
describe('the hash carries an order the document wrote, per SPEC 5.3', () => {
  /** The same schema with its property map written the other way round, and nothing else moved. */
  function reversedProperties(schema: IRSchema): IRSchema {
    const normalized = schema.normalized;
    if (normalized?.properties === undefined) {
      throw new Error('the fixture schema no longer carries a property map');
    }
    return {
      ...schema,
      normalized: {
        ...normalized,
        properties: Object.fromEntries(Object.entries(normalized.properties).reverse()),
      },
    };
  }

  it('should give a different hash to a document whose property order was reversed', () => {
    // Given, one schema of the fixture rewritten with its properties in the opposite order.
    const document = createDocumentFixture();
    const order = document.schemas.get('Order');
    if (order === undefined) throw new Error('the fixture no longer carries the Order schema');
    const schemas = new Map(document.schemas);
    schemas.set('Order', reversedProperties(order));
    const reversed = { ...document, schemas };

    // When
    const forwardNames = Object.keys(order.normalized?.properties ?? {});
    const reversedNames = Object.keys(schemas.get('Order')?.normalized?.properties ?? {});

    // Then, the subject is present: four names, the same four, in a different order. Without
    // this the case could pass on a schema that had one property or none.
    expect(forwardNames.length).toBeGreaterThan(1);
    expect([...reversedNames].sort()).toEqual([...forwardNames].sort());
    expect(reversedNames).not.toEqual(forwardNames);

    // Then, and that difference alone moves the hash.
    expect(hashDocument(reversed)).not.toBe(hashDocument(document));
  });

  it('should write a property map in the document order rather than sorted', () => {
    // Given, a property order that is not the sorted one, so the two answers are tellable apart.
    const document = createDocumentFixture();
    const names = Object.keys(document.schemas.get('Order')?.normalized?.properties ?? {});

    // When
    const text = canonicalize(document);
    const positions = names.map((name) => text.indexOf(`"${name}":`));

    // Then
    expect(names).not.toEqual([...names].sort());
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it('should still sort a map whose keys the normalizer builds', () => {
    // Given, the node map written the other way round. Its order is walk order, per SPEC 5.1.1.
    const document = createDocumentFixture();
    const entries = [...document.nodes.entries()];
    const reversed = { ...document, nodes: new Map([...entries].reverse()) };

    // Then, the subject is present and the hash does not move with it.
    expect(entries.length).toBeGreaterThan(1);
    expect([...reversed.nodes.keys()]).not.toEqual([...document.nodes.keys()]);
    expect(hashDocument(reversed)).toBe(hashDocument(document));
  });

  it('should hold the same list of authored maps as the canonical form does', () => {
    // Given, the shuffler's lists are written by hand so that they cannot follow the record.
    const recorded = Object.entries(CANONICAL_MAP_ORDER)
      .filter(([, verdict]) => verdict !== 'sorted')
      .map(([member]) => member)
      .sort();

    // When
    const declared = [...AUTHORED_KEY_MEMBERS, ...AUTHORED_TREE_MEMBERS].sort();

    // Then, both directions, so neither list can gain or lose a name on its own.
    expect(declared).toEqual(recorded);
    expect(recorded.length).toBeGreaterThan(0);
  });

  it('should split the two authored lists exactly as the record splits its two verdicts', () => {
    // Given, one verdict keeps a map's own keys and returns to the IR below it; the other keeps
    // every level. A shuffler that confused them would permute inside a raw path schema.
    const keyed = Object.entries(CANONICAL_MAP_ORDER)
      .filter(([, verdict]) => verdict === 'ordered')
      .map(([member]) => member)
      .sort();
    const tree = Object.entries(CANONICAL_MAP_ORDER)
      .filter(([, verdict]) => verdict === 'ordered-tree')
      .map(([member]) => member)
      .sort();

    // Then, both directions on both lists
    expect([...AUTHORED_KEY_MEMBERS].sort()).toEqual(keyed);
    expect([...AUTHORED_TREE_MEMBERS].sort()).toEqual(tree);
    expect(keyed.length).toBeGreaterThan(0);
    expect(tree.length).toBeGreaterThan(0);
  });

  it('should leave every map the record calls sorted out of the shuffler exception', () => {
    // Given
    const sorted = Object.entries(CANONICAL_MAP_ORDER)
      .filter(([, verdict]) => verdict === 'sorted')
      .map(([member]) => member);

    // When
    const leaked = sorted.filter((member) => AUTHORED_ORDER_MEMBERS.includes(member));

    // Then, the subject is present: there are sorted maps, and none of them is in the list.
    // `value` is here because one name serves `IRExample.value` and `IRFact.value` and the
    // serializer sees only the name, which the record states in full.
    // `guardSchemes` joined them at `TX-INSTRUMENT`: the host writes the mapping and nothing
    // renders it in order, so hashing the order two guards were written in would invalidate a
    // cache over nothing.
    expect(sorted).toEqual(['nodes', 'schemas', 'webhooks', 'value', 'guardSchemes']);
    expect(leaked).toEqual([]);
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
    const spellings = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      const shuffled = shuffleEquivalentKeys(source.root, random);
      spellings.add(spelling(shuffled));
      hashes.add(
        normalizeOpenApiDocument(shuffled, { externalDocuments: source.externalDocuments }).hash,
      );
    }

    // Then
    expect(spellings.size).toBeGreaterThan(900);
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
    const spellings = new Set<string>();
    for (let variant = 0; variant < 1000; variant += 1) {
      const shuffled = shuffleEquivalentKeys(source.root, random);
      spellings.add(spelling(shuffled));
      hashes.add(
        normalizeOpenApiDocument(shuffled, { externalDocuments: source.externalDocuments }).hash,
      );
    }

    // Then
    expect(spellings.size).toBeGreaterThan(900);
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

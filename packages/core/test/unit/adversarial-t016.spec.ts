import { describe, expect, it } from 'vitest';
import {
  CANONICAL_MAX_DEPTH,
  canonicalize,
  createSchemaRegistry,
  DEFAULT_MAX_SCHEMA_NESTING,
  ErrorCode,
  hash,
  MAX_NORMALIZE_RECURSION,
  NormalizeError,
  normalizeSchema,
  normalizeSchemaGraph,
  OpenRefError,
  parseJsonPointer,
  RefResolutionError,
  resolveJsonPointer,
  schemaIdForReference,
  schemaNameFromId,
  schemaNameFromReference,
} from '../../src/index';

/**
 * Regressions for the findings of the T016 adversarial pass over M0.
 *
 * Each block names the finding it pins and states what used to happen, because a regression
 * test that does not say what it caught reads as an ordinary test and gets deleted as one.
 */

function nestedSchema(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = { type: 'string' };
  for (let index = 0; index < levels; index += 1) {
    node = { type: 'object', properties: { child: node } };
  }
  return node;
}

function nestedValue(levels: number): Record<string, unknown> {
  let node: Record<string, unknown> = { leaf: 1 };
  for (let index = 0; index < levels; index += 1) {
    node = { child: node };
  }
  return node;
}

function chainedDocument(links: number): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (let index = 0; index < links; index += 1) {
    schemas[`Link${String(index)}`] =
      index === links - 1
        ? { type: 'string' }
        : { $ref: `#/components/schemas/Link${String(index + 1)}` };
  }
  return { components: { schemas } };
}

function allOfChainedDocument(links: number): Record<string, unknown> {
  const schemas: Record<string, unknown> = {};
  for (let index = 0; index < links; index += 1) {
    schemas[`Link${String(index)}`] =
      index === links - 1
        ? { type: 'object', properties: { end: { type: 'string' } } }
        : {
            allOf: [
              { $ref: `#/components/schemas/Link${String(index + 1)}` },
              { type: 'object', properties: { [`p${String(index)}`]: { type: 'string' } } },
            ],
          };
  }
  return { components: { schemas } };
}

describe('F1, the id space a document could forge from the inside', () => {
  it('should file an internal name that imitates an external id in the internal space', () => {
    // Given, `~x20b4b690~Order` is the id `common.yaml#/components/schemas/Order` earns.
    const imitation = '#/components/schemas/~x20b4b690~Order';

    // When
    const forged = schemaIdForReference(imitation);
    const genuine = schemaIdForReference('common.yaml#/components/schemas/Order');

    // Then
    expect(forged).toBe('~~x20b4b690~~Order');
    expect(genuine).toBe('~x20b4b690~Order');
    expect(forged).not.toBe(genuine);
  });

  it('should keep the two id spaces disjoint for every name that tries to cross', () => {
    // Given, names picked to sit on the boundary of the escaping rather than far from it.
    const names = [
      '~x20b4b690~Order',
      '~',
      '~~',
      '~x',
      '~xdeadbeef~',
      'Order',
      '~~x20b4b690~~Order',
      'x20b4b690~Order',
    ];

    // When
    const internal = names.map((name) => schemaIdForReference(`#/components/schemas/${name}`));
    const external = names.map((name) =>
      schemaIdForReference(`common.yaml#/components/schemas/${name}`),
    );

    // Then, no internal id equals any external id, and no id is produced twice
    expect(new Set(internal).size).toBe(names.length);
    expect(new Set(external).size).toBe(names.length);
    for (const id of internal) {
      expect(external).not.toContain(id);
    }
  });

  it('should recover the name a document gave a schema from either space', () => {
    // Given, the human part is what a reader is shown, per SPEC 5.1.1.
    const names = ['Order', '~x20b4b690~Order', '~', 'Order_Line', 'Café'];

    // When
    const roundTripped = names.map((name) => {
      const id = schemaIdForReference(`#/components/schemas/${name}`) ?? '';
      return schemaNameFromId(id);
    });
    const external = names.map((name) => {
      const id = schemaIdForReference(`common.yaml#/components/schemas/${name}`) ?? '';
      return schemaNameFromId(id);
    });

    // Then
    expect(roundTripped).toEqual(names);
    expect(external).toEqual(names);
  });

  it('should refuse two different targets that land on one id rather than lose a body', () => {
    // Given, two pointers into one external document whose last segments agree. The id carries
    // the document and the name, so both arrive at the same one.
    const registry = createSchemaRegistry();
    const first = 'common.yaml#/components/schemas/Order';
    const second = 'common.yaml#/definitions/Order';
    const id = schemaIdForReference(first) ?? '';

    // When
    registry.ensure(id, first, () => ({ type: 'object' }));
    const refuse = (): void => {
      registry.ensure(id, second, () => ({ type: 'string' }));
    };

    // Then
    expect(refuse).toThrow(NormalizeError);
    expect(refuse).toThrow(/both filed under the schema id/);
    try {
      refuse();
    } catch (error) {
      expect((error as NormalizeError).code).toBe(ErrorCode.NORM_SCHEMA_ID_COLLISION);
      expect((error as NormalizeError).context?.references).toEqual([first, second]);
    }
  });

  it('should name the two references in one order however the walk reached them', () => {
    // Given, an error that reported them as first and second would describe one defect two
    // ways and put the order dependence back, one level up, in the text.
    const first = 'common.yaml#/components/schemas/Order';
    const second = 'common.yaml#/definitions/Order';
    const id = schemaIdForReference(first) ?? '';

    // When
    const messages = [
      [first, second],
      [second, first],
    ].map(([left, right]) => {
      const registry = createSchemaRegistry();
      registry.ensure(id, left ?? '', () => ({ type: 'object' }));
      try {
        registry.ensure(id, right ?? '', () => ({ type: 'string' }));
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    });

    // Then
    expect(messages[0]).toBe(messages[1]);
  });

  it('should treat one target written with different percent encoding as one target', () => {
    // Given
    const registry = createSchemaRegistry();
    const plain = '#/components/schemas/Order';
    const encoded = '#/components/schemas/Or%64er';
    const id = schemaIdForReference(plain) ?? '';

    // When
    registry.ensure(id, plain, () => ({ type: 'object' }));
    const again = (): void => {
      registry.ensure(id, encoded, () => ({ type: 'object' }));
    };

    // Then
    expect(again).not.toThrow();
    expect(registry.entries().size).toBe(1);
    expect(registry.entries().get(id)).toEqual({ type: 'object' });
  });
});

describe('F2, the band where a document normalized and could not then be hashed', () => {
  it('should keep the canonical limit at or above what the normalizer can produce', () => {
    // Given, the two constants live in modules that may not import each other, because the
    // hashing path takes nothing from the normalizer. So they are checked here instead.
    // When
    const written = DEFAULT_MAX_SCHEMA_NESTING * 2;

    // Then
    expect(CANONICAL_MAX_DEPTH).toBeGreaterThanOrEqual(DEFAULT_MAX_SCHEMA_NESTING);
    expect(CANONICAL_MAX_DEPTH).toBeGreaterThan(written);
  });

  it('should refuse a value nested past the canonical limit with a code, not a RangeError', () => {
    // Given
    const value = nestedValue(CANONICAL_MAX_DEPTH + 10);

    // When
    const serialize = (): string => canonicalize(value);

    // Then
    expect(serialize).toThrow(OpenRefError);
    expect(serialize).not.toThrow(RangeError);
    try {
      serialize();
    } catch (error) {
      expect((error as OpenRefError).code).toBe(ErrorCode.NORM_DEPTH_EXCEEDED);
    }
  });

  it('should refuse a schema nested past the normalizer limit with a code, not a RangeError', () => {
    // Given
    const input = nestedSchema(DEFAULT_MAX_SCHEMA_NESTING + 10);

    // When
    const normalize = (): unknown => normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(normalize).toThrow(OpenRefError);
    expect(normalize).not.toThrow(RangeError);
    try {
      normalize();
    } catch (error) {
      expect((error as OpenRefError).code).toBe(ErrorCode.NORM_DEPTH_EXCEEDED);
    }
  });

  it('should hash everything the normalizer accepts, which is what closes the band', () => {
    // Given, the deepest schema the normalizer will take. Before T016 this normalized and
    // then could not be hashed, so the SSR cache key did not exist for it.
    const input = nestedSchema(DEFAULT_MAX_SCHEMA_NESTING - 2);

    // When
    const graph = normalizeSchemaGraph(input, { rootDocument: {} });
    const digest = hash(graph);

    // Then
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should resolve a chain of named references far past any stack it could have used', () => {
    // Given, 5000 links. This is the shape that used to cost stack in proportion to its
    // length, and that exhausted the engine's stack at about 900 links while nesting nothing.
    // The registry queues a named body instead of making it in place, so the cost is now flat.
    const document = chainedDocument(5000);

    // When
    const graph = normalizeSchemaGraph(
      { $ref: '#/components/schemas/Link0' },
      { rootDocument: document },
    );

    // Then
    expect(graph.schemas.size).toBe(5000);
    expect(canonicalize(graph)).toContain('Link4999');
  });

  it('should refuse an allOf chain longer than the recursion limit with a code', () => {
    // Given, merging is the one case SPEC 5.1.1 requires to resolve its target rather than
    // point at it, so an `allOf` chain is the only shape left that recurses with the document.
    const document = allOfChainedDocument(MAX_NORMALIZE_RECURSION * 2);

    // When
    const normalize = (): unknown =>
      normalizeSchemaGraph({ $ref: '#/components/schemas/Link0' }, { rootDocument: document });

    // Then
    expect(normalize).toThrow(OpenRefError);
    expect(normalize).not.toThrow(RangeError);
    try {
      normalize();
    } catch (error) {
      expect((error as OpenRefError).code).toBe(ErrorCode.NORM_DEPTH_EXCEEDED);
    }
  });

  it('should still find a broken reference buried inside a queued named schema', () => {
    // Given, deferring production without draining would make the normalizer fail open, which
    // is the one thing it may not do. Nothing in the walk itself reaches this reference.
    const document = {
      components: {
        schemas: {
          Order: { $ref: '#/components/schemas/Missing' },
        },
      },
    };

    // When
    const normalize = (): unknown =>
      normalizeSchema({ $ref: '#/components/schemas/Order' }, { rootDocument: document });

    // Then
    expect(normalize).toThrow(RefResolutionError);
  });
});

describe('F3, the URIError that left core wearing a foreign type', () => {
  const malformed = ['/a%', '/a%zz', '/%', '/%E0%A4%A', '/components/schemas/Disc%unt'];

  for (const pointer of malformed) {
    it(`should refuse the pointer ${pointer} with an error contract`, () => {
      // Given, `decodeURIComponent` throws a bare URIError on each of these.
      // When
      const parse = (): string[] => parseJsonPointer(pointer);

      // Then
      expect(parse).toThrow(RefResolutionError);
      expect(parse).not.toThrow(URIError);
      try {
        parse();
      } catch (error) {
        expect((error as RefResolutionError).code).toBe(ErrorCode.NORM_REF_MALFORMED);
        expect((error as RefResolutionError).cause).toBeInstanceOf(URIError);
      }
    });
  }

  it('should refuse a malformed reference through every public entry that reads one', () => {
    // Given
    const reference = '#/components/schemas/Disc%unt';
    const entries: (() => unknown)[] = [
      () => normalizeSchema({ $ref: reference }, { rootDocument: {} }),
      () => resolveJsonPointer({}, '/components/schemas/Disc%unt'),
      () => schemaNameFromReference(reference),
      () => schemaIdForReference(reference),
    ];

    // When
    const escaped = entries.filter((entry) => {
      try {
        entry();
        return true;
      } catch (error) {
        return !(error instanceof OpenRefError);
      }
    });

    // Then
    expect(escaped).toEqual([]);
  });
});

describe('F5, two schema names that no reader can tell apart', () => {
  const composed = 'Café';
  const decomposed = 'Café';

  it('should file a name written NFC and the same name written NFD under one id', () => {
    // Given, the two strings differ and no browser distinguishes them, so navigation, deep
    // links and, from T039, static filenames cannot either.
    expect(composed).not.toBe(decomposed);

    // When
    const ids = [composed, decomposed].map((name) =>
      schemaIdForReference(`#/components/schemas/${name}`),
    );

    // Then
    expect(ids[0]).toBe(ids[1]);
    expect(ids[0]).toBe(composed);
  });

  it('should normalize the document URI of an external target as well', () => {
    // Given, the same document named two ways would otherwise register two entries.
    // When
    const ids = [
      schemaIdForReference(`café.yaml#/components/schemas/Order`),
      schemaIdForReference(`café.yaml#/components/schemas/Order`),
    ];

    // Then
    expect(ids[0]).toBe(ids[1]);
  });

  it('should refuse two different bodies whose names agree only after normalization', () => {
    // Given
    const document = {
      components: {
        schemas: {
          [composed]: { type: 'object' },
          [decomposed]: { type: 'string' },
        },
      },
    };

    // When
    const normalize = (): unknown =>
      normalizeSchemaGraph(
        {
          allOf: [
            { $ref: `#/components/schemas/${composed}` },
            { $ref: `#/components/schemas/${decomposed}` },
          ],
        },
        { rootDocument: document },
      );

    // Then
    expect(normalize).toThrow(NormalizeError);
    try {
      normalize();
    } catch (error) {
      expect((error as NormalizeError).code).toBe(ErrorCode.NORM_SCHEMA_ID_COLLISION);
    }
  });
});

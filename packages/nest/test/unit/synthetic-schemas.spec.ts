import { describe, expect, it } from 'vitest';
import { envelope, paginated } from '../../src/schemas/api/generics';
import {
  mergeSyntheticSchemas,
  SyntheticSchemaRegistry,
} from '../../src/schemas/domain/synthetic-schemas';

/**
 * The generic factories of SPEC 13.5, and the four properties the section actually rests on.
 *
 * Determinism, uniqueness, no duplicates, and a collision that fails the build. The first three
 * are what `openref diff` needs to stop reporting breaking changes that did not happen; the fourth
 * is what stops two different schemas reaching a generated SDK under one client type name.
 *
 * EVERY CASE BUILDS ITS OWN REGISTRY. The one the factories write into by default is process wide,
 * because decorators run at import time, and a suite sharing it would have each case's schemas
 * visible to the next. That is also why the collision cases can be written at all.
 */

class CatDto {
  name = '';
}
class DogDto {
  name = '';
}
class PageMeta {
  total = 0;
}
class CursorMeta {
  cursor = '';
}

/** A document with one schema already in it, which is what a host's own DTO looks like. */
function documentWith(...names: readonly string[]): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    paths: {},
    components: {
      schemas: Object.fromEntries(names.map((name) => [name, { type: 'object' }])),
    },
  };
}

describe('the synthetic schema names', () => {
  it('should be the wrapper and the inner type, and nothing generated', () => {
    // Given, SPEC 13.5: `PaginatedCatDto`, not `PaginatedResponseDto_1`
    const registry = new SyntheticSchemaRegistry();

    // When
    const page = paginated(CatDto, { registry });
    const wrapped = envelope(DogDto, { registry, meta: PageMeta });

    // Then
    expect(page.schema).toEqual({ $ref: '#/components/schemas/PaginatedCatDto' });
    expect(wrapped.schema).toEqual({ $ref: '#/components/schemas/EnvelopeDogDto' });
  });

  it('should be identical across two builds', () => {
    // Given two registries, which is what two processes are
    const first = new SyntheticSchemaRegistry();
    const second = new SyntheticSchemaRegistry();

    // When
    paginated(CatDto, { registry: first });
    envelope(DogDto, { registry: first, meta: PageMeta });
    envelope(DogDto, { registry: second, meta: PageMeta });
    paginated(CatDto, { registry: second });

    // Then, the same names, the same bodies and the same order, even though the calls were made
    // in a different order. Anything else is a false breaking change in `openref diff`.
    expect(second.entries()).toEqual(first.entries());
  });

  it('should be unique within one build', () => {
    // Given
    const registry = new SyntheticSchemaRegistry();

    // When
    paginated(CatDto, { registry });
    paginated(DogDto, { registry });
    envelope(CatDto, { registry });

    // Then
    const names = registry.entries().map((entry) => entry.name);
    expect(names).toEqual(['EnvelopeCatDto', 'PaginatedCatDto', 'PaginatedDogDto']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should refuse a type with no name rather than invent one', () => {
    // Given an anonymous class, which is also what a minified build leaves behind
    const registry = new SyntheticSchemaRegistry();
    const anonymous = (() =>
      class {
        value = 0;
      })();

    // When, Then
    expect(() => paginated(anonymous, { registry })).toThrow(/has no name/);
  });
});

describe('the cache on the wrapper and inner pair', () => {
  it('should register one schema however many times it is asked for', () => {
    // Given, SPEC 13.5: no duplicates in `components.schemas`
    const registry = new SyntheticSchemaRegistry();

    // When
    const first = paginated(CatDto, { registry });
    const second = paginated(CatDto, { registry });

    // Then
    expect(second.schema).toEqual(first.schema);
    expect(registry.entries()).toHaveLength(1);
  });

  it('should keep two wrappers over one type apart', () => {
    // Given, the pair is the key, so one half changing is a different entry
    const registry = new SyntheticSchemaRegistry();

    // When
    paginated(CatDto, { registry });
    envelope(CatDto, { registry });

    // Then
    expect(registry.entries().map((entry) => entry.name)).toEqual([
      'EnvelopeCatDto',
      'PaginatedCatDto',
    ]);
  });
});

describe('collision detection', () => {
  it('should fail the build naming both sources when two envelopes want one name', () => {
    // Given, SPEC 13.5 names the wrapper and the inner type and not the metadata, so two
    // envelopes over one type collide by construction. That is the case the check exists for.
    const registry = new SyntheticSchemaRegistry();
    envelope(CatDto, { registry, meta: PageMeta });

    // When, Then, and the message names both calls rather than only the name they wanted
    expect(() => envelope(CatDto, { registry, meta: CursorMeta })).toThrow(
      /EnvelopeCatDto.*envelope\(CatDto, \{ meta: PageMeta \}\).*envelope\(CatDto, \{ meta: CursorMeta \}\)/s,
    );
  });

  it('should fail the build when the document already declares the name', () => {
    // Given a host that has its own `PaginatedCatDto` DTO
    const registry = new SyntheticSchemaRegistry();
    paginated(CatDto, { registry });

    // When, Then
    expect(() =>
      mergeSyntheticSchemas(documentWith('CatDto', 'PaginatedCatDto'), registry),
    ).toThrow(/PaginatedCatDto.*already in the document.*paginated\(CatDto\)/s);
  });
});

describe('the merge into the source document', () => {
  it('should add every registered schema and leave the rest of the document alone', () => {
    // Given
    const registry = new SyntheticSchemaRegistry();
    paginated(CatDto, { registry });
    const document = documentWith('CatDto');

    // When
    const merged = mergeSyntheticSchemas(document, registry) as Record<string, unknown>;

    // Then
    const components = merged.components as { schemas: Record<string, unknown> };
    expect(Object.keys(components.schemas).sort()).toEqual(['CatDto', 'PaginatedCatDto']);
    expect(components.schemas.PaginatedCatDto).toEqual({
      type: 'object',
      required: ['items', 'total'],
      properties: {
        items: { type: 'array', items: { $ref: '#/components/schemas/CatDto' } },
        total: { type: 'integer', description: 'How many items match, across all pages.' },
        page: { type: 'integer', description: 'One based index of this page.' },
        perPage: { type: 'integer', description: 'How many items a full page holds.' },
      },
    });
    expect(merged.info).toEqual(document.info);
  });

  it('should not modify the document it was given', () => {
    // Given, the host's object may be theirs to keep, and `setup` is called with it
    const registry = new SyntheticSchemaRegistry();
    paginated(CatDto, { registry });
    const document = documentWith('CatDto');

    // When
    mergeSyntheticSchemas(document, registry);

    // Then
    const components = document.components as { schemas: Record<string, unknown> };
    expect(Object.keys(components.schemas)).toEqual(['CatDto']);
  });

  it('should say what to do when the inner type never reached the document', () => {
    // Given the ordinary first use of these factories: `@nestjs/swagger` collects a DTO it sees
    // named on a route, and a route documented with `paginated(CatDto)` names the wrapper.
    const registry = new SyntheticSchemaRegistry();
    paginated(CatDto, { registry });

    // When, Then, and the message carries the fix rather than only the symptom
    expect(() => mergeSyntheticSchemas(documentWith(), registry)).toThrow(
      /references the schema CatDto.*@ApiExtraModels\(CatDto\)/s,
    );
  });

  it('should return the document untouched when nothing was registered', () => {
    // Given an application that uses no generic factory, which is most of them
    const registry = new SyntheticSchemaRegistry();
    const document = documentWith('CatDto');

    // When
    const merged = mergeSyntheticSchemas(document, registry);

    // Then, the same object rather than a copy: a document nobody added to is not a new document
    expect(merged).toBe(document);
  });

  it('should build a components block for a document that has none', () => {
    // Given
    const registry = new SyntheticSchemaRegistry();
    envelope(CatDto, { registry });
    const document = { openapi: '3.1.0', info: { title: 'Pets', version: '1' }, paths: {} };

    // When, Then, the reference check fires because there is nothing for it to land on, which is
    // the same refusal as above and is what a document with no components means here
    expect(() => mergeSyntheticSchemas(document, registry)).toThrow(/references the schema CatDto/);
  });
});

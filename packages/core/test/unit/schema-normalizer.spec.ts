import { describe, expect, it } from 'vitest';
import type { IRJsonSchema } from '../../src/index';
import {
  CycleDepthError,
  DEFAULT_CYCLE_DEPTH,
  ErrorCode,
  NormalizeError,
  normalizeSchema,
  normalizeSchemaGraph,
  RefResolutionError,
} from '../../src/index';

function documentWith(schemas: Record<string, unknown>): Record<string, unknown> {
  return { components: { schemas } };
}

function reference(name: string): Record<string, unknown> {
  return { $ref: `#/components/schemas/${name}` };
}

describe('normalizeSchema reference resolution', () => {
  it('should keep an internal reference as a reference and register its target', () => {
    // Given
    const rootDocument = documentWith({ Order: { type: 'object', title: 'Order' } });

    // When
    const graph = normalizeSchemaGraph(reference('Order'), { rootDocument });

    // Then
    expect(graph.schema).toEqual({ $ref: 'Order' });
    expect(graph.schemas.get('Order')).toEqual({ type: 'object', title: 'Order' });
  });

  it('should give two use sites of one named schema the same reference, not two copies', () => {
    // Given
    const rootDocument = documentWith({ Money: { type: 'string' } });
    const input = {
      type: 'object',
      properties: { paid: reference('Money'), due: reference('Money') },
    };

    // When
    const graph = normalizeSchemaGraph(input, { rootDocument });

    // Then
    expect(graph.schema.properties?.paid).toEqual({ $ref: 'Money' });
    expect(graph.schema.properties?.due).toEqual({ $ref: 'Money' });
    expect(graph.schemas.size).toBe(1);
  });

  it('should expand a reference that points at something with no name', () => {
    // Given, a pointer outside components/schemas has no id to refer to
    const rootDocument = { parts: { Money: { type: 'string', format: 'decimal' } } };

    // When
    const graph = normalizeSchemaGraph({ $ref: '#/parts/Money' }, { rootDocument });

    // Then
    expect(graph.schema).toEqual({ $id: 'Money', type: 'string', format: 'decimal' });
    expect(graph.schemas.size).toBe(0);
  });

  it('should resolve an external reference against a supplied document', () => {
    // Given
    const shared = documentWith({ Money: { type: 'string', format: 'decimal' } });

    // When
    const graph = normalizeSchemaGraph(
      { $ref: 'shared.yaml#/components/schemas/Money' },
      { rootDocument: {}, externalDocuments: { 'shared.yaml': shared } },
    );

    // Then, an external target is registered under an id in the external space, so two
    // documents can each have a Money without colliding
    expect(graph.schema.$ref).toMatch(/^~x[0-9a-f]{8}~Money$/);
    expect(graph.schemas.get(graph.schema.$ref ?? '')).toEqual({
      type: 'string',
      format: 'decimal',
    });
  });

  it('should give an external target the same id however often it is referenced', () => {
    // Given
    const shared = documentWith({ Money: { type: 'string' } });
    const input = {
      type: 'object',
      properties: {
        a: { $ref: 'shared.yaml#/components/schemas/Money' },
        b: { $ref: 'shared.yaml#/components/schemas/Money' },
      },
    };

    // When
    const graph = normalizeSchemaGraph(input, {
      rootDocument: {},
      externalDocuments: { 'shared.yaml': shared },
    });

    // Then
    expect(graph.schema.properties?.a).toEqual(graph.schema.properties?.b);
    expect(graph.schemas.size).toBe(1);
  });

  it('should raise when an external document was not supplied', () => {
    // Given
    const input = { $ref: 'missing.yaml#/components/schemas/Money' };

    // When
    let error: unknown;
    try {
      normalizeSchema(input, { rootDocument: {} });
    } catch (caught) {
      error = caught;
    }

    // Then
    expect(error).toBeInstanceOf(RefResolutionError);
    expect(error).toMatchObject({ code: ErrorCode.NORM_REF_UNRESOLVED });
  });

  it('should raise when an external reference points at a missing target', () => {
    // Given
    const shared = documentWith({});

    // When
    const act = (): IRJsonSchema =>
      normalizeSchema(
        { $ref: 'shared.yaml#/components/schemas/Money' },
        { rootDocument: {}, externalDocuments: { 'shared.yaml': shared } },
      );

    // Then
    expect(act).toThrow(RefResolutionError);
  });

  it('should raise when an internal reference points at a missing target', () => {
    // Given
    const rootDocument = documentWith({});

    // When
    const act = (): IRJsonSchema => normalizeSchema(reference('Order'), { rootDocument });

    // Then
    expect(act).toThrow(RefResolutionError);
  });

  it('should raise when a $ref is not a string', () => {
    // Given
    const input = { $ref: 42 };

    // When
    const act = (): IRJsonSchema => normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(act).toThrow(NormalizeError);
    expect(act).toThrow(/not a string/);
  });

  it('should apply keywords written beside a $ref as further constraints', () => {
    // Given
    const rootDocument = documentWith({ Name: { type: 'string' } });
    const input = { $ref: '#/components/schemas/Name', maxLength: 32, description: 'short name' };

    // When
    const result = normalizeSchema(input, { rootDocument });

    // Then, a keyword that narrows the target makes this position a different type, so it
    // stops being a bare reference and the target is merged in
    expect(result).toMatchObject({ type: 'string', maxLength: 32 });
    expect(result.description).toBe('short name');
  });

  it('should keep a reference when only annotations sit beside it', () => {
    // Given, a description does not change what the target is
    const rootDocument = documentWith({ Name: { type: 'string' } });
    const input = { $ref: '#/components/schemas/Name', description: 'the short one' };

    // When
    const result = normalizeSchema(input, { rootDocument });

    // Then
    expect(result).toEqual({ $ref: 'Name', description: 'the short one' });
  });
});

describe('normalizeSchema cycles', () => {
  it('should express a self reference as a reference, which is what stops the expansion', () => {
    // Given
    const rootDocument = documentWith({
      Node: { type: 'object', properties: { next: reference('Node') } },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Node'), { rootDocument });

    // Then, a reference does not expand, so a cycle through named schemas needs no marker
    expect(graph.schema).toEqual({ $ref: 'Node' });
    expect(graph.schemas.get('Node')?.properties?.next).toEqual({ $ref: 'Node' });
  });

  it('should fold a cycle to a marker when the target has no name to refer to', () => {
    // Given, a self referencing pointer outside components/schemas must still be expanded
    const rootDocument: Record<string, unknown> = {
      parts: { Node: { type: 'object', properties: { next: { $ref: '#/parts/Node' } } } },
    };

    // When
    const result = normalizeSchema({ $ref: '#/parts/Node' }, { rootDocument });

    // Then
    expect(result.properties?.next).toEqual({ $cycle: 'Node' });
  });

  it('should fold a mutually recursive pair at the point it closes', () => {
    // Given
    const rootDocument = documentWith({
      A: { type: 'object', properties: { b: reference('B') } },
      B: { type: 'object', properties: { a: reference('A') } },
    });

    // When
    const result = normalizeSchema(reference('A'), { rootDocument });

    // Then, both directions stay references, so neither side is the one that gets copied
    const graph = normalizeSchemaGraph(reference('A'), { rootDocument });
    expect(graph.schema).toEqual({ $ref: 'A' });
    expect(graph.schemas.get('A')?.properties?.b).toEqual({ $ref: 'B' });
    expect(graph.schemas.get('B')?.properties?.a).toEqual({ $ref: 'A' });
    expect(result).toEqual({ $ref: 'A' });
  });

  it('should fold a cycle that runs through an array item', () => {
    // Given
    const rootDocument = documentWith({
      Tree: {
        type: 'object',
        properties: { children: { type: 'array', items: reference('Tree') } },
      },
    });

    // When
    const result = normalizeSchema(reference('Tree'), { rootDocument });

    // Then
    const graph = normalizeSchemaGraph(reference('Tree'), { rootDocument });
    expect(graph.schemas.get('Tree')?.properties?.children?.items).toEqual({ $ref: 'Tree' });
    expect(result).toEqual({ $ref: 'Tree' });
  });

  it('should fold a cycle that closes through two array levels', () => {
    // Given
    const rootDocument = documentWith({
      Matrix: { type: 'array', items: { type: 'array', items: reference('Matrix') } },
    });

    // When
    const result = normalizeSchema(reference('Matrix'), { rootDocument });

    // Then
    const graph = normalizeSchemaGraph(reference('Matrix'), { rootDocument });
    expect(graph.schemas.get('Matrix')?.items?.items).toEqual({ $ref: 'Matrix' });
    expect(result).toEqual({ $ref: 'Matrix' });
  });

  it('should produce a hashable result for a cyclic schema, since the cycle is folded', () => {
    // Given
    const rootDocument = documentWith({
      Node: { type: 'object', properties: { next: reference('Node') } },
    });

    // When
    const result = normalizeSchema(reference('Node'), { rootDocument });

    // Then
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(() =>
      JSON.stringify([...normalizeSchemaGraph(reference('Node'), { rootDocument }).schemas]),
    ).not.toThrow();
  });
});

describe('normalizeSchema depth limit', () => {
  /**
   * A chain of anonymous schemas, which are the only thing left that expands.
   *
   * A chain of named schemas no longer has a depth to exceed, because a reference to a named
   * schema does not expand. That is the whole point of SPEC 5.1.1 and it is asserted below.
   */
  function chain(length: number): Record<string, unknown> {
    const parts: Record<string, unknown> = {};
    for (let index = 0; index < length; index += 1) {
      parts[`S${String(index)}`] = {
        type: 'object',
        properties: { next: { $ref: `#/parts/S${String(index + 1)}` } },
      };
    }
    parts[`S${String(length)}`] = { type: 'string' };
    return { parts };
  }

  function namedChain(length: number): Record<string, unknown> {
    const schemas: Record<string, unknown> = {};
    for (let index = 0; index < length; index += 1) {
      schemas[`S${String(index)}`] = {
        type: 'object',
        properties: { next: reference(`S${String(index + 1)}`) },
      };
    }
    schemas[`S${String(length)}`] = { type: 'string' };
    return documentWith(schemas);
  }

  it('should raise CycleDepthError rather than hang on a chain deeper than the limit', () => {
    // Given
    const rootDocument = chain(40);

    // When
    let error: unknown;
    try {
      normalizeSchema({ $ref: '#/parts/S0' }, { rootDocument });
    } catch (caught) {
      error = caught;
    }

    // Then
    expect(error).toBeInstanceOf(CycleDepthError);
    expect(error).toMatchObject({ code: ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED });
  });

  it('should normalize a chain of named references far longer than the limit', () => {
    // Given, forty named schemas in a row, which the previous model could not expand
    const rootDocument = namedChain(40);

    // When
    const graph = normalizeSchemaGraph(reference('S0'), { rootDocument });

    // Then, nothing expanded, so nothing came near the limit
    expect(graph.schema).toEqual({ $ref: 'S0' });
    expect(graph.schemas.size).toBe(41);
    expect(graph.schemas.get('S0')?.properties?.next).toEqual({ $ref: 'S1' });
  });

  it('should report the chain that reached the limit', () => {
    // Given
    const rootDocument = chain(40);

    // When
    let context: Readonly<Record<string, unknown>> | undefined;
    try {
      normalizeSchema({ $ref: '#/parts/S0' }, { rootDocument, cycleDepth: 3 });
    } catch (error) {
      context = error instanceof CycleDepthError ? error.context : undefined;
    }

    // Then
    expect(context?.depth).toBe(3);
    expect(context?.chain).toHaveLength(3);
  });

  it('should accept a chain exactly as deep as the limit', () => {
    // Given
    // chain(n) creates n references plus a terminal schema, so this is exactly the limit.
    const rootDocument = chain(DEFAULT_CYCLE_DEPTH - 1);

    // When
    const act = (): IRJsonSchema => normalizeSchema({ $ref: '#/parts/S0' }, { rootDocument });

    // Then
    expect(act).not.toThrow();
  });

  it('should reject a limit that is not a positive integer', () => {
    // Given
    const limits = [0, -1, 1.5];

    // When
    const outcomes = limits.map((cycleDepth) => {
      try {
        normalizeSchema({ type: 'string' }, { rootDocument: {}, cycleDepth });
        return 'accepted';
      } catch (error) {
        return error instanceof NormalizeError ? 'rejected' : 'wrong-type';
      }
    });

    // Then
    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected']);
  });
});

describe('normalizeSchema composition', () => {
  it('should merge allOf branches reached through references', () => {
    // Given
    const rootDocument = documentWith({
      Base: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      Order: {
        allOf: [
          reference('Base'),
          { required: ['total'], properties: { total: { type: 'number' } } },
        ],
      },
    });

    // When, allOf resolves a referenced branch, per the decision recorded in SPEC 5.1.1:
    // merging needs the target, and deferring it would push the work onto every consumer
    const graph = normalizeSchemaGraph(reference('Order'), { rootDocument });
    const order = graph.schemas.get('Order');

    // Then
    expect(order?.required).toEqual(['id', 'total']);
    expect(Object.keys(order?.properties ?? {})).toEqual(['id', 'total']);
  });

  it('should keep a single allOf branch a reference when there is nothing to merge into', () => {
    // Given
    const rootDocument = documentWith({
      Base: { type: 'object', properties: { id: { type: 'string' } } },
      Alias: { allOf: [reference('Base')] },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Alias'), { rootDocument });

    // Then, the merge is a no op, so nothing is copied. THIS ASSERTION USED TO SAY THE
    // OPPOSITE OF ITS OWN TITLE: it read the copied `properties.id` off `Alias` and passed,
    // which is how the defect T003-R2 fixes survived a test written to catch it. The rule and
    // its boundaries are in `singleton-allof.spec.ts`.
    expect(graph.schemas.get('Alias')).toEqual({ $ref: 'Base' });
  });

  it('should raise when allOf branches declare conflicting types', () => {
    // Given
    const input = { allOf: [{ type: 'string' }, { type: 'number' }] };

    // When
    let code: ErrorCode | undefined;
    try {
      normalizeSchema(input, { rootDocument: {} });
    } catch (error) {
      code = error instanceof NormalizeError ? error.code : undefined;
    }

    // Then
    expect(code).toBe(ErrorCode.NORM_COMPOSITION_CONFLICT);
  });
});

describe('normalizeSchema variants', () => {
  it('should label oneOf branches from the discriminator mapping', () => {
    // Given
    const rootDocument = documentWith({
      Dog: { type: 'object', title: 'Dog' },
      Cat: { type: 'object', title: 'Cat' },
      Pet: {
        oneOf: [reference('Dog'), reference('Cat')],
        discriminator: {
          propertyName: 'petType',
          mapping: { dog: '#/components/schemas/Dog', cat: '#/components/schemas/Cat' },
        },
      },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Pet'), { rootDocument });
    const pet = graph.schemas.get('Pet');

    // Then, a branch is a reference now, so the label has to come from the mapping and the
    // reference rather than from a title that is no longer copied into the branch
    expect(pet?.variants?.map((variant) => variant.label)).toEqual(['dog', 'cat']);
    expect(pet?.variants?.map((variant) => variant.discriminatorValue)).toEqual(['dog', 'cat']);
    expect(pet?.oneOf).toEqual([{ $ref: 'Dog' }, { $ref: 'Cat' }]);
  });

  it('should label a referenced branch by its schema name when no mapping names it', () => {
    // Given
    const rootDocument = documentWith({
      Dog: { type: 'object', title: 'Dog' },
      Cat: { type: 'object', title: 'Cat' },
      Pet: { oneOf: [reference('Dog'), reference('Cat')] },
    });

    // When
    const graph = normalizeSchemaGraph(reference('Pet'), { rootDocument });

    // Then
    expect(graph.schemas.get('Pet')?.variants?.map((variant) => variant.label)).toEqual([
      'Dog',
      'Cat',
    ]);
  });

  it('should fall back to the branch title when there is no mapping', () => {
    // Given
    const input = { oneOf: [{ title: 'Cash' }, { title: 'Card' }] };

    // When
    const result = normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(result.variants?.map((variant) => variant.label)).toEqual(['Cash', 'Card']);
  });

  it('should fall back to the reference name when the branch has no title', () => {
    // Given
    const rootDocument = documentWith({ Cash: { type: 'object' }, Card: { type: 'object' } });
    const input = { oneOf: [reference('Cash'), reference('Card')] };

    // When
    const result = normalizeSchema(input, { rootDocument });

    // Then
    expect(result.variants?.map((variant) => variant.label)).toEqual(['Cash', 'Card']);
  });

  it('should number an anonymous branch rather than leaving it unlabelled', () => {
    // Given
    const input = { anyOf: [{ type: 'string' }, { type: 'number' }] };

    // When
    const result = normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(result.variants?.map((variant) => variant.label)).toEqual(['Variant 1', 'Variant 2']);
  });

  it('should keep a discriminator that declares no mapping', () => {
    // Given
    const input = {
      oneOf: [{ title: 'Cash' }],
      discriminator: { propertyName: 'kind' },
    };

    // When
    const result = normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(result.discriminator).toEqual({ propertyName: 'kind' });
  });
});

describe('normalizeSchema keyword handling', () => {
  it('should carry constraints, examples and extensions through', () => {
    // Given
    const input = {
      type: 'string',
      minLength: 1,
      maxLength: 8,
      pattern: '^[a-z]+$',
      enum: ['a', 'b'],
      examples: ['a'],
      default: 'a',
      deprecated: true,
      'x-openref-audience': 'public',
      'x-ignored-function': () => 1,
    };

    // When
    const result = normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(result).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 8,
      pattern: '^[a-z]+$',
      enum: ['a', 'b'],
      examples: ['a'],
      default: 'a',
      deprecated: true,
      extensions: { 'x-openref-audience': 'public' },
    });
  });

  it('should accept a type list and drop members it does not recognise', () => {
    // Given
    const input = { type: ['string', 'null', 'nonsense'] };

    // When
    const result = normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(result.type).toEqual(['string', 'null']);
  });

  it('should read a boolean schema', () => {
    // Given
    const inputs = [true, false];

    // When
    const results = inputs.map((input) => normalizeSchema(input, { rootDocument: {} }));

    // Then
    expect(results).toEqual([{}, { not: {} }]);
  });

  it('should read additionalProperties in both its boolean and its schema form', () => {
    // Given
    const inputs = [{ additionalProperties: false }, { additionalProperties: { type: 'string' } }];

    // When
    const results = inputs.map(
      (input) => normalizeSchema(input, { rootDocument: {} }).additionalProperties,
    );

    // Then
    expect(results).toEqual([false, { type: 'string' }]);
  });

  it('should resolve references inside patternProperties, prefixItems and propertyNames', () => {
    // Given
    const rootDocument = documentWith({ Name: { type: 'string' } });
    const input = {
      patternProperties: { '^x-': reference('Name') },
      prefixItems: [reference('Name')],
      propertyNames: reference('Name'),
      not: reference('Name'),
    };

    // When
    const result = normalizeSchema(input, { rootDocument });

    // Then, every position holds a reference rather than a copy of the target
    expect([
      result.patternProperties?.['^x-']?.$ref,
      result.prefixItems?.[0]?.$ref,
      result.propertyNames?.$ref,
      result.not?.$ref,
    ]).toEqual(['Name', 'Name', 'Name', 'Name']);
  });

  it('should reject input that is not a schema at all', () => {
    // Given
    const inputs = ['a string', 42, null, []];

    // When
    const outcomes = inputs.map((input) => {
      try {
        normalizeSchema(input, { rootDocument: {} });
        return 'accepted';
      } catch (error) {
        return error instanceof NormalizeError ? error.code : 'wrong-type';
      }
    });

    // Then
    expect(outcomes).toEqual(Array.from({ length: 4 }, () => ErrorCode.NORM_DOCUMENT_INVALID));
  });

  it('should drop a non finite number rather than carrying something unhashable', () => {
    // Given
    const input = { minimum: Number.POSITIVE_INFINITY, maximum: 10 };

    // When
    const result = normalizeSchema(input, { rootDocument: {} });

    // Then
    expect(result).toEqual({ maximum: 10 });
  });
});

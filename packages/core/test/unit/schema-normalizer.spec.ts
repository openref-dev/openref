import { describe, expect, it } from 'vitest';
import type { IRJsonSchema } from '../../src/index';
import {
  CycleDepthError,
  DEFAULT_CYCLE_DEPTH,
  ErrorCode,
  NormalizeError,
  normalizeSchema,
  RefResolutionError,
} from '../../src/index';

function documentWith(schemas: Record<string, unknown>): Record<string, unknown> {
  return { components: { schemas } };
}

function reference(name: string): Record<string, unknown> {
  return { $ref: `#/components/schemas/${name}` };
}

describe('normalizeSchema reference resolution', () => {
  it('should inline an internal reference and remember its name', () => {
    // Given
    const rootDocument = documentWith({ Order: { type: 'object', title: 'Order' } });

    // When
    const result = normalizeSchema(reference('Order'), { rootDocument });

    // Then
    expect(result).toEqual({ $id: 'Order', type: 'object', title: 'Order' });
  });

  it('should resolve an external reference against a supplied document', () => {
    // Given
    const shared = documentWith({ Money: { type: 'string', format: 'decimal' } });

    // When
    const result = normalizeSchema(
      { $ref: 'shared.yaml#/components/schemas/Money' },
      { rootDocument: {}, externalDocuments: { 'shared.yaml': shared } },
    );

    // Then
    expect(result).toEqual({ $id: 'Money', type: 'string', format: 'decimal' });
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

    // Then
    expect(result).toMatchObject({ $id: 'Name', type: 'string', maxLength: 32 });
    expect(result.description).toBe('short name');
  });
});

describe('normalizeSchema cycles', () => {
  it('should fold a self referencing schema to a cycle marker', () => {
    // Given
    const rootDocument = documentWith({
      Node: { type: 'object', properties: { next: reference('Node') } },
    });

    // When
    const result = normalizeSchema(reference('Node'), { rootDocument });

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

    // Then
    const b = result.properties?.b;
    expect(b?.$id).toBe('B');
    expect(b?.properties?.a).toEqual({ $cycle: 'A' });
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
    expect(result.properties?.children?.items).toEqual({ $cycle: 'Tree' });
  });

  it('should fold a cycle that closes through two array levels', () => {
    // Given
    const rootDocument = documentWith({
      Matrix: { type: 'array', items: { type: 'array', items: reference('Matrix') } },
    });

    // When
    const result = normalizeSchema(reference('Matrix'), { rootDocument });

    // Then
    expect(result.items?.items).toEqual({ $cycle: 'Matrix' });
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
  });
});

describe('normalizeSchema depth limit', () => {
  function chain(length: number): Record<string, unknown> {
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
      normalizeSchema(reference('S0'), { rootDocument });
    } catch (caught) {
      error = caught;
    }

    // Then
    expect(error).toBeInstanceOf(CycleDepthError);
    expect(error).toMatchObject({ code: ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED });
  });

  it('should report the chain that reached the limit', () => {
    // Given
    const rootDocument = chain(40);

    // When
    let context: Readonly<Record<string, unknown>> | undefined;
    try {
      normalizeSchema(reference('S0'), { rootDocument, cycleDepth: 3 });
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
    const act = (): IRJsonSchema => normalizeSchema(reference('S0'), { rootDocument });

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

    // When
    const result = normalizeSchema(reference('Order'), { rootDocument });

    // Then
    expect(result.required).toEqual(['id', 'total']);
    expect(Object.keys(result.properties ?? {})).toEqual(['id', 'total']);
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
    const result = normalizeSchema(reference('Pet'), { rootDocument });

    // Then
    expect(result.variants?.map((variant) => variant.label)).toEqual(['dog', 'cat']);
    expect(result.variants?.map((variant) => variant.discriminatorValue)).toEqual(['dog', 'cat']);
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

    // Then
    expect([
      result.patternProperties?.['^x-']?.$id,
      result.prefixItems?.[0]?.$id,
      result.propertyNames?.$id,
      result.not?.$id,
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

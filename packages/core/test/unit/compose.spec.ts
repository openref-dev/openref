import { describe, expect, it } from 'vitest';
import type { IRJsonSchema } from '../../src/index';
import {
  ErrorCode,
  intersectTypes,
  mergeAllOf,
  mergeRequired,
  NormalizeError,
} from '../../src/index';

describe('mergeAllOf', () => {
  it('should merge allOf into a single schema with combined required', () => {
    // Given
    const input: IRJsonSchema[] = [{ required: ['a'] }, { required: ['b'] }];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.required).toEqual(['a', 'b']);
  });

  it('should not repeat a required name that both branches declare', () => {
    // Given
    const input: IRJsonSchema[] = [{ required: ['a', 'b'] }, { required: ['b', 'c'] }];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.required).toEqual(['a', 'b', 'c']);
  });

  it('should union properties from every branch', () => {
    // Given
    const input: IRJsonSchema[] = [
      { type: 'object', properties: { a: { type: 'string' } } },
      { type: 'object', properties: { b: { type: 'number' } } },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(Object.keys(result.properties ?? {})).toEqual(['a', 'b']);
  });

  it('should merge a property that two branches both describe', () => {
    // Given
    const input: IRJsonSchema[] = [
      { properties: { total: { type: 'number', minimum: 0 } } },
      { properties: { total: { type: 'number', maximum: 100 } } },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.properties?.total).toEqual({ type: 'number', minimum: 0, maximum: 100 });
  });

  it('should let the most restrictive additionalProperties win', () => {
    // Given
    const cases: readonly IRJsonSchema[][] = [
      [{ additionalProperties: true }, { additionalProperties: false }],
      [{ additionalProperties: false }, {}],
      [{}, { additionalProperties: true }],
    ];

    // When
    const results = cases.map((branches) => mergeAllOf(branches).additionalProperties);

    // Then
    expect(results).toEqual([false, false, true]);
  });

  it('should merge two additionalProperties schemas rather than dropping one', () => {
    // Given
    const input: IRJsonSchema[] = [
      { additionalProperties: { type: 'string', minLength: 1 } },
      { additionalProperties: { type: 'string', maxLength: 8 } },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.additionalProperties).toEqual({ type: 'string', minLength: 1, maxLength: 8 });
  });

  it('should take the tightest numeric bounds', () => {
    // Given
    const input: IRJsonSchema[] = [
      { minimum: 1, maximum: 100, minLength: 2, maxItems: 9 },
      { minimum: 5, maximum: 50, minLength: 1, maxItems: 4 },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result).toMatchObject({ minimum: 5, maximum: 50, minLength: 2, maxItems: 4 });
  });

  it('should intersect enums', () => {
    // Given
    const input: IRJsonSchema[] = [{ enum: ['a', 'b', 'c'] }, { enum: ['b', 'c', 'd'] }];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.enum).toEqual(['b', 'c']);
  });

  it('should raise when two branches share no enum member', () => {
    // Given
    const input: IRJsonSchema[] = [{ enum: ['a'] }, { enum: ['b'] }];

    // When
    const act = (): IRJsonSchema => mergeAllOf(input);

    // Then
    expect(act).toThrow(NormalizeError);
    expect(act).toThrow(/enum/);
  });

  it('should raise rather than pick one when branches declare conflicting types', () => {
    // Given
    const input: IRJsonSchema[] = [{ type: 'string' }, { type: 'number' }];

    // When
    let code: ErrorCode | undefined;
    try {
      mergeAllOf(input);
    } catch (error) {
      code = error instanceof NormalizeError ? error.code : undefined;
    }

    // Then
    expect(code).toBe(ErrorCode.NORM_COMPOSITION_CONFLICT);
  });

  it('should raise when two branches declare a different const', () => {
    // Given
    const input: IRJsonSchema[] = [{ const: 1 }, { const: 2 }];

    // When
    const act = (): IRJsonSchema => mergeAllOf(input);

    // Then
    expect(act).toThrow(/const/);
  });

  it('should accept the same const declared twice', () => {
    // Given
    const input: IRJsonSchema[] = [{ const: 'paid' }, { const: 'paid' }];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.const).toBe('paid');
  });

  it('should keep a single oneOf that only one branch declares', () => {
    // Given
    const input: IRJsonSchema[] = [
      { type: 'object' },
      { oneOf: [{ type: 'string' }, { type: 'number' }] },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.oneOf).toHaveLength(2);
    expect(result.allOf).toBeUndefined();
  });

  it('should keep both oneOf lists under allOf when two branches declare one', () => {
    // Given
    const input: IRJsonSchema[] = [
      { oneOf: [{ type: 'string' }] },
      { oneOf: [{ type: 'number' }] },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.allOf).toEqual([
      { oneOf: [{ type: 'string' }] },
      { oneOf: [{ type: 'number' }] },
    ]);
  });

  it('should treat a folded cycle as carrying no constraints', () => {
    // Given
    const input: IRJsonSchema[] = [{ $cycle: 'Node' }, { type: 'object', title: 'Node' }];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result).toEqual({ type: 'object', title: 'Node' });
  });

  it('should take the first title and description', () => {
    // Given
    const input: IRJsonSchema[] = [
      { title: 'Order', description: 'An order' },
      { title: 'Base', description: 'Base type' },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result).toMatchObject({ title: 'Order', description: 'An order' });
  });

  it('should mark the result readOnly when any branch is readOnly', () => {
    // Given
    const input: IRJsonSchema[] = [{ readOnly: false }, { readOnly: true }];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.readOnly).toBe(true);
  });

  it('should merge extensions from every branch', () => {
    // Given
    const input: IRJsonSchema[] = [
      { extensions: { 'x-openref-audience': 'public' } },
      { extensions: { 'x-internal': true } },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.extensions).toEqual({ 'x-openref-audience': 'public', 'x-internal': true });
  });

  it('should return an empty schema for an empty branch list', () => {
    // Given
    const input: IRJsonSchema[] = [];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result).toEqual({});
  });

  it('should merge items when both branches constrain them', () => {
    // Given
    const input: IRJsonSchema[] = [
      { type: 'array', items: { type: 'string', minLength: 1 } },
      { type: 'array', items: { type: 'string', maxLength: 3 } },
    ];

    // When
    const result = mergeAllOf(input);

    // Then
    expect(result.items).toEqual({ type: 'string', minLength: 1, maxLength: 3 });
  });
});

describe('intersectTypes', () => {
  it('should narrow number and integer to integer', () => {
    // Given
    const left = 'number' as const;
    const right = 'integer' as const;

    // When
    const result = intersectTypes(left, right, '$');

    // Then
    expect(result).toBe('integer');
  });

  it('should intersect two type lists', () => {
    // Given
    const left = ['string', 'null'] as const;
    const right = ['null', 'number'] as const;

    // When
    const result = intersectTypes(left, right, '$');

    // Then
    expect(result).toBe('null');
  });

  it('should carry the other side through when one branch does not constrain the type', () => {
    // Given
    const right = 'string' as const;

    // When
    const results = [intersectTypes(undefined, right, '$'), intersectTypes(right, undefined, '$')];

    // Then
    expect(results).toEqual(['string', 'string']);
  });

  it('should sort a multi member intersection so the result is deterministic', () => {
    // Given
    const left = ['string', 'null', 'number'] as const;
    const right = ['number', 'string', 'null'] as const;

    // When
    const result = intersectTypes(left, right, '$');

    // Then
    expect(result).toEqual(['null', 'number', 'string']);
  });
});

describe('mergeRequired', () => {
  it('should return the other list when one is absent', () => {
    // Given
    const list = ['a'];

    // When
    const results = [mergeRequired(undefined, list), mergeRequired(list, undefined)];

    // Then
    expect(results).toEqual([['a'], ['a']]);
  });
});

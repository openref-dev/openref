import { describe, expect, it } from 'vitest';
import {
  asBoolean,
  asJsonSchemaType,
  asJsonValue,
  asNumber,
  asString,
  asStringArray,
  asStringRecord,
  isPlainObject,
  isUnknownArray,
} from '../../src/index';

describe('isPlainObject', () => {
  it('should accept a plain object and reject arrays, null and primitives', () => {
    // Given
    const values: readonly unknown[] = [{}, [], null, 'a', 1, undefined];

    // When
    const results = values.map((value) => isPlainObject(value));

    // Then
    expect(results).toEqual([true, false, false, false, false, false]);
  });
});

describe('isUnknownArray', () => {
  it('should accept an array and reject everything else', () => {
    // Given
    const values: readonly unknown[] = [[], {}, 'a'];

    // When
    const results = values.map((value) => isUnknownArray(value));

    // Then
    expect(results).toEqual([true, false, false]);
  });
});

describe('asString, asNumber and asBoolean', () => {
  it('should keep a value of the right type and drop everything else', () => {
    // Given
    const value: unknown = 'ok';

    // When
    const results = [
      asString(value),
      asString(1),
      asNumber(1),
      asNumber('1'),
      asBoolean(false),
      asBoolean(0),
    ];

    // Then
    expect(results).toEqual(['ok', undefined, 1, undefined, false, undefined]);
  });

  it('should drop a non finite number, which has no canonical form', () => {
    // Given
    const values = [Number.NaN, Number.POSITIVE_INFINITY];

    // When
    const results = values.map((value) => asNumber(value));

    // Then
    expect(results).toEqual([undefined, undefined]);
  });
});

describe('asStringArray', () => {
  it('should keep only the string members', () => {
    // Given
    const value = ['a', 1, 'b', null];

    // When
    const result = asStringArray(value);

    // Then
    expect(result).toEqual(['a', 'b']);
  });

  it('should return undefined for something that is not an array', () => {
    // Given
    const value = 'a';

    // When
    const result = asStringArray(value);

    // Then
    expect(result).toBeUndefined();
  });
});

describe('asStringRecord', () => {
  it('should keep only the string members', () => {
    // Given
    const value = { a: 'x', b: 2 };

    // When
    const result = asStringRecord(value);

    // Then
    expect(result).toEqual({ a: 'x' });
  });

  it('should return undefined for something that is not a plain object', () => {
    // Given
    const value = ['x'];

    // When
    const result = asStringRecord(value);

    // Then
    expect(result).toBeUndefined();
  });
});

describe('asJsonSchemaType', () => {
  it('should accept the seven type names and reject anything else', () => {
    // Given
    const values = ['string', 'integer', 'nonsense', 42];

    // When
    const results = values.map((value) => asJsonSchemaType(value));

    // Then
    expect(results).toEqual(['string', 'integer', undefined, undefined]);
  });
});

describe('asJsonValue', () => {
  it('should carry primitives, arrays and objects through', () => {
    // Given
    const value = { a: 1, b: 'two', c: [true, null], d: { e: 1 } };

    // When
    const result = asJsonValue(value);

    // Then
    expect(result).toEqual(value);
  });

  it('should drop a member that cannot be represented', () => {
    // Given
    const value = { keep: 1, drop: () => 1, alsoDrop: Symbol('x'), broken: Number.NaN };

    // When
    const result = asJsonValue(value);

    // Then
    expect(result).toEqual({ keep: 1 });
  });

  it('should replace an array member that cannot be represented with null, so indexes hold', () => {
    // Given
    const value = [1, () => 1, 3];

    // When
    const result = asJsonValue(value);

    // Then
    expect(result).toEqual([1, null, 3]);
  });

  it('should return undefined for a value that is nothing but unrepresentable', () => {
    // Given
    const value = () => 1;

    // When
    const result = asJsonValue(value);

    // Then
    expect(result).toBeUndefined();
  });
});

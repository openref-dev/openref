import { describe, expect, it } from 'vitest';
import {
  canonicalize,
  compareByCodePoint,
  ErrorCode,
  NormalizeError,
  normalizeNumber,
  quoteString,
} from '../../src/index';

describe('canonicalize', () => {
  it('should sort object keys by code point regardless of insertion order', () => {
    // Given
    const written = { zulu: 1, alpha: 2, mike: 3 };

    // When
    const canonical = canonicalize(written);

    // Then
    expect(canonical).toBe('{"alpha":2,"mike":3,"zulu":1}');
  });

  it('should produce one form for integer like keys written in either order', () => {
    // Given
    const ascending = { '200': 'ok', '404': 'gone', default: 'other' };
    const descending = { '404': 'gone', default: 'other', '200': 'ok' };

    // When
    const results = [canonicalize(ascending), canonicalize(descending)];

    // Then
    expect(results[0]).toBe(results[1]);
    expect(results[0]).toBe('{"200":"ok","404":"gone","default":"other"}');
  });

  it('should omit undefined object members rather than writing null', () => {
    // Given
    const value = { present: 1, absent: undefined };

    // When
    const canonical = canonicalize(value);

    // Then
    expect(canonical).toBe('{"present":1}');
  });

  it('should serialize a Map as a sorted array of pairs', () => {
    // Given
    const map = new Map([
      ['zulu', 1],
      ['alpha', 2],
    ]);

    // When
    const canonical = canonicalize(map);

    // Then
    expect(canonical).toBe('[["alpha",2],["zulu",1]]');
  });

  it('should produce one form for a Map built in either insertion order', () => {
    // Given
    const forward = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const backward = new Map([
      ['b', 2],
      ['a', 1],
    ]);

    // When
    const results = [canonicalize(forward), canonicalize(backward)];

    // Then
    expect(results[0]).toBe(results[1]);
  });

  it('should omit a Map entry whose value is undefined', () => {
    // Given
    const map = new Map<string, number | undefined>([
      ['a', 1],
      ['b', undefined],
    ]);

    // When
    const canonical = canonicalize(map);

    // Then
    expect(canonical).toBe('[["a",1]]');
  });

  it('should preserve array order, which carries meaning in the IR', () => {
    // Given
    const forward = ['a', 'b'];
    const backward = ['b', 'a'];

    // When
    const results = [canonicalize(forward), canonicalize(backward)];

    // Then
    expect(results[0]).not.toBe(results[1]);
  });

  it('should serialize nested structures depth first', () => {
    // Given
    const value = { b: { d: 1, c: 2 }, a: [1, { f: 1, e: 2 }] };

    // When
    const canonical = canonicalize(value);

    // Then
    expect(canonical).toBe('{"a":[1,{"e":2,"f":1}],"b":{"c":2,"d":1}}');
  });

  it('should serialize null, booleans and a Date deterministically', () => {
    // Given
    const value = { nothing: null, yes: true, no: false, at: new Date(0) };

    // When
    const canonical = canonicalize(value);

    // Then
    expect(canonical).toBe(
      '{"at":"1970-01-01T00:00:00.000Z","no":false,"nothing":null,"yes":true}',
    );
  });

  it('should reject a non finite number rather than writing null', () => {
    // Given
    const value = { broken: Number.NaN };

    // When
    const act = (): string => canonicalize(value);

    // Then
    expect(act).toThrow(NormalizeError);
    expect(act).toThrow(/non finite/);
  });

  it('should reject undefined inside an array, which would shift every later index', () => {
    // Given
    const value = [1, undefined, 3];

    // When
    const act = (): string => canonicalize(value);

    // Then
    expect(act).toThrow(NormalizeError);
  });

  it('should reject a circular reference', () => {
    // Given
    const value: Record<string, unknown> = { name: 'root' };
    value.self = value;

    // When
    const act = (): string => canonicalize(value);

    // Then
    expect(act).toThrow(/circular/);
  });

  it('should reject values with no canonical form and report the path', () => {
    // Given
    const cases: readonly unknown[] = [
      { at: 1n },
      { at: () => 1 },
      { at: Symbol('x') },
      { at: new Set([1]) },
      undefined,
    ];

    // When
    const codes = cases.map((value) => {
      try {
        canonicalize(value);
        return 'no-throw';
      } catch (error) {
        return error instanceof NormalizeError ? error.code : 'wrong-type';
      }
    });

    // Then
    expect(codes).toEqual(Array.from({ length: 5 }, () => ErrorCode.NORM_VALUE_NOT_SERIALIZABLE));
  });

  it('should report the path of the offending value', () => {
    // Given
    const value = { outer: { inner: [Number.POSITIVE_INFINITY] } };

    // When
    let context: Readonly<Record<string, unknown>> | undefined;
    try {
      canonicalize(value);
    } catch (error) {
      context = error instanceof NormalizeError ? error.context : undefined;
    }

    // Then
    expect(context).toEqual({ path: '$.outer.inner[0]' });
  });

  it('should serialize the same structure to the same text on repeated calls', () => {
    // Given
    const value = { a: new Map([['k', { z: 1, y: 2 }]]), b: [1, 2, 3] };

    // When
    const results = [canonicalize(value), canonicalize(value)];

    // Then
    expect(results[0]).toBe(results[1]);
  });

  it('should allow the same object to appear twice without calling it circular', () => {
    // Given
    const shared = { id: 'shared' };
    const value = { left: shared, right: shared };

    // When
    const canonical = canonicalize(value);

    // Then
    expect(canonical).toBe('{"left":{"id":"shared"},"right":{"id":"shared"}}');
  });
});

describe('normalizeNumber', () => {
  it('should collapse negative zero to zero', () => {
    // Given
    const value = -0;

    // When
    const normalized = normalizeNumber(value);

    // Then
    expect(normalized).toBe('0');
  });

  it('should give one form to literals that denote the same double', () => {
    // Given
    const literals = [1e3, 1000, 1000.0, 0x3e8];

    // When
    const normalized = literals.map((value) => normalizeNumber(value));

    // Then
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('1000');
  });

  it('should keep a stable form for very large integers and for floats', () => {
    // Given
    const values = [Number.MAX_SAFE_INTEGER, 1e21, 0.1 + 0.2, -1.5e-7];

    // When
    const normalized = values.map((value) => normalizeNumber(value));

    // Then
    expect(normalized).toEqual(['9007199254740991', '1e+21', '0.30000000000000004', '-1.5e-7']);
  });

  it('should reject NaN and both infinities', () => {
    // Given
    const values = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

    // When
    const outcomes = values.map((value) => {
      try {
        return normalizeNumber(value);
      } catch (error) {
        return error instanceof NormalizeError ? 'rejected' : 'wrong-type';
      }
    });

    // Then
    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected']);
  });
});

describe('quoteString', () => {
  it('should escape the characters JSON requires and leave the rest alone', () => {
    // Given
    const text = 'quote " backslash \\ newline \n tab \t';

    // When
    const quoted = quoteString(text);

    // Then
    expect(quoted).toBe('"quote \\" backslash \\\\ newline \\n tab \\t"');
  });

  it('should escape control characters with a four digit escape', () => {
    // Given
    const text = '\u0001\u001f';

    // When
    const quoted = quoteString(text);

    // Then
    expect(quoted).toBe('"\\u0001\\u001f"');
  });

  it('should keep printable non ascii characters literal', () => {
    // Given
    const text = 'ключ 键 🔑';

    // When
    const quoted = quoteString(text);

    // Then
    expect(quoted).toBe('"ключ 键 🔑"');
  });

  it('should escape a lone surrogate so the output stays well formed', () => {
    // Given
    const text = '\ud800';

    // When
    const quoted = quoteString(text);

    // Then
    expect(quoted).toBe('"\\ud800"');
  });
});

describe('compareByCodePoint', () => {
  it('should order by code point rather than by utf-16 code unit', () => {
    // Given
    const astral = '\u{1d306}';
    const bmp = 'ﬀ';

    // When
    const result = compareByCodePoint(bmp, astral);

    // Then
    expect(result).toBeLessThan(0);
  });

  it('should treat a prefix as smaller than the longer string', () => {
    // Given
    const shorter = 'order';
    const longer = 'orders';

    // When
    const result = compareByCodePoint(shorter, longer);

    // Then
    expect(result).toBeLessThan(0);
  });

  it('should report equality for identical strings', () => {
    // Given
    const text = 'orders';

    // When
    const result = compareByCodePoint(text, text);

    // Then
    expect(result).toBe(0);
  });
});

describe('canonicalize sparse arrays', () => {
  it('should refuse a hole rather than emit invalid JSON for it', () => {
    // Given, a sparse array. `Array.prototype.map` skips holes instead of visiting them, so
    // a hole used to reach `join` and render as nothing, producing `[1,,2]`. That is valid
    // JavaScript and not valid JSON, which is the one thing this function must never produce.
    const value = { lengths: [1, , 2] };

    // When
    const act = (): string => canonicalize(value);

    // Then
    expect(act).toThrow(NormalizeError);
    expect(act).toThrow(/hole in an array/);
  });

  it('should report the path of the hole', () => {
    // Given
    const value = { outer: { lengths: [0, , 0] } };

    // When
    let context: Readonly<Record<string, unknown>> | undefined;
    try {
      canonicalize(value);
    } catch (error) {
      context = error instanceof NormalizeError ? error.context : undefined;
    }

    // Then
    expect(context?.path).toBe('$.outer.lengths[1]');
  });

  it('should still accept a dense array holding a zero', () => {
    // Given
    const value = { lengths: [1, 0, 2] };

    // When
    const result = canonicalize(value);

    // Then
    expect(result).toBe('{"lengths":[1,0,2]}');
    expect(() => JSON.parse(result) as unknown).not.toThrow();
  });
});

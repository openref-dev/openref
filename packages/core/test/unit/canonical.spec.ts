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

  it('should keep the key order of a map whose order the document wrote', () => {
    // Given, SPEC 5.3's one exception. `properties` is the map a schema page draws in order.
    const written = { properties: { zulu: 1, alpha: 2, mike: 3 } };

    // When
    const canonical = canonicalize(written);

    // Then, and the sorted spelling is a different string, so the two answers are tellable apart
    expect(canonical).toBe('{"properties":{"zulu":1,"alpha":2,"mike":3}}');
    expect(canonical).not.toBe('{"properties":{"alpha":2,"mike":3,"zulu":1}}');
  });

  it('should give two orders of one authored map two canonical forms', () => {
    // Given
    const forward = { properties: { alpha: 1, zulu: 2 } };
    const backward = { properties: { zulu: 2, alpha: 1 } };

    // When
    const results = [canonicalize(forward), canonicalize(backward)];

    // Then
    expect(results[0]).not.toBe(results[1]);
  });

  it('should still sort the object a value of an authored map holds', () => {
    // Given, the exception reaches the map's own keys and not what sits under them: the value
    // here is a schema, whose members are names this IR chose.
    const written = { properties: { zulu: { type: 'string', format: 'uuid' } } };

    // When
    const canonical = canonicalize(written);

    // Then
    expect(canonical).toBe('{"properties":{"zulu":{"format":"uuid","type":"string"}}}');
  });

  it('should treat a property literally named properties as a property and not as a map', () => {
    // Given, an author may name a field anything, including the name of an IR member. Inside an
    // authored map the keys are the document's, so the record is not consulted for them.
    const written = { properties: { properties: { zulu: 1, alpha: 2 } } };

    // When
    const canonical = canonicalize(written);

    // Then, the outer map keeps its order and the inner object, which is a schema, sorts
    expect(canonical).toBe('{"properties":{"properties":{"alpha":2,"zulu":1}}}');
  });

  it('should sort an object reached through an array, whatever member the array hangs off', () => {
    // Given
    const written = { properties: [{ zulu: 1, alpha: 2 }] };

    // When
    const canonical = canonicalize(written);

    // Then
    expect(canonical).toBe('{"properties":[{"alpha":2,"zulu":1}]}');
  });

  it('should sort a map the record does not call authored, whatever its insertion order', () => {
    // Given, `nodes` is keyed by an id the normalizer builds and its order is walk order.
    const written = { nodes: { zulu: 1, alpha: 2 } };

    // When
    const canonical = canonicalize(written);

    // Then
    expect(canonical).toBe('{"nodes":{"alpha":2,"zulu":1}}');
  });

  it('should keep every level of an extension value in the order the author wrote it', () => {
    // Given, `extensions` holds `IRJsonValue`, which is where the IR stops describing the shape,
    // so nothing below it is this IR's and every level of it is content.
    const written = { extensions: { 'x-a': { properties: { b: 1, a: 2 }, z: 1, y: 2 } } };

    // When
    const canonical = canonicalize(written);

    // Then, uniformly: the siblings keep their order too, so nothing here turns on a key
    // happening to be spelled like an IR member
    expect(canonical).toBe('{"extensions":{"x-a":{"properties":{"b":1,"a":2},"z":1,"y":2}}}');
  });

  it('should keep every level of a raw path schema in the order the author wrote it', () => {
    // Given, `IRSchema.raw` is the one member the IR declares as `unknown`, and SPEC 5.2 has it
    // rendered as annotated source, so its order is drawn and the hash has to carry it.
    const written = { raw: { type: 'record', name: 'Order', fields: [{ z: 1, y: 2 }] } };

    // When
    const canonical = canonicalize(written);

    // Then
    expect(canonical).toBe('{"raw":{"type":"record","name":"Order","fields":[{"z":1,"y":2}]}}');
  });

  it('should keep a declared const, default and example in the order the author wrote them', () => {
    // Given
    const written = { const: { z: 1, y: 2 }, default: { z: 1, y: 2 }, example: { z: 1, y: 2 } };

    // When
    const canonical = canonicalize(written);

    // Then, the three member names sort against each other, being this IR's, and their values do
    // not, being the author's
    expect(canonical).toBe(
      '{"const":{"z":1,"y":2},"default":{"z":1,"y":2},"example":{"z":1,"y":2}}',
    );
  });

  it('should sort under the two names that serve an author value and an IR value alike', () => {
    // Given, the measured cost of keying the record by member name. `value` is `IRExample.value`
    // and `IRFact.value`; `examples` is a map of `IRExample` and an array of arbitrary JSON. The
    // IR reading wins at both, because the alternative hashes an order a normalizer literal chose.
    const written = { value: { z: 1, y: 2 }, examples: [{ z: 1, y: 2 }] };

    // When
    const canonical = canonicalize(written);

    // Then
    expect(canonical).toBe('{"examples":[{"y":2,"z":1}],"value":{"y":2,"z":1}}');
  });

  it('should sort a field an author named properties, and order the schema member below it', () => {
    // Given, the two spellings the exception has to tell apart. The first `properties` is an IR
    // member, so its keys are the author's field names; a field the author called `properties`
    // holds a schema, whose members are this IR's again; that schema's own `properties` is an IR
    // member once more and keeps its order.
    const written = { properties: { properties: { title: 'x', properties: { b: 1, a: 2 } } } };

    // When
    const canonical = canonicalize(written);

    // Then, the middle level sorts and the innermost keeps its order
    expect(canonical).toBe(
      '{"properties":{"properties":{"properties":{"b":1,"a":2},"title":"x"}}}',
    );
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

/**
 * What the exception cannot preserve, named as a price rather than left to be discovered.
 *
 * SPEC 5.3's point 2 names integer like keys as the reason canonical form exists at all: JS
 * enumerates such an own key in ascending numeric order whatever the author wrote. The exception
 * enumerates rather than sorts, so at an authored position that is a plain object the author's
 * order is not what comes back. It is a price and not a defect, because the page draws from the
 * same object, so the hash is still a function of everything the page is drawn from; what stops
 * being literally true is the sentence "in the author's order". Measured over both corpora at
 * `T065`: zero positions inside an authored space carry an integer like key.
 */
describe('an authored position whose keys look like integers, per SPEC 5.3', () => {
  it('should keep the written order for keys that are not integer like, which is the control', () => {
    // Given / When
    const canonical = canonicalize({ properties: { b: 1, a: 2, c: 3 } });

    // Then
    expect(canonical).toBe('{"properties":{"b":1,"a":2,"c":3}}');
  });

  it('should hand back the numeric order for integer like keys, whatever was written', () => {
    // Given, an order no sort and no insertion would produce on its own
    const written = { properties: { b: 1, '2': 2, a: 3, '1': 4 } };

    // Then, the subject is present: the object itself already enumerates them that way, which is
    // the whole of the finding. The canonical form reports what the page would draw.
    expect(Object.keys(written.properties)).toEqual(['1', '2', 'b', 'a']);
    expect(canonicalize(written)).toBe('{"properties":{"1":4,"2":2,"b":1,"a":3}}');
  });

  it('should do the same at every level of an ordered tree', () => {
    // Given
    const written = { extensions: { 'x-a': { z: 1, '10': 2, '9': 3 } } };

    // Then
    expect(canonicalize(written)).toBe('{"extensions":{"x-a":{"9":3,"10":2,"z":1}}}');
  });

  it('should be exactly what a Map at the same position does not do', () => {
    // Given, a `Map` keeps insertion order for every key shape, which is why the three document
    // maps and the exception behave differently and why the price above is about plain objects.
    const map = new Map<string, number>([
      ['b', 1],
      ['2', 2],
      ['1', 3],
    ]);

    // When
    const canonical = canonicalize({ examples: map });

    // Then
    expect(canonical).toBe('{"examples":[["b",1],["2",2],["1",3]]}');
  });
});

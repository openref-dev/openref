import { SerializationError } from '@openref/core';
import type { IRParameterLocation, IRParameterStyle } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { serializeParameter, type RunnerValue, type SerializableParameter } from '../../src/index';

/**
 * T026: the whole of SPEC 14.2, every cell, none skipped.
 *
 * THE TABLE IS THE TEST AND THE TEST IS THE TABLE. Every combination of style, location, explode
 * and value kind is enumerated below and every one of them is asserted, including the ones that
 * must refuse. `every cell of the matrix is covered` at the bottom counts them against the
 * enumeration itself, so a cell dropped from the table is a red build rather than a case that
 * quietly stopped existing.
 *
 * OPENAPI'S OWN EXAMPLE VALUES ARE USED, so a reader can hold the specification's table next to
 * this file: `color` with `blue`, `["blue","black","brown"]` and `{"R":100,"G":200,"B":150}`.
 *
 * WHERE THE SPECIFICATION IS SILENT, THE CASE TITLE SAYS WHAT WAS CHOSEN. OpenAPI's table has
 * eleven `n/a` cells and says nothing at all about an empty array, an empty object, or whether a
 * delimiter is percent encoded. Those cases are titled `chosen:` so that a later reader can tell
 * a decision this project made from a rule it is following.
 */

const PRIMITIVE: RunnerValue = { kind: 'primitive', value: 'blue' };
const ARRAY: RunnerValue = { kind: 'array', value: ['blue', 'black', 'brown'] };
const OBJECT: RunnerValue = {
  kind: 'object',
  value: [
    ['R', '100'],
    ['G', '200'],
    ['B', '150'],
  ],
};

const EMPTY_PRIMITIVE: RunnerValue = { kind: 'primitive', value: '' };
const EMPTY_ARRAY: RunnerValue = { kind: 'array', value: [] };
const EMPTY_OBJECT: RunnerValue = { kind: 'object', value: [] };

function param(
  style: IRParameterStyle,
  location: IRParameterLocation,
  explode: boolean,
  extra: Partial<SerializableParameter> = {},
): SerializableParameter {
  return { name: 'color', in: location, style, explode, ...extra };
}

/** What a cell produces, flattened so the table below reads as one column of expectations. */
function render(parameter: SerializableParameter, value: RunnerValue): string {
  const serialized = serializeParameter(parameter, value);

  return serialized.form === 'text' ? serialized.text : serialized.pairs.join('&');
}

/** One cell: a style, a location, an explode, a value kind, and what the request carries. */
interface Cell {
  readonly style: IRParameterStyle;
  readonly in: IRParameterLocation;
  readonly explode: boolean;
  readonly kind: RunnerValue['kind'];
  readonly value: RunnerValue;
  /** The rendering, or null when OpenAPI leaves the cell undefined and the runner refuses. */
  readonly expected: string | null;
}

function cell(
  style: IRParameterStyle,
  location: IRParameterLocation,
  explode: boolean,
  value: RunnerValue,
  expected: string | null,
): Cell {
  return { style, in: location, explode, kind: value.kind, value, expected };
}

/**
 * The matrix, in the order SPEC 14.2 prints it.
 *
 * Both locations of every style are listed, because a style is not the same rendering at two
 * locations: `simple` in a header is not percent encoded and `simple` in a path is.
 */
const MATRIX: readonly Cell[] = [
  // simple, path
  cell('simple', 'path', false, PRIMITIVE, 'blue'),
  cell('simple', 'path', false, ARRAY, 'blue,black,brown'),
  cell('simple', 'path', false, OBJECT, 'R,100,G,200,B,150'),
  cell('simple', 'path', true, PRIMITIVE, 'blue'),
  cell('simple', 'path', true, ARRAY, 'blue,black,brown'),
  cell('simple', 'path', true, OBJECT, 'R=100,G=200,B=150'),

  // simple, header
  cell('simple', 'header', false, PRIMITIVE, 'blue'),
  cell('simple', 'header', false, ARRAY, 'blue,black,brown'),
  cell('simple', 'header', false, OBJECT, 'R,100,G,200,B,150'),
  cell('simple', 'header', true, PRIMITIVE, 'blue'),
  cell('simple', 'header', true, ARRAY, 'blue,black,brown'),
  cell('simple', 'header', true, OBJECT, 'R=100,G=200,B=150'),

  // label, path
  cell('label', 'path', false, PRIMITIVE, '.blue'),
  cell('label', 'path', false, ARRAY, '.blue,black,brown'),
  cell('label', 'path', false, OBJECT, '.R,100,G,200,B,150'),
  cell('label', 'path', true, PRIMITIVE, '.blue'),
  cell('label', 'path', true, ARRAY, '.blue.black.brown'),
  cell('label', 'path', true, OBJECT, '.R=100.G=200.B=150'),

  // matrix, path
  cell('matrix', 'path', false, PRIMITIVE, ';color=blue'),
  cell('matrix', 'path', false, ARRAY, ';color=blue,black,brown'),
  cell('matrix', 'path', false, OBJECT, ';color=R,100,G,200,B,150'),
  cell('matrix', 'path', true, PRIMITIVE, ';color=blue'),
  cell('matrix', 'path', true, ARRAY, ';color=blue;color=black;color=brown'),
  cell('matrix', 'path', true, OBJECT, ';R=100;G=200;B=150'),

  // form, query
  cell('form', 'query', false, PRIMITIVE, 'color=blue'),
  cell('form', 'query', false, ARRAY, 'color=blue,black,brown'),
  cell('form', 'query', false, OBJECT, 'color=R,100,G,200,B,150'),
  cell('form', 'query', true, PRIMITIVE, 'color=blue'),
  cell('form', 'query', true, ARRAY, 'color=blue&color=black&color=brown'),
  cell('form', 'query', true, OBJECT, 'R=100&G=200&B=150'),

  // form, cookie. The matrix renders these and `buildRequest` refuses to send them until the
  // same origin proxy of T029, because `Cookie` is a forbidden header name for `fetch`.
  cell('form', 'cookie', false, PRIMITIVE, 'color=blue'),
  cell('form', 'cookie', false, ARRAY, 'color=blue,black,brown'),
  cell('form', 'cookie', false, OBJECT, 'color=R,100,G,200,B,150'),
  cell('form', 'cookie', true, PRIMITIVE, 'color=blue'),
  cell('form', 'cookie', true, ARRAY, 'color=blue&color=black&color=brown'),
  cell('form', 'cookie', true, OBJECT, 'R=100&G=200&B=150'),

  // spaceDelimited, query
  cell('spaceDelimited', 'query', false, PRIMITIVE, null),
  cell('spaceDelimited', 'query', false, ARRAY, 'color=blue%20black%20brown'),
  cell('spaceDelimited', 'query', false, OBJECT, 'color=R%20100%20G%20200%20B%20150'),
  cell('spaceDelimited', 'query', true, PRIMITIVE, null),
  cell('spaceDelimited', 'query', true, ARRAY, null),
  cell('spaceDelimited', 'query', true, OBJECT, null),

  // pipeDelimited, query
  cell('pipeDelimited', 'query', false, PRIMITIVE, null),
  cell('pipeDelimited', 'query', false, ARRAY, 'color=blue|black|brown'),
  cell('pipeDelimited', 'query', false, OBJECT, 'color=R|100|G|200|B|150'),
  cell('pipeDelimited', 'query', true, PRIMITIVE, null),
  cell('pipeDelimited', 'query', true, ARRAY, null),
  cell('pipeDelimited', 'query', true, OBJECT, null),

  // deepObject, query
  cell('deepObject', 'query', false, PRIMITIVE, null),
  cell('deepObject', 'query', false, ARRAY, null),
  cell('deepObject', 'query', false, OBJECT, null),
  cell('deepObject', 'query', true, PRIMITIVE, null),
  cell('deepObject', 'query', true, ARRAY, null),
  cell('deepObject', 'query', true, OBJECT, 'color[R]=100&color[G]=200&color[B]=150'),
];

describe('the SPEC 14.2 matrix, cell by cell', () => {
  for (const entry of MATRIX) {
    const title =
      `${entry.style} at a ${entry.in}, explode ${String(entry.explode)}, ${entry.kind} value` +
      (entry.expected === null ? ' is refused, because OpenAPI does not define it' : '');

    it(`should render ${title}`, () => {
      // Given
      const parameter = param(entry.style, entry.in, entry.explode);

      // When, Then
      if (entry.expected === null) {
        expect(() => serializeParameter(parameter, entry.value)).toThrow(SerializationError);
        return;
      }

      expect(render(parameter, entry.value)).toBe(entry.expected);
    });
  }

  it('should cover every cell of the matrix, which is what makes the list above a matrix', () => {
    // Given the table's own definition of what a cell is. THE COUNT IS THE POINT: a cell deleted
    // from `MATRIX` deletes its own case too, and nothing would say so without this.
    const styles: readonly IRParameterStyle[] = [
      'simple',
      'label',
      'matrix',
      'form',
      'spaceDelimited',
      'pipeDelimited',
      'deepObject',
    ];
    const locations: Readonly<Record<IRParameterStyle, readonly IRParameterLocation[]>> = {
      simple: ['path', 'header'],
      label: ['path'],
      matrix: ['path'],
      form: ['query', 'cookie'],
      spaceDelimited: ['query'],
      pipeDelimited: ['query'],
      deepObject: ['query'],
    };

    // When
    const seen = new Set(
      MATRIX.map((entry) => `${entry.style}:${entry.in}:${String(entry.explode)}:${entry.kind}`),
    );

    // Then every style at every location it is defined at, both explodes, all three kinds
    const wanted: string[] = [];
    for (const style of styles) {
      for (const location of locations[style]) {
        for (const explode of [false, true]) {
          for (const kind of ['primitive', 'array', 'object']) {
            wanted.push(`${style}:${location}:${String(explode)}:${kind}`);
          }
        }
      }
    }

    expect(wanted.filter((key) => !seen.has(key))).toEqual([]);
    expect(seen.size).toBe(wanted.length);
    // Nine style and location pairs, two explodes, three value kinds. The literal is deliberate:
    // it is the size of SPEC 14.2's table read out loud, so adding a style without adding its
    // rows here goes red rather than passing with a smaller matrix.
    expect(wanted).toHaveLength(54);
  });
});

describe('the matrix at a location the style is not defined for', () => {
  const wrong: readonly (readonly [IRParameterStyle, IRParameterLocation])[] = [
    ['form', 'path'],
    ['form', 'header'],
    ['simple', 'query'],
    ['simple', 'cookie'],
    ['label', 'query'],
    ['label', 'header'],
    ['label', 'cookie'],
    ['matrix', 'query'],
    ['matrix', 'header'],
    ['matrix', 'cookie'],
    ['spaceDelimited', 'path'],
    ['spaceDelimited', 'header'],
    ['spaceDelimited', 'cookie'],
    ['pipeDelimited', 'path'],
    ['pipeDelimited', 'header'],
    ['pipeDelimited', 'cookie'],
    ['deepObject', 'path'],
    ['deepObject', 'header'],
    ['deepObject', 'cookie'],
  ];

  for (const [style, location] of wrong) {
    it(`should refuse ${style} at a ${location}, rather than render it as the nearest style`, () => {
      // Given a document declaring a combination the SPEC 14.2 table has no row for
      const parameter = param(style, location, style === 'deepObject');

      // When, Then
      expect(() => serializeParameter(parameter, OBJECT)).toThrow(SerializationError);
    });
  }
});

describe('an empty value, which OpenAPI names and an empty list, which it does not', () => {
  it('should render an empty primitive as the empty column of the table says', () => {
    // Given, When, Then. These four are in the specification's own table.
    expect(render(param('simple', 'path', false), EMPTY_PRIMITIVE)).toBe('');
    expect(render(param('label', 'path', false), EMPTY_PRIMITIVE)).toBe('.');
    expect(render(param('matrix', 'path', false), EMPTY_PRIMITIVE)).toBe(';color');
    expect(render(param('form', 'query', false), EMPTY_PRIMITIVE)).toBe('color=');
  });

  it('chosen: an empty array or object renders as an empty value does at the same style', () => {
    // Given. OPENAPI SAYS NOTHING ABOUT THIS. Its empty column is about a value with nothing in
    // it, and a list with no members is the same situation reached from the other side: there is
    // nothing to put between the delimiters. One rule for all three keeps a reader from having
    // to learn which kinds have their own.
    for (const empty of [EMPTY_ARRAY, EMPTY_OBJECT]) {
      // When, Then
      expect(render(param('simple', 'path', false), empty)).toBe('');
      expect(render(param('label', 'path', false), empty)).toBe('.');
      expect(render(param('matrix', 'path', false), empty)).toBe(';color');
      expect(render(param('form', 'query', false), empty)).toBe('color=');
      expect(render(param('form', 'query', true), EMPTY_ARRAY)).toBe('color=');
    }
  });

  it('chosen: a rendering that never names the parameter renders an empty value as nothing', () => {
    // Given the second clause of the same rule, and the two cells it applies to. `form` exploded
    // over an object writes `R=100&G=200`, and `deepObject` writes `color[R]=100`; neither has a
    // name to write when there are no fields, so writing `color=` would invent a parameter the
    // non-empty rendering does not have.

    // When, Then
    expect(serializeParameter(param('form', 'query', true), EMPTY_OBJECT)).toEqual({
      form: 'pairs',
      pairs: [],
    });
    expect(serializeParameter(param('deepObject', 'query', true), EMPTY_OBJECT)).toEqual({
      form: 'pairs',
      pairs: [],
    });
  });
});

describe('reserved characters and the delimiters between members', () => {
  const SPACED: RunnerValue = { kind: 'array', value: ['a b', 'c/d'] };

  it('chosen: a member is percent encoded and the delimiter between members is literal', () => {
    // Given. The specification's table prints `blue,black,brown` and `blue|black|brown` with the
    // delimiter unencoded, and states no rule. Encoding the delimiter would make it a member
    // character rather than a separator, and no server implementing the style would split on it.

    // When, Then
    expect(render(param('form', 'query', false), SPACED)).toBe('color=a%20b,c%2Fd');
    expect(render(param('pipeDelimited', 'query', false), SPACED)).toBe('color=a%20b|c%2Fd');
  });

  it('chosen: spaceDelimited joins with %20, because a literal space cannot be in a url', () => {
    // Given the one delimiter that has to be encoded to survive the trip, which the
    // specification's own example shows as `blue%20black%20brown`.

    // When, Then
    expect(render(param('spaceDelimited', 'query', false), ARRAY)).toBe(
      'color=blue%20black%20brown',
    );
  });

  it('should leave reserved characters alone in a query parameter that declares allowReserved', () => {
    // Given
    const parameter = param('form', 'query', false, { allowReserved: true });

    // When, Then
    expect(render(parameter, SPACED)).toBe('color=a%20b,c/d');
  });

  it('chosen: a header value is not percent encoded at all, at any style or kind', () => {
    // Given. Percent encoding is a url rule and a header field value is not part of a url, so
    // encoding one sends `a%20b` where the reader typed `a b`. OpenAPI's table shows header
    // values unencoded, and `allowReserved` is defined for query parameters only.

    // When, Then
    expect(render(param('simple', 'header', false), SPACED)).toBe('a b,c/d');
  });

  it('chosen: deepObject writes its brackets literally and encodes the key inside them', () => {
    // Given a field name that has to be encoded and brackets that must not be. A server matching
    // on the literal `color[R]` never sees `color%5BR%5D`, and the specification's own example
    // prints the literal form.
    const parameter = param('deepObject', 'query', true);
    const value: RunnerValue = { kind: 'object', value: [['a b', 'c d']] };

    // When, Then
    expect(render(parameter, value)).toBe('color[a%20b]=c%20d');
  });
});

describe('an object keeps the order its fields were given in', () => {
  it('should not reorder integer-like field names, which a Record would', () => {
    // Given the shape SPEC 12 already caught once in the page model: an object held as a
    // `Record` iterates integer-like keys in numeric order whatever order they were written in,
    // and every exploded style puts field order into the request.
    const value: RunnerValue = {
      kind: 'object',
      value: [
        ['10', 'ten'],
        ['2', 'two'],
        ['role', 'admin'],
      ],
    };

    // When
    const rendered = render(param('deepObject', 'query', true), value);

    // Then
    expect(rendered).toBe('color[10]=ten&color[2]=two&color[role]=admin');
  });
});

/**
 * The serialization matrix of SPEC 14.2, whole: `style x explode x location x value type`.
 *
 * THE MATRIX IS THE PRODUCT AND NOT A DETAIL OF IT. A console that renders `deepObject` as
 * `form` sends a request that looks sent, comes back 400, and reads to the reader as the API
 * being wrong. Every cell is either implemented here or refused by name, and there is no third
 * behaviour: nothing in this file falls back to a nearby style.
 *
 * WHERE OPENAPI IS SILENT, THE CHOICE IS MADE HERE AND STATED, AND THE TEST NAME CARRIES IT.
 * The specification's own table has `n/a` in eleven cells and says nothing at all about an empty
 * array, an empty object, or whether a delimiter is percent encoded. Silence is not permission to
 * guess quietly: each choice below says what it chose and why, and `serialization-matrix.spec.ts`
 * names the chosen behaviour in the title of the case that pins it.
 *
 * AN ABSENT PARAMETER AND AN EMPTY ONE ARE DIFFERENT REQUESTS, which the M0 runner could not say.
 * It held one string per parameter and skipped the empty ones, so `?q=` and no `q` at all were
 * the same input. A value is now a member of {@link RunnerValue} or it is not there: absent means
 * the reader filled nothing in and the parameter does not appear, empty means they cleared the
 * field and the request carries `q=`.
 */

import { SerializationError } from '@openref/core';
import type { IRParameterLocation, IRParameterStyle } from '@openref/core';

/**
 * One value a reader supplied, in one of the three kinds SPEC 14.2 names.
 *
 * EVERY MEMBER IS A STRING, INCLUDING THE NUMBERS. The runner serializes what a reader typed and
 * has no schema to coerce against; `100` and `"100"` reach a query string as the same three
 * characters, and inventing a distinction here would put a type system between the reader and
 * their own request.
 *
 * AN OBJECT IS ORDERED PAIRS AND NOT A RECORD, and that is the same lesson as the canonical
 * serialization one in SPEC 12. `deepObject` and every exploded style render an object field by
 * field, so field order is visible in the request; a `Record` with integer-like keys iterates
 * them in numeric order whatever order they were inserted in, so `{ "10": a, "2": b }` would be
 * sent as `2` then `10`. Pairs keep what the reader wrote.
 */
export type RunnerValue =
  | { readonly kind: 'primitive'; readonly value: string }
  | { readonly kind: 'array'; readonly value: readonly string[] }
  | { readonly kind: 'object'; readonly value: readonly (readonly [string, string])[] };

/** What kind of value a parameter's schema declares, which is what a console offers a field for. */
export type RunnerValueKind = RunnerValue['kind'];

/**
 * How a serialized parameter reaches the request.
 *
 * TWO SHAPES BECAUSE THE LOCATIONS GENUINELY DIFFER, and a single one would have to be unpacked
 * by every caller anyway. A path or header parameter renders as one piece of text, spliced into
 * a template or set as a field value. A query or cookie parameter renders as zero or more
 * complete `name=value` pieces, because an exploded object produces one piece per field and its
 * own name appears in none of them.
 */
export type SerializedParameter =
  | { readonly form: 'text'; readonly text: string }
  | { readonly form: 'pairs'; readonly pairs: readonly string[] };

/** The fields of a parameter that decide how it is rendered. */
export interface SerializableParameter {
  readonly name: string;
  readonly in: IRParameterLocation;
  readonly style: IRParameterStyle;
  readonly explode: boolean;
  readonly allowReserved?: boolean;
}

/** The three kinds, which four of the seven styles all render. */
const ALL_KINDS: readonly RunnerValueKind[] = ['primitive', 'array', 'object'];

/**
 * One row of the SPEC 14.2 table: where a style is defined, which explode, which value kinds.
 *
 * ONE TABLE AND NOT THREE PARALLEL ONES, because three records keyed by the same seven styles
 * are three places a style has to be added and two of them can be forgotten silently. A row is
 * what the specification prints: `deepObject`, query, explode true, objects.
 */
interface StyleRow {
  /** Locations the table lists the style at. Anywhere else is a document that is wrong. */
  readonly at: readonly IRParameterLocation[];
  /** The one explode the style is defined for, or null for both. */
  readonly explode: boolean | null;
  /** Value kinds the style renders. The rest are the table's `n/a` cells. */
  readonly kinds: readonly RunnerValueKind[];
}

/**
 * The SPEC 14.2 table, as data, which is what makes every refusal say the row it failed against.
 *
 * THE `n/a` CELLS ARE REFUSALS AND NOT FALLBACKS. `spaceDelimited` and `pipeDelimited` exist to
 * put a delimiter between members and a primitive has no members; `deepObject` exists to write
 * one bracketed key per field and neither a primitive nor an array has fields; and the two blank
 * explode cells are blank because exploding those styles is what `form` already does. Every one
 * of them is a document saying something OpenAPI does not define, so the runner names it rather
 * than rendering it as the nearest style that would have worked.
 */
const TABLE: Readonly<Record<IRParameterStyle, StyleRow>> = {
  form: { at: ['query', 'cookie'], explode: null, kinds: ALL_KINDS },
  simple: { at: ['path', 'header'], explode: null, kinds: ALL_KINDS },
  label: { at: ['path'], explode: null, kinds: ALL_KINDS },
  matrix: { at: ['path'], explode: null, kinds: ALL_KINDS },
  spaceDelimited: { at: ['query'], explode: false, kinds: ['array', 'object'] },
  pipeDelimited: { at: ['query'], explode: false, kinds: ['array', 'object'] },
  deepObject: { at: ['query'], explode: true, kinds: ['object'] },
};

/**
 * Reserved characters of RFC 3986, which `allowReserved` leaves as they are.
 *
 * `encodeURIComponent` escapes all of them, so honouring the flag means putting these back
 * rather than writing a second encoder. Doing neither and encoding regardless would change the
 * request, which is the same defect as guessing at a style.
 */
const RESERVED = new Map<string, string>([
  ['%3A', ':'],
  ['%2F', '/'],
  ['%3F', '?'],
  ['%23', '#'],
  ['%5B', '['],
  ['%5D', ']'],
  ['%40', '@'],
  ['%21', '!'],
  ['%24', '$'],
  ['%26', '&'],
  ['%27', "'"],
  ['%28', '('],
  ['%29', ')'],
  ['%2A', '*'],
  ['%2B', '+'],
  ['%2C', ','],
  ['%3B', ';'],
  ['%3D', '='],
]);

/**
 * Percent encodes one value.
 *
 * @param value - The value as the reader typed it
 * @param allowReserved - Whether the parameter declares `allowReserved`
 * @returns The encoded value
 */
export function encodeValue(value: string, allowReserved: boolean): string {
  const encoded = encodeURIComponent(value);
  if (!allowReserved) return encoded;

  return encoded.replace(/%[0-9A-F]{2}/g, (match) => RESERVED.get(match) ?? match);
}

/**
 * How each location encodes a member, which is not the same question as which style renders it.
 *
 * A HEADER VALUE IS NOT ENCODED AT ALL, AND THAT IS A CHOSEN BEHAVIOUR. Percent encoding is a URL
 * rule and a header field value is not part of a URL, so encoding one would send `a%20b` where the
 * reader typed `a b` and the server would read the percent signs literally. OpenAPI's own table
 * shows header values unencoded. `allowReserved` is defined for query parameters only, so it is
 * read only there; a path parameter encodes everything.
 *
 * @param parameter - The parameter being rendered
 * @returns The encoder for its location
 */
function encoderFor(parameter: SerializableParameter): (member: string) => string {
  if (parameter.in === 'header') return (member) => member;
  if (parameter.in === 'query') {
    const allowReserved = parameter.allowReserved ?? false;
    return (member) => encodeValue(member, allowReserved);
  }

  return (member) => encodeValue(member, false);
}

/**
 * Refuses a cell the matrix does not define, naming the row it failed against.
 *
 * ONE MESSAGE AND NOT ONE PER CONSTRAINT. The three ways a cell can be undefined, wrong
 * location, wrong explode, wrong value kind, are one question to a reader: what does the table
 * say about this style. Printing the row answers all three at once and in the specification's
 * own vocabulary, and it costs the chunk of a deferred console one template rather than three.
 *
 * @param parameter - The parameter as the document declares it
 * @param kind - The kind of value the reader supplied
 * @throws {SerializationError} When the cell is one the table leaves blank
 */
export function assertCellDefined(parameter: SerializableParameter, kind: RunnerValueKind): void {
  const row = TABLE[parameter.style];
  const explode = row.explode;

  const defined =
    row.at.includes(parameter.in) &&
    row.kinds.includes(kind) &&
    (explode === null || explode === parameter.explode);
  if (defined) return;

  throw new SerializationError(
    `parameter '${parameter.name}' declares style '${parameter.style}' at a ${parameter.in} ` +
      `with explode ${String(parameter.explode)} and a ${kind} value, which OpenAPI does not ` +
      `define. It defines '${parameter.style}' at ${row.at.join(' and ')}, ` +
      `${explode === null ? 'with either explode' : `with explode ${String(explode)}`}, ` +
      `for ${row.kinds.join(' and ')} values`,
    'RUN_SERIALIZATION_FAILED',
    undefined,
    { parameter: parameter.name, in: parameter.in, style: parameter.style, kind },
  );
}

/** Whether a value has no members at all, which every style renders as its empty form. */
function isEmpty(value: RunnerValue): boolean {
  if (value.kind === 'primitive') return value.value === '';

  return value.value.length === 0;
}

/** Members of a value, flattened the way an unexploded style writes them. */
function flatten(value: RunnerValue): readonly string[] {
  if (value.kind === 'primitive') return [value.value];
  if (value.kind === 'array') return value.value;

  return value.value.flatMap(([key, member]) => [key, member]);
}

/**
 * Renders one parameter, per the matrix.
 *
 * @param parameter - The parameter as the document declares it
 * @param value - What the reader supplied
 * @returns The text of a path or header parameter, or the pieces of a query or cookie one
 * @throws {SerializationError} When the cell is one OpenAPI leaves undefined
 *
 * @example
 * serializeParameter({ name: 'color', in: 'query', style: 'form', explode: true }, {
 *   kind: 'array', value: ['blue', 'black'],
 * });
 * // { form: 'pairs', pairs: ['color=blue', 'color=black'] }
 */
export function serializeParameter(
  parameter: SerializableParameter,
  value: RunnerValue,
): SerializedParameter {
  assertCellDefined(parameter, value.kind);

  const encode = encoderFor(parameter);
  const name = parameter.in === 'header' ? parameter.name : encodeValue(parameter.name, false);

  switch (parameter.style) {
    case 'simple':
      return { form: 'text', text: simple(parameter, value, encode) };
    case 'label':
      return { form: 'text', text: label(parameter, value, encode) };
    case 'matrix':
      return { form: 'text', text: matrix(parameter, value, encode, name) };
    case 'form':
      return { form: 'pairs', pairs: form(parameter, value, encode, name) };
    case 'spaceDelimited':
      return { form: 'pairs', pairs: [`${name}=${flatten(value).map(encode).join('%20')}`] };
    case 'pipeDelimited':
      return { form: 'pairs', pairs: [`${name}=${flatten(value).map(encode).join('|')}`] };
    default:
      return { form: 'pairs', pairs: deepObject(value, encode, name) };
  }
}

/**
 * `simple`, at a path or a header.
 *
 * EXPLODE CHANGES ONLY THE OBJECT COLUMN HERE, which is what the OpenAPI table says and which
 * reads as an oversight until the reason is seen: an exploded `simple` array would need a
 * delimiter between members and `simple` has only the comma it already uses, so exploding it
 * would produce exactly the unexploded rendering.
 */
function simple(
  parameter: SerializableParameter,
  value: RunnerValue,
  encode: (member: string) => string,
): string {
  if (isEmpty(value)) return '';
  if (value.kind === 'object' && parameter.explode) return pairsJoined(value.value, encode, ',');

  return flatten(value).map(encode).join(',');
}

/** `label`, at a path. The dot is the marker, and an exploded value repeats it as its delimiter. */
function label(
  parameter: SerializableParameter,
  value: RunnerValue,
  encode: (member: string) => string,
): string {
  if (isEmpty(value)) return '.';
  if (!parameter.explode) return `.${flatten(value).map(encode).join(',')}`;
  if (value.kind === 'object') return `.${pairsJoined(value.value, encode, '.')}`;

  return `.${flatten(value).map(encode).join('.')}`;
}

/**
 * `matrix`, at a path.
 *
 * An exploded object is the one rendering that drops the parameter's own name: `;R=100;G=200`
 * names the fields and not the parameter, which is what OpenAPI's table shows.
 */
function matrix(
  parameter: SerializableParameter,
  value: RunnerValue,
  encode: (member: string) => string,
  name: string,
): string {
  if (isEmpty(value)) return `;${name}`;
  if (!parameter.explode) return `;${name}=${flatten(value).map(encode).join(',')}`;
  if (value.kind === 'object') return `;${pairsJoined(value.value, encode, ';')}`;
  if (value.kind === 'array')
    return value.value.map((member) => `;${name}=${encode(member)}`).join('');

  return `;${name}=${encode(value.value)}`;
}

/**
 * `form`, at a query or a cookie.
 *
 * THE EMPTY EXPLODED OBJECT IS THE ONE CELL THAT RENDERS NOTHING, and the rule behind it is
 * stated once here for every style: an empty value renders as the style's empty form, and where
 * the style's rendering of a non-empty value never contains the parameter's name, its empty form
 * is nothing at all. `form` exploded over an object writes `R=100&G=200`, so an object with no
 * fields has nothing to write and no name to write it under. The same clause covers `deepObject`.
 */
function form(
  parameter: SerializableParameter,
  value: RunnerValue,
  encode: (member: string) => string,
  name: string,
): readonly string[] {
  const exploded = parameter.explode;

  if (isEmpty(value)) return exploded && value.kind === 'object' ? [] : [`${name}=`];
  if (!exploded) return [`${name}=${flatten(value).map(encode).join(',')}`];
  if (value.kind === 'object') {
    return value.value.map(([key, member]) => `${encodeValue(key, false)}=${encode(member)}`);
  }
  if (value.kind === 'array') return value.value.map((member) => `${name}=${encode(member)}`);

  return [`${name}=${encode(value.value)}`];
}

/**
 * `deepObject`, at a query.
 *
 * THE BRACKETS ARE LITERAL AND THE KEY INSIDE THEM IS ENCODED, which is a chosen behaviour where
 * OpenAPI shows an example and states no rule. `[` and `]` are reserved characters, so a strict
 * reading would send `color%5BR%5D=100`; the specification's own example prints `color[R]=100`,
 * every server that implements the style parses the literal form, and an encoded bracket is a
 * different parameter name to a server that does not decode before matching.
 */
function deepObject(
  value: RunnerValue,
  encode: (member: string) => string,
  name: string,
): readonly string[] {
  if (value.kind !== 'object') return [];

  return value.value.map(
    ([key, member]) => `${name}[${encodeValue(key, false)}]=${encode(member)}`,
  );
}

/** `k=v` pairs joined by one delimiter, which is what every exploded object rendering is. */
function pairsJoined(
  pairs: readonly (readonly [string, string])[],
  encode: (member: string) => string,
  delimiter: string,
): string {
  return pairs.map(([key, member]) => `${encode(key)}=${encode(member)}`).join(delimiter);
}

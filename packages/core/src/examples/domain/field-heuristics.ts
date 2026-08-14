import type { IRJsonValue } from '../../ir/domain/schema.types';

/**
 * Field name heuristics for the example generator, per SPEC 5.5.
 *
 * A dictionary rather than inference: the value a name maps to is written down, so the same
 * name always produces the same example and the table is the thing that gets reviewed when an
 * example reads badly. Nothing here guesses at runtime behaviour; it only makes a placeholder
 * that looks like the field it stands for.
 */

/**
 * One entry of the dictionary: names it answers to, and what it produces.
 *
 * String entries carry a small list rather than one value, read by element position, so the
 * second element of an array differs from the first without the generator inventing a
 * transformation that could break the value's shape: the second email is written down as an
 * email, not derived from the first. An entry whose value is pinned by meaning, `REDACTED`,
 * carries one and repeats, which is the honest outcome. Number entries stay single: the
 * generator adds the element position to the base, which is valid for every number.
 */
interface Heuristic {
  /** Normalized name fragments this entry claims, checked as whole words. */
  readonly names: readonly string[];
  readonly stringValues?: readonly string[];
  readonly numberValue?: number;
}

/**
 * Splits a field name into lowercase words.
 *
 * `orderId`, `order_id`, `order-id` and `OrderID` all reduce to `['order', 'id']`, so the
 * dictionary does not have to carry one entry per casing convention.
 *
 * @param name - Field name as written in the schema
 * @returns Lowercase words, in order
 *
 * @example
 * splitFieldName('createdAtUTC'); // ['created', 'at', 'utc']
 */
export function splitFieldName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => (part === '' ? [] : [part.toLowerCase()]));
}

/**
 * The dictionary, most specific first.
 *
 * Order matters: `emailAddress` must reach the email entry rather than the address entry, so
 * the narrower name is listed above the broader one.
 */
const HEURISTICS: readonly Heuristic[] = [
  { names: ['email'], stringValues: ['user@example.com', 'user2@example.com'] },
  {
    names: ['url', 'uri', 'href', 'link', 'website'],
    stringValues: ['https://example.com', 'https://example.org'],
  },
  { names: ['phone', 'tel', 'telephone', 'mobile'], stringValues: ['+15550100', '+15550101'] },
  {
    names: ['uuid', 'guid'],
    stringValues: ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001'],
  },
  { names: ['slug'], stringValues: ['example-slug', 'second-slug'] },
  { names: ['token', 'secret', 'password', 'apikey', 'key'], stringValues: ['REDACTED'] },
  { names: ['currency'], stringValues: ['EUR', 'USD'] },
  { names: ['country'], stringValues: ['DE', 'FR'] },
  { names: ['locale', 'language', 'lang'], stringValues: ['en-US', 'de-DE'] },
  { names: ['timezone', 'tz'], stringValues: ['Europe/Berlin', 'Europe/Paris'] },
  { names: ['city'], stringValues: ['Berlin', 'Paris'] },
  { names: ['street', 'address'], stringValues: ['Example Street 1', 'Example Street 2'] },
  { names: ['zip', 'postcode', 'postalcode'], stringValues: ['10115', '75001'] },
  { names: ['firstname', 'givenname'], stringValues: ['Ada', 'Grace'] },
  { names: ['lastname', 'surname', 'familyname'], stringValues: ['Lovelace', 'Hopper'] },
  { names: ['username', 'login', 'handle'], stringValues: ['ada', 'grace'] },
  { names: ['title'], stringValues: ['Example title', 'Second title'] },
  {
    names: ['description', 'summary', 'note', 'comment'],
    stringValues: ['Example description', 'Second description'],
  },
  { names: ['message', 'reason'], stringValues: ['Example message', 'Second message'] },
  { names: ['status', 'state'], stringValues: ['active', 'inactive'] },
  { names: ['type', 'kind'], stringValues: ['example', 'sample'] },
  { names: ['name', 'label'], stringValues: ['Example name', 'Second name'] },
  { names: ['version'], stringValues: ['1.0.0', '1.1.0'] },
  {
    names: ['hash', 'checksum', 'etag'],
    stringValues: ['d41d8cd98f00b204e9800998ecf8427e', '900150983cd24fb0d6963f7d28e17f72'],
  },
  { names: ['ip'], stringValues: ['203.0.113.1', '203.0.113.2'] },
  { names: ['host', 'hostname', 'domain'], stringValues: ['example.com', 'example.org'] },
  { names: ['path'], stringValues: ['/example', '/second'] },
  { names: ['mimetype', 'contenttype'], stringValues: ['application/json', 'text/plain'] },
  { names: ['id'], stringValues: ['example-id', 'example-id-2'] },

  { names: ['price', 'amount', 'total', 'cost', 'balance'], numberValue: 19.99 },
  { names: ['rate', 'ratio', 'percent', 'percentage'], numberValue: 0.5 },
  { names: ['latitude', 'lat'], numberValue: 52.52 },
  { names: ['longitude', 'lon', 'lng'], numberValue: 13.405 },
  { names: ['age'], numberValue: 30 },
  { names: ['count', 'quantity', 'qty', 'size', 'length', 'total'], numberValue: 2 },
  { names: ['limit', 'perpage', 'pagesize'], numberValue: 20 },
  { names: ['offset', 'skip'], numberValue: 0 },
  { names: ['page', 'index', 'position', 'order', 'priority'], numberValue: 1 },
  { names: ['port'], numberValue: 8080 },
  { names: ['timestamp', 'epoch', 'unixtime'], numberValue: 1_767_225_600 },
];

/**
 * Finds the dictionary entry a field name matches.
 *
 * A name matches when one of its words, or its whole squashed form, is claimed by the entry.
 * `orderId` matches on the word `id`; `apikey` matches on the squashed form.
 */
function lookup(name: string): Heuristic | undefined {
  const words = splitFieldName(name);
  if (words.length === 0) return undefined;

  const squashed = words.join('');
  const wordSet = new Set(words);

  return HEURISTICS.find((heuristic) =>
    heuristic.names.some((claim) => claim === squashed || wordSet.has(claim)),
  );
}

/**
 * Produces a string example for a field name.
 *
 * @param name - Field name, or undefined at a position that has no name
 * @param variant - Element position the value is for, 0 outside an array
 * @returns The dictionary value at that position, or undefined when no entry claims the name
 *
 * @example
 * stringForFieldName('customerEmail'); // 'user@example.com'
 * stringForFieldName('customerEmail', 1); // 'user2@example.com'
 */
export function stringForFieldName(name: string | undefined, variant = 0): string | undefined {
  if (name === undefined) return undefined;
  const values = lookup(name)?.stringValues;
  if (values === undefined || values.length === 0) return undefined;
  return values[variant % values.length];
}

/**
 * Produces a number example for a field name.
 *
 * @param name - Field name, or undefined at a position that has no name
 * @returns The dictionary value, or undefined when no entry claims the name
 *
 * @example
 * numberForFieldName('itemCount'); // 2
 */
export function numberForFieldName(name: string | undefined): number | undefined {
  if (name === undefined) return undefined;
  return lookup(name)?.numberValue;
}

/**
 * Values produced for the JSON Schema string formats, per SPEC 5.5.
 *
 * Two samples per format wherever a second valid one is worth showing, read by element
 * position. `password` is pinned by meaning and repeats; both base64 entries decode to the
 * word they carry, `example` and `second`.
 */
const FORMAT_VALUES: Readonly<Record<string, readonly string[]>> = {
  'date-time': ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
  date: ['2026-01-01', '2026-01-02'],
  time: ['00:00:00Z', '00:00:01Z'],
  duration: ['P1D', 'P2D'],
  email: ['user@example.com', 'user2@example.com'],
  'idn-email': ['user@example.com', 'user2@example.com'],
  hostname: ['example.com', 'example.org'],
  'idn-hostname': ['example.com', 'example.org'],
  ipv4: ['203.0.113.1', '203.0.113.2'],
  ipv6: ['2001:db8::1', '2001:db8::2'],
  uri: ['https://example.com', 'https://example.org'],
  'uri-reference': ['/example', '/second'],
  'uri-template': ['https://example.com/{id}', 'https://example.org/{id}'],
  iri: ['https://example.com', 'https://example.org'],
  'iri-reference': ['/example', '/second'],
  uuid: ['00000000-0000-4000-8000-000000000000', '00000000-0000-4000-8000-000000000001'],
  'json-pointer': ['/example', '/second'],
  'relative-json-pointer': ['0/example', '0/second'],
  regex: ['^example$', '^second$'],
  byte: ['ZXhhbXBsZQ==', 'c2Vjb25k'],
  binary: ['ZXhhbXBsZQ==', 'c2Vjb25k'],
  password: ['REDACTED'],
  hostname_port: ['example.com:8080', 'example.org:8080'],
};

/**
 * Produces a string example for a declared `format`.
 *
 * @param format - Value of the `format` keyword
 * @param variant - Element position the value is for, 0 outside an array
 * @returns The value for that format at that position, or undefined for an unknown format
 *
 * @example
 * stringForFormat('date-time'); // '2026-01-01T00:00:00Z'
 * stringForFormat('date-time', 1); // '2026-01-02T00:00:00Z'
 */
export function stringForFormat(format: string | undefined, variant = 0): string | undefined {
  if (format === undefined) return undefined;
  const values = FORMAT_VALUES[format];
  if (values === undefined || values.length === 0) return undefined;
  return values[variant % values.length];
}

/** Values produced for the integer formats OpenAPI adds. */
const NUMBER_FORMAT_VALUES: Readonly<Record<string, number>> = {
  int32: 1,
  int64: 1,
  float: 1.5,
  double: 1.5,
};

/**
 * Produces a number example for a declared `format`.
 *
 * @param format - Value of the `format` keyword
 * @returns The value for that format, or undefined when the format is not in the table
 */
export function numberForFormat(format: string | undefined): number | undefined {
  if (format === undefined) return undefined;
  return NUMBER_FORMAT_VALUES[format];
}

/** The value used when nothing more specific is known about a string. */
export const GENERIC_STRING: IRJsonValue = 'string';

import type { IRJsonValue } from '../../ir/domain/schema.types';

/**
 * Field name heuristics for the example generator, per SPEC 5.5.
 *
 * A dictionary rather than inference: the value a name maps to is written down, so the same
 * name always produces the same example and the table is the thing that gets reviewed when an
 * example reads badly. Nothing here guesses at runtime behaviour; it only makes a placeholder
 * that looks like the field it stands for.
 */

/** One entry of the dictionary: names it answers to, and what it produces. */
interface Heuristic {
  /** Normalized name fragments this entry claims, checked as whole words. */
  readonly names: readonly string[];
  readonly stringValue?: string;
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
  { names: ['email'], stringValue: 'user@example.com' },
  { names: ['url', 'uri', 'href', 'link', 'website'], stringValue: 'https://example.com' },
  { names: ['phone', 'tel', 'telephone', 'mobile'], stringValue: '+15550100' },
  { names: ['uuid', 'guid'], stringValue: '00000000-0000-4000-8000-000000000000' },
  { names: ['slug'], stringValue: 'example-slug' },
  { names: ['token', 'secret', 'password', 'apikey', 'key'], stringValue: 'REDACTED' },
  { names: ['currency'], stringValue: 'EUR' },
  { names: ['country'], stringValue: 'DE' },
  { names: ['locale', 'language', 'lang'], stringValue: 'en-US' },
  { names: ['timezone', 'tz'], stringValue: 'Europe/Berlin' },
  { names: ['city'], stringValue: 'Berlin' },
  { names: ['street', 'address'], stringValue: 'Example Street 1' },
  { names: ['zip', 'postcode', 'postalcode'], stringValue: '10115' },
  { names: ['firstname', 'givenname'], stringValue: 'Ada' },
  { names: ['lastname', 'surname', 'familyname'], stringValue: 'Lovelace' },
  { names: ['username', 'login', 'handle'], stringValue: 'ada' },
  { names: ['title'], stringValue: 'Example title' },
  { names: ['description', 'summary', 'note', 'comment'], stringValue: 'Example description' },
  { names: ['message', 'reason'], stringValue: 'Example message' },
  { names: ['status', 'state'], stringValue: 'active' },
  { names: ['type', 'kind'], stringValue: 'example' },
  { names: ['name', 'label'], stringValue: 'Example name' },
  { names: ['version'], stringValue: '1.0.0' },
  { names: ['hash', 'checksum', 'etag'], stringValue: 'd41d8cd98f00b204e9800998ecf8427e' },
  { names: ['ip'], stringValue: '203.0.113.1' },
  { names: ['host', 'hostname', 'domain'], stringValue: 'example.com' },
  { names: ['path'], stringValue: '/example' },
  { names: ['mimetype', 'contenttype'], stringValue: 'application/json' },
  { names: ['id'], stringValue: 'example-id' },

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
 * @returns The dictionary value, or undefined when no entry claims the name
 *
 * @example
 * stringForFieldName('customerEmail'); // 'user@example.com'
 */
export function stringForFieldName(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  return lookup(name)?.stringValue;
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

/** Values produced for the JSON Schema string formats, per SPEC 5.5. */
const FORMAT_VALUES: Readonly<Record<string, string>> = {
  'date-time': '2026-01-01T00:00:00Z',
  date: '2026-01-01',
  time: '00:00:00Z',
  duration: 'P1D',
  email: 'user@example.com',
  'idn-email': 'user@example.com',
  hostname: 'example.com',
  'idn-hostname': 'example.com',
  ipv4: '203.0.113.1',
  ipv6: '2001:db8::1',
  uri: 'https://example.com',
  'uri-reference': '/example',
  'uri-template': 'https://example.com/{id}',
  iri: 'https://example.com',
  'iri-reference': '/example',
  uuid: '00000000-0000-4000-8000-000000000000',
  'json-pointer': '/example',
  'relative-json-pointer': '0/example',
  regex: '^example$',
  byte: 'ZXhhbXBsZQ==',
  binary: 'ZXhhbXBsZQ==',
  password: 'REDACTED',
  hostname_port: 'example.com:8080',
};

/**
 * Produces a string example for a declared `format`.
 *
 * @param format - Value of the `format` keyword
 * @returns The value for that format, or undefined when the format is not in the table
 *
 * @example
 * stringForFormat('date-time'); // '2026-01-01T00:00:00Z'
 */
export function stringForFormat(format: string | undefined): string | undefined {
  if (format === undefined) return undefined;
  return FORMAT_VALUES[format];
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

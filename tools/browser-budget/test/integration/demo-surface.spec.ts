/**
 * The demo shows what the demo is for, or it is a hello world with a README that oversells it.
 *
 * `examples/` was promoted from a test fixture to something a person clones and runs, and the
 * argument for the surface it carries is written in `examples/README.md`: five shapes that are
 * each a place a reference either works or quietly gives up. A README naming five things and an
 * application carrying two of them is the ordinary way a demo rots, and nothing reports it,
 * because both files are internally consistent.
 *
 * SO EACH CLAIM IS READ OFF THE SERVED DOCUMENT. Not off the source, which would prove the
 * decorators were typed, and not off the README, which is the thing being held to account.
 *
 * EVERY OPERATION IS ALSO SENT A REQUEST. A demo whose Send button fails is worse than no demo,
 * and an operation that is documented and does not answer is exactly that failure.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH } from '../../src/index';
import type { SpawnedServer } from '../../src/index';

const TIMEOUT = 120_000;

let app: SpawnedServer;
let specification: OpenApiLike;

/** Only the parts of the document this file reads. */
interface OpenApiLike {
  readonly paths: Record<string, Record<string, OperationLike>>;
  readonly components: { readonly schemas: Record<string, SchemaLike> };
}

interface OperationLike {
  readonly summary?: string;
  readonly parameters?: readonly { readonly name: string; readonly in: string }[];
  readonly responses: Record<string, { readonly content?: Record<string, unknown> }>;
}

interface SchemaLike {
  readonly properties?: Record<string, SchemaLike>;
  readonly items?: SchemaLike;
  readonly $ref?: string;
  readonly allOf?: readonly SchemaLike[];
  readonly oneOf?: readonly { readonly $ref?: string }[];
  readonly discriminator?: {
    readonly propertyName: string;
    readonly mapping?: Record<string, string>;
  };
}

beforeAll(async () => {
  app = await bootExampleApp();

  const response = await fetch(`${app.url}${EXAMPLE_BASE_PATH}/openapi.json`);
  expect(response.status).toBe(200);
  specification = (await response.json()) as OpenApiLike;
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
});

/**
 * Follows a `$ref` into the components of the served document.
 *
 * THROUGH A SINGLETON `allOf` AS WELL AS A BARE `$ref`, because that is what the document
 * actually carries. `@nestjs/swagger` wraps a reference in `allOf` the moment the property also
 * has a description, since a sibling of `$ref` is ignored in OpenAPI 3.0. It is composition
 * around a reference, which the normalizer has to flatten, and it is the reason this walk is
 * written against the served bytes rather than against what the decorators look like.
 *
 * @param schema - A schema, a reference to one, or a composition wrapping one
 * @returns The schema itself
 */
function deref(schema: SchemaLike): SchemaLike {
  const reference = schema.$ref ?? schema.allOf?.[0]?.$ref;
  if (reference === undefined) return schema;

  const name = reference.split('/').at(-1) ?? '';
  return specification.components.schemas[name] ?? {};
}

describe('the demo API surface', () => {
  it('should carry the four operations the README sends a reader to', () => {
    // Given the paths the served document declares
    const paths = Object.keys(specification.paths).sort();

    // Then
    expect(paths).toEqual([
      '/orders',
      '/orders/categories',
      '/orders/{id}',
      '/orders/{id}/receipt',
    ]);
  });

  it('should nest four levels deep, from an order down to a pair of coordinates', () => {
    // Given
    const order = specification.components.schemas.OrderDto ?? {};

    // When the reader walks the one path the README names
    const customer = deref(order.properties?.customer ?? {});
    const address = deref(customer.properties?.billingAddress ?? {});
    const geo = deref(address.properties?.geo ?? {});

    // Then, each level is an object with its own properties rather than a dead end
    expect(Object.keys(order.properties ?? {})).toContain('customer');
    expect(Object.keys(customer.properties ?? {})).toContain('billingAddress');
    expect(Object.keys(address.properties ?? {})).toContain('geo');
    expect(Object.keys(geo.properties ?? {}).sort()).toEqual(['latitude', 'longitude']);
  });

  it('should offer a oneOf with a discriminator that maps every alternative', () => {
    // Given
    const order = specification.components.schemas.OrderDto ?? {};

    // When
    const payment = order.properties?.payment ?? {};

    // Then, three named alternatives rather than one union of everything
    expect(payment.oneOf?.map((alternative) => alternative.$ref)).toEqual([
      '#/components/schemas/CardPaymentDto',
      '#/components/schemas/BankTransferDto',
      '#/components/schemas/WalletPaymentDto',
    ]);
    expect(payment.discriminator?.propertyName).toBe('kind');
    expect(Object.keys(payment.discriminator?.mapping ?? {}).sort()).toEqual([
      'bank_transfer',
      'card',
      'wallet',
    ]);
  });

  it('should carry a schema that refers to itself', () => {
    // Given
    const category = specification.components.schemas.CategoryDto ?? {};

    // When
    const children = category.properties?.children ?? {};

    // Then the cycle is in the document, which is what a reference has to survive
    expect(children.items?.$ref).toBe('#/components/schemas/CategoryDto');
  });

  it('should give one operation more parameters than fit on a line', () => {
    // Given
    const list = specification.paths['/orders']?.get;

    // When
    const parameters = list?.parameters ?? [];

    // Then, nine query parameters and a header, per the README
    expect(parameters.filter((parameter) => parameter.in === 'query')).toHaveLength(9);
    expect(parameters.filter((parameter) => parameter.in === 'header')).toHaveLength(1);
  });

  it('should document six status codes on one operation', () => {
    // Given
    const create = specification.paths['/orders']?.post;

    // Then
    expect(Object.keys(create?.responses ?? {}).sort()).toEqual([
      '201',
      '400',
      '402',
      '409',
      '422',
      '429',
    ]);
  });

  it('should answer one operation with something that is not JSON', () => {
    // Given
    const receipt = specification.paths['/orders/{id}/receipt']?.get;

    // When
    const success = receipt?.responses['200'];

    // Then
    expect(Object.keys(success?.content ?? {})).toEqual(['text/csv']);
  });
});

describe('the demo application behind that surface', () => {
  it('should answer every documented operation, since Send has to work', async () => {
    // Given every operation the document declares, sent a request the reference would build
    const calls: { readonly what: string; readonly response: Response }[] = [
      { what: 'list', response: await fetch(`${app.url}/orders?currency=EUR&status=placed`) },
      { what: 'categories', response: await fetch(`${app.url}/orders/categories`) },
      { what: 'read', response: await fetch(`${app.url}/orders/ord_1024`) },
      { what: 'receipt', response: await fetch(`${app.url}/orders/ord_1024/receipt`) },
      {
        what: 'create',
        response: await fetch(`${app.url}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            currency: 'EUR',
            lines: [{ sku: 'sku_flute_c', quantity: 2, unitAmount: 2250 }],
            payment: { kind: 'card', last4: '4242', network: 'visa' },
          }),
        }),
      },
    ];

    // Then
    expect(calls.filter((call) => !call.response.ok).map((call) => call.what)).toEqual([]);
    expect(calls).toHaveLength(5);
  });

  it('should serve the receipt as the content type it documents', async () => {
    // Given, a demo that documents text and answers with JSON has documented nothing
    const response = await fetch(`${app.url}/orders/ord_1024/receipt`);

    // When
    const body = await response.text();

    // Then
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(body.split('\n')[0]).toBe('sku,quantity,unitAmount');
  });

  it('should render a page for every operation, so the README sends nobody to a 404', async () => {
    // Given, the finding that closed M0: a proof measured a route that no longer existed, and a
    // 404 loads nothing, so it passed. A README is the same shape one layer up.
    const pages = [
      'get-orders',
      'get-orders-categories',
      'get-orders-id',
      'get-orders-id-receipt',
      'post-orders',
    ];

    // When
    const statuses = await Promise.all(
      pages.map(async (page) => {
        const response = await fetch(`${app.url}${EXAMPLE_BASE_PATH}/${page}`);
        return { page, status: response.status, html: await response.text() };
      }),
    );

    // Then each one is a page of the reference rather than an error page
    expect(statuses.filter((entry) => entry.status !== 200).map((entry) => entry.page)).toEqual([]);
    expect(statuses.filter((entry) => !entry.html.includes('oref-app')).map((e) => e.page)).toEqual(
      [],
    );
    expect(statuses).toHaveLength(5);
  });
});

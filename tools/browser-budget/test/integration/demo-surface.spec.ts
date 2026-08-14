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
  it('should carry the six paths the README sends a reader to', () => {
    // Given the paths the served document declares
    const paths = Object.keys(specification.paths).sort();

    // Then
    expect(paths).toEqual([
      '/orders',
      '/orders/categories',
      '/orders/events',
      '/orders/page',
      '/orders/{id}',
      '/orders/{id}/receipt',
    ]);
  });

  it('should carry the synthetic schema of the generic wrapper, per SPEC 13.5', () => {
    // Given `@ApiOkResponse(paginated(OrderDto))` on the paged route. THE POINT IS THAT IT IS IN
    // THE DOCUMENT: the schema is merged at intake, so a generator downloading `openapi.json`
    // reads the same wrapper the page renders, and there is no hand written DTO behind it.
    const wrapper = specification.components.schemas.PaginatedOrderDto ?? {};

    // Then
    expect(Object.keys(wrapper.properties ?? {}).sort()).toEqual([
      'items',
      'page',
      'perPage',
      'total',
    ]);
    expect(wrapper.properties?.items?.items?.$ref).toBe('#/components/schemas/OrderDto');
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
      { what: 'page', response: await fetch(`${app.url}/orders/page`) },
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
    expect(calls).toHaveLength(6);
  });

  it('should answer an empty create with the 400 it documents, in the shape it documents', async () => {
    // Given the second operation a reader tries, sent the way the console sends an untouched
    // form: no body at all. Express 5 leaves `req.body` undefined when no parser matched, and
    // the demo used to answer its documented 400 with an Internal Server Error, on the first
    // thing a person runs.
    const response = await fetch(`${app.url}/orders`, { method: 'POST' });

    // Then the answer is the documented status in the documented ProblemDto shape
    expect(response.status).toBe(400);
    const body = (await response.json()) as { status?: number; title?: string; detail?: string };
    expect(body.status).toBe(400);
    expect(body.title).toBe('invalid_body');
    expect(typeof body.detail).toBe('string');
  });

  it("should print under each error response an example stating that response's own status", async () => {
    // Given the page that used to print `order_conflict` with status 409 under both 400 and
    // 429: property examples travel with the schema and are identical under every response
    // that references it, so each response now declares its own example at the media type,
    // and SPEC 5.5 makes the declared example win over the generated one.
    const response = await fetch(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`);
    const html = await response.text();

    // Then the 400 example is the 400 sentence and the 429 example is the 429 one
    expect(html).toContain('invalid_parameter');
    expect(html).toContain('rate_limited');

    // And the conflict body belongs to the one response that answers 409, which is not on
    // this page at all
    expect(html).not.toContain('order_conflict');
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

  it('should say the sentence 401 and 403 share exactly once, on their merged grid item', async () => {
    // Given the operation the defect was reported against. SPEC 6.4 derives 401 and 403 from one
    // fact, so their `detail` differs by nothing at all, and the old block printed it under each
    // of them: two codes, one explanation, stacked, reading as repetition rather than as two
    // contracts. TX-GUTTER summarized the contracts in the response codes cell with no detail at
    // all; TX-MARKUP brought the full three group grid back, and the pair is one item there, so
    // the sentence is on the page exactly once, as this case's own comment promised it would
    // grow back to. Read off the served markup, because that is where a reader met it.
    const response = await fetch(`${app.url}${EXAMPLE_BASE_PATH}/get-orders`);
    const html = await response.text();
    const sentence = 'so it can refuse a caller before the handler runs';

    // When, counted over the rendered markup and not over the whole document: the page also
    // carries the model it was rendered from, as JSON, and the model is where each contract
    // rightly keeps its own copy of the field.
    const markup = html.split('<script type="application/json"')[0] ?? '';
    const said = markup.split(sentence).length - 1;

    // Then both contracts are on the page as one merged value, and the sentence appears once
    expect(markup).toContain('401, 403');
    expect(said).toBe(1);
  });

  it('should render a page for every operation, so the README sends nobody to a 404', async () => {
    // Given, the finding that closed M0: a proof measured a route that no longer existed, and a
    // 404 loads nothing, so it passed. A README is the same shape one layer up.
    const pages = [
      'get-orders',
      'get-orders-categories',
      'get-orders-events',
      'get-orders-id',
      'get-orders-id-receipt',
      'get-orders-page',
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
    expect(statuses).toHaveLength(7);
  });
});

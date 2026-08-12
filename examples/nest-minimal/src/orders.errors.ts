import type { ErrorCatalogEntry } from '@openref/nest';

/**
 * The application's error classes, and the catalog that says what each one answers with.
 *
 * IT IS THE APPLICATION'S CATALOG AND NOT THE PACKAGE'S, for the same reason `orders.security.ts`
 * holds this application's scope key. `@ApiErrors(OrderNotFoundError)` hands over a class, and a
 * class does not carry a status: constructing it to ask would run this application's code during a
 * documentation build, and reading `OrderNotFoundError` as 404 is the guess with a candidate list
 * that SPEC 6.2.1 refuses. So the mapping is written once, here, by the person who knows it.
 *
 * TWO SPELLINGS ON PURPOSE, BECAUSE BOTH ARE SUPPORTED AND A DEMO THAT SHOWS ONE PROVES ONE.
 * `OrderNotFoundError` is in the catalog below. `OrderConflictError` carries a static `status`
 * instead, which is the second level of SPEC 6.4: a declarative value under a known name, read off
 * a class object that already exists. An application with a base error class usually already has
 * the second, and never having to write a catalog at all is the point of it being there.
 */

/** The order asked for does not exist. */
export class OrderNotFoundError extends Error {}

/** The order cannot move to the requested state from the one it is in. */
export class OrderConflictError extends Error {
  /** Read by `errorsCollector` when no catalog names this class. */
  static readonly status = 409;
}

/**
 * What each declared error answers with, in RFC 9457 terms.
 *
 * Keyed by class name, which is the form a host writes by hand. `errorsCollector` also takes a
 * `Map` keyed by the class itself, which is what to reach for when two modules could export the
 * same name.
 */
export const ORDER_ERRORS: Readonly<Record<string, ErrorCatalogEntry>> = {
  OrderNotFoundError: {
    status: 404,
    title: 'Order not found',
    type: 'https://example.com/errors/order-not-found',
    detail: 'No order exists with the identifier given.',
  },
};

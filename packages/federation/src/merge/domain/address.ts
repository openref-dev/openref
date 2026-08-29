/**
 * Where a service's addresses land once it is mounted somewhere, per SPEC 15.
 *
 * TWO KINDS OF ADDRESS AND ONE RULE FOR EACH. An HTTP path is a path, and a prefix goes in front
 * of it. A channel address is a topic, a queue or a WebSocket path, and only the third of those
 * is a path at all: putting `/billing` in front of the Kafka topic `orders.created` would produce
 * a topic name no broker has. So a channel address that is a path is prefixed as a path, and one
 * that is not is prefixed with the same segments joined by a separator, which keeps the operation
 * reversible and the result readable as what it is.
 *
 * M5 OWNS EVENT DOCUMENTS AND WILL REVISIT THIS. Channels reach `T044` because `IRNode` is a union
 * and dropping half of it would not be a merge; what SPEC 15 says about a channel address conflict
 * is implemented here in the shape it says, and the AsyncAPI milestone is where a broker's own
 * naming rules can be taken into account.
 */

/** Which of the two address spaces a value is in. */
export type AddressStyle = 'path' | 'channel';

/**
 * Puts a mount prefix in front of one address.
 *
 * @param prefix - Absolute path prefix, validated by `validateServices`, such as `/billing`
 * @param address - The address as the service's own document wrote it
 * @param style - Whether the address is an HTTP path or a channel address
 * @returns The address as the merged document serves it
 *
 * @example
 * applyPrefix('/billing', '/orders', 'path'); // '/billing/orders'
 * applyPrefix('/billing', 'orders.created', 'channel'); // 'billing/orders.created'
 */
export function applyPrefix(prefix: string, address: string, style: AddressStyle): string {
  if (address === '') return prefix;

  if (style === 'path' || address.startsWith('/')) {
    if (address === '/') return prefix;
    return address.startsWith('/') ? `${prefix}${address}` : `${prefix}/${address}`;
  }

  return `${prefix.slice(1)}/${address}`;
}

/** The prefix a service namespaces with when it declared no mount of its own. */
export function servicePrefix(serviceId: string): string {
  return `/${serviceId}`;
}

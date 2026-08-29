import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
import { applyPrefix, resolveConflictMode, servicePrefix, validateServices } from '../../src/index';
import type { FederationConflictMode, FederationService } from '../../src/index';
import { buildDocument } from '../mocks/documents';

/**
 * What the merge refuses before it reads a document.
 *
 * A SERVICE ID AND A PREFIX BOTH LEAVE THIS PACKAGE. The id is prefixed onto every node id, and a
 * node id becomes a page address and a file name; the prefix becomes part of a URL path. Neither
 * is re-checked where it lands, so the check is here and it is an allowlist.
 */

/** A service with an empty document, since nothing here reads one. */
function service(id: string, prefix?: string): FederationService {
  const document = buildDocument({ id: `${id}-api` });
  return prefix === undefined ? { id, document } : { id, document, prefix };
}

/** The message of the refusal a call produces, or the empty string when it does not refuse. */
function refusal(run: () => unknown): string {
  try {
    run();
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('validateServices', () => {
  it('should accept ordinary service ids and mount prefixes', () => {
    // Given services named and mounted the way SPEC 15's example names and mounts them, plus the
    // edges of the alphabet `core` defines, since this file must not hold a second, stricter copy
    const services = [
      service('billing', '/billing'),
      service('orders'),
      service('ship-2'),
      service('-billing'),
      service('billing-'),
    ];

    // When they are validated
    const problem = refusal(() => {
      validateServices(services);
    });

    // Then nothing is refused
    expect(problem).toBe('');
  });

  it('should refuse an empty list rather than merging nothing into an empty document', () => {
    // Given no services
    // When they are validated
    const run = (): void => {
      validateServices([]);
    };

    // Then the refusal says what the caller has actually configured
    expect(run).toThrow(InvalidOptionsError);
    expect(run).toThrow(/never named a remote/);
  });

  it('should refuse two services with one id, naming both positions', () => {
    // Given the same id twice
    const services = [service('billing'), service('orders'), service('billing')];

    // When they are validated
    const run = (): void => {
      validateServices(services);
    };

    // Then the refusal names the id and where the two entries are
    expect(run).toThrow(InvalidOptionsError);
    expect(run).toThrow(/positions 0 and 2/);
  });

  it('should refuse every service id outside the alphabet SPEC 15 confines one to', () => {
    // Given the spellings that would reach a file name, a URL or a path grammar, and the
    // underscore, whose absence from the node id space is what makes the `<serviceId>_` prefix
    // separable at all
    const hostile = [
      'Billing',
      'billing service',
      'billing/orders',
      '../etc',
      'billing.v2',
      'billing_v2',
      '',
      'billing\u0000',
      'billing\u202E',
      'b'.repeat(65),
    ];

    // When each is validated on its own
    const refused = hostile.filter(
      (id) =>
        refusal(() => {
          validateServices([service(id)]);
        }) !== '',
    );

    // Then every one of them is refused
    expect(refused).toEqual(hostile);
  });

  it('should refuse every prefix that is not an absolute path of ordinary segments', () => {
    // Given the spellings a path grammar treats specially
    const hostile = [
      'billing',
      '/',
      '/billing/',
      '//billing',
      '/../etc',
      '/./billing',
      '/billing/../../etc',
      '/billing?x=1',
      '/billing#f',
      '/billing%2f..',
      '/billing\u0000',
      '/billing\n/orders',
      `/${'b'.repeat(300)}`,
    ];

    // When each is validated on its own
    const refused = hostile.filter(
      (prefix) =>
        refusal(() => {
          validateServices([service('billing', prefix)]);
        }) !== '',
    );

    // Then every one of them is refused
    expect(refused).toEqual(hostile);
  });

  it('should accept a nested prefix, which is what a gateway mount really looks like', () => {
    // Given a two segment mount
    // When it is validated
    const problem = refusal(() => {
      validateServices([service('billing', '/api/billing')]);
    });

    // Then it is accepted
    expect(problem).toBe('');
  });
});

describe('resolveConflictMode', () => {
  it('should default to the mode SPEC 15 configures in its own example', () => {
    // Given no mode
    // When it is resolved
    const mode = resolveConflictMode(undefined);

    // Then it is namespace
    expect(mode).toBe('namespace');
  });

  it('should refuse a mode that is not one of the three', () => {
    // Given a mode a caller could reach through untyped configuration
    const mode = 'last-wins' as FederationConflictMode;

    // When it is resolved
    const run = (): unknown => resolveConflictMode(mode);

    // Then the refusal lists the three
    expect(run).toThrow(InvalidOptionsError);
    expect(run).toThrow(/namespace, fail, first-wins/);
  });
});

describe('applyPrefix', () => {
  it('should put a mount in front of an HTTP path', () => {
    // Given a mount and the paths a document writes
    const paths = ['/orders', '/', '/orders/{id}'];

    // When each is prefixed as a path
    const prefixed = paths.map((path) => applyPrefix('/billing', path, 'path'));

    // Then each is under the mount, with no doubled or missing separator
    expect(prefixed).toEqual(['/billing/orders', '/billing', '/billing/orders/{id}']);
  });

  it('should join a channel address that is not a path with a separator instead', () => {
    // Given a topic, a queue and a WebSocket path
    const addresses = ['orders.created', 'billing.invoices', '/ws/events'];

    // When each is prefixed as a channel address
    const prefixed = addresses.map((address) => applyPrefix('/billing', address, 'channel'));

    // Then only the one that is a path is treated as one
    expect(prefixed).toEqual([
      'billing/orders.created',
      'billing/billing.invoices',
      '/billing/ws/events',
    ]);
  });

  it('should build the namespace prefix from the service id', () => {
    // Given a service id
    // When the merge needs a prefix for it
    const prefix = servicePrefix('billing');

    // Then it is the id as one absolute segment
    expect(prefix).toBe('/billing');
  });
});

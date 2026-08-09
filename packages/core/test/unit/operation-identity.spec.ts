import { describe, expect, it } from 'vitest';
import {
  assignOperationIdentities,
  isGeneratedOperationId,
  isStandardHttpMethod,
  operationNodeId,
  pathSlug,
  STANDARD_HTTP_METHODS,
} from '../../src/index';

describe('pathSlug', () => {
  it('should drop template braces and lowercase the rest', () => {
    // Given
    const path = '/Orders/{orderId}/Items';

    // When
    const slug = pathSlug(path);

    // Then
    expect(slug).toBe('orders-orderid-items');
  });

  it('should give the root path a name of its own', () => {
    // Given
    const paths = ['/', ''];

    // When
    const slugs = paths.map((path) => pathSlug(path));

    // Then
    expect(slugs).toEqual(['root', 'root']);
  });

  it('should collapse punctuation into single separators', () => {
    // Given
    const path = '/v1//orders.json';

    // When
    const slug = pathSlug(path);

    // Then
    expect(slug).toBe('v1-orders-json');
  });

  it('should keep two paths that differ only in the template name distinct', () => {
    // Given
    const paths = ['/orders/{id}', '/orders/{code}'];

    // When
    const slugs = paths.map((path) => pathSlug(path));

    // Then
    expect(new Set(slugs).size).toBe(2);
  });
});

describe('operationNodeId', () => {
  it('should join the lowercase method and the path slug', () => {
    // Given
    const method = 'GET';
    const path = '/orders/{id}';

    // When
    const id = operationNodeId(method, path);

    // Then
    expect(id).toBe('get-orders-id');
  });
});

describe('isGeneratedOperationId', () => {
  it('should recognise the shape a controller and a method name produce', () => {
    // Given
    const ids = ['OrdersController_findAll', 'AppController_getHello'];

    // When
    const results = ids.map((id) => isGeneratedOperationId(id));

    // Then
    expect(results).toEqual([true, true]);
  });

  it('should leave a hand written id alone', () => {
    // Given
    const ids = ['listOrders', 'orders.list', 'list-orders', '_private', 'A_'];

    // When
    const results = ids.map((id) => isGeneratedOperationId(id));

    // Then
    expect(results).toEqual([false, false, false, false, false]);
  });
});

describe('isStandardHttpMethod', () => {
  it('should accept every enumerated method, including query', () => {
    // Given
    const methods = [...STANDARD_HTTP_METHODS];

    // When
    const results = methods.map((method) => isStandardHttpMethod(method));

    // Then
    expect(results.every((result) => result)).toBe(true);
  });

  it('should reject a method the specification does not enumerate', () => {
    // Given
    const methods = ['purge', 'lock', 'GET'];

    // When
    const results = methods.map((method) => isStandardHttpMethod(method));

    // Then
    expect(results).toEqual([false, false, false]);
  });
});

describe('assignOperationIdentities', () => {
  it('should rewrite a generated operationId and keep the original', () => {
    // Given
    const operations = [
      { method: 'get', path: '/orders', rawOperationId: 'OrdersController_findAll' },
    ];

    // When
    const identities = assignOperationIdentities(operations);

    // Then
    expect(identities).toEqual([
      { id: 'get-orders', operationId: 'get-orders', rawOperationId: 'OrdersController_findAll' },
    ]);
  });

  it('should keep a hand written operationId as the public name', () => {
    // Given
    const operations = [{ method: 'get', path: '/orders', rawOperationId: 'listOrders' }];

    // When
    const identities = assignOperationIdentities(operations);

    // Then
    expect(identities[0]?.operationId).toBe('listOrders');
  });

  it('should derive an operationId when the document has none', () => {
    // Given
    const operations = [{ method: 'post', path: '/orders' }];

    // When
    const identities = assignOperationIdentities(operations);

    // Then
    expect(identities[0]).toEqual({ id: 'post-orders', operationId: 'post-orders' });
  });

  it('should disambiguate duplicate ids in document order', () => {
    // Given
    const operations = [
      { method: 'get', path: '/orders', rawOperationId: 'duplicate' },
      { method: 'get', path: '/orders/', rawOperationId: 'duplicate' },
      { method: 'get', path: '/orders//', rawOperationId: 'duplicate' },
    ];

    // When
    const identities = assignOperationIdentities(operations);

    // Then
    expect(identities.map((identity) => identity.id)).toEqual([
      'get-orders',
      'get-orders-2',
      'get-orders-3',
    ]);
    expect(identities.map((identity) => identity.operationId)).toEqual([
      'duplicate',
      'duplicate-2',
      'duplicate-3',
    ]);
  });

  it('should be stable across two runs on the same input', () => {
    // Given
    const operations = [
      { method: 'get', path: '/orders', rawOperationId: 'A_one' },
      { method: 'post', path: '/orders', rawOperationId: 'A_two' },
    ];

    // When
    const runs = [assignOperationIdentities(operations), assignOperationIdentities(operations)];

    // Then
    expect(runs[0]).toEqual(runs[1]);
  });

  it('should treat an empty operationId as absent', () => {
    // Given
    const operations = [{ method: 'get', path: '/orders', rawOperationId: '' }];

    // When
    const identities = assignOperationIdentities(operations);

    // Then
    expect(identities[0]).toEqual({ id: 'get-orders', operationId: 'get-orders' });
  });
});

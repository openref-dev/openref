import { ErrorCode, SerializationError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildRequest, encodeValue, isJsonMediaType, joinUrl } from '../../src/index';
import { operation, parameter } from '../mocks/operations';

describe('buildRequest', () => {
  it('should substitute a path parameter into the template', () => {
    // Given
    const target = operation();

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'path:id': '42' },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders/42');
    expect(plan.method).toBe('GET');
    expect(plan.body).toBeNull();
  });

  it('should percent encode a path value rather than pass a slash through', () => {
    // Given
    const target = operation();

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'path:id': 'a/b c' },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders/a%2Fb%20c');
  });

  it('should put a query parameter in the query string and a header parameter in the headers', () => {
    // Given
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({ name: 'limit', in: 'query', required: false, style: 'form', explode: true }),
        parameter({ name: 'X-Trace', in: 'header', required: true }),
      ],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'query:limit': '10', 'header:X-Trace': 'abc' },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders?limit=10');
    expect(plan.headers).toEqual({ 'X-Trace': 'abc' });
  });

  it('should omit an optional parameter the reader left empty', () => {
    // Given
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({ name: 'limit', in: 'query', required: false, style: 'form', explode: true }),
      ],
    });

    // When
    const plan = buildRequest(target, { serverUrl: 'https://api.example.com', values: {} });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders');
  });

  it('should leave reserved characters alone when the parameter allows them', () => {
    // Given
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({
          name: 'filter',
          in: 'query',
          required: false,
          style: 'form',
          explode: true,
          allowReserved: true,
        }),
      ],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'query:filter': 'a/b:c' },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders?filter=a/b:c');
  });

  it('should refuse a required parameter with no value rather than send without it', () => {
    // Given
    const target = operation({
      path: '/orders',
      parameters: [parameter({ name: 'X-Trace', in: 'header', required: true })],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://api.example.com', values: {} });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/required/);
  });

  it('should refuse a path parameter with no value rather than send to a different route', () => {
    // Given
    const target = operation();

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://api.example.com', values: {} });

    // Then
    expect(build).toThrow(SerializationError);
  });

  it('should refuse a style outside the M0 subset and name the milestone', () => {
    // Given, deepObject is a cell of the matrix M2 covers.
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({ name: 'filter', in: 'query', required: false, style: 'deepObject' }),
      ],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: { 'query:filter': 'x' },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/deepObject/);
    expect(build).toThrow(/M2/);
  });

  it('should refuse a cookie parameter, which a script cannot set', () => {
    // Given
    const target = operation({
      path: '/orders',
      parameters: [parameter({ name: 'session', in: 'cookie', required: false, style: 'form' })],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://api.example.com', values: {} });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/cookie/);
  });

  it('should refuse a server the operation does not declare', () => {
    // Given, otherwise a console would be a request forwarder to any host a caller names.
    const target = operation();

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://evil.example', values: { 'path:id': '1' } });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/not one this operation declares/);
  });

  it('should refuse a path template holding a placeholder no parameter declares', () => {
    // Given
    const target = operation({ path: '/orders/{id}/items/{itemId}' });

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://api.example.com', values: { 'path:id': '1' } });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/itemId/);
  });

  it('should send a JSON body and set the content type from the declared media type', () => {
    // Given
    const target = operation({
      method: 'post',
      path: '/orders',
      parameters: [],
      bodyMediaTypes: ['application/json'],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: {},
      body: '{"sku":"a"}',
    });

    // Then
    expect(plan.body).toBe('{"sku":"a"}');
    expect(plan.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('should send no body when the reader typed only whitespace', () => {
    // Given
    const target = operation({ method: 'post', path: '/orders', parameters: [] });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: {},
      body: '  \n',
    });

    // Then
    expect(plan.body).toBeNull();
    expect(plan.headers['Content-Type']).toBeUndefined();
  });

  it('should refuse a body that is not valid JSON rather than let the server reject it', () => {
    // Given
    const target = operation({
      method: 'post',
      path: '/orders',
      parameters: [],
      bodyMediaTypes: ['application/json'],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://api.example.com', values: {}, body: '{oops' });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/not valid JSON/);
  });

  it('should refuse a media type outside the M0 subset and name the milestone', () => {
    // Given
    const target = operation({
      method: 'post',
      path: '/orders',
      parameters: [],
      bodyMediaTypes: ['multipart/form-data'],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, { serverUrl: 'https://api.example.com', values: {}, body: '{}' });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/multipart\/form-data/);
    expect(build).toThrow(/M2/);
  });

  it('should carry the serialization error code on every refusal', () => {
    // Given
    const target = operation();

    // When
    let thrown: unknown;
    try {
      buildRequest(target, { serverUrl: 'https://api.example.com', values: {} });
    } catch (error: unknown) {
      thrown = error;
    }

    // Then
    expect((thrown as SerializationError).code).toBe(ErrorCode.RUN_SERIALIZATION_FAILED);
  });

  it('should add auth headers and query values on top of the parameters', () => {
    // Given
    const target = operation({ path: '/orders', parameters: [] });

    // When
    const plan = buildRequest(
      target,
      { serverUrl: 'https://api.example.com', values: {} },
      { headers: { Authorization: 'Bearer t' }, query: [['access_token', 'k e y']] },
    );

    // Then
    expect(plan.url).toBe('https://api.example.com/orders?access_token=k%20e%20y');
    expect(plan.headers).toEqual({ Authorization: 'Bearer t' });
  });
});

describe('joinUrl', () => {
  it('should join without doubling the separator', () => {
    // Given
    const cases: [string, string, string][] = [
      ['https://api.example.com', '/orders', 'https://api.example.com/orders'],
      ['https://api.example.com/', '/orders', 'https://api.example.com/orders'],
      ['https://api.example.com/v1//', 'orders', 'https://api.example.com/v1/orders'],
      ['/api', '/orders', '/api/orders'],
    ];

    // When
    const actual = cases.map(([base, path]) => joinUrl(base, path));

    // Then
    expect(actual).toEqual(cases.map(([, , expected]) => expected));
  });
});

describe('encodeValue and isJsonMediaType', () => {
  it('should encode everything by default and keep the reserved set when allowed', () => {
    // Given
    const value = "a/b?c#d[e]f@g!h$i&j'k(l)m*n+o,p;q=r";

    // When
    const strict = encodeValue(value, false);
    const relaxed = encodeValue(value, true);

    // Then
    expect(strict).not.toContain('/');
    expect(relaxed).toBe(value);
  });

  it('should recognise the structured json suffix and nothing else', () => {
    // Given
    const cases = [
      'application/json',
      'application/problem+json',
      'application/json; charset=utf-8',
      'text/plain',
      'multipart/form-data',
    ];

    // When
    const actual = cases.map((mediaType) => isJsonMediaType(mediaType));

    // Then
    expect(actual).toEqual([true, true, true, false, false]);
  });
});

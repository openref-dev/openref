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
      values: { 'path:id': { kind: 'primitive', value: '42' } },
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
      values: { 'path:id': { kind: 'primitive', value: 'a/b c' } },
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
      values: {
        'query:limit': { kind: 'primitive', value: '10' },
        'header:X-Trace': { kind: 'primitive', value: 'abc' },
      },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders?limit=10');
    expect(plan.headers).toEqual({ 'X-Trace': 'abc' });
  });

  it('should omit an optional parameter the reader never filled in', () => {
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

  /**
   * Absent and empty, which the M0 runner could not tell apart.
   *
   * It held one string per parameter and skipped the empty ones, so a reader who cleared a field
   * and a reader who never opened it sent the same request. T026 is where the two separate: no
   * key at all is absent, a key holding an empty value is a value with nothing in it, and `?q=`
   * is a question a server can answer differently from no `q` at all.
   */
  it('should send an optional parameter the reader cleared, which is not the same as absent', () => {
    // Given
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({ name: 'q', in: 'query', required: false, style: 'form', explode: true }),
      ],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'query:q': { kind: 'primitive', value: '' } },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders?q=');
  });

  it('should refuse a required parameter left empty, and name allowEmptyValue as the exception', () => {
    // Given a required parameter the reader cleared. An empty value is a value, and it is still
    // not an answer to a question the operation says it cannot be asked without.
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({ name: 'q', in: 'query', required: true, style: 'form', explode: true }),
      ],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: { 'query:q': { kind: 'primitive', value: '' } },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/allowEmptyValue/);
  });

  it('should send a required parameter left empty when the document declares allowEmptyValue', () => {
    // Given the one document that can overrule the rule above, which is the one that declared
    // the parameter
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({
          name: 'q',
          in: 'query',
          required: true,
          style: 'form',
          explode: true,
          allowEmptyValue: true,
        }),
      ],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'query:q': { kind: 'primitive', value: '' } },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders?q=');
  });

  it('should refuse a path parameter that renders as nothing, whatever left it empty', () => {
    // Given a `simple` path parameter with an empty value. It renders as the empty string, so
    // `/orders/{id}` would become `/orders/`, which is a request to a different route and a 404
    // a reader would read as the API's answer. The test is what came out rather than which style
    // produced it: `matrix` and `label` render an empty value as `;id` and `.` and keep the
    // segment, which OpenAPI's own empty column defines.
    //
    // `allowEmptyValue` IS ON IT DELIBERATELY, so this reaches the rendering rather than stopping
    // at the required check, which is the refusal a plain path parameter gets first. It is also
    // the interesting case: the document says an empty value is allowed and the route still
    // cannot carry one, so the two refusals are about different things and both are needed.
    const target = operation({
      parameters: [parameter({ allowEmptyValue: true })],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: { 'path:id': { kind: 'primitive', value: '' } },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/renders as nothing/);
  });

  it('should keep the path segment for a matrix parameter whose value is empty', () => {
    // Given the other side of the same rule, which is why it is written about the output
    const target = operation({
      path: '/orders{id}',
      parameters: [parameter({ name: 'id', style: 'matrix', allowEmptyValue: true })],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: { 'path:id': { kind: 'primitive', value: '' } },
    });

    // Then
    expect(plan.url).toBe('https://api.example.com/orders;id');
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
      values: { 'query:filter': { kind: 'primitive', value: 'a/b:c' } },
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

  it('should build a deepObject query parameter, which T026 added to the whole matrix', () => {
    // Given, the style this case used to assert a refusal for. M0 refused every style but the
    // default one and named M2 in the message; T026 is that milestone, and the whole of SPEC
    // 14.2 is in `serialization-matrix.spec.ts`. What is checked here is that `buildRequest`
    // reaches it rather than holding a second opinion about which styles exist.
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({
          name: 'filter',
          in: 'query',
          required: false,
          style: 'deepObject',
          explode: true,
        }),
      ],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: {
        'query:filter': {
          kind: 'object',
          value: [
            ['status', 'open'],
            ['since', '2026-01-01'],
          ],
        },
      },
    });

    // Then
    expect(plan.url).toBe(
      'https://api.example.com/orders?filter[status]=open&filter[since]=2026-01-01',
    );
  });

  it('should refuse a cell OpenAPI leaves undefined rather than fall back to a nearby style', () => {
    // Given, `deepObject` with a primitive, which the SPEC 14.2 table prints as n/a
    const target = operation({
      path: '/orders',
      parameters: [
        parameter({
          name: 'filter',
          in: 'query',
          required: false,
          style: 'deepObject',
          explode: true,
        }),
      ],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: { 'query:filter': { kind: 'primitive', value: 'x' } },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/deepObject/);
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
      buildRequest(target, {
        serverUrl: 'https://evil.example',
        values: { 'path:id': { kind: 'primitive', value: '1' } },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/not one this operation declares/);
  });

  it('should refuse a path template holding a placeholder no parameter declares', () => {
    // Given
    const target = operation({ path: '/orders/{id}/items/{itemId}' });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: { 'path:id': { kind: 'primitive', value: '1' } },
      });

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
      body: [{ mediaType: 'application/json' }],
    });

    // When
    const plan = buildRequest(target, {
      serverUrl: 'https://api.example.com',
      values: {},
      body: { kind: 'text', text: '{"sku":"a"}' },
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
      body: { kind: 'text', text: '  \n' },
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
      body: [{ mediaType: 'application/json' }],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: {},
        body: { kind: 'text', text: '{oops' },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/not valid JSON/);
  });

  it('should refuse one typed value at a media type that is made of named fields', () => {
    // Given a multipart operation and a body typed as one blob, which is what the M0 console
    // could produce and what T027 replaced with a field per declared property. The refusal names
    // the reason rather than the milestone: the media type is supported, and this is not how it
    // is filled in.
    const target = operation({
      method: 'post',
      path: '/orders',
      parameters: [],
      body: [{ mediaType: 'multipart/form-data' }],
    });

    // When
    const build = (): unknown =>
      buildRequest(target, {
        serverUrl: 'https://api.example.com',
        values: {},
        body: { kind: 'text', text: '{}' },
      });

    // Then
    expect(build).toThrow(SerializationError);
    expect(build).toThrow(/multipart\/form-data/);
    expect(build).toThrow(/named fields/);
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

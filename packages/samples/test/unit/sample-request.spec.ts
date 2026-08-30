import { describe, expect, it } from 'vitest';
import { AuthError } from '@openref/core';
import { applyCredentials, buildRequest } from '@openref/runner';
import type { RunnableSecurityScheme } from '@openref/runner';
import {
  BASIC_CREDENTIAL_PLACEHOLDER,
  buildSampleRequest,
  placeholderCredentials,
} from '../../src/index';
import { createPet, listPets, replacePhoto, SERVER, pngFile } from '../mocks/operations';

describe('buildSampleRequest', () => {
  it('should return exactly the plan the runner builds for the same inputs', () => {
    // Given
    const operation = createPet();
    const inputs = {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text' as const, text: '{"name":"Fido"}' },
    };
    const credentials = { apiKey: 'secret-value' };

    // When
    const request = buildSampleRequest(operation, inputs, credentials);

    // Then
    expect(request.plan).toEqual(
      buildRequest(operation, inputs, applyCredentials(operation.security, credentials)),
    );
  });

  it('should carry the reader body beside the plan, since a byte body cannot be printed', () => {
    // Given
    const file = pngFile();
    const body = { kind: 'binary' as const, file };

    // When
    const request = buildSampleRequest(replacePhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body,
    });

    // Then
    expect(request.body).toBe(body);
    expect(typeof request.plan.body).not.toBe('string');
  });

  it('should report no content type for a request that carries no body', () => {
    // Given
    const operation = listPets();

    // When
    const request = buildSampleRequest(operation, { values: {}, serverUrl: SERVER });

    // Then
    expect(request.plan.body).toBeNull();
    expect(request.contentType).toBeNull();
  });

  it('should read a content type written under a casing the runner did not choose', () => {
    // Given, a document that names the content type header itself, in a casing of its own
    const request = buildSampleRequest(contentTypeParameterOperation(), {
      values: { 'header:content-type': { kind: 'primitive', value: 'application/vnd.pet+json' } },
      serverUrl: SERVER,
      body: { kind: 'text', text: '{}' },
    });

    // When
    const found = request.contentType;

    // Then
    expect(request.plan.headers).not.toHaveProperty('Content-Type: application/vnd.pet+json');
    expect(found).toBe('application/vnd.pet+json');
  });

  it('should record that the runner writes both casings when a document names that header', () => {
    // Given, the same operation, whose only header parameter is the content type in lower case
    const operation = contentTypeParameterOperation();
    expect(operation.parameters.map((parameter) => parameter.name)).toEqual(['content-type']);

    // When
    const request = buildSampleRequest(operation, {
      values: { 'header:content-type': { kind: 'primitive', value: 'application/vnd.pet+json' } },
      serverUrl: SERVER,
      body: { kind: 'text', text: '{}' },
    });

    // Then, `resolveBody` guards on the exact key and HTTP field names are case insensitive, so
    // the plan carries two, and `new Headers` joins them into one field with the value written
    // twice. Pinned here because `contentTypeOf` exists for this reading and a caller of this
    // package should find the behaviour written down rather than in a request.
    //
    // THIS PIN IS A DEBT RECORD AND IS EXPECTED TO FLIP. The defect is the runner's, at the
    // `headers['Content-Type'] ??=` guard in `resolveBody` in `request-plan.ts`, named by its
    // expression because a line number drifts. Fixing it means SPEC 14.3 moving first, which is
    // why `T057` did not fix it in passing; it is item 4 of the `T059` section in
    // `ai-docs/BUILD-AMENDMENTS.md`. When that lands, this case asserts one key rather than two.
    expect(Object.keys(request.plan.headers).sort()).toEqual(['Content-Type', 'content-type']);
  });
});

/** An operation whose document declares the content type header itself, in lower case. */
function contentTypeParameterOperation(): ReturnType<typeof createPet> {
  return {
    ...createPet(),
    security: [],
    parameters: [
      { name: 'content-type', in: 'header', required: false, style: 'simple', explode: false },
    ],
    body: [{ mediaType: 'application/vnd.pet+json' }],
  };
}

describe('placeholderCredentials', () => {
  it('should give every sendable scheme a placeholder derived from its id', () => {
    // Given
    const schemes: RunnableSecurityScheme[] = [
      { id: 'apiKey', type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      { id: 'bearer', type: 'http', scheme: 'bearer' },
      { id: 'oauth', type: 'oauth2' },
    ];

    // When
    const { values, unsendable } = placeholderCredentials(schemes);

    // Then
    expect(values).toEqual({ apiKey: '<apiKey>', bearer: '<bearer>', oauth: '<oauth>' });
    expect(unsendable).toEqual([]);
  });

  it('should give a basic scheme the pair it is made of, since the runner encodes the pair', () => {
    // Given
    const schemes: RunnableSecurityScheme[] = [{ id: 'basic', type: 'http', scheme: 'Basic' }];

    // When
    const { values } = placeholderCredentials(schemes);

    // Then
    expect(values.basic).toBe(BASIC_CREDENTIAL_PLACEHOLDER);
  });

  it('should put the placeholder on the wire as the base64 its own JSDoc prints', () => {
    // Given, the figure the JSDoc of `BASIC_CREDENTIAL_PLACEHOLDER` states, which is what a reader
    // sees in the sample. It is asserted rather than described, because a base64 string written
    // only in a comment is one nobody decodes again.
    const operation = {
      ...createPet(),
      security: [{ id: 'basic', type: 'http', scheme: 'basic' }] satisfies RunnableSecurityScheme[],
    };
    const { values } = placeholderCredentials(operation.security);

    // When
    const request = buildSampleRequest(operation, { values: {}, serverUrl: SERVER }, values);

    // Then
    expect(request.plan.headers.Authorization).toBe('Basic PHVzZXI+OjxwYXNzd29yZD4=');
  });

  it('should list a scheme no request can carry instead of giving it a value', () => {
    // Given
    const schemes: RunnableSecurityScheme[] = [
      { id: 'mtls', type: 'mutualTLS' },
      { id: 'session', type: 'apiKey', in: 'cookie', name: 'sid' },
      { id: 'bearer', type: 'http', scheme: 'bearer' },
    ];

    // When
    const { values, unsendable } = placeholderCredentials(schemes);

    // Then
    expect(Object.keys(values)).toEqual(['bearer']);
    expect(unsendable).toEqual([
      { schemeId: 'mtls', cause: 'mutual-tls' },
      { schemeId: 'session', cause: 'cookie-api-key' },
    ]);
  });

  it('should keep a sample buildable for an operation whose schemes cannot all be sent', () => {
    // Given, the same list, and the runner refuses the unsendable one when it holds a value
    const operation = {
      ...createPet(),
      security: [
        { id: 'mtls', type: 'mutualTLS' },
        { id: 'apiKey', type: 'apiKey', in: 'header', name: 'X-Api-Key' },
      ] satisfies RunnableSecurityScheme[],
    };
    expect(() =>
      buildSampleRequest(operation, { values: {}, serverUrl: SERVER }, { mtls: 'anything' }),
    ).toThrow(AuthError);

    // When
    const { values } = placeholderCredentials(operation.security);
    const request = buildSampleRequest(operation, { values: {}, serverUrl: SERVER }, values);

    // Then
    expect(request.plan.headers).toEqual({ 'X-Api-Key': '<apiKey>' });
  });
});

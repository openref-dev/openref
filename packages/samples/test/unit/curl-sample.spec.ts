import { describe, expect, it } from 'vitest';
import { DEFAULT_BOUNDARY, isMultipart } from '@openref/runner';
import { buildSampleRequest, generateCodeSamples, SAMPLE_LANGUAGES } from '../../src/index';
import {
  createPet,
  listPets,
  pngFile,
  postNote,
  replacePhoto,
  SERVER,
  uploadPhoto,
} from '../mocks/operations';

const CURL = SAMPLE_LANGUAGES.filter((language) => language.id === 'shell');

/** The cURL sample for one request, which every case here reads. */
function curlFor(request: Parameters<typeof generateCodeSamples>[0]): string {
  const { samples } = generateCodeSamples(request, CURL);
  expect(samples).toHaveLength(1);

  return samples[0]!.source;
}

describe('emitCurl', () => {
  it('should carry the plan url and method verbatim, since the plan is the one source', () => {
    // Given
    const request = buildSampleRequest(listPets(), {
      values: {
        'query:limit': { kind: 'primitive', value: '10' },
        'query:tags': { kind: 'array', value: ['cat', 'small dog'] },
      },
      serverUrl: SERVER,
    });

    // When
    const source = curlFor(request);

    // Then
    expect(source).toContain(`'${request.plan.url}'`);
    expect(source).toContain('curl -X GET ');
    expect(request.plan.url).toBe('https://api.example.com/v1/pets?limit=10&tags=cat,small%20dog');
  });

  it('should quote a value holding a single quote by closing, escaping and reopening', () => {
    // Given, the one character a single quoted shell word cannot contain
    const request = buildSampleRequest(createPet(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: `{"name":"O'Hara"}` },
    });

    // When
    const source = curlFor(request);

    // Then
    expect(source).toContain(`--data-raw '{"name":"O'\\''Hara"}'`);
  });

  it('should send a text body with --data-raw, so a leading at sign is not read as a file', () => {
    // Given
    const request = buildSampleRequest(postNote(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: '@etc/passwd' },
    });

    // When
    const source = curlFor(request);

    // Then
    expect(source).toContain(`--data-raw '@etc/passwd'`);
    expect(source).not.toContain('--data-binary');
  });

  it('should send a multipart text field with --form-string, which never reads a file', () => {
    // Given, a field value beginning with the character `-F` would treat as a file name
    const request = buildSampleRequest(uploadPhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: {
        kind: 'fields',
        fields: [
          { kind: 'text', name: 'note', value: '@home' },
          { kind: 'file', name: 'cover', file: pngFile() },
        ],
      },
    });

    // When
    const source = curlFor(request);

    // Then
    expect(source).toContain(`--form-string 'note=@home'`);
    expect(source).toContain(`-F 'cover=@"cover.png";type=image/png'`);
  });

  it('should leave the content type to curl for a multipart body, since the boundary is curls', () => {
    // Given, the plan does carry one, and it names the runner's boundary
    const request = buildSampleRequest(uploadPhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: { kind: 'fields', fields: [{ kind: 'text', name: 'note', value: 'hello' }] },
    });
    expect(request.contentType).toBe(`multipart/form-data; boundary=${DEFAULT_BOUNDARY}`);
    expect(isMultipart(request.contentType ?? '')).toBe(true);

    // When
    const source = curlFor(request);

    // Then
    expect(source).not.toContain(DEFAULT_BOUNDARY);
    expect(source).not.toContain('-H ');
  });

  it('should keep the content type for a binary body, which curl would not set itself', () => {
    // Given
    const request = buildSampleRequest(replacePhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: { kind: 'binary', file: pngFile() },
    });

    // When
    const source = curlFor(request);

    // Then
    expect(source).toContain(`-H 'Content-Type: image/png'`);
    expect(source).toContain(`--data-binary '@cover.png'`);
  });
});

describe('a header curl would otherwise drop', () => {
  it('should spell an empty value with the form curl sends rather than the one it removes', () => {
    // Given, measured against the real binary: `-H 'X-Empty: '` reaches the server with no such
    // field at all, and a value of nothing but spaces does the same
    const request = buildSampleRequest(
      {
        ...listPets(),
        parameters: [
          { name: 'X-Empty', in: 'header', required: false, style: 'simple', explode: false },
        ],
      },
      { values: { 'header:X-Empty': { kind: 'primitive', value: '' } }, serverUrl: SERVER },
    );
    expect(request.plan.headers['X-Empty']).toBe('');

    // When
    const command = curlFor(request);

    // Then
    expect(command).toContain(`-H 'X-Empty;'`);
    expect(command).not.toContain(`-H 'X-Empty: '`);
  });

  it('should keep the ordinary spelling for a value that is not empty', () => {
    // Given, the control
    const request = buildSampleRequest(
      {
        ...listPets(),
        parameters: [
          { name: 'X-Trace', in: 'header', required: false, style: 'simple', explode: false },
        ],
      },
      { values: { 'header:X-Trace': { kind: 'primitive', value: 'abc' } }, serverUrl: SERVER },
    );

    // When
    const command = curlFor(request);

    // Then
    expect(command).toContain(`-H 'X-Trace: abc'`);
  });
});

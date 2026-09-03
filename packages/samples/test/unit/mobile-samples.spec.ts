/**
 * The three mobile clients SPEC 18 adds: Swift, Kotlin and Dart.
 *
 * THEY ARE HERE FOR A READER AND NOT FOR SYMMETRY, which is the ruling SPEC 18 records. A mobile
 * application is a constant consumer of an HTTP API and the first nine covered none: Java is the
 * JVM's server half, and Android has been Kotlin for years. So each of the three is spelled with
 * the client its own platform uses, and this suite checks that rather than checking that a string
 * came out.
 *
 * TWO OF THE THREE MAKE A CHOICE THAT KEEPS A HEADER HONEST, and both are checked here because
 * both are the kind of thing a later edit undoes without noticing. OkHttp writes `Content-Type`
 * from the body's media type, so the sample must not also set the header; `package:http` rewrites
 * the content type when the `body` setter is used, so the sample uses `bodyBytes`.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSampleRequest,
  BYTE_BODY_REFUSAL,
  generateCodeSamples,
  OKHTTP_MISSING_BODY_REFUSAL,
} from '../../src/index';
import type { SampleLanguageId, SampleRequest } from '../../src/index';
import { createPet, listPets, pngFile, postNote, SERVER, uploadPhoto } from '../mocks/operations';

/** The source of one language, asserting first that the language produced one at all. */
function sourceOf(request: SampleRequest, lang: SampleLanguageId): string {
  const sample = generateCodeSamples(request).samples.find((entry) => entry.lang === lang);
  expect(sample, `${lang} produced no sample`).toBeDefined();

  return sample?.source ?? '';
}

/** A JSON request all three can write. */
function jsonRequest(): SampleRequest {
  return buildSampleRequest(
    createPet(),
    { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{"name":"Fido"}' } },
    { apiKey: '<apiKey>' },
  );
}

describe('Swift', () => {
  it('should build a URLRequest, set every header on it and hand it to URLSession', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), 'swift');

    // Then
    expect(source).toContain('import Foundation');
    expect(source).toContain('var request = URLRequest(url: URL(string: ');
    expect(source).toContain('request.httpMethod = "POST"');
    expect(source).toContain(
      'request.setValue("application/json", forHTTPHeaderField: "Content-Type")',
    );
    expect(source).toContain('request.setValue("<apiKey>", forHTTPHeaderField: "X-Api-Key")');
    expect(source).toContain('request.httpBody = Data("{\\"name\\":\\"Fido\\"}".utf8)');
    expect(source).toContain('try await URLSession.shared.data(for: request)');
  });

  it('should spell a control character with the braced escape Swift reads', () => {
    // Given, a text body rather than a JSON one, because a raw control character inside a JSON
    // string is not valid JSON and the runner refuses to build the request at all
    const request = buildSampleRequest(postNote(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: 'ab' },
    });

    // When
    const source = sourceOf(request, 'swift');

    // Then
    expect(source).toContain('Data("a\\u{1}b".utf8)');
  });
});

describe('Kotlin', () => {
  it('should build an OkHttp request, which is the client Android actually uses', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), 'kotlin');

    // Then
    expect(source).toContain('import okhttp3.OkHttpClient');
    expect(source).toContain('val request = Request.Builder()');
    expect(source).toContain('.header("X-Api-Key", "<apiKey>")');
    expect(source).toContain('OkHttpClient().newCall(request).execute()');
  });

  it('should carry the content type on the body, which is where OkHttp reads it from', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), 'kotlin');

    // Then, one value in one place: the bridge interceptor writes the header from the body
    expect(source).toContain('.toRequestBody("application/json".toMediaType())');
    expect(source).not.toContain('.header("Content-Type"');
  });

  it('should pass a null body for a request that carries none', () => {
    // Given
    const request = buildSampleRequest(listPets(), { values: {}, serverUrl: SERVER });

    // When
    const source = sourceOf(request, 'kotlin');

    // Then
    expect(source).toContain('.method("GET", null)');
    expect(source).not.toContain('toRequestBody');
  });

  it('should escape a dollar sign, which opens a template expression in a Kotlin string', () => {
    // Given
    const request = buildSampleRequest(createPet(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: '{"price":"$9.99"}' },
    });

    // When
    const source = sourceOf(request, 'kotlin');

    // Then
    expect(source).toContain('"{\\"price\\":\\"\\$9.99\\"}"');
  });

  it('should refuse a bodyless POST, which OkHttp requires a body on', () => {
    // Given, the commonest shape the first edition of this emitter wrote `.method("POST", null)`
    // for, which `Request.Builder.method` rejects through `HttpMethod.requiresRequestBody`
    const request = buildSampleRequest(
      { ...createPet(), body: [] },
      { values: {}, serverUrl: SERVER },
      { apiKey: '<apiKey>' },
    );
    expect(request.plan.method).toBe('POST');
    expect(request.plan.body).toBeNull();

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(samples.map((sample) => sample.lang)).not.toContain('kotlin');
    expect(omitted.find((entry) => entry.lang === 'kotlin')?.reason).toBe(
      OKHTTP_MISSING_BODY_REFUSAL,
    );

    // And the control: a bodyless GET is not a method OkHttp requires a body on, so it still writes
    // one, which is what keeps this case about the requirement rather than about bodies at all.
    const bodyless = generateCodeSamples(
      buildSampleRequest(listPets(), { values: {}, serverUrl: SERVER }),
    );
    expect(bodyless.samples.map((sample) => sample.lang)).toContain('kotlin');
  });
});

describe('Dart', () => {
  it('should build an http.Request and send it through a client', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), 'dart');

    // Then
    expect(source).toContain('import "package:http/http.dart" as http;');
    expect(source).toContain('final request = http.Request("POST", Uri.parse(');
    expect(source).toContain('request.headers["X-Api-Key"] = "<apiKey>";');
    expect(source).toContain('final response = await http.Client().send(request);');
  });

  it('should set bodyBytes, because the body setter would rewrite the content type', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), 'dart');

    // Then, `request.body =` appends a charset the runner never sent
    expect(source).toContain('import "dart:convert";');
    expect(source).toContain('request.bodyBytes = utf8.encode("{\\"name\\":\\"Fido\\"}");');
    expect(source).not.toContain('request.body =');
  });

  it('should escape a dollar sign, which opens an interpolation in a Dart string', () => {
    // Given
    const request = buildSampleRequest(createPet(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: '{"price":"$9.99"}' },
    });

    // When
    const source = sourceOf(request, 'dart');

    // Then
    expect(source).toContain('"{\\"price\\":\\"\\$9.99\\"}"');
  });

  it('should import dart:convert only when there is a body to encode', () => {
    // Given
    const request = buildSampleRequest(listPets(), { values: {}, serverUrl: SERVER });

    // When
    const source = sourceOf(request, 'dart');

    // Then
    expect(source).not.toContain('dart:convert');
  });
});

describe('all three mobile clients against a byte body', () => {
  it('should refuse it by name, with the reason every template shares', () => {
    // Given
    const request = buildSampleRequest(uploadPhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: {
        kind: 'fields',
        fields: [
          { kind: 'text', name: 'note', value: 'front' },
          { kind: 'file', name: 'cover', file: pngFile() },
        ],
      },
    });

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    for (const lang of ['swift', 'kotlin', 'dart'] as const) {
      expect(samples.map((sample) => sample.lang)).not.toContain(lang);
      expect(omitted.find((entry) => entry.lang === lang)?.reason).toBe(BYTE_BODY_REFUSAL);
    }
  });
});

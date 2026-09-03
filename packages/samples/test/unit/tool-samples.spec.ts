/**
 * The three command line tools of SPEC 18: what each writes, and what each refuses by name.
 *
 * EVERY REFUSAL HERE HAS A MEASUREMENT BEHIND IT, taken off a live server on 2026-09-03 and
 * recorded in SPEC 18. This suite pins the refusal, not the measurement: it proves that the request
 * shape the measurement found inexpressible produces a named reason rather than a command, which is
 * the rule SPEC 14.7 already states for a socket handshake and `emit-curl.ts` for a multipart field
 * name curl misreads.
 *
 * A REFUSAL IS CHECKED AS DATA AND NOT AS AN ABSENCE. Each case asserts the tab is missing and that
 * `omitted` carries the tab's own name and the reason SPEC 18 names, because a sample vanishing
 * silently is the failure the `omitted` list exists to prevent.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSampleRequest,
  generateCodeSamples,
  HTTPIE_MULTIPART_REFUSAL,
  HTTPIE_SEPARATOR_REFUSAL,
  POWERSHELL_MULTIPART_REFUSAL,
  POWERSHELL_TYPED_EMPTY_REFUSAL,
  SAMPLE_LANGUAGES,
  UNTYPED_BODY_REFUSAL,
  WGET_MULTIPART_REFUSAL,
} from '../../src/index';
import type { SampleLanguageId, SampleOmission, SampleRequest } from '../../src/index';
import {
  createPet,
  listPets,
  pngFile,
  replacePhoto,
  SERVER,
  uploadPhoto,
} from '../mocks/operations';

/** The tab a tool draws, by the id SPEC 18 gives it. */
const HTTPIE: SampleLanguageId = 'bash';
const WGET: SampleLanguageId = 'sh';
const POWERSHELL: SampleLanguageId = 'powershell';

/** The source of one language, asserting first that the language produced one at all. */
function sourceOf(request: SampleRequest, lang: SampleLanguageId): string {
  const sample = generateCodeSamples(request).samples.find((entry) => entry.lang === lang);
  expect(sample, `${lang} produced no sample`).toBeDefined();

  return sample?.source ?? '';
}

/** The omission one language produced, asserting first that it produced one. */
function omissionOf(request: SampleRequest, lang: SampleLanguageId): SampleOmission {
  const { samples, omitted } = generateCodeSamples(request);

  // A PROOF OF ABSENCE ASSERTS THE SUBJECT WAS PRESENT: the language is in the set being asked
  // for, so its absence from `samples` is a refusal and not a language nobody requested.
  expect(SAMPLE_LANGUAGES.map((language) => language.id)).toContain(lang);
  expect(samples.map((entry) => entry.lang)).not.toContain(lang);

  const entry = omitted.find((one) => one.lang === lang);
  expect(entry, `${lang} was dropped with no reason attached`).toBeDefined();

  return entry ?? { lang, label: '', reason: '' };
}

/** A JSON request every tool can write. */
function jsonRequest(): SampleRequest {
  return buildSampleRequest(
    createPet(),
    { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{"name":"Fido"}' } },
    { apiKey: '<apiKey>' },
  );
}

/** A multipart request, whose parts no tool here can frame. */
function multipartRequest(): SampleRequest {
  return buildSampleRequest(uploadPhoto(), {
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
}

/** A request carrying a header parameter whose name HTTPie reads as one of its own separators. */
function separatorHeaderRequest(name: string): SampleRequest {
  return buildSampleRequest(
    {
      ...listPets(),
      parameters: [{ name, in: 'header', required: false, style: 'simple', explode: false }],
    },
    { values: { [`header:${name}`]: { kind: 'primitive', value: 'v' } }, serverUrl: SERVER },
  );
}

describe('HTTPie', () => {
  it('should write the method, the url, each header and the body as one command', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), HTTPIE);

    // Then
    expect(source).toContain('http --ignore-stdin POST ');
    expect(source).toContain(`'https://api.example.com/v1/pets'`);
    expect(source).toContain(`'Content-Type:application/json'`);
    expect(source).toContain(`'X-Api-Key:<apiKey>'`);
    expect(source).toContain(`--raw '{"name":"Fido"}'`);
  });

  it('should spell an empty header value with the form that sends it and not the form that drops it', () => {
    // Given, `X-Empty:` was measured to remove the header from what HTTPie sends
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
    const source = sourceOf(request, HTTPIE);

    // Then
    expect(source).toContain(`'X-Empty;'`);
    expect(source).not.toContain(`'X-Empty:'`);
  });

  it('should read its own body from the file for a binary body, which is what stdin is for', () => {
    // Given
    const request = buildSampleRequest(replacePhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: { kind: 'binary', file: pngFile() },
    });

    // When
    const source = sourceOf(request, HTTPIE);

    // Then, the flag that would make HTTPie ignore the redirect is left out for this shape alone
    expect(source).toContain(`< 'cover.png'`);
    expect(source).not.toContain('--ignore-stdin');
  });

  it.each([['=1'], ['=true'], ['="a"'], ['=[1]'], ['@home']])(
    'should refuse a header whose value opens with %s, since the join makes the separator',
    (value) => {
      // Given, the emitter writes `name:value`, so the colon and the value's first character meet
      const request = buildSampleRequest(
        {
          ...listPets(),
          parameters: [
            { name: 'X-V', in: 'header', required: false, style: 'simple', explode: false },
          ],
        },
        { values: { 'header:X-V': { kind: 'primitive', value } }, serverUrl: SERVER },
      );
      expect(request.plan.headers['X-V']).toBe(value);

      // When
      const entry = omissionOf(request, HTTPIE);

      // Then
      expect(entry.reason).toBe(HTTPIE_SEPARATOR_REFUSAL);
    },
  );

  it('should write a header whose value carries a separator anywhere but the front', () => {
    // Given, the control that keeps the refusal about the opening character: HTTPie was measured
    // delivering `a@b.com` intact, so refusing it would cost a reader an ordinary tab
    const request = buildSampleRequest(
      {
        ...listPets(),
        parameters: [
          { name: 'X-M', in: 'header', required: false, style: 'simple', explode: false },
        ],
      },
      { values: { 'header:X-M': { kind: 'primitive', value: 'a@b.com' } }, serverUrl: SERVER },
    );

    // When
    const source = sourceOf(request, HTTPIE);

    // Then
    expect(source).toContain(`'X-M:a@b.com'`);
  });

  it.each([['X-A=B'], ['X-A@B']])(
    'should refuse a header named %s, which HTTPie reads as a body field rather than a header',
    (name) => {
      // Given
      const request = separatorHeaderRequest(name);
      expect(request.plan.headers[name]).toBe('v');

      // When
      const entry = omissionOf(request, HTTPIE);

      // Then
      expect(entry.label).toBe('HTTPie');
      expect(entry.reason).toBe(HTTPIE_SEPARATOR_REFUSAL);
    },
  );

  it('should refuse a multipart body by name rather than framing one it cannot frame', () => {
    // Given, When
    const entry = omissionOf(multipartRequest(), HTTPIE);

    // Then
    expect(entry.label).toBe('HTTPie');
    expect(entry.reason).toBe(HTTPIE_MULTIPART_REFUSAL);
  });
});

describe('wget', () => {
  it('should write the method, the url last, each header and the body as one command', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), WGET);

    // Then
    expect(source).toContain('wget -O -');
    expect(source).toContain(`--method 'POST'`);
    expect(source).toContain(`--header 'Content-Type: application/json'`);
    expect(source).toContain(`--body-data '{"name":"Fido"}'`);
    expect(source.trimEnd().endsWith(`'https://api.example.com/v1/pets'`)).toBe(true);
  });

  it('should send a binary body from the file, which wget can do and its reputation says it cannot', () => {
    // Given
    const request = buildSampleRequest(replacePhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: { kind: 'binary', file: pngFile() },
    });

    // When
    const source = sourceOf(request, WGET);

    // Then
    expect(source).toContain(`--body-file 'cover.png'`);
  });

  it('should refuse a multipart body, which is the one shape it has no encoder for', () => {
    // Given, When
    const entry = omissionOf(multipartRequest(), WGET);

    // Then
    expect(entry.label).toBe('wget');
    expect(entry.reason).toBe(WGET_MULTIPART_REFUSAL);
  });
});

describe('PowerShell', () => {
  it('should write every method through -CustomMethod, since -Method is an enumeration', () => {
    // Given, a method the WebRequestMethod enumeration does not name, measured to fail on -Method
    const exotic = buildSampleRequest(
      { ...createPet(), method: 'query' },
      { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{}' } },
    );

    // When
    const standard = sourceOf(jsonRequest(), POWERSHELL);
    const source = sourceOf(exotic, POWERSHELL);

    // Then, one shape for both rather than a helper per method and an untested fallback
    expect(standard).toContain(`-CustomMethod 'POST'`);
    expect(standard).not.toContain('-Method ');
    expect(source).toContain(`-CustomMethod 'QUERY'`);
  });

  it('should carry the headers in a hash table and the body beside it', () => {
    // Given, When
    const source = sourceOf(jsonRequest(), POWERSHELL);

    // Then
    expect(source).toContain(`-Uri 'https://api.example.com/v1/pets'`);
    expect(source).toContain(`'Content-Type' = 'application/json'`);
    expect(source).toContain(`'X-Api-Key' = '<apiKey>'`);
    expect(source).toContain(`-Body '{"name":"Fido"}'`);
  });

  it('should silence its own content type on a bodyless request, which it otherwise invents', () => {
    // Given, the divergence the widened wire comparison found: a bodyless POST reached the server
    // carrying `Content-Type: application/x-www-form-urlencoded`, which the runner never sent
    const request = buildSampleRequest(
      { ...createPet(), body: [] },
      { values: {}, serverUrl: SERVER },
      { apiKey: '<apiKey>' },
    );
    expect(request.plan.body).toBeNull();

    // When
    const source = sourceOf(request, POWERSHELL);

    // Then
    expect(source).toContain(`-ContentType ''`);

    // And never where there is a body, whose content type is a real one
    expect(sourceOf(jsonRequest(), POWERSHELL)).not.toContain(`-ContentType`);
  });

  it('should read a binary body off disk rather than putting bytes in the command', () => {
    // Given
    const request = buildSampleRequest(replacePhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: { kind: 'binary', file: pngFile() },
    });

    // When
    const source = sourceOf(request, POWERSHELL);

    // Then
    expect(source).toContain(`-Body ([System.IO.File]::ReadAllBytes('cover.png'))`);
  });

  it('should refuse a content type with no body on GET alone, which is where it was measured', () => {
    // Given, the same operation shape the C# refusal is written against
    const typedEmpty = (method: string): SampleRequest =>
      buildSampleRequest(
        {
          ...listPets(),
          method,
          parameters: [
            {
              name: 'Content-Type',
              in: 'header',
              required: false,
              style: 'simple',
              explode: false,
            },
          ],
        },
        {
          values: { 'header:Content-Type': { kind: 'primitive', value: 'application/json' } },
          serverUrl: SERVER,
        },
      );
    expect(typedEmpty('get').plan.body).toBeNull();

    // When
    const entry = omissionOf(typedEmpty('get'), POWERSHELL);

    // Then
    expect(entry.label).toBe('PowerShell');
    expect(entry.reason).toBe(POWERSHELL_TYPED_EMPTY_REFUSAL);

    // And the correction the blind review forced: the first edition refused all six methods, and
    // the matrix found only GET drops the header. Refusing the rest cost a reader five tabs that
    // send exactly what the console sends.
    for (const method of ['head', 'post', 'put', 'delete', 'options']) {
      const source = sourceOf(typedEmpty(method), POWERSHELL);
      expect(source, `${method} should still be written`).toContain(
        `'Content-Type' = 'application/json'`,
      );
    }
  });

  it('should refuse a multipart body, whose parts -Form cannot be told to frame', () => {
    // Given, When
    const entry = omissionOf(multipartRequest(), POWERSHELL);

    // Then
    expect(entry.label).toBe('PowerShell');
    expect(entry.reason).toBe(POWERSHELL_MULTIPART_REFUSAL);
  });

  it('should escape a quote in a value by doubling it, since a single quoted string expands nothing', () => {
    // Given, a body carrying the one character a PowerShell single quoted string can be ended by,
    // and a subexpression that a double quoted one would have run
    const request = buildSampleRequest(createPet(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: `{"n":"O'Hara $(whoami)"}` },
    });

    // When
    const source = sourceOf(request, POWERSHELL);

    // Then
    expect(source).toContain(`-Body '{"n":"O''Hara $(whoami)"}'`);
  });
});

describe('a body whose content type the plan does not carry', () => {
  /**
   * The plan `resolveBody` does not produce, built here so the guard has a subject.
   *
   * IT IS ASSEMBLED RATHER THAN OBTAINED, and that is the point. `sample-request.ts` records that
   * a body always reaches the plan with a content type today, so this shape cannot be reached
   * through `buildSampleRequest`; the guard exists because "does not arise today" and "cannot
   * arise" are different claims, and a guard with no case behind it is the second claim asserted.
   */
  function untypedBodyRequest(): SampleRequest {
    return {
      plan: { method: 'POST', url: 'https://api.example.com/v1/pets', headers: {}, body: '{}' },
      body: { kind: 'text', text: '{}' },
      contentType: null,
    };
  }

  it.each([[HTTPIE], [WGET], [POWERSHELL]])(
    'should refuse %s rather than let it choose a content type of its own',
    (lang) => {
      // Given
      const request = untypedBodyRequest();
      expect(request.plan.body).not.toBeNull();
      expect(request.contentType).toBeNull();

      // When
      const entry = omissionOf(request, lang);

      // Then
      expect(entry.reason).toBe(UNTYPED_BODY_REFUSAL);
    },
  );
});

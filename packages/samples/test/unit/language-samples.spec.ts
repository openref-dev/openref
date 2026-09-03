import { describe, expect, it } from 'vitest';
import {
  BYTE_BODY_REFUSAL,
  buildSampleRequest,
  generateCodeSamples,
  SAMPLE_LANGUAGES,
} from '../../src/index';
import type { SampleLanguageId } from '../../src/index';
import { createPet, listPets, pngFile, SERVER, uploadPhoto } from '../mocks/operations';

/** The fifteen ids, in the order SPEC 18 lists them. */
const ALL_IDS: readonly SampleLanguageId[] = [
  'shell',
  'bash',
  'sh',
  'powershell',
  'typescript',
  'python',
  'go',
  'php',
  'java',
  'csharp',
  'ruby',
  'rust',
  'swift',
  'kotlin',
  'dart',
];

/** Which of the fifteen can write a body the plan carries as bytes. */
const BYTE_BODY_IDS: readonly SampleLanguageId[] = ['shell', 'typescript', 'python'];

/** A JSON request every language can write. */
function jsonRequest(): ReturnType<typeof buildSampleRequest> {
  return buildSampleRequest(
    createPet(),
    { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{"name":"Fido"}' } },
    { apiKey: '<apiKey>' },
  );
}

/** A multipart request, whose body reaches the plan as bytes. */
function multipartRequest(): ReturnType<typeof buildSampleRequest> {
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

describe('SAMPLE_LANGUAGES', () => {
  it('should name the fifteen of SPEC 18, six at level 1 and nine at level 2', () => {
    // Given, When
    const ids = SAMPLE_LANGUAGES.map((language) => language.id);
    const levelOne = SAMPLE_LANGUAGES.filter((language) => language.level === 1);

    // Then
    expect(ids).toEqual(ALL_IDS);
    expect(levelOne.map((language) => language.label)).toEqual([
      'cURL',
      'HTTPie',
      'wget',
      'PowerShell',
      'TypeScript',
      'Python',
    ]);
    expect(SAMPLE_LANGUAGES.filter((language) => language.level === 2)).toHaveLength(9);
  });

  it('should give every tab an id of its own, since a repeat makes the second unreachable', () => {
    // Given, `CodeSample` finds the active tab by `lang` and keys the strip by it
    const ids = SAMPLE_LANGUAGES.map((language) => language.id);

    // When
    const distinct = new Set(ids);

    // Then
    expect(distinct.size).toBe(ids.length);
    expect(new Set(SAMPLE_LANGUAGES.map((language) => language.label)).size).toBe(ids.length);
  });
});

describe('generateCodeSamples', () => {
  it('should write all fifteen languages for a text body, in the order they are declared', () => {
    // Given
    const request = jsonRequest();

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(samples.map((sample) => sample.lang)).toEqual(ALL_IDS);
    expect(omitted).toEqual([]);
    for (const sample of samples) expect(sample.source).toContain(request.plan.url);
  });

  it('should label each tab with the language name and not with the highlighter id', () => {
    // Given, When
    const { samples } = generateCodeSamples(jsonRequest());

    // Then
    expect(samples.map((sample) => sample.label)).toEqual([
      'cURL',
      'HTTPie',
      'wget',
      'PowerShell',
      'TypeScript',
      'Python',
      'Go',
      'PHP',
      'Java',
      'C#',
      'Ruby',
      'Rust',
      'Swift',
      'Kotlin',
      'Dart',
    ]);
  });

  it('should write only the three that can frame a byte body, and say why for the twelve', () => {
    // Given, the same generator answers all fifteen for the text body above
    const request = multipartRequest();

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(samples.map((sample) => sample.lang)).toEqual(BYTE_BODY_IDS);
    expect(omitted.map((entry) => entry.lang)).toEqual([
      'bash',
      'sh',
      'powershell',
      'go',
      'php',
      'java',
      'csharp',
      'ruby',
      'rust',
      'swift',
      'kotlin',
      'dart',
    ]);

    // And every refusal names a reason, none of which is empty or shared by accident: the nine
    // templates give one sentence and the three tools give three of their own.
    for (const entry of omitted) expect(entry.reason.length).toBeGreaterThan(0);
    const templates = omitted.filter((entry) => !['bash', 'sh', 'powershell'].includes(entry.lang));
    for (const entry of templates) expect(entry.reason).toBe(BYTE_BODY_REFUSAL);
  });

  it('should honour a caller that asks for one language', () => {
    // Given
    const asked = SAMPLE_LANGUAGES.filter((language) => language.id === 'python');

    // When
    const { samples } = generateCodeSamples(jsonRequest(), asked);

    // Then
    expect(samples.map((sample) => sample.lang)).toEqual(['python']);
  });
});

describe('a multipart text part that declares its own content type', () => {
  /** The request whose first part carries a content type, which the runner writes as a header. */
  function typedPartRequest(): ReturnType<typeof buildSampleRequest> {
    return buildSampleRequest(uploadPhoto(), {
      values: { 'path:petId': { kind: 'primitive', value: '7' } },
      serverUrl: SERVER,
      body: {
        kind: 'fields',
        fields: [
          { kind: 'text', name: 'meta', value: '{"a":1}', contentType: 'application/json' },
          { kind: 'text', name: 'plain', value: 'no type' },
        ],
      },
    });
  }

  it('should carry the part content type in all three languages that can write a byte body', () => {
    // Given, When
    const { samples } = generateCodeSamples(typedPartRequest());
    const byLang = new Map(samples.map((sample) => [sample.lang, sample.source]));

    // Then
    expect(byLang.get('shell')).toContain(`-F 'meta="{\\"a\\":1}";type=application/json'`);
    expect(byLang.get('typescript')).toContain(
      'body.append("meta", new Blob(["{\\"a\\":1}"], { type: "application/json" }));',
    );
    expect(byLang.get('python')).toContain('("meta", (None, "{\\"a\\":1}", "application/json")),');
  });

  it('should leave a part with no content type in the literal form of each language', () => {
    // Given, the control the case above needs
    const { samples } = generateCodeSamples(typedPartRequest());
    const byLang = new Map(samples.map((sample) => [sample.lang, sample.source]));

    // Then
    expect(byLang.get('shell')).toContain(`--form-string 'plain=no type'`);
    expect(byLang.get('typescript')).toContain('body.append("plain", "no type");');
    expect(byLang.get('python')).toContain('("plain", (None, "no type")),');
  });
});

describe('the level 2 templates', () => {
  it('should put the content type on the body for C#, which is where .NET carries it', () => {
    // Given
    const { samples } = generateCodeSamples(jsonRequest());
    const csharp = samples.find((sample) => sample.lang === 'csharp');

    // When
    const source = csharp?.source ?? '';

    // Then
    expect(source).toContain('request.Content = new StringContent("{\\"name\\":\\"Fido\\"}");');
    expect(source).toContain(
      'request.Content.Headers.ContentType = MediaTypeHeaderValue.Parse("application/json");',
    );
    expect(source).not.toContain('request.Headers.Add("Content-Type"');
  });

  it('should refuse C# for a request that declares a content type and sends no body', () => {
    // Given, a document that names the header itself on an operation with no body
    const operation = {
      ...listPets(),
      parameters: [
        {
          name: 'Content-Type',
          in: 'header' as const,
          required: false,
          style: 'simple' as const,
          explode: false,
        },
      ],
    };
    const request = buildSampleRequest(operation, {
      values: { 'header:Content-Type': { kind: 'primitive', value: 'application/json' } },
      serverUrl: SERVER,
    });
    expect(request.plan.body).toBeNull();

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(samples.map((sample) => sample.lang)).not.toContain('csharp');
    expect(omitted.find((entry) => entry.lang === 'csharp')).toEqual({
      lang: 'csharp',
      label: 'C#',
      reason:
        'this request declares a content type and sends no body, and the .NET client carries ' +
        'a content type on the body alone',
    });

    // And PowerShell refuses the same pair for the same reason in its own words, which is why the
    // list is read by language rather than compared whole: two clients of one platform family
    // share the limit and neither refusal is the other's.
    expect(omitted.map((entry) => entry.lang)).toEqual(['powershell', 'csharp']);
  });

  it('should build a Ruby request through the generic class when the method has no helper', () => {
    // Given, the same operation under a method Ruby ships a class for, as the control
    const standard = generateCodeSamples(jsonRequest()).samples.find(
      (sample) => sample.lang === 'ruby',
    );
    expect(standard?.source).toContain('Net::HTTP::Post.new(uri)');

    // When
    const exotic = buildSampleRequest(
      { ...createPet(), method: 'query' },
      {
        values: {},
        serverUrl: SERVER,
        body: { kind: 'text', text: '{}' },
      },
    );
    const { samples } = generateCodeSamples(exotic);

    // Then
    expect(samples.find((sample) => sample.lang === 'ruby')?.source).toContain(
      'Net::HTTPGenericRequest.new("QUERY", true, true, uri)',
    );
  });

  it('should build a Rust method from bytes when reqwest names no constant for it', () => {
    // Given, the constant path is what a standard method takes
    const standard = generateCodeSamples(jsonRequest()).samples.find(
      (sample) => sample.lang === 'rust',
    );
    expect(standard?.source).toContain('reqwest::Method::POST');

    // When
    const exotic = buildSampleRequest(
      { ...createPet(), method: 'query' },
      {
        values: {},
        serverUrl: SERVER,
        body: { kind: 'text', text: '{}' },
      },
    );
    const { samples } = generateCodeSamples(exotic);

    // Then
    expect(samples.find((sample) => sample.lang === 'rust')?.source).toContain(
      'reqwest::Method::from_bytes("QUERY".as_bytes())?',
    );
  });
});

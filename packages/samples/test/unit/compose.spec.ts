import { describe, expect, it } from 'vitest';
import type { IRCodeSample } from '@openref/core';
import { buildSampleRequest, composeCodeSamples, generateCodeSamples } from '../../src/index';
import { createPet, SERVER } from '../mocks/operations';

/** What a document writes under `x-codeSamples`, which is level 3 of SPEC 18. */
const DECLARED: readonly IRCodeSample[] = [
  { lang: 'shell', label: 'cURL', source: 'curl https://docs.example.com/written-by-hand' },
  { lang: 'kotlin', label: 'Kotlin', source: 'val client = HttpClient()' },
];

/** The generated samples for a JSON request, which every case here composes against. */
function generated(): readonly IRCodeSample[] {
  const request = buildSampleRequest(createPet(), {
    values: {},
    serverUrl: SERVER,
    body: { kind: 'text', text: '{}' },
  });

  return generateCodeSamples(request).samples;
}

describe('composeCodeSamples', () => {
  it('should put the document samples first, in the order the document wrote them', () => {
    // Given
    const produced = generated();
    expect(produced[0]?.lang).toBe('shell');

    // When
    const { samples } = composeCodeSamples(DECLARED, produced);

    // Then
    expect(samples.slice(0, 2)).toEqual(DECLARED);
  });

  it('should drop the generated sample for a language the document already wrote', () => {
    // Given, the generator does produce a shell sample
    const produced = generated();
    expect(produced.filter((sample) => sample.lang === 'shell')).toHaveLength(1);

    // When
    const { samples } = composeCodeSamples(DECLARED, produced);

    // Then
    expect(samples.filter((sample) => sample.lang === 'shell')).toEqual([DECLARED[0]]);
  });

  it('should leave one sample per language, since a tab is found by its language', () => {
    // Given, When
    const { samples } = composeCodeSamples(DECLARED, generated());
    const langs = samples.map((sample) => sample.lang);

    // Then
    expect(new Set(langs).size).toBe(langs.length);
    expect(langs).toEqual([
      'shell',
      'kotlin',
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
      'dart',
    ]);
  });

  it('should return the generated samples unchanged when the document wrote none', () => {
    // Given
    const produced = generated();

    // When
    const composed = composeCodeSamples(undefined, produced);

    // Then
    expect(composed.samples).toEqual(produced);
    expect(composed.unreachable).toEqual([]);
  });

  it('should return the document samples alone when the generator produced none', () => {
    // Given, When
    const composed = composeCodeSamples(DECLARED, []);

    // Then
    expect(composed.samples).toEqual(DECLARED);
    expect(composed.unreachable).toEqual([]);
  });

  it('should keep the first of two document samples under one language and return the rest', () => {
    // Given a document that wrote two samples under one language, of which a tab strip keyed by
    // `lang` can show one. The first edition deduplicated the generated list against the declared
    // one and never the declared list against itself.
    const twice: readonly IRCodeSample[] = [
      ...DECLARED,
      { lang: 'shell', label: 'cURL, verbose', source: 'curl -v https://docs.example.com' },
    ];

    // When
    const composed = composeCodeSamples(twice, []);

    // Then the first is the tab and the second is handed back rather than dropped, so the caller
    // can say what the document wrote and the page cannot show.
    expect(composed.samples).toEqual(DECLARED);
    expect(composed.unreachable).toEqual([twice[2]]);
  });
});

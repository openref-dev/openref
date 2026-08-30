import { describe, expect, it } from 'vitest';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import type { SampleLanguageId } from '../../src/index';
import { createPet, listPets, SERVER } from '../mocks/operations';

/**
 * What carrying a body looks like in each language.
 *
 * ONE TABLE FOR BOTH DIRECTIONS, so the case that proves a bodyless request emits no body argument
 * and the case that proves a body-carrying one does are checked against the same nine strings.
 * A marker that no language ever emits would pass the first half and fail the second, which is why
 * both halves are here.
 */
const BODY_MARKERS: Readonly<Record<SampleLanguageId, readonly string[]>> = {
  shell: ['--data-raw', '--data-binary', '--form-string', '-F '],
  typescript: ['body:', 'body,'],
  python: ['content=', 'files=', 'data='],
  go: ['strings.NewReader'],
  php: ['CURLOPT_POSTFIELDS'],
  java: ['BodyPublishers.ofString'],
  csharp: ['request.Content'],
  ruby: ['request.body ='],
  rust: ['.body('],
};

describe('a sample for an operation with no body', () => {
  it('should emit no body argument in any of the nine languages', () => {
    // Given
    const request = buildSampleRequest(listPets(), {
      values: { 'query:limit': { kind: 'primitive', value: '10' } },
      serverUrl: SERVER,
    });
    expect(request.plan.body).toBeNull();

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(omitted).toEqual([]);
    for (const sample of samples) {
      for (const marker of BODY_MARKERS[sample.lang as SampleLanguageId]) {
        expect(sample.source, `${sample.label} emitted ${marker}`).not.toContain(marker);
      }
    }
  });

  it('should say the request has no body where the language insists on saying something', () => {
    // Given, the two clients whose call takes a body argument that cannot be left out
    const request = buildSampleRequest(listPets(), { values: {}, serverUrl: SERVER });

    // When
    const { samples } = generateCodeSamples(request);
    const byLang = new Map(samples.map((sample) => [sample.lang, sample.source]));

    // Then
    expect(byLang.get('go')).toContain(
      'http.NewRequest("GET", "https://api.example.com/v1/pets", nil)',
    );
    expect(byLang.get('java')).toContain('.method("GET", HttpRequest.BodyPublishers.noBody())');
  });

  it('should emit one in every language for an operation that does carry a body', () => {
    // Given, the control the case above needs to mean anything
    const request = buildSampleRequest(createPet(), {
      values: {},
      serverUrl: SERVER,
      body: { kind: 'text', text: '{"name":"Fido"}' },
    });
    expect(request.plan.body).toBe('{"name":"Fido"}');

    // When
    const { samples } = generateCodeSamples(request);

    // Then
    expect(samples).toHaveLength(9);
    for (const sample of samples) {
      const markers = BODY_MARKERS[sample.lang as SampleLanguageId];
      const carried = markers.some((marker) => sample.source.includes(marker));
      expect(carried, `${sample.label} emitted none of ${markers.join(', ')}`).toBe(true);
    }
  });
});

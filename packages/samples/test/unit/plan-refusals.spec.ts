/**
 * The two refusals that belong to the request rather than to any client, and the one note.
 *
 * BOTH REFUSALS CAME OUT OF A BLIND REVIEW THAT FOUND SAMPLES SENDING SOMETHING OTHER THAN THE
 * PLAN, which is the defect SPEC 18 exists to prevent and which outranks any over-refusal. A `GET`
 * carrying a body is a plan the runner will not send at all, and fourteen emitters wrote a sample
 * for it; a header value outside US-ASCII leaves different octets on the wire depending on who
 * writes the command, and nothing was checking it.
 *
 * THE NOTE IS THE THIRD ANSWER AND IS DELIBERATELY NOT A REFUSAL. On a redirect the five clients
 * that can be run here send the first request identically and then diverge over the response, so
 * the sample is correct and the reader still needs telling.
 */

import { describe, expect, it } from 'vitest';
import {
  buildSampleRequest,
  generateCodeSamples,
  NON_ASCII_HEADER_REFUSAL,
  REDIRECT_CREDENTIAL_DROPPED_NOTE,
  REDIRECT_NOT_FOLLOWED_NOTE,
  SAMPLE_LANGUAGES,
  UNSENDABLE_PLAN_REFUSAL,
} from '../../src/index';
import type { SampleRequest } from '../../src/index';
import { createPet, listPets, SERVER } from '../mocks/operations';

/** A GET that declares a body, which OpenAPI allows and no transport here will send. */
function getWithBody(): SampleRequest {
  return buildSampleRequest(
    { ...listPets(), body: [{ mediaType: 'application/json' }] },
    { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{"q":1}' } },
  );
}

/** A request whose header parameter carries a character outside US-ASCII. */
function nonAsciiHeader(): SampleRequest {
  return buildSampleRequest(
    {
      ...listPets(),
      parameters: [{ name: 'X-N', in: 'header', required: false, style: 'simple', explode: false }],
    },
    { values: { 'header:X-N': { kind: 'primitive', value: 'café' } }, serverUrl: SERVER },
  );
}

describe('a plan the runner itself cannot send', () => {
  it('should refuse every one of the fifteen, with the runner reason and not a client one', () => {
    // Given, the subject is present before its refusal means anything: the plan exists, carries the
    // body, and is the request `buildRequest` produced rather than one assembled here
    const request = getWithBody();
    expect(request.plan.method).toBe('GET');
    expect(request.plan.body).toBe('{"q":1}');

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(samples).toEqual([]);
    expect(omitted).toHaveLength(SAMPLE_LANGUAGES.length);
    for (const entry of omitted) {
      expect(entry.reason).toContain(UNSENDABLE_PLAN_REFUSAL);
      // And the transport's own sentence travels with it, so the reason names the actual refusal
      expect(entry.reason).toContain('GET/HEAD method cannot have body');
    }
  });

  it('should be the transport that refuses it, which is what makes the reason the runner own', async () => {
    // Given, the fact the refusal is written from, checked rather than quoted
    const { FetchHttpTransport } = await import('@openref/runner');
    const request = getWithBody();

    // When
    const sent = await new FetchHttpTransport()
      .send(request.plan)
      .then(() => null)
      .catch((cause: unknown) => cause);

    // Then, nothing left the process, and the transport wraps the platform's own words as the
    // cause rather than replacing them, which is where the refusal above reads its fact from
    expect(sent).toBeInstanceOf(Error);
    expect((sent as { readonly code?: string }).code).toBe('RUN_NOT_AVAILABLE');
    expect(String((sent as { readonly cause?: Error }).cause?.message)).toContain(
      'GET/HEAD method cannot have body',
    );
  });

  it('should still write every language for the same operation once the body is gone', () => {
    // Given, the control: without the body this is an ordinary GET
    const request = buildSampleRequest(listPets(), { values: {}, serverUrl: SERVER });

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(omitted).toEqual([]);
    expect(samples).toHaveLength(SAMPLE_LANGUAGES.length);
  });
});

describe('a method the transport does not support', () => {
  it.each([['trace'], ['track'], ['connect']])(
    'should refuse %s for every language, which enumerating body shapes did not',
    (method) => {
      // Given, `trace` is an OpenAPI Path Item field, so this is reachable from a plain document
      const request = buildSampleRequest(
        { ...listPets(), method },
        {
          values: {},
          serverUrl: SERVER,
        },
      );
      expect(request.plan.body).toBeNull();

      // When
      const { samples, omitted } = generateCodeSamples(request);

      // Then, the first edition of the guard knew one shape, a body on GET, and let this past
      expect(samples).toEqual([]);
      expect(omitted).toHaveLength(SAMPLE_LANGUAGES.length);
      for (const entry of omitted) {
        expect(entry.reason).toContain(UNSENDABLE_PLAN_REFUSAL);
        expect(entry.reason).toContain('HTTP method is unsupported');
      }
    },
  );

  it('should judge the method and the body, and never the address', () => {
    // Given, a document declaring no server takes the OpenAPI default of `/`, so its plans carry a
    // relative url. `new Request('/ping')` throws, and reading that as "the runner cannot send
    // this" refused every sample of every such document, which is how this was found.
    const request = buildSampleRequest(
      { ...listPets(), servers: ['/'] },
      { values: {}, serverUrl: '/' },
    );
    expect(request.plan.url.startsWith('http')).toBe(false);

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(omitted).toEqual([]);
    expect(samples).toHaveLength(SAMPLE_LANGUAGES.length);
  });

  it('should let through a method the transport does support but has never heard of', () => {
    // Given, the control that keeps this about the transport rather than about a list of methods:
    // PROPFIND and QUERY are not in any enumeration here and `new Request` accepts both
    for (const method of ['propfind', 'query']) {
      const request = buildSampleRequest(
        { ...listPets(), method },
        {
          values: {},
          serverUrl: SERVER,
        },
      );

      // Then
      const { samples, omitted } = generateCodeSamples(request);
      expect(omitted, `${method} was refused`).toEqual([]);
      expect(samples).toHaveLength(SAMPLE_LANGUAGES.length);
    }
  });
});

describe('a header value outside US-ASCII', () => {
  it('should be written only by the two clients measured to send the runner octets', () => {
    // Given
    const request = nonAsciiHeader();
    expect(request.plan.headers['X-N']).toBe('café');

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(samples.map((sample) => sample.lang)).toEqual(['typescript', 'swift']);
    expect(omitted).toHaveLength(SAMPLE_LANGUAGES.length - 2);
    for (const entry of omitted) expect(entry.reason).toBe(NON_ASCII_HEADER_REFUSAL);
  });

  it('should look at the value and never at the name, since a name cannot carry one', () => {
    // Given, the control: an ASCII value on the same operation is written by all fifteen
    const request = buildSampleRequest(
      {
        ...listPets(),
        parameters: [
          { name: 'X-N', in: 'header', required: false, style: 'simple', explode: false },
        ],
      },
      { values: { 'header:X-N': { kind: 'primitive', value: 'cafe' } }, serverUrl: SERVER },
    );

    // When
    const { samples, omitted } = generateCodeSamples(request);

    // Then
    expect(omitted).toEqual([]);
    expect(samples).toHaveLength(SAMPLE_LANGUAGES.length);
  });

  it('should carry the character into the two samples it does write, unescaped', () => {
    // Given, When
    const { samples } = generateCodeSamples(nonAsciiHeader());
    const byLang = new Map(samples.map((sample) => [sample.lang, sample.source]));

    // Then, the literal escapers leave a printable non ASCII character alone by design
    expect(byLang.get('typescript')).toContain('"X-N": "café"');
    expect(byLang.get('swift')).toContain('request.setValue("café", forHTTPHeaderField: "X-N")');
  });
});

describe('the redirect note', () => {
  it('should name each client whose redirect behaviour differs from the console, and no other', () => {
    // Given
    const request = buildSampleRequest(
      createPet(),
      { values: {}, serverUrl: SERVER, body: { kind: 'text', text: '{}' } },
      { apiKey: '<apiKey>' },
    );

    // When
    const { samples, notes } = generateCodeSamples(request);

    // Then, wget follows and re-sends the credential as the console does, so it has no note
    expect(notes.map((note) => note.lang)).toEqual(['shell', 'bash', 'powershell', 'swift']);
    expect(notes.map((note) => note.label)).toEqual(['cURL', 'HTTPie', 'PowerShell', 'Swift']);
    expect(notes.find((note) => note.lang === 'shell')?.note).toBe(REDIRECT_NOT_FOLLOWED_NOTE);
    expect(notes.find((note) => note.lang === 'swift')?.note).toBe(
      REDIRECT_CREDENTIAL_DROPPED_NOTE,
    );

    // And a note is never attached to a language that produced no sample to put it beside
    const written = new Set(samples.map((sample) => sample.lang));
    for (const note of notes) expect(written.has(note.lang)).toBe(true);
  });

  it('should attach no note to a language whose sample was refused', () => {
    // Given, a plan nothing writes, so there is no tab for a note to sit beside
    const { samples, notes } = generateCodeSamples(getWithBody());

    // Then
    expect(samples).toEqual([]);
    expect(notes).toEqual([]);
  });
});

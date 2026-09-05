import { describe, expect, it } from 'vitest';
import { buildSampleRequest, generateCodeSamples, SAMPLE_LANGUAGES } from '../../src/index';
import { listPets, SERVER } from '../mocks/operations';

/**
 * A sample whose document named no origin, per SPEC 18.
 *
 * THE COPY CONTROL HANDS A READER A COMMAND, AND UNTIL `TX-INSTRUMENT` IT COULD NOT RUN. The
 * OpenAPI default server is `/`, meaning "wherever this is served from", so a document that
 * declares no `servers` produces plans carrying a path and no host. The console sends those,
 * because a browser resolves them against the page; `curl -X GET '/api/v1/health'` answers
 * `curl: (3) URL rejected: No host part in the URL` and exits 3. Measured on a real document of
 * fifty eight operations, every one of which offered a command that fails.
 *
 * WHAT IS HELD HERE IS THAT NO ORIGIN IS INVENTED. The sample names the value it does not have,
 * the shell reads it from a variable, and the absolute case is byte for byte what it always was.
 */

/** The samples of one request, keyed by language. */
function sourcesOf(request: Parameters<typeof generateCodeSamples>[0]): Map<string, string> {
  const { samples } = generateCodeSamples(request, SAMPLE_LANGUAGES);

  return new Map(samples.map((sample) => [sample.lang, sample.source]));
}

/** The request an operation of a document that declares no server produces. */
function relativeRequest(): ReturnType<typeof buildSampleRequest> {
  return buildSampleRequest(listPets('/'), { values: {}, serverUrl: '/' });
}

describe('a plan whose address has no origin', () => {
  it('should be the shape a document declaring no servers actually produces', () => {
    // Given, the subject is present before anything is said about it
    const request = relativeRequest();

    // Then
    expect(request.plan.url).toBe('/pets');
    expect(URL.canParse(request.plan.url)).toBe(false);
  });

  it('should give cURL a command that runs once the origin is supplied', () => {
    // Given
    const request = relativeRequest();

    // When
    const curl = sourcesOf(request).get('shell') ?? '';

    // Then the address is the variable and the path, and the path stays single quoted, so
    // nothing in it is ever exposed to shell expansion
    expect(curl).toContain(
      `curl -X GET "\${OPENREF_ORIGIN:?set this to the origin the API is served from}"'/pets'`,
    );
    expect(curl).not.toContain(`curl -X GET '/pets'`);
  });

  it('should say why in the sample itself, so the reason survives the copy', () => {
    // Given, a note drawn beside the tab is not what the copy control copies
    const request = relativeRequest();

    // When
    const sources = sourcesOf(request);

    // Then every language says it in its own comment syntax, and the three shells name the
    // variable their command already reads
    expect(sources.get('shell')?.startsWith('# this document declares no server')).toBe(true);
    expect(sources.get('shell')).toContain('OPENREF_ORIGIN supplies it');
    expect(sources.get('typescript')?.startsWith('// this document declares no server')).toBe(true);
    expect(sources.get('python')?.startsWith('# this document declares no server')).toBe(true);

    for (const source of sources.values()) {
      expect(source).toContain('this document declares no server');
    }
  });

  it('should give wget and HTTPie the same address as cURL', () => {
    // Given, three shell clients answering one question three ways is the defect one helper
    // exists to prevent
    const request = relativeRequest();

    // When
    const sources = sourcesOf(request);

    // Then
    for (const lang of ['shell', 'bash', 'sh']) {
      expect(sources.get(lang)).toContain(
        `"\${OPENREF_ORIGIN:?set this to the origin the API is served from}"'/pets'`,
      );
    }
  });
});

describe('a plan whose address has an origin', () => {
  it('should be exactly what it was, with no comment and no variable', () => {
    // Given a document that declares a server, which is every document that says where it lives
    const request = buildSampleRequest(listPets(), { values: {}, serverUrl: SERVER });

    // When
    const sources = sourcesOf(request);

    // Then nothing about the ordinary case moves, which is what the wire equality suites pin
    expect(sources.get('shell')).toBe(`curl -X GET 'https://api.example.com/v1/pets'`);
    for (const source of sources.values()) {
      expect(source).not.toContain('OPENREF_ORIGIN');
      expect(source).not.toContain('declares no server');
    }
  });
});

/**
 * A sample regenerated after a specification change reflects it, which is the second test T057
 * names.
 *
 * IT STARTS AT THE DOCUMENT AND NOT AT A HAND BUILT PROJECTION. The chain under test is
 * `normalizeOpenApiDocument`, then `runnerOperationOf`, then `buildRequest`, then the emitters, and
 * a case that began halfway along would prove that this package answers a projection it wrote
 * itself. Four edits are made to one document, one per thing a sample can carry: the server, a
 * parameter's serialization, the security scheme and the request body.
 *
 * EVERY CASE ASSERTS THE UNCHANGED DOCUMENT FIRST. "The sample changed" means nothing unless the
 * sample was stable to begin with, so each case regenerates from the same document and pins the
 * bytes before editing anything.
 */

import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import type { IRDocument, IROperation } from '@openref/core';
import { runnerOperationOf } from '@openref/vue';
import { buildSampleRequest, generateCodeSamples, placeholderCredentials } from '../../src/index';
import type { SampleLanguageId } from '../../src/index';

/** One version of the specification, as a plain object the normalizer reads. */
interface Edits {
  readonly server?: string;
  readonly style?: string;
  readonly explode?: boolean;
  readonly scheme?: Readonly<Record<string, unknown>>;
  readonly body?: Readonly<Record<string, unknown>>;
}

/**
 * The document under test, in the version the edits describe.
 *
 * @param edits - What this version changes about the base document
 * @returns The specification, ready to normalize
 */
function specification(edits: Edits = {}): Record<string, unknown> {
  const scheme = edits.scheme ?? { type: 'apiKey', in: 'header', name: 'X-Api-Key' };

  return {
    openapi: '3.1.0',
    info: { title: 'Pets', version: '1.0.0' },
    servers: [{ url: edits.server ?? 'https://api.example.com/v1' }],
    components: { securitySchemes: { auth: scheme } },
    security: [{ auth: [] }],
    paths: {
      '/pets': {
        post: {
          operationId: 'listPets',
          parameters: [
            {
              name: 'tags',
              in: 'query',
              style: edits.style ?? 'form',
              explode: edits.explode ?? false,
              schema: { type: 'array', items: { type: 'string' } },
            },
          ],
          ...(edits.body === undefined ? {} : { requestBody: edits.body }),
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

/** The first operation of a document, which this specification has exactly one of. */
function onlyOperation(document: IRDocument): IROperation {
  const operation = [...document.nodes.values()].find((node) => node.kind === 'operation');
  expect(operation).toBeDefined();

  return operation!;
}

/** The samples for one version of the specification, keyed by language. */
function samplesFor(edits: Edits = {}, text?: string): Map<SampleLanguageId, string> {
  const document = normalizeOpenApiDocument(specification(edits));
  const operation = onlyOperation(document);
  const run = runnerOperationOf(operation, document);
  const { values } = placeholderCredentials(run.security);

  const request = buildSampleRequest(
    run,
    {
      values: { 'query:tags': { kind: 'array', value: ['cat', 'dog'] } },
      serverUrl: run.servers[0] ?? '',
      ...(text === undefined ? {} : { body: { kind: 'text' as const, text } }),
    },
    values,
  );

  return new Map(
    generateCodeSamples(request).samples.map((sample) => [
      sample.lang as SampleLanguageId,
      sample.source,
    ]),
  );
}

describe('a sample regenerated after a specification change', () => {
  it('should be the same bytes when the specification did not change', () => {
    // Given, When
    const first = samplesFor();
    const second = samplesFor();

    // Then
    expect([...second]).toEqual([...first]);
    expect(first.size).toBe(9);
  });

  it('should follow the server url into every language', () => {
    // Given
    const before = samplesFor();
    expect(before.get('shell')).toContain('https://api.example.com/v1/pets');

    // When
    const after = samplesFor({ server: 'https://api.example.com/v2' });

    // Then
    for (const [lang, source] of after) {
      expect(source, lang).toContain('https://api.example.com/v2/pets');
      expect(source, lang).not.toContain('/v1/pets');
    }
  });

  it('should follow a parameter that changes its serialization style', () => {
    // Given, the document's own default spelling
    const before = samplesFor();
    expect(before.get('shell')).toContain('?tags=cat,dog');

    // When
    const after = samplesFor({ style: 'pipeDelimited' });

    // Then
    expect(after.get('shell')).toContain('?tags=cat|dog');
    expect(after.get('shell')).not.toContain('?tags=cat,dog');
  });

  it('should follow a security scheme that changes where the credential travels', () => {
    // Given
    const before = samplesFor();
    expect(before.get('shell')).toContain(`-H 'X-Api-Key: <auth>'`);

    // When
    const after = samplesFor({ scheme: { type: 'http', scheme: 'bearer' } });

    // Then
    expect(after.get('shell')).toContain(`-H 'Authorization: Bearer <auth>'`);
    expect(after.get('shell')).not.toContain('X-Api-Key');
  });

  it('should follow an operation that gains a request body', () => {
    // Given
    const before = samplesFor();
    expect(before.get('shell')).not.toContain('--data-raw');

    // When
    const after = samplesFor(
      { body: { content: { 'application/json': { schema: { type: 'object' } } } } },
      '{"name":"Fido"}',
    );

    // Then
    expect(after.get('shell')).toContain(`--data-raw '{"name":"Fido"}'`);
    expect(after.get('shell')).toContain(`-H 'Content-Type: application/json'`);
    expect(after.get('typescript')).toContain('body: "{\\"name\\":\\"Fido\\"}"');
  });
});

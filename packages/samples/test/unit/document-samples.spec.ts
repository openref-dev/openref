import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import type { IRCodeSample, IRCodeSampleLanguage, IRDocument, IROperation } from '@openref/core';
import { runnerOperationOf } from '@openref/vue';
import { OFF_PAGE_SAMPLE_LANGUAGES, SAMPLE_LANGUAGES, withGeneratedSamples } from '../../src/index';

/**
 * The transform `TX-PAGE-SAMPLES` adds, which is what finally puts SPEC 18's generator on a page.
 *
 * IT STARTS AT A SPECIFICATION AND ENDS AT `IROperation.codeSamples`, because that field is the
 * whole of the wiring: `drawnOf` mounts the samples section whenever it is not empty and
 * `CodeSample` draws the tab strip from it. A case that began at a hand built projection would
 * prove that this package answers an input it wrote itself, which is the objection
 * `regenerated-sample.spec.ts` states about its own chain.
 *
 * THE PROJECTION IS THE REAL ONE. `runnerOperationOf` is a devDependency of this package for the
 * reason `tools/dependency-rules.cjs` states beside the `samples` boundary, and it is the function
 * the two hosts pass in, so passing anything else here would test a contract nobody uses.
 */

/** What one version of the specification changes about the fixture. */
interface Edits {
  /** Samples the document writes by hand, which are level 3 and outrank the generator. */
  readonly declared?: readonly Readonly<Record<string, string>>[];
  /** Replaces the servers list, so the no server case is expressible. */
  readonly servers?: readonly Readonly<Record<string, string>>[];
}

/**
 * The document under test: a POST with a path parameter carrying a declared example, an exploded
 * query array whose only example is the one its schema generates, a bearer scheme and a JSON body.
 */
function specification(edits: Edits = {}): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    servers: edits.servers ?? [{ url: 'https://api.example.com/v1' }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
      schemas: {
        Item: {
          type: 'object',
          required: ['sku'],
          properties: { sku: { type: 'string' }, quantity: { type: 'integer' } },
        },
      },
    },
    security: [{ bearer: [] }],
    paths: {
      '/orders/{orderId}/items': {
        post: {
          operationId: 'addItem',
          ...(edits.declared === undefined ? {} : { 'x-codeSamples': edits.declared }),
          parameters: [
            {
              name: 'orderId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              example: 'ord_42',
            },
            {
              name: 'expand',
              in: 'query',
              style: 'form',
              explode: false,
              schema: { type: 'array', items: { type: 'string' } },
            },
          ],
          requestBody: {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
          },
          responses: { '200': { description: 'ok' } },
        },
      },
    },
  };
}

/** The document, normalized and not yet given any generated sample. */
function document(edits: Edits = {}): IRDocument {
  return normalizeOpenApiDocument(specification(edits));
}

/** The one operation of the fixture, from whichever version of the document is passed. */
function onlyOperation(from: IRDocument): IROperation {
  const node = [...from.nodes.values()].find((entry) => entry.kind === 'operation');
  expect(node).toBeDefined();

  return node!;
}

/** The samples one version of the document ends up carrying. */
function samplesOf(edits: Edits = {}): readonly IRCodeSample[] {
  return onlyOperation(withGeneratedSamples(document(edits), runnerOperationOf)).codeSamples ?? [];
}

/** The languages one version of the document names without drawing. */
function elsewhereOf(edits: Edits = {}): readonly IRCodeSampleLanguage[] {
  return (
    onlyOperation(withGeneratedSamples(document(edits), runnerOperationOf)).codeSamplesElsewhere ??
    []
  );
}

/** One sample by language, so a case can name the tab it is about. */
function sample(samples: readonly IRCodeSample[], lang: string): IRCodeSample | undefined {
  return samples.find((entry) => entry.lang === lang);
}

describe('withGeneratedSamples, what it puts on an operation', () => {
  it('should draw the twelve of SPEC 18 and name the three it holds back', () => {
    // Given, When
    const samples = samplesOf();

    // Then: twelve tabs, in the order SPEC 18 lists them with the three taken out, and the three
    // named beside them rather than dropped.
    expect(samples).toHaveLength(12);
    expect(samples.map((entry) => entry.lang)).toEqual([
      'shell',
      'bash',
      'sh',
      'powershell',
      'typescript',
      'python',
      'go',
      'csharp',
      'rust',
      'swift',
      'kotlin',
      'dart',
    ]);
    expect(elsewhereOf()).toEqual([
      { lang: 'php', label: 'PHP' },
      { lang: 'java', label: 'Java' },
      { lang: 'ruby', label: 'Ruby' },
    ]);
  });

  it('should draw and name a partition of the fifteen, never a language twice and never none', () => {
    // Given, When
    const drawn = samplesOf().map((entry) => entry.lang);
    const named = elsewhereOf().map((entry) => entry.lang);

    // Then: the two lists together are the fifteen, with no overlap. This is the property the
    // page's sentence rests on, and it is asserted rather than read off the two lists above.
    expect([...drawn, ...named].sort()).toEqual(SAMPLE_LANGUAGES.map((it) => it.id).sort());
    expect(drawn.filter((lang) => named.includes(lang))).toEqual([]);
  });

  it('should name nothing at all when the caller asks for every language on the page', () => {
    // Given a caller that wants all fifteen drawn, which is the lever SPEC 18 names
    const all = withGeneratedSamples(document(), runnerOperationOf, SAMPLE_LANGUAGES);

    // When
    const operation = onlyOperation(all);

    // Then: fifteen tabs and no sentence, because there is nothing the page is holding back.
    expect(operation.codeSamples).toHaveLength(15);
    expect(operation.codeSamplesElsewhere).toBeUndefined();
  });

  it('should name no language whose emitter refused this request', () => {
    // Given a request only two languages may write: a header value outside US-ASCII, which SPEC 18
    // refuses everywhere except the two clients measured putting the runner's own octets on the
    // wire. All three held back languages are among the thirteen that refuse.
    const refusing = specification();
    const post = (refusing.paths as Record<string, Record<string, Record<string, unknown>>>)[
      '/orders/{orderId}/items'
    ]?.['post'];
    expect(post).toBeDefined();
    (post!['parameters'] as Record<string, unknown>[]).push({
      name: 'X-Note',
      in: 'header',
      schema: { type: 'string' },
      example: 'caf\u00e9',
    });

    // When
    const result = withGeneratedSamples(normalizeOpenApiDocument(refusing), runnerOperationOf);
    const operation = onlyOperation(result);

    // Then: two tabs, and nothing named, because for this request the three produce nothing and a
    // page telling a reader to go and ask for a Ruby sample would be sending them after a refusal.
    expect(operation.codeSamples?.map((entry) => entry.lang)).toEqual(['typescript', 'swift']);
    expect(operation.codeSamplesElsewhere).toBeUndefined();
    expect(OFF_PAGE_SAMPLE_LANGUAGES.map((it) => it.id)).toEqual(['php', 'java', 'ruby']);
  });

  it('should write the sample from the values the console would send, not from invention', () => {
    // Given, When
    const shell = sample(samplesOf(), 'shell')?.source ?? '';

    // Then: the path parameter's declared example, the schema's generated body, and the query
    // parameter serialized through the style the document declared for it.
    expect(shell).toContain('https://api.example.com/v1/orders/ord_42/items');
    expect(shell).toContain('?expand=string,string-2');
    expect(shell).toContain('"sku": "string"');
    expect(shell).toContain(`-H 'Content-Type: application/json'`);
  });

  it('should carry a placeholder credential and never anything that could be a real one', () => {
    // Given, When
    const shell = sample(samplesOf(), 'shell')?.source ?? '';

    // Then: SPEC 19.7. A rendered reference is cached, served and statically built.
    expect(shell).toContain(`-H 'Authorization: Bearer <bearer>'`);
  });

  it('should leave a channel document untouched, and the same object, because it has no operation', () => {
    // Given an events document, whose nodes are channels and never operations
    const events = normalizeOpenApiDocument(specification());
    const empty: IRDocument = { ...events, nodes: new Map() };

    // When
    const result = withGeneratedSamples(empty, runnerOperationOf);

    // Then: no rehash, no re-freeze, the document itself back.
    expect(result).toBe(empty);
  });
});

describe('withGeneratedSamples, against what the document already wrote', () => {
  it('should put the document own sample first, per SPEC 18 priority', () => {
    // Given
    const declared = [{ lang: 'shell', label: 'Ours', source: 'curl -sS https://ours.example' }];

    // When
    const samples = samplesOf({ declared });

    // Then
    expect(samples[0]).toEqual({
      lang: 'shell',
      label: 'Ours',
      source: 'curl -sS https://ours.example',
    });
  });

  it('should write no second sample for a language the document already spoke', () => {
    // Given
    const declared = [{ lang: 'shell', label: 'Ours', source: 'curl -sS https://ours.example' }];

    // When
    const samples = samplesOf({ declared });

    // Then: twelve languages, one of them the document's, and never two tabs named `shell`.
    expect(samples).toHaveLength(12);
    expect(samples.filter((entry) => entry.lang === 'shell')).toHaveLength(1);
    expect(sample(samples, 'typescript')?.source).toContain('https://api.example.com/v1');
  });

  it('should keep a hand written sample in a language the generator does not write', () => {
    // Given
    const declared = [{ lang: 'elixir', label: 'Elixir', source: 'HTTPoison.post!(url, body)' }];

    // When
    const samples = samplesOf({ declared });

    // Then
    expect(samples).toHaveLength(13);
    expect(samples[0]?.lang).toBe('elixir');
  });

  it('should not name a held back language the document wrote itself', () => {
    // Given a document that writes its own Ruby, which is level 3 and outranks the generator
    const declared = [{ lang: 'ruby', label: 'Ruby', source: 'Net::HTTP.post(uri, body)' }];

    // When
    const samples = samplesOf({ declared });

    // Then: the Ruby tab is on the page, so the page does not say Ruby is missing from it. The
    // other two are still named.
    expect(sample(samples, 'ruby')?.source).toBe('Net::HTTP.post(uri, body)');
    expect(elsewhereOf({ declared }).map((entry) => entry.lang)).toEqual(['php', 'java']);
  });
});

describe('withGeneratedSamples, an operation with nowhere to send', () => {
  it('should write no sample rather than one against an invented origin', () => {
    // Given a document with no server at all, which the OpenAPI default rules out but a merged
    // document and a hand built one do not.
    const declared = document();
    const nowhere: IRDocument = { ...declared, servers: [] };

    // When
    const result = withGeneratedSamples(nowhere, runnerOperationOf);

    // Then
    expect(onlyOperation(result).codeSamples).toBeUndefined();
    expect(result).toBe(nowhere);
  });

  it('should still keep the samples the document wrote by hand', () => {
    // Given
    const declared = document({
      declared: [{ lang: 'shell', label: 'Ours', source: 'curl -sS https://ours.example' }],
    });
    const nowhere: IRDocument = { ...declared, servers: [] };

    // When
    const result = withGeneratedSamples(nowhere, runnerOperationOf);

    // Then: the operation is one nobody generated for, not one whose samples were taken away.
    expect(onlyOperation(result).codeSamples).toHaveLength(1);
  });
});

describe('withGeneratedSamples, determinism', () => {
  it('should produce byte identical samples on a hundred repeats of the same document', () => {
    // Given
    const first = samplesOf();
    const serialized = JSON.stringify(first);

    // When
    const repeats: string[] = [];
    for (let run = 0; run < 100; run += 1) repeats.push(JSON.stringify(samplesOf()));

    // Then
    expect(new Set(repeats).size).toBe(1);
    expect(repeats[0]).toBe(serialized);
  });

  it('should retake the document hash, because the page cache is keyed by it', () => {
    // Given
    const before = document();

    // When
    const after = withGeneratedSamples(before, runnerOperationOf);

    // Then: the content moved, so the claim about the content moves with it, per
    // `ReferenceService.augment`. And the same document twice gives the same claim.
    expect(after.hash).not.toBe(before.hash);
    expect(withGeneratedSamples(document(), runnerOperationOf).hash).toBe(after.hash);
  });

  it('should hand back the very same document when it is applied twice', () => {
    // Given a document that has already been through it
    const once = withGeneratedSamples(document(), runnerOperationOf);

    // When
    const twice = withGeneratedSamples(once, runnerOperationOf);

    // Then: every language is already spoken, so nothing is added and nothing is rehashed. That
    // is what lets the served host and the static build both call it without either having to
    // know whether the other ran first.
    expect(twice).toBe(once);
  });

  it('should leave the document it was given alone, because it is a transform and not a write', () => {
    // Given
    const before = document();

    // When
    withGeneratedSamples(before, runnerOperationOf);

    // Then
    expect(onlyOperation(before).codeSamples).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import type { IRCodeSample, IRDocument, IROperation } from '@openref/core';
import { runnerOperationOf } from '@openref/vue';
import { withGeneratedSamples } from '../../src/index';

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

/** One sample by language, so a case can name the tab it is about. */
function sample(samples: readonly IRCodeSample[], lang: string): IRCodeSample | undefined {
  return samples.find((entry) => entry.lang === lang);
}

describe('withGeneratedSamples, what it puts on an operation', () => {
  it('should give every language of SPEC 18 a sample when the document wrote none', () => {
    // Given, When
    const samples = samplesOf();

    // Then
    expect(samples).toHaveLength(15);
    expect(samples.map((entry) => entry.lang)).toEqual([
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
    ]);
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

    // Then: fifteen languages, one of them the document's, and never two tabs named `shell`.
    expect(samples).toHaveLength(15);
    expect(samples.filter((entry) => entry.lang === 'shell')).toHaveLength(1);
    expect(sample(samples, 'typescript')?.source).toContain('https://api.example.com/v1');
  });

  it('should keep a hand written sample in a language the generator does not write', () => {
    // Given
    const declared = [{ lang: 'elixir', label: 'Elixir', source: 'HTTPoison.post!(url, body)' }];

    // When
    const samples = samplesOf({ declared });

    // Then
    expect(samples).toHaveLength(16);
    expect(samples[0]?.lang).toBe('elixir');
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

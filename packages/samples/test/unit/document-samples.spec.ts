import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import type {
  IRCodeSample,
  IRCodeSampleLanguage,
  IRCodeSampleNote,
  IRCodeSampleRefusal,
  IRDocument,
  IROperation,
} from '@openref/core';
import { runnerOperationOf } from '@openref/vue';
import {
  NO_SERVER_REFUSAL,
  OFF_PAGE_SAMPLE_LANGUAGES,
  PAGE_SAMPLE_LANGUAGES,
  REDIRECT_CREDENTIAL_DROPPED_NOTE,
  REDIRECT_NOT_FOLLOWED_NOTE,
  SAMPLE_LANGUAGES,
  SHARED_TAB_NOTE,
  UNBUILDABLE_REQUEST_REFUSAL,
  UNREACHABLE_TAB_NOTE,
  unsendableCredentialNote,
  withGeneratedSamples,
} from '../../src/index';

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

/** The refusals one version of the document ends up carrying, grouped as the page states them. */
function refusedOf(edits: Edits = {}): readonly IRCodeSampleRefusal[] {
  return (
    onlyOperation(withGeneratedSamples(document(edits), runnerOperationOf)).codeSamplesRefused ?? []
  );
}

/** The notes one version of the document ends up carrying, grouped as the page states them. */
function notedOf(edits: Edits = {}): readonly IRCodeSampleNote[] {
  return (
    onlyOperation(withGeneratedSamples(document(edits), runnerOperationOf)).codeSamplesNotes ?? []
  );
}

/** One sample by language, so a case can name the tab it is about. */
function sample(samples: readonly IRCodeSample[], lang: string): IRCodeSample | undefined {
  return samples.find((entry) => entry.lang === lang);
}

/**
 * The specification with a required cookie parameter, which the runner will not build a request
 * from at all.
 *
 * AN ORDINARY OPENAPI DOCUMENT AND NOTHING FEDERATED. `trace`, a body on `GET` and a cookie
 * parameter are all things a written document may declare, and `buildRequest` throws a
 * `SerializationError` on the third by name: `Cookie` is a forbidden header and a browser will not
 * let a script set it.
 */
function cookieParameterSpecification(): Record<string, unknown> {
  const refusing = specification();
  const paths = refusing.paths as Record<string, Record<string, Record<string, unknown>>>;
  const post = paths['/orders/{orderId}/items']?.post;
  expect(post).toBeDefined();
  (post!.parameters as Record<string, unknown>[]).push({
    name: 'session',
    in: 'cookie',
    required: true,
    schema: { type: 'string' },
    example: 'abc',
  });

  return refusing;
}

/** The specification with a header parameter whose example carries a character outside US-ASCII. */
function nonAsciiHeaderSpecification(): Record<string, unknown> {
  const refusing = specification();
  const paths = refusing.paths as Record<string, Record<string, Record<string, unknown>>>;
  const post = paths['/orders/{orderId}/items']?.post;
  expect(post).toBeDefined();
  (post!.parameters as Record<string, unknown>[]).push({
    name: 'X-Note',
    in: 'header',
    schema: { type: 'string' },
    example: 'caf\u00e9',
  });

  return refusing;
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
    const refusing = nonAsciiHeaderSpecification();

    // When
    const result = withGeneratedSamples(normalizeOpenApiDocument(refusing), runnerOperationOf);
    const operation = onlyOperation(result);

    // Then: two tabs, and nothing named, because for this request the three produce nothing and a
    // page telling a reader to go and ask for a Ruby sample would be sending them after a refusal.
    expect(operation.codeSamples?.map((entry) => entry.lang)).toEqual(['typescript', 'swift']);
    expect(operation.codeSamplesElsewhere).toBeUndefined();
    expect(OFF_PAGE_SAMPLE_LANGUAGES.map((it) => it.id)).toEqual(['php', 'java', 'ruby']);
  });

  it('should state the refusal of every language that could not write this request', () => {
    // Given the same request, whose thirteen refusals used to reach the caller as
    // `GeneratedSamples.omitted` and nobody else. A vanished tab and a language the page never had
    // are indistinguishable, and telling them apart is what SPEC 18's standing rule asks for.
    const refusing = nonAsciiHeaderSpecification();

    // When
    const result = withGeneratedSamples(normalizeOpenApiDocument(refusing), runnerOperationOf);
    const operation = onlyOperation(result);

    // Then: the subject first, two tabs and thirteen languages with nothing to show
    expect(operation.codeSamples?.map((entry) => entry.lang)).toEqual(['typescript', 'swift']);

    // And one group, because all thirteen refused for one reason, in the order the page would have
    // met them: the set it draws first, then the set it names.
    expect(operation.codeSamplesRefused).toHaveLength(1);
    expect(operation.codeSamplesRefused?.[0]?.languages.map((entry) => entry.lang)).toEqual([
      'shell',
      'bash',
      'sh',
      'powershell',
      'python',
      'go',
      'csharp',
      'rust',
      'kotlin',
      'dart',
      'php',
      'java',
      'ruby',
    ]);
    expect(operation.codeSamplesRefused?.[0]?.reason).toContain('outside US-ASCII');
  });

  it('should account for all fifteen between what it draws, names and refuses', () => {
    // Given the same request, where the three answers are all non empty at once
    const refusing = nonAsciiHeaderSpecification();
    const drawnAll = withGeneratedSamples(
      normalizeOpenApiDocument(refusing),
      runnerOperationOf,
      SAMPLE_LANGUAGES.filter((language) => language.id !== 'swift'),
    );
    const operation = onlyOperation(drawnAll);

    // When
    const drawn = (operation.codeSamples ?? []).map((entry) => entry.lang);
    const named = (operation.codeSamplesElsewhere ?? []).map((entry) => entry.lang);
    const refused = (operation.codeSamplesRefused ?? []).flatMap((group) =>
      group.languages.map((entry) => entry.lang),
    );

    // Then: every one of the fifteen is in exactly one of the three, which is what lets a reader
    // read the page's silence about a language as a statement rather than as an omission.
    expect(named).toEqual(['swift']);
    expect(drawn).toEqual(['typescript']);
    expect([...drawn, ...named, ...refused].sort()).toEqual(
      SAMPLE_LANGUAGES.map((language) => language.id).sort(),
    );
  });

  it('should refuse nothing for a request every language can write', () => {
    // Given, When: the ordinary page, where the whole of the answer is twelve tabs and three names
    // Then, a proof of absence that first asserts the subject was present
    expect(samplesOf()).toHaveLength(12);
    expect(elsewhereOf()).toHaveLength(3);
    expect(refusedOf()).toEqual([]);
  });

  it('should say nothing about a refusal in a language the document wrote itself', () => {
    // Given a document that writes its own Ruby for a request no language may write, which is
    // level 3 and outranks the generator
    const refusing = nonAsciiHeaderSpecification();
    const paths = refusing.paths as Record<string, Record<string, Record<string, unknown>>>;
    const post = paths['/orders/{orderId}/items']?.post;
    post!['x-codeSamples'] = [{ lang: 'ruby', label: 'Ruby', source: 'Net::HTTP.post(uri, body)' }];

    // When
    const result = withGeneratedSamples(normalizeOpenApiDocument(refusing), runnerOperationOf);
    const operation = onlyOperation(result);

    // Then: the Ruby tab is on the page, so the page does not say Ruby refused it
    expect(operation.codeSamples?.map((entry) => entry.lang)).toContain('ruby');
    const refused = (operation.codeSamplesRefused ?? []).flatMap((group) =>
      group.languages.map((entry) => entry.lang),
    );
    expect(refused).not.toContain('ruby');
    expect(refused).toContain('shell');
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

describe('withGeneratedSamples, an operation the runner will not build a request for', () => {
  it('should name all fifteen as refused rather than hand back an operation nobody decided about', () => {
    // Given an ordinary OpenAPI document, written by hand, with one required cookie parameter.
    // `buildRequest` refuses it by name, and until this the whole refusal was swallowed: no sample,
    // no name, no reason, and a page with no samples section at all.
    const refusing = cookieParameterSpecification();

    // When
    const result = withGeneratedSamples(normalizeOpenApiDocument(refusing), runnerOperationOf);
    const operation = onlyOperation(result);

    // Then, the subject first: nothing was drawn and nothing was held back, which is exactly the
    // state in which the third answer has to speak or nobody does.
    expect(operation.codeSamples).toBeUndefined();
    expect(operation.codeSamplesElsewhere).toBeUndefined();

    // And every one of the fifteen is accounted for, under the one reason they all share, carrying
    // the runner's own sentence rather than a phrase invented here.
    expect(operation.codeSamplesRefused).toHaveLength(1);
    const refused = operation.codeSamplesRefused?.[0]?.languages.map((entry) => entry.lang) ?? [];
    expect(refused).toEqual(
      [...PAGE_SAMPLE_LANGUAGES, ...OFF_PAGE_SAMPLE_LANGUAGES].map((language) => language.id),
    );
    expect([...refused].sort()).toEqual(SAMPLE_LANGUAGES.map((language) => language.id).sort());
    expect(operation.codeSamplesRefused?.[0]?.reason).toContain(UNBUILDABLE_REQUEST_REFUSAL);
    expect(operation.codeSamplesRefused?.[0]?.reason).toContain('cookie parameter');
  });

  it('should write no sample rather than one against an invented origin', () => {
    // Given a document with no server at all, which the OpenAPI default rules out but a merged
    // document and a hand built one do not.
    const declared = document();
    const nowhere: IRDocument = { ...declared, servers: [] };

    // When
    const result = withGeneratedSamples(nowhere, runnerOperationOf);

    // Then, no sample, because there is nowhere to send. WHAT THIS CASE ASSERTED BEFORE, AND WHY
    // IT WAS WRONG: it asserted `result` was the very same object, that is, that the transform had
    // said nothing at all about the operation. That is the silence SPEC 18's standing rule forbids,
    // pinned as correct. The refusal now reaches the page like every other one.
    expect(onlyOperation(result).codeSamples).toBeUndefined();
    expect(onlyOperation(result).codeSamplesRefused).toHaveLength(1);
    expect(onlyOperation(result).codeSamplesRefused?.[0]?.languages).toHaveLength(15);
    expect(onlyOperation(result).codeSamplesRefused?.[0]?.reason).toBe(NO_SERVER_REFUSAL);
    expect(result).not.toBe(nowhere);
  });

  it('should be idempotent over a refusal, because both hosts apply it without asking the other', () => {
    // Given a document whose one operation the runner refuses, already transformed once
    const once = withGeneratedSamples(
      normalizeOpenApiDocument(cookieParameterSpecification()),
      runnerOperationOf,
    );

    // When
    const twice = withGeneratedSamples(once, runnerOperationOf);

    // Then, the subject first: there is a refusal on it to re-derive
    expect(onlyOperation(once).codeSamplesRefused).toHaveLength(1);
    expect(twice).toBe(once);
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

/**
 * The four members are recomputed on every pass, which is what a second pass over an edited
 * document depends on.
 *
 * SPEC 18 NAMES THE SECOND PASS AS A SUPPORTED PATH, so these are not synthetic. A host transforms
 * a document, hands it to `ReferenceService` as `ir:`, and it is transformed again over the top;
 * `@openref/static` transforms it in both `buildSite` and `createSiteServer`. Every case here is a
 * document that changed between the two passes, which is the ordinary shape of that path.
 */
describe('withGeneratedSamples, a recomputed member replaces the old one when it is empty', () => {
  /** The one fixture operation of an already transformed document, so a second pass has a subject. */
  const transformed = (
    from: IRDocument,
    languages?: readonly (typeof SAMPLE_LANGUAGES)[number][],
  ) =>
    languages === undefined
      ? withGeneratedSamples(from, runnerOperationOf)
      : withGeneratedSamples(from, runnerOperationOf, languages);

  it('should take the refusal off an operation whose server arrived between two passes', () => {
    // Given a document with nowhere to send, transformed once, so all fifteen stand refused
    const nowhere: IRDocument = { ...document(), servers: [] };
    const once = transformed(nowhere);
    expect(onlyOperation(once).codeSamplesRefused).toHaveLength(1);

    // When the document gains the server it was missing and is transformed again
    const restored: IRDocument = { ...once, servers: document().servers };
    const operation = onlyOperation(transformed(restored));

    // Then the twelve tabs are drawn and no sentence under them says the languages refused, since
    // a reader told a language refused while looking at its tab is being told two things at once.
    expect(operation.codeSamples).toHaveLength(12);
    expect(operation.codeSamplesRefused).toBeUndefined();
  });

  it('should take the held back sentence off a page that now draws those languages', () => {
    // Given a host that asked for one tab, so fourteen languages are named as held back
    const once = transformed(document(), [SAMPLE_LANGUAGES[0]!]);
    expect(onlyOperation(once).codeSamplesElsewhere).toHaveLength(14);

    // When the same document is transformed again with every language on the page
    const operation = onlyOperation(transformed(once, SAMPLE_LANGUAGES));

    // Then fifteen tabs and no held back sentence, because a sentence naming a language that is a
    // tab on the same page names it in two contradictory places.
    expect(operation.codeSamples).toHaveLength(15);
    expect(operation.codeSamplesElsewhere).toBeUndefined();
  });

  it('should not keep a sample addressed to a server the document no longer declares', () => {
    // Given a transformed document whose twelve samples all carry the origin it declared
    const once = transformed(document());
    expect(sample(onlyOperation(once).codeSamples ?? [], 'shell')?.source).toContain(
      'https://api.example.com/v1',
    );

    // When the server is taken away and the document is transformed again
    const moved: IRDocument = { ...once, servers: [] };
    const operation = onlyOperation(transformed(moved));

    // Then no sample survives pointing at an origin `buildRequest` would now refuse to build for.
    // This is the wire correctness half: a drawn sample that is not the runner's plan is exactly
    // the failure SPEC 18 exists to prevent, and a stale sample is one.
    expect(operation.codeSamples).toBeUndefined();
    expect(operation.codeSamplesRefused?.[0]?.languages).toHaveLength(15);
    expect(operation.codeSamplesRefused?.[0]?.reason).toBe(NO_SERVER_REFUSAL);
  });

  it('should draw one tab for a language a caller named twice', () => {
    // Given a caller list carrying the same language twice, which is a list a host may build by
    // concatenation without noticing
    const twice = [SAMPLE_LANGUAGES[0]!, SAMPLE_LANGUAGES[0]!];

    // When
    const operation = onlyOperation(withGeneratedSamples(document(), runnerOperationOf, twice));

    // Then one tab, because `CodeSample` resolves the active sample by `lang` and a second entry
    // under one id is a tab a reader can click and never reach.
    expect(operation.codeSamples).toHaveLength(1);
    expect(operation.codeSamples?.[0]?.lang).toBe('shell');
  });

  it('should keep the samples the document wrote when the server goes away', () => {
    // Given a hand written sample and a generated set, both on the operation after one pass
    const declared = [{ lang: 'elixir', label: 'Elixir', source: 'HTTPoison.post!(url, body)' }];
    const once = transformed(document({ declared }));
    expect(onlyOperation(once).codeSamples).toHaveLength(13);

    // When the server goes away and the document is transformed again
    const operation = onlyOperation(transformed({ ...once, servers: [] }));

    // Then the document's own sample is still there and only the generated twelve are gone, which
    // is the difference between recomputing what this package wrote and deleting what it did not.
    expect(operation.codeSamples).toHaveLength(1);
    expect(operation.codeSamples?.[0]?.lang).toBe('elixir');
  });
});

describe('withGeneratedSamples, an alias shares a tab rather than putting a language out, per SPEC 18', () => {
  /** The document writing its own HTTPie sample under the shared shell grammar id. */
  const aliased = { declared: [{ lang: 'bash', label: 'Ours', source: 'http POST /orders' }] };

  it('should still account for every one of the fifteen lang ids', () => {
    // Given, When: the guarantee SPEC 18 states, read over ids, which is the level it holds at
    const drawn = samplesOf(aliased).map((entry) => entry.lang);
    const named = elsewhereOf(aliased).map((entry) => entry.lang);
    const refused = refusedOf(aliased).flatMap((group) =>
      group.languages.map((entry) => entry.lang),
    );

    // Then every id is somewhere, and `bash` is there as the document's own tab
    expect(drawn).toContain('bash');
    for (const language of SAMPLE_LANGUAGES) {
      expect([...drawn, ...named, ...refused]).toContain(language.id);
    }
  });

  it('should draw what the document wrote in the shared tab, because level 3 outranks the generator', () => {
    // Given, When
    const samples = samplesOf(aliased);

    // Then one `bash` tab and it is the document's, which is the half of the ruling that does not
    // change: an author who writes a sample gets the tab.
    expect(samples.filter((entry) => entry.lang === 'bash')).toHaveLength(1);
    expect(sample(samples, 'bash')?.label).toBe('Ours');
  });

  it('should name the language whose tab the alias shares rather than lose it from the page', () => {
    // Given, When: the same document, read over the fifteen tabs rather than the fifteen ids
    const labels = [
      ...samplesOf(aliased).map((entry) => entry.label),
      ...elsewhereOf(aliased).map((entry) => entry.label),
      ...refusedOf(aliased).flatMap((group) => group.languages.map((entry) => entry.label)),
      ...notedOf(aliased).flatMap((group) => group.languages.map((entry) => entry.label)),
    ];

    // Then, the subject first, so this is a page with tabs rather than a page with none: the two
    // neighbouring aliases of the same grammar are each named as their own tab.
    expect(labels).toContain('cURL');
    expect(labels).toContain('wget');

    // And HTTPie is on the page too. Until 2026-09-04 the document's own `bash` entry took the id
    // the tab is keyed by and HTTPie appeared in none of the three lists, so the word was nowhere
    // at all: a vanished tab, which is the failure the whole of SPEC 18 is written against.
    expect(labels).toContain('HTTPie');
  });

  it('should say which language is sharing the tab and say it once', () => {
    // Given, When
    const notes = notedOf(aliased);

    // Then one group, one sentence, naming the language keyed by the id the document took, with
    // the label SPEC 18's own table gives it rather than the one the document chose.
    expect(notes.map((entry) => entry.note)).toContain(SHARED_TAB_NOTE);
    const shared = notes.find((entry) => entry.note === SHARED_TAB_NOTE);
    expect(shared?.languages).toEqual([{ lang: 'bash', label: 'HTTPie' }]);
  });

  it('should share no tab where the document writes an id no generated language uses', () => {
    // Given a document writing a language that is not one of the fifteen at all
    const foreign = {
      declared: [{ lang: 'elixir', label: 'Elixir', source: 'HTTPoison.post!()' }],
    };

    // When
    const notes = notedOf(foreign);

    // Then, the subject first: this operation does carry notes, so the absence below is a filter
    // answering rather than an operation with nothing to say.
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.map((entry) => entry.note)).not.toContain(SHARED_TAB_NOTE);
  });
});

describe('withGeneratedSamples, two level 3 samples under one language', () => {
  /** A document writing two Ruby samples, of which a tab strip keyed by `lang` can show one. */
  const collided = {
    declared: [
      { lang: 'ruby', label: 'Ruby', source: 'Net::HTTP.post(uri, body)' },
      { lang: 'ruby', label: 'Ruby, async', source: 'Async { Net::HTTP.post(uri, body) }' },
    ],
  };

  it('should draw the first and never a second tab a reader cannot reach', () => {
    // Given, When
    const samples = samplesOf(collided);

    // Then one Ruby tab, the document's first, because `CodeSample` finds the active sample by
    // `lang` and a second entry under that id is drawn, clickable and never shown.
    expect(samples.filter((entry) => entry.lang === 'ruby')).toHaveLength(1);
    expect(sample(samples, 'ruby')?.label).toBe('Ruby');
  });

  it('should state the collision rather than drop the second in silence', () => {
    // Given, When
    const notes = notedOf(collided);

    // Then the page has a sentence naming what the document wrote and cannot be shown, which is
    // the same rule that governs a language the page holds back and a language that refused.
    expect(notes.map((entry) => entry.note)).toContain(UNREACHABLE_TAB_NOTE);
    const collision = notes.find((entry) => entry.note === UNREACHABLE_TAB_NOTE);
    expect(collision?.languages).toEqual([{ lang: 'ruby', label: 'Ruby, async' }]);
  });
});

describe('withGeneratedSamples, what a correct sample still does not say by itself', () => {
  it('should carry the redirect divergence of the clients measured to differ from the console', () => {
    // Given, When: the ordinary page, whose twelve tabs are all correct
    const notes = notedOf();

    // Then two groups, because the four clients diverge in two different ways, and a note is not a
    // refusal: each of these samples sends exactly what the button sends and then behaves
    // differently with the response. Until this the divergence was computed and thrown away.
    expect(notes.map((entry) => entry.note)).toEqual([
      REDIRECT_NOT_FOLLOWED_NOTE,
      REDIRECT_CREDENTIAL_DROPPED_NOTE,
    ]);
    expect(notes[0]?.languages.map((entry) => entry.label)).toEqual(['cURL', 'HTTPie']);
    expect(notes[1]?.languages.map((entry) => entry.label)).toEqual(['PowerShell', 'Swift']);
  });

  it('should say that no sample carries a credential no request can carry', () => {
    // Given an operation whose only scheme is mutualTLS, whose credential is chosen by the browser
    // during the TLS handshake and travels in no request at all
    const mutual = specification();
    const components = mutual.components as Record<string, Record<string, unknown>>;
    components.securitySchemes = { mtls: { type: 'mutualTLS' } };
    mutual.security = [{ mtls: [] }];

    // When
    const operation = onlyOperation(
      withGeneratedSamples(normalizeOpenApiDocument(mutual), runnerOperationOf),
    );

    // Then, the subject first: twelve tabs are drawn, and every one of them is a request that will
    // not authenticate. `placeholderCredentials` computed that and the page threw it away.
    expect(operation.codeSamples).toHaveLength(12);
    const note = unsendableCredentialNote('mtls', 'mutual-tls');
    expect(operation.codeSamplesNotes?.map((entry) => entry.note)).toContain(note);

    // And it is said about every language that has a tab or a name, since the fact is about the
    // request rather than about any client.
    const named = operation.codeSamplesNotes?.find((entry) => entry.note === note);
    expect(named?.languages).toHaveLength(15);
  });

  it('should say nothing about a sample the document wrote itself', () => {
    // Given a document that writes its own cURL, which is level 3 and outranks the generator, so
    // the tab a reader opens holds text this package never produced
    const declared = [{ lang: 'shell', label: 'Ours', source: 'curl -sS https://ours.example' }];

    // When
    const notes = notedOf({ declared });

    // Then, the subject first: the redirect notes are still there for the client that did not
    // write its own, so this is a filter rather than an empty answer
    expect(notes.map((entry) => entry.note)).toContain(REDIRECT_NOT_FOLLOWED_NOTE);

    // And cURL is not named, because what our emitter would have done with a redirect says nothing
    // about the command the author typed.
    const following = notes.find((entry) => entry.note === REDIRECT_NOT_FOLLOWED_NOTE);
    expect(following?.languages.map((entry) => entry.label)).toEqual(['HTTPie']);
  });

  it('should say nothing about a credential an ordinary bearer operation carries', () => {
    // Given, When: the fixture, whose bearer scheme travels in a header like any other
    const notes = notedOf();

    // Then, a proof of absence that first asserts the subject was present: there are notes, and
    // none of them is about a credential.
    expect(notes).toHaveLength(2);
    expect(notes.every((entry) => !entry.note.includes('credential for'))).toBe(true);
  });
});

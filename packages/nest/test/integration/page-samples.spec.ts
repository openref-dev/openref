import { describe, expect, it } from 'vitest';
import { loadDefaultAssets, runnerOperationOf } from '@openref/render';
import {
  OFF_PAGE_SAMPLE_LANGUAGES,
  PAGE_SAMPLE_LANGUAGES,
  withGeneratedSamples,
} from '@openref/samples';
import { finalizeDocument, normalizeOpenApiDocument } from '@openref/core';
import type { IROperation } from '@openref/core';
import { replyText } from '../../src/http/domain/reply';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import { NODE_PARAM } from '../../src/reference/domain/routes';

/**
 * The page draws the samples the generator writes, which is the whole of `TX-PAGE-SAMPLES`.
 *
 * WHY IT IS AN INTEGRATION TEST AND NOT A UNIT ONE. `T057` built the generator and every unit of
 * it has been green since; what was missing was that no page drew any of it, and no unit test can
 * fail for that. The subject here is the served bytes: a real `ReferenceService` over a real
 * specification, the page it answers with, and the cURL a reader would copy out of it.
 *
 * THE EXPECTED TEXT IS NOT WRITTEN OUT HERE. It comes from `withGeneratedSamples` over the same
 * document, so what is asserted is that the page and the transform agree rather than that the page
 * matches a string somebody typed. A string typed here would have to be edited whenever an emitter
 * changes, which is how a check comes to assert its own last output.
 */

/** The document the page is served from: one operation with a body, a scheme and two parameters. */
function specification(
  declared?: readonly Readonly<Record<string, string>>[],
): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [{ url: 'https://api.example.com/v1' }],
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
          ...(declared === undefined ? {} : { 'x-codeSamples': declared }),
          parameters: [
            {
              name: 'orderId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              example: 'ord_42',
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

/**
 * The same specification with one required cookie parameter added.
 *
 * A DOCUMENT ANY AUTHOR MAY WRITE. `buildRequest` throws a `SerializationError` for it by name,
 * because `Cookie` is a forbidden header and a browser will not let a script set one, so every one
 * of the fifteen emitters is unreachable for this operation.
 */
function cookieSpecification(): Record<string, unknown> {
  const withCookie = specification();
  const paths = withCookie.paths as Record<string, Record<string, Record<string, unknown>>>;
  const post = paths['/orders/{orderId}/items']?.post;
  expect(post).toBeDefined();
  (post!.parameters as Record<string, unknown>[]).push({
    name: 'session',
    in: 'cookie',
    required: true,
    schema: { type: 'string' },
    example: 'abc',
  });

  return withCookie;
}

function service(declared?: readonly Readonly<Record<string, string>>[]): ReferenceService {
  return new ReferenceService({
    document: specification(declared),
    basePath: '/docs',
    assets: loadDefaultAssets(),
  });
}

/** The operation page of the one operation this document has. */
async function page(reference: ReferenceService): Promise<string> {
  const nodeId = [...reference.document.nodes.keys()][0] ?? '';
  const reply = await reference.handle('node', { params: { [NODE_PARAM]: nodeId }, headers: {} });

  expect(reply.status).toBe(200);

  return replyText(reply);
}

/**
 * The text inside a fragment of served markup, tags removed and entities put back.
 *
 * THE SAMPLE ON THE PAGE IS HIGHLIGHTED AND THEREFORE IS NOT THE SOURCE, per SPEC 12: the
 * highlighter runs on the server and what travels is the markup it produced, one span per token.
 * Comparing against the generator's output means undoing exactly that and nothing else.
 */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replaceAll('&#39;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** The samples section of an operation page, or the empty string when it draws none. */
function samplesSection(html: string): string {
  const start = html.indexOf('<section class="oref-section oref-section-samples">');
  if (start === -1) return '';

  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

/** The source the transform produces for one language of the same document. */
function expectedSource(reference: ReferenceService, lang: string): string {
  // THE SERVICE'S OWN DOCUMENT ALREADY CARRIES THE SAMPLES, so the transform is re-run over a
  // freshly normalized copy instead: comparing the page against the field the page was built
  // from would compare a value with itself.
  const fresh = new ReferenceService({
    document: specification(),
    basePath: '/docs',
    assets: loadDefaultAssets(),
  });
  const node = [...fresh.document.nodes.values()][0] as IROperation;
  const source = node.codeSamples?.find((sample) => sample.lang === lang)?.source;

  expect(source, `no ${lang} sample was generated at all`).toBeDefined();
  expect(reference.document.hash).toBe(fresh.document.hash);

  return source ?? '';
}

describe('an operation page of a served reference', () => {
  it('should draw the samples section, which no page drew before TX-PAGE-SAMPLES', async () => {
    // Given, When
    const html = await page(service());

    // Then
    expect(html).toContain('<section class="oref-section oref-section-samples">');
    expect(html).toContain('Call it');
  });

  it('should offer a tab for each of the twelve SPEC 18 draws', async () => {
    // Given, When
    const section = samplesSection(await page(service()));

    // Then: the tab strip is the twelve, read off the declared set rather than off a list typed
    // here, so moving a language between the two placements reddens this and nothing has to be
    // remembered.
    for (const language of PAGE_SAMPLE_LANGUAGES) {
      expect(section, language.label).toContain(`>${language.label}</button>`);
    }
  });

  it('should draw no tab for the three it holds back', async () => {
    // Given, When
    const section = samplesSection(await page(service()));

    // Then: no button, which is the byte saving, and it is asserted rather than assumed.
    for (const language of OFF_PAGE_SAMPLE_LANGUAGES) {
      expect(section, language.label).not.toContain(`>${language.label}</button>`);
    }
  });

  it('should name the three it holds back, so a reader can tell absent from unavailable', async () => {
    // Given, When
    const html = await page(service());

    // Then: the sentence, on the page, naming all three. The maintainer's requirement is exactly
    // this: a reader must be able to tell a language this page does not have from one it can
    // produce, and silence cannot say that.
    expect(html).toContain('Generated for this operation and not drawn here: PHP, Java, Ruby.');
    expect(html).toContain('A build that asks for them draws them.');
    expect(OFF_PAGE_SAMPLE_LANGUAGES.map((language) => language.label)).toEqual([
      'PHP',
      'Java',
      'Ruby',
    ]);
  });

  it('should say nothing once the three are on the page', async () => {
    // Given a document that writes its own PHP, Java and Ruby. Level 3 outranks the generator, so
    // all three get a tab, and this is one of the two ways SPEC 18 says a held back language
    // reaches a page. The presence half is the case above: on the default page the sentence is
    // there and names all three.
    const declared = [
      { lang: 'php', label: 'PHP', source: '<?php $r = curl_init();' },
      { lang: 'java', label: 'Java', source: 'HttpClient client = HttpClient.newHttpClient();' },
      { lang: 'ruby', label: 'Ruby', source: 'Net::HTTP.post(uri, body)' },
    ];

    // When
    const html = await page(service(declared));

    // Then: three tabs and no sentence, because nothing is being held back from this page.
    for (const language of OFF_PAGE_SAMPLE_LANGUAGES) {
      expect(html, language.label).toContain(`>${language.label}</button>`);
    }
    expect(html).not.toContain('Generated for this operation and not drawn here');
  });

  it('should carry the generated cURL the transform wrote, character for character', async () => {
    // Given
    const reference = service();
    const expected = expectedSource(reference, 'shell');

    // When
    const drawn = textOf(samplesSection(await page(reference)));

    // Then: every line of the sample is on the page, in the page's own order.
    expect(expected).toContain('curl -X POST');
    for (const line of expected.split('\n')) expect(drawn).toContain(line.trim());
    expect(drawn).toContain('https://api.example.com/v1/orders/ord_42/items');
  });

  it('should show a placeholder credential and never a real one, per SPEC 19.7', async () => {
    // Given, When
    const drawn = textOf(samplesSection(await page(service())));

    // Then
    expect(drawn).toContain('Authorization: Bearer <bearer>');
  });

  it('should put a sample the document wrote by hand ahead of the generated ones', async () => {
    // Given a document declaring its own shell sample, which is level 3 and outranks the generator
    const declared = [{ lang: 'shell', label: 'Ours', source: 'curl -sS https://ours.example' }];

    // When
    const section = samplesSection(await page(service(declared)));
    const drawn = textOf(section);

    // Then the hand written one is the tab that is showing and the generated shell is not there
    expect(drawn).toContain('curl -sS https://ours.example');
    expect(drawn).not.toContain('curl -X POST');
    expect(section.indexOf('Ours')).toBeLessThan(section.indexOf('TypeScript'));
  });

  it('should state the refusal for an operation with nowhere to send, rather than say nothing', async () => {
    // Given a document with no server, which a written OpenAPI file cannot be, because the
    // specification's own default supplies `/`. It reaches a mount through the federated `ir`
    // path of SPEC 15.3, where the document arrives already normalized.
    const base = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Nowhere', version: '1.0.0' },
      paths: {
        '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'ok' } } } },
      },
    });
    const reference = new ReferenceService({
      ir: finalizeDocument({ ...base, servers: [], hash: '' }),
      basePath: '/docs',
      assets: loadDefaultAssets(),
    });

    // When
    const html = await page(reference);
    const section = samplesSection(html);

    // Then. WHAT THIS CASE ASSERTED BEFORE, AND WHY IT WAS WRONG: it asserted the page carried no
    // `oref-section-samples` at all, on the grounds that an empty tab strip is worse than no
    // section. The first half is right and is a case of its own below; the conclusion drawn from
    // it was that fifteen languages may vanish with nothing said, which is precisely the silence
    // SPEC 18's standing rule forbids. The section is drawn, it carries no strip, and it says why.
    expect(section).toContain('Call it');
    expect(section).not.toContain('role="tablist"');
    expect(section).toContain('No sample for this request in cURL, HTTPie, wget');
    expect(section).toContain('no server');
  });

  it('should say so on an ordinary document the runner refuses to build a request from', async () => {
    // Given a plain OpenAPI document with one required cookie parameter, nothing federated and
    // nothing hand built: `buildRequest` refuses it by name, because `Cookie` is a header a browser
    // will not let a script set. Until this the whole refusal was swallowed and the page carried no
    // samples section at all.
    const reference = new ReferenceService({
      document: cookieSpecification(),
      basePath: '/docs',
      assets: loadDefaultAssets(),
    });

    // When
    const html = await page(reference);
    const section = samplesSection(html);

    // Then: all fifteen named under the one reason, and the reason is the runner's own words
    for (const language of [...PAGE_SAMPLE_LANGUAGES, ...OFF_PAGE_SAMPLE_LANGUAGES]) {
      expect(section, language.label).toContain(language.label);
      expect(section, language.label).not.toContain(`>${language.label}</button>`);
    }
    expect(section).toContain('cookie parameter');
  });

  it('should draw no empty tab strip, which the page model calls worse than no section', async () => {
    // Given the same document, whose every language refused
    // When
    const section = samplesSection(
      await page(
        new ReferenceService({
          document: cookieSpecification(),
          basePath: '/docs',
          assets: loadDefaultAssets(),
        }),
      ),
    );

    // Then, the subject first: this is the samples section, and it says what it is
    expect(section).toContain('Call it');

    // And it carries no strip, empty or otherwise, because there is not one tab to put in it
    expect(section).not.toContain('role="tablist"');
    expect(section).not.toContain('oref-sample-tabs');
  });

  it('should cost the state block 24 bytes on a page with no refusal at all', async () => {
    // Given the ordinary page, whose request all fifteen languages can write. SPEC 20 recorded
    // this arrival as costing the page "zero where there are no refusals"; measured, it costs the
    // empty list, on every node page, and the figure is pinned here so the sentence has a runner.
    const html = await page(service());

    // Then, the subject first: this really is a page with nothing refused on it
    expect(html).not.toContain('No sample for this request in');

    // And the member still crosses, because the samples section is the one part of the article the
    // client redraws, so it reads the list rather than the markup. It cannot be left out: the
    // member is required on `NodeModel` on purpose, and `readPageState` is a bare `JSON.parse`
    // with no defaults, so an absent key is an exception during hydration rather than an empty
    // list. What that costs is this, and it is 24 bytes rather than nothing.
    expect(html).toContain(',"codeSamplesRefused":[]');
    expect(Buffer.byteLength(',"codeSamplesRefused":[]', 'utf8')).toBe(24);
  });

  it('should keep both notices inside the section they belong to', async () => {
    // Given the ordinary page, which draws twelve tabs and names three languages beside them
    const html = await page(service());

    // When
    const section = samplesSection(html);

    // Then, the subject first: the sentence is on the page at all
    expect(html).toContain('Generated for this operation and not drawn here: PHP, Java, Ruby.');

    // And it is inside the samples section rather than a sibling after its closing tag, which is
    // where a reader looking at the tab strip reads it and where a theme's section styling reaches.
    expect(section).toContain('Generated for this operation and not drawn here: PHP, Java, Ruby.');
  });

  it('should say a language refused this request rather than let its tab vanish', async () => {
    // Given a request thirteen of the fifteen refuse: a header value outside US-ASCII, which
    // SPEC 18 allows only the two clients measured putting the runner's own octets on the wire.
    // Before this, ten of the twelve drawn languages simply had no tab, and a missing tab is
    // indistinguishable from a language this page never had.
    const withHeader = specification();
    const paths = withHeader.paths as Record<string, Record<string, Record<string, unknown>>>;
    const post = paths['/orders/{orderId}/items']?.post;
    expect(post).toBeDefined();
    (post!.parameters as Record<string, unknown>[]).push({
      name: 'X-Note',
      in: 'header',
      schema: { type: 'string' },
      example: 'caf\u00e9',
    });
    const reference = new ReferenceService({
      document: withHeader,
      basePath: '/docs',
      assets: loadDefaultAssets(),
    });

    // When
    const html = await page(reference);
    const section = samplesSection(html);

    // Then, the subject first: the two that can write it have their tabs
    expect(section).toContain('>TypeScript</button>');
    expect(section).toContain('>Swift</button>');

    // And the ten drawn languages that refused are named with the reason, rather than absent
    for (const label of ['cURL', 'HTTPie', 'wget', 'PowerShell', 'Python', 'Go', 'C#', 'Rust']) {
      expect(section, label).not.toContain(`>${label}</button>`);
    }
    expect(html).toContain('No sample for this request in cURL, HTTPie, wget, PowerShell');
    expect(html).toContain('outside US-ASCII');
  });

  it('should say how four of its own tabs treat a redirect, which it used to compute and drop', async () => {
    // Given the ordinary page, whose twelve tabs are all correct. `GeneratedSamples.notes` has
    // carried the measured redirect divergence of cURL, HTTPie, PowerShell and Swift since the
    // generator was built, and the transform destructured two of the three members, so it reached
    // no reader on any page at all.
    const html = await page(service());
    const section = samplesSection(html);

    // Then, the subject first: all four have tabs, so these are notes about samples a reader can
    // see rather than about languages that are missing
    for (const label of ['cURL', 'HTTPie', 'PowerShell', 'Swift']) {
      expect(section, label).toContain(`>${label}</button>`);
    }

    // And each pair is named with what it does, inside the section, grouped by the sentence
    expect(section).toContain('In cURL, HTTPie: this client stops at the first response');
    expect(section).toContain('In PowerShell, Swift: this client follows a redirect');
  });

  it('should say that no sample carries a credential no request can carry', async () => {
    // Given an operation behind mutualTLS, whose credential the browser chooses during the TLS
    // handshake and which travels in no request at all. `placeholderCredentials` has returned that
    // fact since the generator was built and the transform threw it away, so such a page drew
    // twelve commands that cannot authenticate and said nothing about it.
    const mutual = specification();
    const components = mutual.components as Record<string, Record<string, unknown>>;
    components.securitySchemes = { mtls: { type: 'mutualTLS' } };
    mutual.security = [{ mtls: [] }];
    const reference = new ReferenceService({
      document: mutual,
      basePath: '/docs',
      assets: loadDefaultAssets(),
    });

    // When
    const section = samplesSection(await page(reference));

    // Then, the subject first: the tabs are there and they are correct
    expect(section).toContain('>cURL</button>');
    expect(section).not.toContain('No sample for this request in');

    // And the page says what they cannot do, naming the scheme so a reader can find it. The
    // scheme id arrives escaped, because it is a document's string reaching markup and SPEC 19.1
    // keeps a document's text out of the interface's namespace; the assertion reads what the
    // browser receives rather than what the constant says.
    expect(section).toContain(
      'no sample carries a credential for the security scheme &quot;mtls&quot;',
    );
    expect(section).toContain('will not authenticate');
  });
});

describe('the transform the page and the static build share', () => {
  it('should be the one the served document went through, and applying it again change nothing', () => {
    // Given the document the service settled on, samples included
    const reference = service();

    // When the same transform is applied to it a second time
    const again = withGeneratedSamples(reference.document, runnerOperationOf);

    // Then it is idempotent, which is what lets the CLI and the module share it without either
    // having to know whether the other ran first.
    expect(again.hash).toBe(reference.document.hash);
  });
});

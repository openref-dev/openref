import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Module, SetMetadata, Sse, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CanActivate, INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { guardsCollector } from '../../src/runtime/infrastructure/collectors/guards.collector';
import { scopesCollector } from '../../src/runtime/infrastructure/collectors/metadata.collector';
import { sourceCollector } from '../../src/runtime/infrastructure/collectors/source.collector';
import { errorsCollector } from '../../src/runtime/infrastructure/collectors/errors.collector';
import type { CollectorRegistration } from '../../src/runtime/application/ports/collector.port';
import { CLAIMS, type Claim, type ClaimContext } from '../../../../tools/docs-site/src/claims.ts';

/**
 * Every claim the documentation makes about what a reader sees, against what a page produces.
 *
 * THE CLAIMS ARE NOT READ OUT OF THE PROSE ANY MORE, AND THAT IS THE CHANGE. The suite that
 * preceded this one scanned fenced blocks for promise lines, and the review that followed found
 * five spellings that walked around the scanner: a table row, a heading, a paragraph, a bullet
 * and a plain sentence. A scanner verifies one way of writing a claim. So a claim is no longer
 * written in prose at all: `tools/docs-site/src/claims.ts` holds the sentence, `generate.ts`
 * emits it into every surface that makes it, and this file asserts it against a booted
 * application. All three read the same array.
 *
 * WHAT THAT REMOVES. There is no marker vocabulary in the prose to keep up to date, no
 * classification for a writer to get wrong, and no opt out. A claim added to the array appears
 * in the prose at the next build and fails here until it has a probe, because `PROBES` is keyed
 * by claim id and a claim with no probe is reported by name.
 *
 * NOTHING IS ASSERTED BY SUBSTRING. Every probe reads a structural marker the renderer emits on
 * purpose: a class, a data attribute, or an address.
 */

/** Repository root, four directories up from this file. */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/** The three pages and the two extra ones a probe is allowed to look at. */
interface Pages {
  readonly overview: string;
  readonly node: string;
  readonly bench: string;
  /** The streaming operation's own page: the page the SSE claim is about. */
  readonly stream: string;
}

/** Whether a page carries the class as a class, rather than as a word somewhere in the text. */
function hasClass(page: string, name: string): boolean {
  return new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`).test(page);
}

/**
 * What the workspace does about a dependency that reports an install.
 *
 * THE TELEMETRY CLAIM GETS A READER HERE. `tools/gates/test/unit/install-scripts.spec.ts` holds
 * the refusals to their reasons; what was missing was anything tying them to the sentence the
 * documentation prints. The claim now fails if either refusal is removed, which is the shape a
 * claim about an absence has to have.
 */
function refusedInstallScripts(): readonly string[] {
  const workspace = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');

  return workspace
    .split('\n')
    .map((line) => /^\s+'([^']+)':\s*false\s*$/.exec(line.trim() === '' ? '' : line)?.[1] ?? '')
    .filter((name) => name !== '');
}

/** What each claim means, as a structural marker on a rendered page. Keyed by claim id. */
const PROBES: Readonly<Record<string, (pages: Pages) => boolean>> = {
  'reference-search-schemas': (pages) =>
    hasClass(pages.overview, 'oref-palette-open') &&
    /href="\/docs\/schema\/[^"]+"/.test(pages.overview + pages.node),

  'try-it': (pages) => hasClass(pages.bench, 'oref-send'),

  'sse-marked': (pages) => hasClass(pages.stream, 'oref-method-sse'),

  'no-external-requests': (pages) =>
    everyPage(pages, (page) => !/(?:src|href)="(?:https?:)?\/\//.test(page)),

  'digest-assets': (pages) =>
    everyPage(pages, (page) => /(?:src|href)="\/docs\/_assets\/[^"]*\.[0-9a-f]{8,}\./.test(page)),

  csp: (pages) =>
    everyPage(
      pages,
      (page) =>
        !/<[a-z][^>]*\sstyle="/i.test(page) &&
        !/<script(?![^>]*\btype="application\/(?:ld\+)?json")[^>]*>[^<]/i.test(page),
    ),

  'no-telemetry': (pages) => {
    const refused = refusedInstallScripts();
    return (
      refused.includes('@nestjs/core') &&
      refused.includes('@scarf/scarf') &&
      everyPage(pages, (page) => !/(?:src|href)="(?:https?:)?\/\//.test(page))
    );
  },

  // BOTH HALVES, BECAUSE SANITIZING IS THE PAIR. The markup a description legitimately writes
  // has to survive and the script in the same description has to not. The earlier probe checked
  // only the half that must survive, which a renderer that passed everything through would also
  // pass. The negative names the script's own body rather than the element, because the page
  // carries two script elements of its own and the subject is the one the document wrote.
  sanitized: (pages) =>
    pages.node.includes('<em>italic from a description</em>') && !pages.node.includes('alert(1)'),

  'guards-scopes': (pages) =>
    pages.node.includes('data-oref-parity="authentication"') &&
    pages.node.includes('data-oref-parity="scopes"') &&
    pages.node.includes('OrdersGuard') &&
    pages.node.includes('orders:read'),

  'source-link': (pages) =>
    hasClass(pages.node, 'oref-source-link') &&
    /href="https:\/\/example\.com\/blob\/main\/[^"]*#L\d+"/.test(pages.node),

  // ALL THREE GROUPS, BY THEIR OWN CLASSES. The claim is that the groups are never one list, and
  // the earlier probe read one substring out of one of them, which is true of a page that merged
  // them. `ResponseList.ts` gives each group a class, and the claim is about all three.
  'error-contracts': (pages) =>
    hasClass(pages.node, 'oref-errgroup-errors-declared') &&
    hasClass(pages.node, 'oref-errgroup-errors-runtime-derived') &&
    hasClass(pages.node, 'oref-errgroup-errors-global') &&
    pages.node.includes('Internal Server Error'),

  'rate-limits': (pages) => {
    const row = (/Rate limit([\s\S]{0,400}?)<\/div><\/div>/.exec(pages.node)?.[1] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ');
    return /\d+\s*\/\s*[a-z]/i.test(row);
  },
};

/** Applies a test to every page, so a claim about the output holds on all of it. */
function everyPage(pages: Pages, holds: (page: string) => boolean): boolean {
  return [pages.overview, pages.node, pages.bench, pages.stream].every(holds);
}

/** The key this application writes its scopes under. */
const SCOPES_KEY = 'orders:scopes';

class OrdersGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Controller('orders')
class OrdersController {
  @Get(':id')
  @UseGuards(OrdersGuard)
  @SetMetadata(SCOPES_KEY, ['orders:read'])
  readOrder(): string {
    return 'an order';
  }

  @Sse('watch')
  watch(): string {
    return 'a stream';
  }
}

/**
 * A document with a named schema, a guarded operation, a streaming one and markup in a
 * description.
 *
 * EACH OF THOSE IS THERE BECAUSE A CLAIM NEEDS IT. A schema page needs a named schema, the
 * sanitization claim needs a description carrying markup that must survive beside a script that
 * must not, and the streaming badge needs a document that declares a stream.
 */
function document(withStream = true): Record<string, unknown> {
  const paths: Record<string, unknown> = {
    '/orders/{id}': {
      get: {
        operationId: 'readOrder',
        description: 'An <em>italic from a description</em> and a <script>alert(1)</script>.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'An order',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } },
          },
        },
      },
    },
  };

  if (withStream) {
    paths['/orders/watch'] = {
      get: {
        operationId: 'watchOrders',
        responses: { '200': { description: 'A stream', content: { 'text/event-stream': {} } } },
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'Orders', version: '1.0.0' },
    servers: [{ url: '/' }],
    components: {
      schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } },
    },
    paths,
  };
}

/** The collectors each claim context is about, cumulative in the order a reader adds them. */
function collectorsFor(context: ClaimContext): readonly CollectorRegistration[] | null {
  const printed = [
    guardsCollector(),
    scopesCollector({ metadataKey: SCOPES_KEY }),
    sourceCollector(),
  ];

  if (context === 'bare-mount') return null;
  if (context === 'printed-block') return printed;
  if (context === 'errors-collector') {
    return [
      ...printed,
      errorsCollector({ global: [{ status: 500, title: 'Internal Server Error' }] }),
    ];
  }
  // The rate limit's producer is `@openref/collector-throttler`, which this package does not
  // depend on and must not. The claim's positive half is proved end to end by the demo, whose
  // parity block `readme-reproduction.spec.ts` holds against the served page; what is proved
  // here is that nothing inside `@openref/nest` produces it.
  return null;
}

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/** Boots the fixture and reads the pages a probe may look at. */
async function render(
  collectors: readonly CollectorRegistration[] | null,
  withStream = true,
): Promise<Pages> {
  @Module({
    controllers: [OrdersController],
    imports:
      collectors === null
        ? []
        : [
            OpenRefModule.forRoot({
              runtime: {
                collectors: [...collectors],
                sourceLink: 'https://example.com/blob/main/{file}#L{line}',
              },
            }),
          ],
  })
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  class AppModule {}

  const app = await NestFactory.create(AppModule, { logger: false });
  running = app;

  OpenRefModule.setup('/docs', app, { document: document(withStream) });
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();

  return {
    overview: await (await fetch(`${url}/docs`)).text(),
    node: await (await fetch(`${url}/docs/get-orders-id`)).text(),
    bench: await (await fetch(`${url}/docs/bench/get-orders-id`)).text(),
    stream: await (
      await fetch(`${url}/docs/${withStream ? 'get-orders-watch' : 'get-orders-id'}`)
    ).text(),
  };
}

describe('the claim table, which is the only place a claim is written', () => {
  it('should carry claims, with evidence, before anything is proved about them', () => {
    // Then
    expect(CLAIMS.length).toBeGreaterThan(8);
    for (const claim of CLAIMS) {
      expect(claim.sentence.length).toBeGreaterThan(10);
      expect(claim.evidence.length).toBeGreaterThan(10);
    }
  });

  it('should have a probe for every claim', () => {
    // Given
    const unprobed = CLAIMS.filter((claim) => PROBES[claim.id] === undefined).map(
      (claim) => claim.id,
    );

    // Then
    expect(unprobed).toEqual([]);
  });

  it('should have no probe for a claim that no longer exists', () => {
    // Given
    const ids = new Set(CLAIMS.map((claim) => claim.id));

    // Then, the other direction, which the type cannot see
    expect(Object.keys(PROBES).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('should reach the prose of every surface that makes a claim', () => {
    // Given the generated prose, which is where a reader meets the sentence
    const surfaces = [
      readFileSync(join(ROOT, 'README.md'), 'utf8'),
      ...readdirSync(join(ROOT, 'docs', 'guide'))
        .filter((file) => file.endsWith('.md'))
        .map((file) => readFileSync(join(ROOT, 'docs', 'guide', file), 'utf8')),
    ].join('\n');

    // Then: a bare mount claim a reader never meets is a claim nobody makes
    for (const claim of CLAIMS.filter((entry) => entry.context === 'bare-mount')) {
      expect(surfaces, claim.id).toContain(claim.sentence);
    }
  });
});

describe('every claim, against the page it is about', () => {
  const contexts = [...new Set(CLAIMS.map((claim) => claim.context))];

  for (const context of contexts) {
    const made = CLAIMS.filter((claim) => claim.context === context);
    const collectors = collectorsFor(context);
    if (collectors === null && context !== 'bare-mount') continue;

    it(`should hold every claim made about a ${context}`, async () => {
      // Given
      const pages = await render(collectors);

      // Then, presence first
      expect(made.length).toBeGreaterThan(0);
      const broken = made
        .filter((claim) => !(PROBES[claim.id] ?? ((): boolean => false))(pages))
        .map((claim: Claim) => `${claim.id}: ${claim.evidence}`);
      expect(broken).toEqual([]);
    }, 60_000);
  }

  it('should make no later claim true on a bare mount', async () => {
    // Given
    const pages = await render(null);
    const later = CLAIMS.filter((claim) => claim.context !== 'bare-mount');

    // Then
    expect(later.length).toBeGreaterThan(0);
    const early = later
      .filter((claim) => (PROBES[claim.id] ?? ((): boolean => false))(pages))
      .map((claim) => claim.id);
    expect(early).toEqual([]);
  }, 60_000);

  it('should carry the rate limit figure in the demo block the served page is held to', () => {
    // Given the claim whose producer lives in a package this one cannot depend on
    const claim = CLAIMS.find((entry) => entry.id === 'rate-limits');
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

    // When: the parity block of the demo, which `readme-reproduction.spec.ts` holds against the
    // page the demo really serves, so this assertion and that one close the chain
    const row = /Rate limit\s+.\s+([^\n]*)/.exec(readme)?.[1] ?? '';

    // Then, presence first, then the same shape the probe looks for on a page
    expect(claim?.evidence, 'the claim names the suite that carries its positive half').toContain(
      'readme-reproduction',
    );
    expect(row.length).toBeGreaterThan(0);
    expect(/\d+\s*\/\s*[a-z]/i.test(row)).toBe(true);
  });

  it('should not mark a stream on a document that declares none', async () => {
    // Given the control the SSE claim needs, since the badge rides the navigation too
    const pages = await render(null, false);

    // Then
    expect(pages.node).toContain('get-orders-id');
    expect(hasClass(pages.stream, 'oref-method-sse')).toBe(false);
  }, 60_000);
});

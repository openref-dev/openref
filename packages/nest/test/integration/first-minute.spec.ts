import 'reflect-metadata';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Readable } from 'node:stream';
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
import type {
  CollectorRegistration,
  IRuntimeCollector,
} from '../../src/runtime/application/ports/collector.port';
import type { IRErrorContract, IRErrorContractOrigin } from '@openref/core';
import { specification } from '../mocks/fixtures';
import { SPAWNED_PROCESS_TIMEOUT_MS } from '../../../../vitest.spawn-timeout.ts';

/**
 * SPEC 2's first minute, run as a reader runs it, and measured line by line.
 *
 * WHY THIS FILE EXISTS. The landing page prints an install, one line and an eight item list of
 * what is already there. Until 2026-09-01 nothing ran that list against a real application
 * booted the way a reader boots one, and two things were wrong at once: the one line ended the
 * process with exit code 1 and no output, and four of the eight items are not produced by that
 * line at all. The first is fixed in `referencesIn`; the second is a measurement, and the copy
 * on the landing page now says what this file proves rather than what SPEC 2 hoped.
 *
 * THE BOOT IS THE READER'S BOOT. `NestFactory.create` with no `abortOnError` and no `forRoot`
 * anywhere, because `abortOnError: false` is exactly the option that switches off the mechanism
 * that used to break this, and a case that sets it proves the opposite of the shipped
 * experience. Nothing here passes an asset plan either: `loadDefaultAssets` runs, which is what
 * a reader gets.
 *
 * THE DOCUMENT IS WRITTEN BY HAND, per the convention `forroot.spec.ts` states and for its
 * reason: this package does not depend on `@nestjs/swagger` and must not start to. What the
 * first minute turns on is what `setup` mounts and what the pages carry, and neither is a
 * property of who serialized the document.
 *
 * BOTH HALVES ARE ASSERTED. Four items are present after the one line, and four are absent
 * until collectors are registered, and the second group is proved twice: absent on the bare
 * mount, present on the same controller once `forRoot` carries the collectors. An absence
 * asserted on its own would also be what a broken selector looks like.
 */

/** A guard, so that "guards and the scopes a route requires" has something real to find. */
class OrdersGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/** The key this application writes its scopes under, since SPEC 6.1 refuses to guess one. */
const SCOPES_KEY = 'orders:scopes';

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
 * The document the reference serves: the two routes the controller has.
 *
 * @param withStream - Whether the streaming route is in it, which one case needs to vary
 */
function document(withStream = true): Record<string, unknown> {
  const base = specification();
  const paths = base.paths as Record<string, unknown>;

  paths['/orders/{id}'] = {
    get: {
      operationId: 'readOrder',
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': { description: 'An order' } },
    },
  };
  if (withStream) {
    paths['/orders/watch'] = {
      get: {
        operationId: 'watchOrders',
        responses: {
          '200': { description: 'A stream', content: { 'text/event-stream': {} } },
        },
      },
    };
  }

  return base;
}

/**
 * The facts the four remaining list items are about, as one collector.
 *
 * WRITTEN HERE RATHER THAN ASSEMBLED FROM THE SHIPPED ONES, because three of the four shipped
 * producers need something this package cannot bring into an integration test: a throttler
 * library, a source map pointing at a repository, and an error catalogue the host declares. The
 * claim under test is that the rows appear once a collector produces them and not before, and
 * that claim does not depend on which collector produced them.
 */
function contract(status: number, title: string, origin: IRErrorContractOrigin): IRErrorContract {
  return { status, title, origin, confidence: 'derived', collector: 'factsCollector' };
}

const factsCollector: IRuntimeCollector = {
  name: 'factsCollector',
  collect: (context) => ({
    scopes: context.fact(['orders:read'], 'declared'),
    rateLimit: context.fact({ limit: 30, ttlMs: 60_000 }, 'derived'),
    source: {
      controller: 'OrdersController',
      handler: 'readOrder',
      file: 'src/orders.ts',
      line: 7,
    },
    errors: {
      declared: [contract(404, 'Not Found', 'declared')],
      runtimeDerived: [contract(401, 'Unauthorized', 'runtime-derived')],
      global: [contract(500, 'Internal Server Error', 'global')],
    },
  }),
};

let running: INestApplication | undefined;
let spawned: ChildProcess | undefined;

afterEach(async () => {
  spawned?.kill('SIGKILL');
  spawned = undefined;
  await running?.close();
  running = undefined;
});

/**
 * The collectors the landing page prints, and nothing else.
 *
 * THE BLOCK ON THE PAGE IS THE SUBJECT, NOT A CONVENIENT APPROXIMATION OF IT. The page names
 * `guardsCollector`, `scopesCollector` and `sourceCollector` and then says what they produce, and
 * the first version of that copy claimed all four of the remaining items. Two of the four are not
 * producible by that block at all: rate limits come from a collector in a separate package, and
 * error contracts need a catalogue the host declares. Reading a mapping off a list of names is
 * how the copy went wrong once, so the mapping is measured here instead.
 */
function printedBlock(): CollectorRegistration[] {
  return [guardsCollector(), scopesCollector({ metadataKey: SCOPES_KEY }), sourceCollector()];
}

/** Boots an application and mounts the reference on it, with the given collectors or with none. */
async function boot(
  collectors: readonly CollectorRegistration[] | null,
  withStream = true,
): Promise<string> {
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

  return await app.getUrl();
}

/** The two arms the older cases use: the bare mount, and one that produces every fact by hand. */
async function firstMinute(withCollectors: boolean): Promise<string> {
  return await boot(withCollectors ? [guardsCollector(), factsCollector] : null);
}

/**
 * Which of the four items the landing page's second list a page actually carries.
 *
 * EACH ONE IS LOOKED FOR AS A READER MEETS IT, not as a class name. The rate limit row is drawn
 * whatever happens, because the parity scale has a row per rule; what says whether a limit was
 * read is the runtime side of that row, so the check is for a figure there rather than for the
 * label, which is present either way.
 *
 * @param node - The served markup of the guarded operation's page
 * @returns One boolean per promised item
 */
function promisedItems(node: string): Readonly<Record<string, boolean>> {
  const rateRow = (/Rate limit([\s\S]{0,400}?)<\/div><\/div>/.exec(node)?.[1] ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ');

  return {
    guards: node.includes('OrdersGuard'),
    scopes: node.includes('orders:read'),
    // A FIGURE PER UNIT, WHICH IS HOW A READ LIMIT IS DRAWN, and not any digit: the first
    // version of this check tested for `\d` and matched the `429` inside the row's own
    // `no 429 response`, so it reported a rate limit on a page that says there is none.
    rateLimit: /\d+\s*\/\s*[a-z]/i.test(rateRow),
    errorContracts: node.includes('Internal Server Error'),
    sourceLink: node.includes('https://example.com/blob/main/'),
  };
}

/**
 * The id of the guarded operation, taken from the normalizer rather than transcribed.
 *
 * A HAND WRITTEN ID IS A SECOND SPELLING OF A RULE THIS PACKAGE DOES NOT OWN, and the first
 * version of this file had one: `read-order`, which is not what the normalizer produces, so
 * three cases fetched a 404 and asserted against the words on it.
 */
const GUARDED_NODE = 'get-orders-id';

/** The node page of the guarded operation, which is where every runtime row is drawn. */
async function pages(url: string): Promise<{ overview: string; node: string; bench: string }> {
  return {
    overview: await (await fetch(`${url}/docs`)).text(),
    node: await (await fetch(`${url}/docs/${GUARDED_NODE}`)).text(),
    bench: await (await fetch(`${url}/docs/bench/${GUARDED_NODE}`)).text(),
  };
}

/** The fixture that runs the first minute as its own process, and the built package it needs. */
const FIXTURE = fileURLToPath(new URL('../mocks/first-minute-app.mjs', import.meta.url));
const BUILT_PACKAGE = fileURLToPath(new URL('../../dist/index.js', import.meta.url));

describe('the first minute as its own process, which is the only place it could fail', () => {
  it(
    'should exit 0 and serve, where before the fix it exited 1 with no output',
    async () => {
      // NOT A SKIP WHEN THE BUILD IS MISSING, per `cli-binary.spec.ts`: a suite that skips itself
      // when the artefact is absent is green in the one run it exists to catch.
      expect(
        existsSync(BUILT_PACKAGE),
        `${BUILT_PACKAGE} is absent. Run "pnpm --filter @openref/nest run build" first`,
      ).toBe(true);

      // Given the whole of SPEC 2's first minute, in a child with a real exit code
      const child: ChildProcess & { stdout: Readable } = spawn(process.execPath, [FIXTURE], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      spawned = child;

      let stdout = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout += chunk;
      });

      const deadline = Date.now() + 60_000;
      for (;;) {
        if (stdout.startsWith('{')) break;
        expect(child.exitCode, `the first minute ended the process: ${stdout}`).toBeNull();
        if (Date.now() > deadline) throw new Error(`no address was printed: ${stdout}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // When
      const url = (JSON.parse(stdout.split('\n')[0] ?? '{}') as { url: string }).url;

      // Then
      expect((await fetch(`${url}/docs`)).status).toBe(200);
      expect(child.exitCode).toBeNull();
    },
    SPAWNED_PROCESS_TIMEOUT_MS,
  );
});

describe('the first minute, exactly as the landing page prints it', () => {
  it('should not end the process, which is the whole of the fix', async () => {
    // Given the one line on a default boot, with no forRoot anywhere
    const url = await firstMinute(false);

    // NOTE THAT THIS CASE CANNOT SEE THE DEFECT ON ITS OWN, which is why the spawned one above
    // exists. Inside a vitest worker the `process.exit(1)` that used to happen here does not end
    // the run, so with the fix reverted every case in this describe still passes. What these
    // cases are for is the content of the pages, and the exit code is the child's job.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect((await fetch(`${url}/docs`)).status).toBe(200);
  });

  it('should serve a reference with search, schemas and a console', async () => {
    // Given
    const url = await firstMinute(false);
    const { overview, node, bench } = await pages(url);

    // Then, item by item, in the order the landing page lists them
    expect(overview).toContain('<!DOCTYPE html>');
    expect(overview).toContain('oref-palette-open');
    expect((await fetch(`${url}/docs/_search-index`)).status).toBe(200);
    // Presence first: the page is the operation's page rather than the not found answer
    expect(node).toContain(GUARDED_NODE);
    expect(node).toContain('oref-section');
    expect(bench).toContain('Send');
    expect(bench).toContain(`/docs/bench/${GUARDED_NODE}`);
  });

  it('should mark a streaming endpoint, which the document alone can say', async () => {
    // Given
    const url = await boot(null);
    const stream = await (await fetch(`${url}/docs/get-orders-watch`)).text();

    // THE CLASS, AS A CLASS. This case used to read `overview.toLowerCase().includes('sse')`,
    // which is true of every page this product has ever served, because every page links
    // `/_assets/`: it proved that the page loads its assets.
    // Then
    const marked = /class="[^"]*\boref-method-sse\b[^"]*"/;
    expect(marked.test(stream)).toBe(true);

    // AND THE CONTROL IS A DOCUMENT WITHOUT A STREAM, not another page of the same document.
    // The marker rides the navigation as well as the operation, so every page of a document that
    // has a streaming endpoint carries it, and an ordinary operation's page is not the negative
    // it looks like. What discriminates is whether the document declares one at all.
    await running?.close();
    running = undefined;
    const plainUrl = await boot(null, false);
    const plain = await (await fetch(`${plainUrl}/docs/${GUARDED_NODE}`)).text();

    expect(plain).toContain(GUARDED_NODE);
    expect(marked.test(plain)).toBe(false);
  });

  it('should ask no other origin for anything', async () => {
    // Given
    const url = await firstMinute(false);
    const { overview, node, bench } = await pages(url);

    // Then, presence first: the page does carry asset references, and every one is local
    for (const page of [overview, node, bench]) {
      expect(/(?:src|href)="\/docs\/_assets\//.test(page)).toBe(true);
      expect(/(?:src|href)="(?:https?:)?\/\//.test(page)).toBe(false);
    }
  });

  it('should draw no runtime row until a collector produces one', async () => {
    // Given the same guarded controller, mounted with the one line and nothing else
    const url = await firstMinute(false);
    const { node } = await pages(url);

    // Then: the guard is standing in front of the route and the page says nothing about it,
    // because nothing was registered to read it
    expect(node).not.toContain('OrdersGuard');
    expect(node).not.toContain('orders:read');
    expect(node).not.toContain('oref-runtime');
    expect(node).not.toContain('OrdersController.readOrder');
  });

  it('should draw every one of those rows once forRoot carries the collectors', async () => {
    // Given the same controller and the same document, three lines further on
    const url = await firstMinute(true);
    const { node } = await pages(url);

    // Then
    expect(node).toContain('oref-runtime');
    expect(node).toContain('OrdersGuard');
    expect(node).toContain('orders:read');
    expect(node).toContain('OrdersController');
    expect(node).toContain('https://example.com/blob/main/src/orders.ts#L7');
  });
});

describe('the collector block the landing page prints, mapped to what it produces', () => {
  it('should produce guards, scopes and the source link, and neither of the other two', async () => {
    // Given exactly the three collectors the page prints, on a route that carries a guard,
    // a scope key and nothing a throttler or an error catalogue could be read from
    const url = await boot(printedBlock());

    // When
    const { node } = await pages(url);

    // Then, the whole mapping at once, so a change to either side has to move this line
    expect(promisedItems(node)).toEqual({
      guards: true,
      scopes: true,
      rateLimit: false,
      errorContracts: false,
      sourceLink: true,
    });
  });

  it('should say the rate limit was not read rather than leaving the row blank', async () => {
    // Given the same block
    const url = await boot(printedBlock());
    const { node } = await pages(url);

    // When: the runtime side of the rate limit row, as a reader reads it
    const row = /Rate limit([\s\S]{0,400}?)<\/div><\/div>/
      .exec(node)?.[1]
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Then: the wording the copy quotes, which is the parity scale reporting that the
    // comparison did not run, not a route that has no limit
    expect(row).toContain('not described');
    expect(row).toContain('no 429 response');
  });

  it('should add the error contracts once errorsCollector carries a catalogue', async () => {
    // Given the printed block plus the one collector the copy names as the extra cost
    const url = await boot([
      ...printedBlock(),
      errorsCollector({ global: [{ status: 500, title: 'Internal Server Error' }] }),
    ]);

    // When
    const { node } = await pages(url);

    // Then: exactly one item moved, which is what the table on the page claims
    expect(promisedItems(node)).toEqual({
      guards: true,
      scopes: true,
      rateLimit: false,
      errorContracts: true,
      sourceLink: true,
    });
  });

  it('should leave the rate limit to a collector this package does not ship', async () => {
    // Given the printed block plus the error collector, which is every producer of the four
    // that lives inside `@openref/nest`
    const url = await boot([
      ...printedBlock(),
      errorsCollector({ global: [{ status: 500, title: 'Internal Server Error' }] }),
    ]);
    const { node } = await pages(url);

    // Then: the one item nothing in this package can produce, which is why the copy sends a
    // reader to `@openref/collector-throttler`. The positive half is proved end to end by the
    // demo, whose parity block `readme-reproduction.spec.ts` holds against the served page.
    expect(promisedItems(node).rateLimit).toBe(false);
  });
});

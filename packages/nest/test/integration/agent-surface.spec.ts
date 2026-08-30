import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { REFUSED_BODY } from '../../src/visibility/domain/admission';
import { assetPlan, specification } from '../mocks/fixtures';

/**
 * The agent surface of SPEC 18.1 against a real NestJS application, on both adapters.
 *
 * WHAT ONLY THIS FILE CAN PROVE. SPEC 18 makes authentication mandatory when MCP is on, and the
 * mechanism is the guard of SPEC 19.6, which this package resolves and calls itself because the
 * routes of SPEC 13.3 are registered on the http adapter rather than on a controller. A unit test
 * over `ReferenceService` never meets the admission at all, so "the MCP endpoint is behind the
 * guard" can only be closed by driving a request at a listening server that has one.
 *
 * TWICE, BECAUSE THE TWO ADAPTERS WRITE A REPLY IN TWO DIFFERENT WAYS, which is the reason
 * `visibility-guard.spec.ts` states at length: a guard that ran on one and not the other would be
 * worse than no guard, because the promise would read as kept.
 *
 * THE NEGATIVE IS PROVED BEFORE THE POSITIVE. Every case that expects a refusal is paired with the
 * same request carrying the credential, so a refusal is never confused with an address that is not
 * there or a body the server could not read.
 */

const PLATFORMS = ['express', 'fastify'] as const;

/** The credential the fixture guard checks for, which exists only to be present or absent. */
const PASS = 'Bearer let-me-in';

@Controller('orders')
class OrdersController {
  @Get(':id')
  readOrder(): string {
    return 'an order';
  }
}

/** The guard a host writes, reading the framework's own request out of the context. */
@Injectable()
class BearerDocsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ headers?: Record<string, unknown> }>();

    return request.headers?.authorization === PASS;
  }
}

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/**
 * Boots an application, listening on a port the operating system picks.
 *
 * @param platform - Which adapter to boot on
 * @param moduleClass - The host module
 * @returns The base url
 */
async function boot(platform: (typeof PLATFORMS)[number], moduleClass: unknown): Promise<string> {
  const app =
    platform === 'fastify'
      ? await (async (): Promise<INestApplication> => {
          const { FastifyAdapter } = await import('@nestjs/platform-fastify');
          return NestFactory.create(moduleClass as never, new FastifyAdapter(), {
            logger: false,
            abortOnError: false,
          });
        })()
      : await NestFactory.create(moduleClass as never, { logger: false, abortOnError: false });

  running = app;
  await app.listen(0, '127.0.0.1');

  return app.getUrl();
}

/** One JSON-RPC call over the wire. */
async function rpc(
  url: string,
  method: string,
  headers: Record<string, string> = {},
  params: Record<string, unknown> = {},
): Promise<{ readonly status: number; readonly body: string }> {
  const response = await fetch(`${url}/docs/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

  return { status: response.status, body: await response.text() };
}

/**
 * The fixture document with one operation marked for internal eyes only beside a public one.
 *
 * BOTH ARE NEEDED AND THE PUBLIC ONE IS THE PRESENCE HALF. A surface that served nothing at all
 * would satisfy "the internal node is absent" while proving nothing about the filter.
 *
 * @returns The document
 */
function documentWithInternal(): Record<string, unknown> {
  const base = specification();
  const paths = base.paths as Record<string, unknown>;

  paths['/admin/impersonate'] = {
    post: {
      operationId: 'impersonate',
      summary: 'Act as another account',
      'x-openref-audience': 'internal',
      responses: { '204': { description: 'Done' } },
    },
  };

  return base;
}

for (const platform of PLATFORMS) {
  describe(`the agent surface on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            { id: 'public', route: '/docs', document: specification(), assetPlan: assetPlan() },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class DefaultModule {}

    it('should serve the two text files and refuse MCP on a default mount', async () => {
      // Given a mount that says nothing about the agent surface
      const url = await boot(platform, DefaultModule);

      // When
      const index = await fetch(`${url}/docs/llms.txt`);
      const full = await fetch(`${url}/docs/llms-full.txt`);
      const mcp = await rpc(url, 'tools/list');

      // Then, and the two text addresses really do answer, so the 403 below is a switch rather
      // than a route that is not there
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toContain('text/plain');
      expect(await index.text()).toContain('# Orders');
      expect(full.status).toBe(200);
      expect(mcp.status).toBe(403);
      expect(mcp.body).toContain('agent: { mcp: true }');
    });

    it('should answer a GET on the MCP address rather than reading it as a node id', async () => {
      // Given, without the GET registration this address falls through to `:nodeId` and answers
      // "no operation of that name is documented here", which is false about an address that
      // exists
      const url = await boot(platform, DefaultModule);

      // When
      const response = await fetch(`${url}/docs/mcp`);
      const body = await response.text();

      // Then
      expect(body).not.toContain('No operation of that name');
      expect(body).toContain('MCP endpoint');
    });
  });

  describe(`an MCP endpoint behind a guard on ${platform}`, () => {
    @Module({
      controllers: [OrdersController],
      providers: [BearerDocsGuard],
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'internal',
              route: '/docs',
              document: documentWithInternal(),
              assetPlan: assetPlan(),
              visibility: 'internal',
              guard: BearerDocsGuard,
              agent: { mcp: true },
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class GuardedModule {}

    it('should refuse an unauthenticated tools/list and answer an authenticated one', async () => {
      // Given
      const url = await boot(platform, GuardedModule);

      // When
      const anonymous = await rpc(url, 'tools/list');
      const credentialled = await rpc(url, 'tools/list', { authorization: PASS });

      // Then, the positive half proves the endpoint is really on, so the refusal is the guard
      // rather than a switched off surface or an unreadable body
      expect(anonymous.status).toBe(403);
      expect(anonymous.body).toBe(REFUSED_BODY);
      expect(credentialled.status).toBe(200);
      expect(credentialled.body).toContain('"tools"');
    });

    it('should withhold an internal node from both files, over the wire, on both surfaces', async () => {
      // Given the exact route the second blind review of `T058` took: a booted, guarded
      // application, and the internal operation read back through the MCP resource rather than
      // through the tool list that already withheld it
      const url = await boot(platform, GuardedModule);
      const auth = { authorization: PASS };

      // When, the two files fetched at their addresses and read as resources on one server
      const overHttp = await Promise.all(
        ['llms.txt', 'llms-full.txt'].map(async (file) =>
          (await fetch(`${url}/docs/${file}`, { headers: auth })).text(),
        ),
      );
      const overMcp = await Promise.all(
        ['openref://llms.txt', 'openref://llms-full.txt'].map(async (uri) => {
          const answer = await rpc(url, 'resources/read', auth, { uri });
          const parsed = JSON.parse(answer.body) as {
            result?: { contents?: { text?: string }[] };
          };
          return parsed.result?.contents?.[0]?.text ?? '';
        }),
      );
      const tools = await rpc(url, 'tools/list', auth);

      // Then, the public sibling is in all four and the internal one in none, and the two
      // surfaces serve the same bytes rather than two filtered spellings
      const named: readonly (readonly [string, string])[] = [
        ['http llms.txt', overHttp[0] ?? ''],
        ['http llms-full.txt', overHttp[1] ?? ''],
        ['mcp llms.txt', overMcp[0] ?? ''],
        ['mcp llms-full.txt', overMcp[1] ?? ''],
      ];
      expect(
        named.filter(([, text]) => !text.includes('get-orders-id')).map(([label]) => label),
      ).toEqual([]);
      expect(
        named.filter(([, text]) => text.includes('impersonate')).map(([label]) => label),
      ).toEqual([]);
      expect(overMcp).toEqual(overHttp);
      // And the tool list agreement the review found holding still holds
      expect(tools.body).toContain('get-orders-id');
      expect(tools.body).not.toContain('impersonate');
    });

    it('should reach the JSON-RPC parse error only under a type the framework leaves alone', async () => {
      // Given a malformed body sent twice, under the two content types. Recorded rather than
      // fixed, in the `T059` section of `ai-docs/BUILD-AMENDMENTS.md`: with `application/json`
      // the platform's own parser answers before any handler of this package runs, so the -32700
      // this package produces is reachable over the wire only under a type it does not parse.
      // `_proxy` has behaved this way since M2 and this address inherits it, which is the
      // property worth keeping; what it costs a reader is that one of the two 400s they can meet
      // is not this package's.
      const url = await boot(platform, GuardedModule);
      const send = async (contentType: string): Promise<{ status: number; body: string }> => {
        const response = await fetch(`${url}/docs/mcp`, {
          method: 'POST',
          headers: { 'content-type': contentType, authorization: PASS },
          body: '{ not json',
        });

        return { status: response.status, body: await response.text() };
      };

      // When
      const asJson = await send('application/json');
      const asText = await send('text/plain');

      // Then, both halves asserted: the platform answers one and this package answers the other
      expect(asJson.body).not.toContain('-32700');
      expect(asJson.status).toBeGreaterThanOrEqual(400);
      expect(asText.status).toBe(200);
      expect(asText.body).toContain('-32700');
      expect(asText.body).toContain('not JSON');
    });

    it('should refuse an unauthenticated llms.txt on the same mount', async () => {
      // Given, the two text files are not a second surface with a second policy: they are routes
      // of SPEC 13.3 and the admission stands in front of every one of them
      const url = await boot(platform, GuardedModule);

      // When
      const anonymous = await fetch(`${url}/docs/llms.txt`);
      const credentialled = await fetch(`${url}/docs/llms.txt`, {
        headers: { authorization: PASS },
      });

      // Then
      expect(anonymous.status).toBe(403);
      expect(await anonymous.text()).toBe(REFUSED_BODY);
      expect(credentialled.status).toBe(200);
    });
  });

  describe(`an MCP endpoint with no guard on ${platform}`, () => {
    it('should refuse before a module is even built, naming both halves', () => {
      // Given, SPEC 18 makes authentication mandatory when MCP is on, and the earliest moment to
      // say so is while `forRoot` is being evaluated: before the container exists, before a route
      // table exists, and therefore before a single request could reach an open endpoint.
      //
      // THE REFUSAL IS DRIVEN THROUGH `forRoot` RATHER THAN THROUGH A DECORATED CLASS ON PURPOSE.
      // A `@Module` whose `imports` array calls this evaluates at import time, so the same
      // refusal would take the whole file down before any case ran, which is itself the proof
      // that this happens early. Called here, the error is a value a case can read.
      const act = (): unknown =>
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'open',
              route: '/docs',
              document: specification(),
              assetPlan: assetPlan(),
              agent: { mcp: true },
            },
          ],
        });

      // Then
      expect(act).toThrow(/supplies no guard/);
    });

    it('should accept the same entry the moment a guard is written beside it', () => {
      // Given the presence half: the refusal above is about the guard and not about the shape of
      // the entry, so the identical entry with a guard has to be accepted
      const act = (): unknown =>
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'open',
              route: '/docs',
              document: specification(),
              assetPlan: assetPlan(),
              visibility: 'internal',
              guard: BearerDocsGuard,
              agent: { mcp: true },
            },
          ],
        });

      // Then
      expect(act).not.toThrow();
    });
  });
}

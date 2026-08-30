import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { assetPlan, specification } from '../mocks/fixtures';

/**
 * What the two body taking routes do with a body that is valid JSON and is not an object.
 *
 * THE DEFECT THIS FILE EXISTS FOR: A ROUTE THAT NEVER ANSWERS. Found by the blind review of
 * `T058`. `parsedBodyOf` classified a framework parsed body by its JavaScript type and answered
 * "nothing was parsed" for a number and for `null`, which sent `readRequestBody` to the socket;
 * the socket had already been drained by the framework's own parser, so `end` never fired again
 * and the promise never settled. The request hung until the client gave up, and the server kept
 * the connection, the handler closure and the pending promise for as long as it was held open.
 *
 * IT PREDATES `T058` AND `T058` GAVE IT A SECOND ADDRESS. `_proxy` of SPEC 14.5 has taken a body
 * since M2 and hangs on exactly the same input; `<route>/mcp` is the second route to take one. So
 * both addresses are driven here, on both adapters, which is four cases per body shape rather than
 * one: a fix in the shared reader that was only proved at one of them would be a fix nobody could
 * tell from a coincidence of that route's own handler.
 *
 * EVERY CASE CARRIES ITS OWN DEADLINE. A hang is not a failed assertion, it is the absence of one,
 * so the case has to turn the absence into a value: `AbortSignal.timeout` makes "never answered"
 * a rejection this file can assert about rather than a suite that dies on the runner's timeout.
 */

const PLATFORMS = ['express', 'fastify'] as const;

/** How long a route gets to answer before this file calls it a hang. */
const DEADLINE_MS = 2000;

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
});

/**
 * Boots an application whose reference has both body taking routes switched on.
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

/** What one request came back with, or the fact that it never did. */
interface Answer {
  readonly answered: boolean;
  readonly status: number;
}

/**
 * Sends one body to one address and refuses to wait forever for the answer.
 *
 * @param url - Base url of the running application
 * @param path - The address under the mount
 * @param body - The request body, exactly as bytes
 * @returns Whether it answered at all, and with what
 */
async function send(url: string, path: string, body: string): Promise<Answer> {
  try {
    const response = await fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(DEADLINE_MS),
    });
    await response.text();

    return { answered: true, status: response.status };
  } catch {
    return { answered: false, status: 0 };
  }
}

/** The bodies that parse as JSON and are not objects, which is the whole of the defect. */
const NON_OBJECT_BODIES: readonly { readonly label: string; readonly body: string }[] = [
  { label: 'a number', body: '42' },
  { label: 'the null literal', body: 'null' },
  { label: 'a boolean', body: 'true' },
  { label: 'a string', body: '"text"' },
  { label: 'an array', body: '[1,2]' },
];

for (const platform of PLATFORMS) {
  describe(`the body taking routes on ${platform}`, () => {
    @Module({
      imports: [
        OpenRefModule.forRoot({
          documents: [
            {
              id: 'public',
              route: '/docs',
              document: specification(),
              assetPlan: assetPlan(),
              agent: { mcp: false },
            },
          ],
        }),
      ],
    })
    // eslint-disable-next-line @typescript-eslint/no-extraneous-class
    class BodyModule {}

    it('should answer an ordinary object body, which is the presence half', async () => {
      // Given, without this the four cases below could pass on a server that answers nothing at
      // all, or on addresses that are not registered
      const url = await boot(platform, BodyModule);

      // When
      const proxy = await send(url, '/docs/_proxy', JSON.stringify({ method: 'GET', url: 'x' }));
      const mcp = await send(
        url,
        '/docs/mcp',
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      );

      // Then
      expect(proxy.answered).toBe(true);
      expect(mcp.answered).toBe(true);
    });

    for (const shape of NON_OBJECT_BODIES) {
      it(`should answer ${shape.label} at both body taking addresses rather than hanging`, async () => {
        // Given a body that is valid JSON and is not an object, which the framework's own parser
        // hands over as a JavaScript value the shared reader has to classify
        const url = await boot(platform, BodyModule);

        // When
        const proxy = await send(url, '/docs/_proxy', shape.body);
        const mcp = await send(url, '/docs/mcp', shape.body);

        // Then, answering with a refusal is correct and answering nothing is the defect: a route
        // that never answers holds a connection, a closure and a pending promise per request
        expect({ proxy: proxy.answered, mcp: mcp.answered }).toEqual({ proxy: true, mcp: true });
        expect(proxy.status).toBeGreaterThanOrEqual(400);
        expect(mcp.status).toBeGreaterThanOrEqual(200);
      });
    }
  });
}

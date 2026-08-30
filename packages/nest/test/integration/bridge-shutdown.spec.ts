import 'reflect-metadata';
import { afterEach, describe, expect, it } from 'vitest';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { CanActivate, INestApplication } from '@nestjs/common';
import { OpenRefModule } from '../../src/api/openref.module';
import { BRIDGE_SEGMENT } from '../../src/reference/domain/routes';
import { FakeSource } from '../mocks/bridge';
import { assetPlan, specification } from '../mocks/fixtures';

/**
 * The one thing `bridge-route.spec.ts` cannot prove: what happens to a stream nobody hung up.
 *
 * WHY IT IS A FILE OF ITS OWN AND NOT A CASE OVER THERE. Every case in that file closes its reader
 * before the hook that closes the application runs, which is what a well behaved case does and
 * which is exactly why none of them can see this. The defect it is aimed at is the reverse: NestJS
 * closes the http server between `onModuleDestroy` and `onApplicationShutdown`, so a subscription
 * ended in the later hook is ended after the server has already been asked to drain a connection
 * that never will. The first edition of this package ended them there, `app.close()` hung, and the
 * only thing that went red was another suite's own teardown timing out.
 *
 * SO THE READER IS DELIBERATELY LEFT OPEN, and two facts are measured against a wall clock: the
 * close returns promptly, and the reader receives the closing event rather than a dropped socket.
 * The wall clock is unavoidable here, since what is being measured is a hang; the bound is a hang
 * detector, and the paragraph on the constant says what it measured.
 */

/** How long `app.close()` may take before it is a hang. Measured: 3,004 ms with the hook, and the
 * probe that removed it did not return inside 8,001 ms. The bound sits between the two, far enough
 * above the reading to survive a slower machine and far enough below the failure to see it. */
const CLOSE_WITHIN_MS = 6_000;

/** The source the bridged mount subscribes through. */
const source = new FakeSource();

/** The guard the mount stands behind, since a bridge needs a visibility that is not public. */
@Injectable()
class AdmitGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

@Module({
  providers: [AdmitGuard],
  imports: [
    OpenRefModule.forRoot({
      documents: [
        {
          id: 'live',
          route: '/live',
          document: specification(),
          assetPlan: assetPlan(),
          visibility: 'internal',
          guard: AdmitGuard,
          bridge: { enabled: true, channels: ['orders.created'], source },
        },
      ],
    }),
  ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
class BridgedModule {}

let running: INestApplication | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  source.reset();
});

for (const platform of ['express', 'fastify'] as const) {
  describe(`shutting down with a bridge stream still open on ${platform}`, () => {
    it('should end the subscription before the server is asked to close, and tell the reader', async () => {
      // Given a reader that is still connected and is not going to hang up
      const app =
        platform === 'fastify'
          ? await (async (): Promise<INestApplication> => {
              const { FastifyAdapter } = await import('@nestjs/platform-fastify');
              return NestFactory.create(BridgedModule as never, new FastifyAdapter(), {
                logger: false,
                abortOnError: false,
              });
            })()
          : await NestFactory.create(BridgedModule as never, {
              logger: false,
              abortOnError: false,
            });
      running = app;
      await app.listen(0, '127.0.0.1');

      const url = await app.getUrl();
      const response = await fetch(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      const body = response.body;
      expect(body).not.toBeNull();
      if (body === null) throw new Error('the bridge answered without a body');

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const reading = (async (): Promise<void> => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return;
          text += decoder.decode(chunk.value, { stream: true });
        }
      })();

      // The subscription is asserted live first, so what is measured below is a release and not a
      // subscription that never happened
      const opened = Date.now() + 5_000;
      while (Date.now() < opened && !text.includes('event: open')) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(text).toContain('event: open');
      expect(source.live).toBe(true);

      // When, with nobody having hung up
      const started = Date.now();
      await app.close();
      const elapsed = Date.now() - started;
      running = undefined;

      // Then the close returned rather than waiting out a connection that would never drain
      expect(elapsed).toBeLessThan(CLOSE_WITHIN_MS);

      // And the reader was told, in the stream, why it stopped, rather than losing the socket
      await reading;
      expect(text).toContain('event: closed');
      expect(text).toContain('shutting down');
      expect(source.closed).toBe(1);
      expect(source.live).toBe(false);
    }, 60_000);
  });
}

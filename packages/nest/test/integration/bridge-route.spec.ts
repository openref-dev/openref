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
 * The bridge of SPEC 14.8 over real HTTP, on both adapters.
 *
 * WHAT ONLY THIS FILE CAN PROVE. `bridge-service.spec.ts` drives the limiter through a `Readable`
 * it holds itself, which is every rule and none of the plumbing. Here the response leaves a real
 * server, arrives at a real client, and the two things the plumbing decides are measured: that the
 * event stream is written incrementally rather than buffered until the end, and that a reader who
 * hangs up releases the broker subscription. The second is the one worth two adapters: Express is
 * piped by this package and Fastify pipes itself, so "the subscription goes when the reader goes"
 * is a different sentence on each and neither implies the other.
 *
 * NO BROKER IS INVOLVED, per SPEC 19.4. The source is the port a host implements and the case
 * hands messages to it by calling a function.
 */

const PLATFORMS = ['express', 'fastify'] as const;

/**
 * Sources, one per mount, so a case can see which subscription was closed.
 *
 * THEY ARE RESET IN PLACE AND NEVER REPLACED, per the note on `FakeSource.reset`: the module below
 * captures these objects when it is declared, so a fresh instance between cases would leave the
 * mount holding the old one and every `emit` going nowhere.
 */
const sources = {
  live: new FakeSource(),
  tight: new FakeSource(),
  refusing: new FakeSource(),
  ending: new FakeSource(),
};

/** The guard the bridged mounts stand behind, since a bridge needs a visibility that is not public. */
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
        // The public mount, which is the negative half: the route exists here too and says off.
        { id: 'public', route: '/docs', document: specification(), assetPlan: assetPlan() },
        {
          id: 'live',
          route: '/live',
          document: specification(),
          assetPlan: assetPlan(),
          visibility: 'internal',
          guard: AdmitGuard,
          bridge: {
            enabled: true,
            channels: ['orders.created'],
            source: sources.live,
            maxConcurrentSubscriptions: 2,
          },
        },
        {
          id: 'tight',
          route: '/tight',
          document: specification(),
          assetPlan: assetPlan(),
          visibility: 'internal',
          guard: AdmitGuard,
          bridge: {
            enabled: true,
            channels: ['orders.created'],
            source: sources.tight,
            maxMessagesPerSecond: 1,
            bufferSize: 2,
            onOverflow: 'drop-oldest',
          },
        },
        // The other two overflow modes, each on its own mount, because the mode is a mount level
        // choice and driving all three over one address would prove only that one of them works.
        {
          id: 'refusing',
          route: '/refusing',
          document: specification(),
          assetPlan: assetPlan(),
          visibility: 'internal',
          guard: AdmitGuard,
          bridge: {
            enabled: true,
            channels: ['orders.created'],
            source: sources.refusing,
            maxMessagesPerSecond: 1,
            bufferSize: 2,
            onOverflow: 'drop-new',
          },
        },
        {
          id: 'ending',
          route: '/ending',
          document: specification(),
          assetPlan: assetPlan(),
          visibility: 'internal',
          guard: AdmitGuard,
          bridge: {
            enabled: true,
            channels: ['orders.created'],
            source: sources.ending,
            maxMessagesPerSecond: 1,
            bufferSize: 1,
            onOverflow: 'disconnect',
          },
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
  for (const source of Object.values(sources)) source.reset();
});

/**
 * Boots the module on one adapter.
 *
 * @param platform - Which adapter
 * @returns The base url
 */
async function boot(platform: (typeof PLATFORMS)[number]): Promise<string> {
  const app =
    platform === 'fastify'
      ? await (async (): Promise<INestApplication> => {
          const { FastifyAdapter } = await import('@nestjs/platform-fastify');
          return NestFactory.create(BridgedModule as never, new FastifyAdapter(), {
            logger: false,
            abortOnError: false,
          });
        })()
      : await NestFactory.create(BridgedModule as never, { logger: false, abortOnError: false });

  running = app;
  await app.listen(0, '127.0.0.1');

  return app.getUrl();
}

/** A live subscription, as a case reads it. */
interface OpenStream {
  /** Everything received so far. */
  text(): string;
  /** Waits until the text satisfies a predicate, or gives up. */
  until(predicate: (text: string) => boolean, ms: number): Promise<boolean>;
  /** Hangs up, the way a reader closing a tab does. */
  hangUp(): void;
}

/**
 * Opens one event stream and reads it in the background.
 *
 * READING IS INCREMENTAL AND NEVER `await response.text()`, which would be the whole point missed:
 * a stream that never ends has no text to await, and a case that awaited one would hang rather
 * than fail.
 *
 * @param url - The address to open
 * @returns The stream, and the response status and headers it opened with
 */
async function openStream(
  url: string,
): Promise<{ readonly status: number; readonly contentType: string; readonly stream: OpenStream }> {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  let text = '';

  const body = response.body;
  if (body !== null) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    void (async (): Promise<void> => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        text += decoder.decode(chunk.value, { stream: true });
      }
    })().catch(() => undefined);
  }

  return {
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    stream: {
      text: (): string => text,
      until: async (predicate, ms): Promise<boolean> => {
        const deadline = Date.now() + ms;
        while (Date.now() < deadline) {
          if (predicate(text)) return true;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }

        return predicate(text);
      },
      hangUp: (): void => {
        controller.abort();
      },
    },
  };
}

for (const platform of PLATFORMS) {
  describe(`the broker bridge on ${platform}`, () => {
    it('should answer 403 with the reason on a mount whose bridge is off', async () => {
      // Given, the `_proxy` precedent: the route is registered on every mount so that off and
      // absent stay distinguishable, which cannot be shown without asking a mount that has one on
      const url = await boot(platform);

      // When
      const off = await fetch(`${url}/docs/${BRIDGE_SEGMENT}?channel=orders.created`);
      const on = await openStream(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      on.stream.hangUp();

      // Then
      expect(off.status).toBe(403);
      expect(((await off.json()) as { error: string }).error).toMatch(
        /not enabled on this reference/,
      );
      expect(off.headers.get('cache-control')).toBe('no-store');
      expect(on.status).toBe(200);
    }, 30_000);

    it('should open an event stream and carry a message the source hands over', async () => {
      // Given
      const url = await boot(platform);

      // When
      const opened = await openStream(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      const announced = await opened.stream.until((text) => text.includes('event: open'), 5_000);
      sources.live.emit('{"orderId":"ord_1"}', 'offset-7');
      const carried = await opened.stream.until((text) => text.includes('ord_1'), 5_000);
      opened.stream.hangUp();

      // Then, the open reaches the reader before the broker says anything, which is what makes a
      // quiet channel distinguishable from a server that never answered
      expect(opened.status).toBe(200);
      expect(opened.contentType).toBe('text/event-stream; charset=utf-8');
      expect(announced).toBe(true);
      expect(carried).toBe(true);
      expect(opened.stream.text()).toContain('id: offset-7');
      expect(opened.stream.text()).toContain('event: message');
    }, 30_000);

    it('should tell the reader how many messages it lost, in the stream the reader is watching', async () => {
      // Given, a bridge whose ring holds two and whose drain is one a second, so a burst of ten
      // cannot fit and the loss is certain rather than probable
      const url = await boot(platform);
      const opened = await openStream(`${url}/tight/${BRIDGE_SEGMENT}?channel=orders.created`);
      await opened.stream.until((text) => text.includes('event: open'), 5_000);

      // When
      for (let index = 0; index < 10; index += 1) {
        sources.tight.emit(`{"n":${String(index)}}`);
      }
      const told = await opened.stream.until((text) => text.includes('event: dropped'), 10_000);
      opened.stream.hangUp();

      // Then, and the notice carries the number rather than the bare fact
      expect(told).toBe(true);
      expect(opened.stream.text()).toMatch(/event: dropped\ndata: \{"dropped":[1-9]/);
      expect(opened.stream.text()).toContain('"mode":"drop-oldest"');
    }, 30_000);

    it('should release the broker subscription when the reader hangs up', async () => {
      // Given, the subscription asserted live first, so its absence later is a release and not a
      // subscription that never happened
      const url = await boot(platform);
      const opened = await openStream(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      await opened.stream.until((text) => text.includes('event: open'), 5_000);
      expect(sources.live.live).toBe(true);
      expect(sources.live.closed).toBe(0);

      // When
      opened.stream.hangUp();

      // Then, within a bound far under the three hundred second connection ceiling, which is what
      // would otherwise eventually clean this up and is not what is being measured
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && sources.live.closed === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(sources.live.closed).toBe(1);
      expect(sources.live.live).toBe(false);
    }, 30_000);

    it('should refuse a request that named no channel, and one that named a channel nobody may hear', async () => {
      // Given
      const url = await boot(platform);

      // When
      const nameless = await fetch(`${url}/live/${BRIDGE_SEGMENT}`);
      const uninvited = await fetch(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.deleted`);

      // Then, and the source was never asked for either
      expect([nameless.status, uninvited.status]).toEqual([400, 403]);
      expect(((await nameless.json()) as { error: string }).error).toMatch(/\?channel=/);
      expect(((await uninvited.json()) as { error: string }).error).toMatch(/allowlist/);
      expect(sources.live.subscribed).toEqual([]);
    }, 30_000);

    it('should refuse the newest under drop-new, and say so to the reader', async () => {
      // Given, the same traffic the drop-oldest case sends, against the other mode, so the two
      // are a pair over the wire and not one mode with a second name
      const url = await boot(platform);
      const opened = await openStream(`${url}/refusing/${BRIDGE_SEGMENT}?channel=orders.created`);
      await opened.stream.until((text) => text.includes('event: open'), 5_000);

      // When
      for (let index = 0; index < 20; index += 1) {
        sources.refusing.emit(`{"n":${String(index)}}`);
      }
      const told = await opened.stream.until((text) => text.includes('event: dropped'), 10_000);
      opened.stream.hangUp();

      // Then, the notice names this mode and not the other one, which is what makes the pair
      // discriminate rather than merely both pass
      expect(told).toBe(true);
      expect(opened.stream.text()).toContain('"mode":"drop-new"');
      expect(opened.stream.text()).not.toContain('drop-oldest');
      expect(opened.stream.text()).toMatch(/"dropped":1[0-9],"total":1[0-9]/);

      // And the messages that did reach the reader are the oldest, which is what drop-new means
      expect(opened.stream.text()).toContain('{"n":0}');
      expect(opened.stream.text()).not.toContain('{"n":19}');
    }, 30_000);

    it('should end the stream under disconnect, with the reason and the count before the close', async () => {
      // Given, a ring of one on a drain of one a second, so the third message cannot fit
      const url = await boot(platform);
      const opened = await openStream(`${url}/ending/${BRIDGE_SEGMENT}?channel=orders.created`);
      await opened.stream.until((text) => text.includes('event: open'), 5_000);

      // When
      sources.ending.emit('{"n":0}');
      sources.ending.emit('{"n":1}');
      sources.ending.emit('{"n":2}');
      const ended = await opened.stream.until((text) => text.includes('event: closed'), 10_000);

      // Then, the indicator fires in this mode too: the reader is told why the stream stopped and
      // how many messages it never got, rather than seeing a socket that simply went quiet
      expect(ended).toBe(true);
      expect(opened.stream.text()).toContain('onOverflow: disconnect');
      expect(opened.stream.text()).toContain('"dropped":2');
      expect(opened.stream.text()).toContain('"delivered":1');

      // And the subscription really went, rather than the reader merely being told it had
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && sources.ending.closed === 0) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(sources.ending.closed).toBe(1);
      opened.stream.hangUp();
    }, 30_000);

    it('should refuse the subscription past the concurrency ceiling with a 429', async () => {
      // Given, a mount that serves two at once, with both taken
      const url = await boot(platform);
      const first = await openStream(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      const second = await openStream(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      await first.stream.until((text) => text.includes('event: open'), 5_000);
      await second.stream.until((text) => text.includes('event: open'), 5_000);

      // When
      const third = await fetch(`${url}/live/${BRIDGE_SEGMENT}?channel=orders.created`);
      const body = (await third.json()) as { error: string };
      first.stream.hangUp();
      second.stream.hangUp();

      // Then, with both openings asserted successful first, so the refusal is a ceiling and not a
      // bridge that stopped working
      expect([first.status, second.status]).toEqual([200, 200]);
      expect(third.status).toBe(429);
      expect(body.error).toMatch(/serves 2 subscriptions at once and 2 are open/);
    }, 30_000);
  });
}

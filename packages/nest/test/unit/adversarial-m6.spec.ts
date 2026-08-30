/**
 * What `T059` broke in the broker bridge, and what it proved could not be broken.
 *
 * TWO CEILINGS WERE WRONG IN OPPOSITE DIRECTIONS. One bounded the wrong thing: `bufferSize` counts
 * entries, so 200 messages of a megabyte against a ring of fifty left `buffered: 50`, which is
 * 50.0 MB retained where the byte ceiling retains 1.0 MB, and SPEC 14.8's own claim that memory is
 * flat under any producer was true of the counter and false of the payload. THE QUANTITY IS
 * RETENTION AND NOT RSS: the same workload reads between 351 and 403 MB of RSS on unchanged code,
 * because RSS counts allocation not yet collected, so the cases below assert `buffered` and the
 * conservation law rather than a memory reading. The other bounded nothing: `maxConnectionSeconds` above the
 * 32-bit millisecond ceiling of `setTimeout` fires at once, so a host asking for a longer ceiling
 * got a subscription that closed on its first millisecond claiming it had reached one.
 *
 * NOTHING HERE OPENS A SOCKET OR SUBSCRIBES TO A BROKER. The source is a double that hands back its
 * own sink, so a hostile producer is a loop rather than a network.
 */

import { describe, expect, it } from 'vitest';
import { BridgeService } from '../../src/bridge/application/services/bridge.service';
import {
  assertBridgeOptions,
  MAX_BRIDGE_CONNECTION_SECONDS,
} from '../../src/bridge/domain/bridge-options';
import type {
  BridgeMessage,
  IBridgeSource,
} from '../../src/bridge/application/ports/bridge-source.port';

const CHANNEL = 'orders.created';

/** Open and abandon rounds, the figure the blind review drove by hand. */
const ROUNDS = 2000;

/** A source that keeps the sink it was handed, so a case can play the broker. */
function producer(): { readonly source: IBridgeSource; deliver: (message: BridgeMessage) => void } {
  let sink: ((message: BridgeMessage) => void) | undefined;

  return {
    source: {
      subscribe: (_channel, deliver) => {
        sink = deliver;

        return Promise.resolve({ close: (): void => undefined });
      },
    },
    deliver: (message): void => {
      sink?.(message);
    },
  };
}

/** One megabyte of a distinct byte, so 200 of them are 200 allocations and not 200 references. */
function megabyte(index: number): string {
  return Buffer.alloc(1024 * 1024, 97 + (index % 26)).toString('latin1');
}

describe('the bridge ring against a producer of large messages, per SPEC 14.8 and T059', () => {
  it('should hold the byte ceiling rather than the entry ceiling when the payloads are large', async () => {
    // Given a ring of fifty entries with the default byte ceiling and a reader that never reads
    const { source, deliver } = producer();
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      bufferSize: 50,
      maxMessagesPerSecond: 1,
      source,
    });
    const opened = await service.open(CHANNEL);
    const session = opened.session;
    expect(session).toBeDefined();

    // When two hundred megabyte messages arrive
    for (let index = 0; index < 200; index += 1) deliver({ data: megabyte(index) });

    // Then the ring holds one message rather than fifty, because one megabyte is the whole ceiling,
    // and the reader is told about every one that went. Measured before the fix: fifty buffered,
    // which is 50.0 MB retained against the 1.0 MB retained here, a difference of 49.0 MB.
    const counts = session?.counts();
    expect(counts?.received).toBe(200);
    expect(counts?.buffered).toBeLessThanOrEqual(1);
    expect((counts?.delivered ?? 0) + (counts?.dropped ?? 0) + (counts?.buffered ?? 0)).toBe(200);

    session?.close('done');
  });

  it('should keep filling the entry ceiling when the payloads are small, which is the control', async () => {
    // Given the same ring and messages small enough that the byte ceiling cannot be the one firing
    const { source, deliver } = producer();
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      bufferSize: 50,
      maxMessagesPerSecond: 1,
      source,
    });
    const opened = await service.open(CHANNEL);

    // When
    for (let index = 0; index < 200; index += 1) deliver({ data: 'x' });

    // Then the entry ceiling is the one that bound it, so the case above measured the byte one
    expect(opened.session?.counts().buffered).toBe(50);

    opened.session?.close('done');
  });

  it('should lose a message larger than the whole ceiling without emptying the ring for it', async () => {
    // Given a ring already holding something a reader has not seen
    const { source, deliver } = producer();
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      bufferSize: 50,
      maxBufferedBytes: 1024,
      maxMessagesPerSecond: 1,
      source,
    });
    const opened = await service.open(CHANNEL);
    for (let index = 0; index < 5; index += 1) deliver({ data: 'small' });
    const held = opened.session?.counts().buffered ?? 0;
    expect(held).toBeGreaterThan(0);

    // When one message arrives that could not fit even in an empty ring
    deliver({ data: 'y'.repeat(4096) });

    // Then it is the only thing lost: evicting the reader's data for a value that still would not
    // fit destroys what was there for nothing
    expect(opened.session?.counts().buffered).toBe(held);
    expect(opened.session?.counts().dropped).toBe(1);

    opened.session?.close('done');
  });

  it('should count every entry a large message evicted rather than counting one per push', async () => {
    // Given a ring whose byte ceiling holds several small messages and not one larger one
    const { source, deliver } = producer();
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      bufferSize: 50,
      maxBufferedBytes: 100,
      maxMessagesPerSecond: 1,
      source,
    });
    const opened = await service.open(CHANNEL);
    for (let index = 0; index < 9; index += 1) deliver({ data: 'x'.repeat(10) });
    const before = opened.session?.counts();
    expect(before?.dropped).toBe(0);
    expect(before?.buffered ?? 0).toBeGreaterThan(2);

    // When one message arrives that needs most of the ceiling
    deliver({ data: 'y'.repeat(90) });

    // Then more than one entry went for it, which is the number the caller used to assume was one,
    // and the debit still balances exactly
    const counts = opened.session?.counts();
    expect(counts?.dropped ?? 0).toBeGreaterThan(1);
    expect((counts?.delivered ?? 0) + (counts?.dropped ?? 0) + (counts?.buffered ?? 0)).toBe(
      counts?.received,
    );

    opened.session?.close('done');
  });
});

describe('the two attack clauses T059 names by hand, per SPEC 14.8', () => {
  it('should refuse a single hundred megabyte payload without disturbing what the ring holds', async () => {
    // Given a ring already holding messages a reader has not seen, and the literal payload size the
    // task's attack list names: "a message payload of 100 MB on a channel with a small buffer"
    const { source, deliver } = producer();
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      bufferSize: 50,
      maxMessagesPerSecond: 1,
      source,
    });
    const opened = await service.open(CHANNEL);
    for (let index = 0; index < 5; index += 1) deliver({ data: 'small' });
    const held = opened.session?.counts().buffered ?? 0;
    expect(held).toBeGreaterThan(0);

    // When one message arrives that is a hundred times the whole default ceiling
    deliver({ data: 'z'.repeat(100 * 1024 * 1024) });

    // Then it is the only thing lost, the ring is untouched, and the debit balances. A ring that
    // evicted for it would have destroyed the reader's data for a value that still would not fit.
    const counts = opened.session?.counts();
    expect(counts?.buffered).toBe(held);
    expect(counts?.dropped).toBe(1);
    expect((counts?.delivered ?? 0) + (counts?.dropped ?? 0) + (counts?.buffered ?? 0)).toBe(
      counts?.received,
    );

    opened.session?.close('done');
  });

  it('should release the source and every timer across two thousand open and abandon cycles', async () => {
    // Given a subscriber that opens and drops connections without ever reading, which is the
    // task's second attack clause: the cleanup `maxConnectionSeconds` exists for
    let closes = 0;
    let armed = 0;
    let cleared = 0;
    const source: IBridgeSource = {
      subscribe: () =>
        Promise.resolve({
          close: (): void => {
            closes += 1;
          },
        }),
    };
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      maxConcurrentSubscriptions: 1,
      source,
      setTimer: (): unknown => {
        armed += 1;
        return armed;
      },
      clearTimer: (): void => {
        cleared += 1;
      },
    });

    // When
    const before = process.memoryUsage().heapUsed;
    for (let round = 0; round < ROUNDS; round += 1) {
      const opened = await service.open(CHANNEL);
      expect(opened.session).toBeDefined();
      const stream = opened.session?.stream;
      // AWAITED RATHER THAN FIRED AND FORGOTTEN, because `destroy` emits `close` on a later tick
      // and the release rides that event. A loop that did not wait would meet its own previous
      // round at the concurrency ceiling, which is a fact about this loop and not about the bridge.
      await new Promise<void>((resolve) => {
        stream?.on('close', () => {
          resolve();
        });
        stream?.destroy();
      });
    }
    const after = process.memoryUsage().heapUsed;

    // Then every subscription went back to the host, the mount is idle rather than saturated at its
    // ceiling of one, and no timer is left armed. The ceiling itself is the timer each round arms,
    // so armed and cleared agree round for round.
    expect(closes).toBe(ROUNDS);
    expect(service.liveSubscriptions).toBe(0);
    expect(armed).toBe(ROUNDS);
    // EQUALITY RATHER THAN A FLOOR, on the second blind review's finding that the exact figure
    // holds and was available: each round arms exactly one timer, the connection ceiling, and
    // clears exactly that one when the reader's stream closes. A floor here would pass a bridge
    // that cleared a timer twice or cleared one it never armed.
    expect(cleared).toBe(ROUNDS);
    // The heap bound is generous on purpose: what is under test is that nothing accumulates per
    // round, and a tight number here would be a case tuned against a garbage collector.
    expect(after - before).toBeLessThan(16 * 1024 * 1024);

    // And the control, so the ceiling really was reachable rather than never approached
    const reopened = await service.open(CHANNEL);
    expect(reopened.session).toBeDefined();
    reopened.session?.close('done');
  });
});

describe('the bridge ceilings against values a timer cannot hold, per SPEC 14.8 and T059', () => {
  it('should refuse a maxConnectionSeconds past the 32-bit millisecond ceiling of setTimeout', () => {
    // Given one second past the largest delay a timer holds
    const refuse = (): void => {
      assertBridgeOptions('a mount', {
        enabled: true,
        channels: [CHANNEL],
        maxConnectionSeconds: MAX_BRIDGE_CONNECTION_SECONDS + 1,
        source: { subscribe: () => ({ close: (): void => undefined }) },
      });
    };

    // Then it is refused at construction with the reason, rather than accepted and fired at once.
    // Measured before the fix: the subscription closed on its first millisecond saying it had
    // reached its ceiling of 2147484 seconds.
    expect(refuse).toThrow(/fires immediately/);
  });

  it('should accept the largest value a timer does hold, which is what makes the refusal a boundary', () => {
    // Given the control one second below
    const accept = (): void => {
      assertBridgeOptions('a mount', {
        enabled: true,
        channels: [CHANNEL],
        maxConnectionSeconds: MAX_BRIDGE_CONNECTION_SECONDS,
        source: { subscribe: () => ({ close: (): void => undefined }) },
      });
    };

    // Then
    expect(accept).not.toThrow();
  });

  it('should refuse a byte ceiling that is not a whole number of at least one', () => {
    // Given the same rule the entry ceiling already had, on the ceiling this task added
    for (const value of [0, -1, 1.5, Number.NaN]) {
      const refuse = (): void => {
        assertBridgeOptions('a mount', { maxBufferedBytes: value });
      };

      // Then
      expect(refuse).toThrow(/maxBufferedBytes/);
    }
  });
});

describe('the bridge allowlist against hostile channel names, per SPEC 14.8', () => {
  it('should admit the exact name and refuse every neighbouring spelling of it', async () => {
    // Given
    const { source } = producer();
    const service = new BridgeService('test', {
      enabled: true,
      channels: [CHANNEL],
      source,
    });

    // Then the presence half first: the name the host wrote does open
    const admitted = await service.open(CHANNEL);
    expect(admitted.session).toBeDefined();
    admitted.session?.close('done');

    for (const name of [
      `${CHANNEL} `,
      CHANNEL.toUpperCase(),
      `${CHANNEL}\n`,
      `../${CHANNEL}`,
      `${CHANNEL}\u0000`,
      `${CHANNEL}%00`,
    ]) {
      // When
      const refused = await service.open(name);

      // Then
      expect(refused.refused?.status).toBe(403);
      expect(refused.session).toBeUndefined();
    }
  });
});

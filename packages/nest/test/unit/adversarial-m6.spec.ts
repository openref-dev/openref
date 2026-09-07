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

import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { BridgeSession } from '../../src/bridge/application/services/bridge.service';
import { BridgeService } from '../../src/bridge/application/services/bridge.service';
import {
  assertBridgeOptions,
  MAX_BRIDGE_CONNECTION_SECONDS,
  resolveBridgeOptions,
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

/** The options the abandon loop runs under, written once so the ceiling can be derived from them. */
const ABANDON_OPTIONS = {
  enabled: true,
  channels: [CHANNEL],
  maxConcurrentSubscriptions: 1,
} as const;

/**
 * Bytes the abandon loop may retain, derived from the cheapest form of the leak it exists to catch.
 *
 * THE FIGURE THAT STOOD HERE WAS 16 MiB ON A QUANTITY THAT IS NOT RETENTION, and this file's own
 * header is what condemns it: "RSS counts allocation not yet collected, so the cases below assert
 * `buffered` and the conservation law rather than a memory reading". A `heapUsed` delta taken with
 * no collection in between is that same quantity one heap in, and it was measured across the two
 * Node versions `ci.yml` runs: byte identical code read 4,320,800 on 22.22.2 and 14,367,368 on
 * 24.14.1, and 6,072,624 against 14,328,064 on one machine with only `--max-semi-space-size`
 * moved from 8 to 16. Nothing about the bridge is in that spread.
 *
 * WHAT MADE IT A DEFECT RATHER THAN AN IMPRECISION IS THAT THE OLD NUMBER COULD NOT SEE THE LEAK.
 * Measured by deleting `this.sessions.delete(session)` from `release`, which is the one line shape
 * of a bridge that hands its slot back and keeps the session: every other assertion in this case
 * still passed, because the counters are all correct, and the reading rose only from 14,303,608 to
 * 15,263,984 and stayed green under 16,777,216. Two thousand retained sessions weigh 12.5 MB and
 * the bound was 16, so the guarantee this file exists for was worth nothing at exactly the size it
 * was written for.
 *
 * THE DERIVATION. A retained session retains its ring, and `MessageRing` allocates its slots once
 * and holds them for the life of the ring, so a bridge that kept one session per round holds at
 * least `ROUNDS` times `bufferSize` slots. The loop sets no `bufferSize`, so the ring is the
 * default and the figure is read back off the resolved options rather than restated. A slot is one
 * pointer, four bytes under V8's pointer compression and eight without, so the ceiling below is
 * ONE byte per slot the leak would hold: a quarter of the cheapest form of it, and 2000 times 500
 * is 1,000,000 bytes.
 *
 * BOTH HALVES ARE MEASURED AND THE SECOND IS A CASE OF ITS OWN. Released, six samples per run:
 * 12,496 to 365,808 bytes on Node 24.14.1 and 33,056 to 231,344 on 22.22.2, so the ceiling clears
 * the honest loop by at least 2.7 times. Held, which is the control below: 12,445,088 to
 * 12,520,496, so a leak clears the ceiling by 12.4 times. The band between them is two orders of
 * magnitude wide, which is what a leak detector should look like and what a garbage reading can
 * never be.
 */
const RETAINED_BYTES_CEILING = ROUNDS * resolveBridgeOptions(ABANDON_OPTIONS).bufferSize;

/**
 * A collection on demand, or nothing when this runtime will not give one.
 *
 * ASKED FOR RATHER THAN WAITED FOR, which is the method `bridge-soak.spec.ts` already records:
 * "`heapUsed` sawtooths between collections, so a single reading says as much about when the last
 * collection ran as about what is retained". The soak takes a window minimum where no collection
 * is available; that substitute needs hundreds of samples across millions of messages and this
 * loop is two thousand rounds long, so here the collection is obtained instead. `globalThis.gc`
 * comes first, so a runner launched with `--expose-gc` is used as it stands and nothing is set
 * twice; the V8 flag is the fallback and is the only reason this case does not need a launch flag.
 *
 * @returns The collector, or null when neither route yields one
 */
function collector(): (() => void) | null {
  const exposed = (globalThis as { gc?: () => void }).gc;
  if (exposed !== undefined) return exposed;

  try {
    setFlagsFromString('--expose-gc');
    const asked: unknown = runInNewContext('gc');

    return typeof asked === 'function' ? (asked as () => void) : null;
  } catch {
    return null;
  }
}

const collect = collector();

/** What one abandon loop retained, and what its counters said while it ran. */
interface AbandonRun {
  /** Heap retained across the loop, both readings taken after a collection. */
  readonly retained: number;
  /** Subscriptions handed back to the host. */
  readonly closes: number;
  /** Timers armed, one per round, which is the connection ceiling. */
  readonly armed: number;
  /** Timers cleared. */
  readonly cleared: number;
  /** The service the loop ran against, so a case can ask it what is still open. */
  readonly service: BridgeService;
}

/**
 * Opens and abandons `ROUNDS` subscriptions, measuring what the heap kept.
 *
 * @param kept - Where to put each session, which stands in for anything that holds one, or null
 *   for the honest case where nothing does
 * @returns The retained bytes and the three counters
 * @throws Error when this runtime gives no collection, because a reading taken without one
 *   measures garbage rather than retention and an undetermined check is not a passing one
 */
async function openAndAbandon(kept: BridgeSession[] | null): Promise<AbandonRun> {
  if (collect === null) {
    throw new Error(
      'no collection is available on this runtime, through globalThis.gc or through the V8 ' +
        'flag, so what this loop retains cannot be told apart from what it merely allocated',
    );
  }

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
    ...ABANDON_OPTIONS,
    source,
    setTimer: (): unknown => {
      armed += 1;

      return armed;
    },
    clearTimer: (): void => {
      cleared += 1;
    },
  });

  // TWICE, BECAUSE ONE PASS LEAVES WHAT IT FREED FOR THE NEXT ONE TO NOTICE, and both readings are
  // taken the same way so that the difference is a difference of live sets and not of methods.
  collect();
  collect();
  const before = process.memoryUsage().heapUsed;

  for (let round = 0; round < ROUNDS; round += 1) {
    const opened = await service.open(CHANNEL);
    expect(opened.session).toBeDefined();
    const session = opened.session;
    if (kept !== null && session !== undefined) kept.push(session);
    // AWAITED RATHER THAN FIRED AND FORGOTTEN, because `destroy` emits `close` on a later tick
    // and the release rides that event. A loop that did not wait would meet its own previous
    // round at the concurrency ceiling, which is a fact about this loop and not about the bridge.
    await new Promise<void>((resolve) => {
      session?.stream.on('close', () => {
        resolve();
      });
      session?.stream.destroy();
    });
  }

  collect();
  collect();
  const after = process.memoryUsage().heapUsed;

  return { retained: after - before, closes, armed, cleared, service };
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
    // When
    const run = await openAndAbandon(null);

    // Then every subscription went back to the host, the mount is idle rather than saturated at its
    // ceiling of one, and no timer is left armed. The ceiling itself is the timer each round arms,
    // so armed and cleared agree round for round.
    expect(run.closes).toBe(ROUNDS);
    expect(run.service.liveSubscriptions).toBe(0);
    expect(run.armed).toBe(ROUNDS);
    // EQUALITY RATHER THAN A FLOOR, on the second blind review's finding that the exact figure
    // holds and was available: each round arms exactly one timer, the connection ceiling, and
    // clears exactly that one when the reader's stream closes. A floor here would pass a bridge
    // that cleared a timer twice or cleared one it never armed.
    expect(run.cleared).toBe(ROUNDS);
    // And nothing accumulated per round, which is the one thing here no counter can say: a session
    // held by anything the counters do not go through leaves all four of them correct. Both
    // readings are taken after a collection, so this is the live set and not the garbage beside
    // it, and the ceiling is derived above from what a retained session cannot weigh less than.
    expect(run.retained).toBeLessThan(RETAINED_BYTES_CEILING);

    // And the control, so the ceiling really was reachable rather than never approached
    const reopened = await run.service.open(CHANNEL);
    expect(reopened.session).toBeDefined();
    reopened.session?.close('done');
  });

  it('should see a retained session, so the reading above is an absence and not a blind instrument', async () => {
    // Given the same two thousand rounds with every session held, which is what a bridge that
    // released its slot and kept the session would leave behind. IT IS THE SHAPE OF A REAL DEFECT
    // AND NOT A CONTRIVANCE: deleting `this.sessions.delete(session)` from `release` produces
    // exactly this, and it is the only failure in this file that no counter can see, since
    // `closes`, `armed`, `cleared` and `liveSubscriptions` are all still correct while it happens.
    const kept: BridgeSession[] = [];

    // When
    const run = await openAndAbandon(kept);

    // Then the loop really ran and really held, which is what makes the next line a measurement
    expect(kept.length).toBe(ROUNDS);
    expect(run.closes).toBe(ROUNDS);
    expect(run.service.liveSubscriptions).toBe(0);

    // And the instrument sees it, by more than an order of magnitude either side of the ceiling.
    // Measured 12,445,088 to 12,520,496 bytes across six runs on the two Node versions `ci.yml`
    // runs, against 12,496 to 365,808 for the released loop. Without this line the case above is
    // a proof of absence taken with an instrument nothing proved could detect a presence, which is
    // how a 16 MiB bound on an uncollected reading sat over a 12.5 MB leak and reported green.
    expect(run.retained).toBeGreaterThan(RETAINED_BYTES_CEILING);
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

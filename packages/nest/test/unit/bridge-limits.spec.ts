import { describe, expect, it } from 'vitest';
import {
  BRIDGE_OVERFLOW_MODES,
  DEFAULT_BRIDGE_BUFFER_SIZE,
  DEFAULT_BRIDGE_BUFFERED_BYTES,
  DEFAULT_BRIDGE_CONCURRENT_SUBSCRIPTIONS,
  DEFAULT_BRIDGE_CONNECTION_SECONDS,
  DEFAULT_BRIDGE_MESSAGES_PER_SECOND,
  DEFAULT_BRIDGE_OVERFLOW,
  type BridgeOverflowMode,
  type IBridgeSource,
} from '../../src/index';
// REACHED BY MODULE PATH AND NOT THROUGH THE PACKAGE ENTRY, because the limiter's own parts are
// deliberately not in the published surface: nothing outside this package has a reason to name
// them, and the entry's comment records the measurement that decided it.
import { assertBridgeOptions, resolveBridgeOptions } from '../../src/bridge/domain/bridge-options';
import { MessageRing } from '../../src/bridge/domain/message-ring';
import { RateGate } from '../../src/bridge/domain/rate-gate';
import { sseClosed, sseDropped, sseMessage, ssePrelude } from '../../src/bridge/domain/sse';
import { readEvents } from '../mocks/bridge';

/**
 * The three pieces the limiter of SPEC 14.8 is made of, measured one at a time.
 *
 * NOTHING HERE OPENS A CONNECTION OR SUBSCRIBES TO ANYTHING. The ring is an array, the gate is a
 * clock and the framing is a string, and each is the whole subject of its own cases; what they add
 * up to is `bridge-service.spec.ts`, and whether they hold under a hostile producer is
 * `bridge-soak.spec.ts`.
 */

/**
 * A byte ceiling high enough that the cases about the entry ceiling only measure that one.
 *
 * THE TWO CEILINGS ARE SEPARATE CASES, per SPEC 14.8, and a case about entries that also happened
 * to hit the byte one would be answering whichever fired first.
 */
const UNBOUNDED_BYTES = Number.MAX_SAFE_INTEGER;

/** A source that exists only to satisfy the option check, since it never subscribes here. */
const source: IBridgeSource = { subscribe: () => ({ close: (): void => undefined }) };

describe('MessageRing', () => {
  it('should hold its capacity and no more, whatever the mode', () => {
    // Given
    for (const mode of BRIDGE_OVERFLOW_MODES) {
      const ring = new MessageRing<number>(3, mode, UNBOUNDED_BYTES, () => 1);

      // When
      for (let index = 0; index < 100; index += 1) ring.push(index);

      // Then
      expect(ring.size).toBeLessThanOrEqual(3);
    }
  });

  it('should drop the oldest and keep the newest under drop-oldest', () => {
    // Given
    const ring = new MessageRing<number>(3, 'drop-oldest', UNBOUNDED_BYTES, () => 1);

    // When
    const outcomes = [1, 2, 3, 4, 5].map((value) => ring.push(value).outcome);

    // Then, the first three fit and the last two each evict a head
    expect(outcomes).toEqual([
      'accepted',
      'accepted',
      'accepted',
      'dropped-oldest',
      'dropped-oldest',
    ]);
    expect([ring.shift(), ring.shift(), ring.shift(), ring.shift()]).toEqual([3, 4, 5, undefined]);
  });

  it('should refuse the newest and keep the oldest under drop-new', () => {
    // Given the falsification pair for the case above: the same pushes, the other mode
    const ring = new MessageRing<number>(3, 'drop-new', UNBOUNDED_BYTES, () => 1);

    // When
    const outcomes = [1, 2, 3, 4, 5].map((value) => ring.push(value).outcome);

    // Then
    expect(outcomes).toEqual(['accepted', 'accepted', 'accepted', 'dropped-new', 'dropped-new']);
    expect([ring.shift(), ring.shift(), ring.shift()]).toEqual([1, 2, 3]);
  });

  it('should say the session is over rather than choose an end under disconnect', () => {
    // Given
    const ring = new MessageRing<number>(2, 'disconnect', UNBOUNDED_BYTES, () => 1);

    // When
    const outcomes = [1, 2, 3].map((value) => ring.push(value).outcome);

    // Then, the ring is untouched by the overflow: what it holds is what the close discards
    expect(outcomes).toEqual(['accepted', 'accepted', 'overflowed']);
    expect(ring.size).toBe(2);
    expect(ring.clear()).toBe(2);
    expect(ring.size).toBe(0);
  });

  it('should release a shifted entry rather than keep a reference to it', () => {
    // Given, the leak this file is about, measured on the ring's own slots rather than on the
    // heap: a `WeakRef` would say when a payload was collected, which is a fact about the garbage
    // collector's timing, and what is under test is whether this object still points at it
    const ring = new MessageRing<{ readonly big: string }>(
      4,
      'drop-oldest',
      UNBOUNDED_BYTES,
      (value) => value.big.length,
    );
    const payload = { big: 'x'.repeat(16) };
    ring.push(payload);

    // When
    const taken = ring.shift();

    // Then, the slot is empty and the ring is not the thing keeping the payload alive. The
    // serialization is the reading: it walks every slot, so a payload still in one shows up in it,
    // and the case was watched failing on a `shift` that moved the head without clearing the slot
    expect(taken).toBe(payload);
    expect(ring.size).toBe(0);
    expect(JSON.stringify(ring)).toContain('"slots"');
    expect(JSON.stringify(ring)).not.toContain('xxxx');
  });

  it('should hold at least one entry when a capacity below one is asked for', () => {
    // Given, a ring of zero is a ring that drops everything and calls it overflow, which the
    // option check refuses; this is the constructor refusing to build one anyway
    const ring = new MessageRing<number>(0, 'drop-new', UNBOUNDED_BYTES, () => 1);

    // When
    const outcome = ring.push(1).outcome;

    // Then
    expect(outcome).toBe('accepted');
    expect(ring.size).toBe(1);
  });
});

describe('RateGate', () => {
  it('should hand out one second of burst at the start and refill by elapsed time', () => {
    // Given
    let at = 0;
    const gate = new RateGate(50, () => at);

    // When, nothing has elapsed
    const first = gate.available();
    gate.spend(first);
    const drained = gate.available();

    // Then, the recorded burst of one second and then nothing
    expect(first).toBe(50);
    expect(drained).toBe(0);

    // And a second later exactly one second's worth is back
    at = 1000;
    expect(gate.available()).toBe(50);
  });

  it('should never accumulate more than one second of allowance while nothing is sent', () => {
    // Given, the property a fixed window does not have: an idle minute is not a minute of credit
    let at = 0;
    const gate = new RateGate(10, () => at);
    gate.spend(gate.available());

    // When
    at = 60_000;

    // Then
    expect(gate.available()).toBe(10);
  });

  it('should hold a producer to the rate over a driven minute', () => {
    // Given, ten thousand a second offered against a limit of fifty, which is the clause of T056
    let at = 0;
    const gate = new RateGate(50, () => at);
    let sent = 0;
    let offered = 0;

    // When, one virtual minute in ten millisecond steps, a hundred messages offered per step, the
    // last step landing on the minute itself so the arithmetic below is the whole minute
    for (let step = 0; step <= 6000; step += 1) {
      at = step * 10;
      for (let message = 0; message < 100; message += 1) {
        offered += 1;
        if (gate.available() < 1) continue;
        gate.spend(1);
        sent += 1;
      }
    }

    // Then, with the population asserted first so the ceiling is measured against real pressure.
    // Sixty seconds at fifty, plus the one second of burst the gate starts with and says it does.
    expect(offered).toBe(600_100);
    expect(sent).toBe(50 * 60 + 50);
  });

  it('should ask to be woken no sooner than the next token and never for zero', () => {
    // Given
    let at = 0;
    const gate = new RateGate(4, () => at);
    gate.spend(gate.available());

    // When
    const dry = gate.waitMs();
    at = 1000;
    gate.available();
    const wet = gate.waitMs();

    // Then, a quarter second at four a second, and a wait that a timer cannot spin on
    expect(dry).toBe(250);
    expect(wet).toBe(1);
  });
});

describe('the bridge stream framing', () => {
  it('should open with a comment and an open event, before the broker says anything', () => {
    // Given
    const text = ssePrelude('orders.created');

    // When
    const events = readEvents(text);

    // Then
    expect(text.startsWith(': openref bridge\n\n')).toBe(true);
    expect(events).toEqual([
      { event: 'open', data: JSON.stringify({ channel: 'orders.created' }) },
    ]);
  });

  it('should split a payload across data lines rather than ending the event early', () => {
    // Given, a payload that carries every line break spelling
    const payload = 'first\nsecond\r\nthird\rfourth';

    // When
    const events = readEvents(sseMessage(payload));

    // Then, four data lines that a reader rejoins into the payload with the newlines normalized
    expect(
      sseMessage(payload)
        .split('\n')
        .filter((line) => line.startsWith('data: ')),
    ).toHaveLength(4);
    expect(events).toEqual([{ event: 'message', data: 'first\nsecond\nthird\nfourth' }]);
  });

  it('should strip a line break out of a broker id, since that ends the event too', () => {
    // Given, an id is the broker's and therefore comes from outside
    const frame = sseMessage('{}', 'a\nevent: closed\ndata: fake');

    // When
    const events = readEvents(frame);

    // Then, one event and not two, and the forged pair is inside the id
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('message');
    expect(events[0]?.id).toBe('a event: closed data: fake');
  });

  it('should carry both a since number and a session total in a drop notice', () => {
    // Given
    const frame = sseDropped({ dropped: 9_950, total: 5_970_000, mode: 'drop-oldest' });

    // When
    const events = readEvents(frame);

    // Then, the reader who saw the last notice and the reader who joined late are both answered
    expect(events).toEqual([
      {
        event: 'dropped',
        data: JSON.stringify({ dropped: 9_950, total: 5_970_000, mode: 'drop-oldest' }),
      },
    ]);
  });

  it('should say why a stream ended and what it carried', () => {
    // Given
    const frame = sseClosed({ reason: 'the ceiling', dropped: 4, delivered: 7 });

    // When
    const events = readEvents(frame);

    // Then
    expect(events).toEqual([
      {
        event: 'closed',
        data: JSON.stringify({ reason: 'the ceiling', dropped: 4, delivered: 7 }),
      },
    ]);
  });
});

describe('resolveBridgeOptions', () => {
  it('should arrive at the strict end of every scale when the host says nothing', () => {
    // Given, the defaults SPEC 14.8 prints
    // When
    const settings = resolveBridgeOptions(undefined);

    // Then
    expect(settings).toEqual({
      enabled: false,
      channels: [],
      maxMessagesPerSecond: DEFAULT_BRIDGE_MESSAGES_PER_SECOND,
      bufferSize: DEFAULT_BRIDGE_BUFFER_SIZE,
      maxBufferedBytes: DEFAULT_BRIDGE_BUFFERED_BYTES,
      onOverflow: DEFAULT_BRIDGE_OVERFLOW,
      maxConnectionSeconds: DEFAULT_BRIDGE_CONNECTION_SECONDS,
      maxConcurrentSubscriptions: DEFAULT_BRIDGE_CONCURRENT_SUBSCRIPTIONS,
    });
    expect(settings.enabled).toBe(false);
    expect(settings.channels).toEqual([]);
  });

  it('should read enabled strictly, so a value that is not true is off', () => {
    // Given, a host reaching this from JavaScript with a truthy value that is not a boolean
    // When
    const settings = resolveBridgeOptions({ enabled: 1 as unknown as boolean });

    // Then
    expect(settings.enabled).toBe(false);
  });

  it('should copy the allowlist rather than hold the host list', () => {
    // Given
    const channels = ['orders.created'];

    // When
    const settings = resolveBridgeOptions({ channels });
    channels.push('everything.else');

    // Then, a list a host mutates after boot does not widen a running bridge
    expect(settings.channels).toEqual(['orders.created']);
  });
});

describe('assertBridgeOptions', () => {
  it('should accept nothing at all, which is the ordinary case', () => {
    // Given, a mount with no bridge configured
    // When, Then
    expect(() => {
      assertBridgeOptions('the mount', undefined);
    }).not.toThrow();
  });

  it('should refuse a bridge that is on and has nothing behind it', () => {
    // Given
    // When, Then
    expect(() => {
      assertBridgeOptions('the document "events"', { enabled: true });
    }).toThrow(/hands it no source/);
  });

  it('should accept a bridge that is on and carries a source, which is the control', () => {
    // Given the control: the same options with the member the refusal above asks for
    // When, Then
    expect(() => {
      assertBridgeOptions('the document "events"', { enabled: true, source });
    }).not.toThrow();
  });

  it.each([
    ['maxMessagesPerSecond', { maxMessagesPerSecond: 0 }],
    ['bufferSize', { bufferSize: 0 }],
    ['maxConnectionSeconds', { maxConnectionSeconds: 0.5 }],
    ['maxConcurrentSubscriptions', { maxConcurrentSubscriptions: -1 }],
  ])('should refuse %s when it is not a whole number of at least one', (name, options) => {
    // Given
    // When, Then
    expect(() => {
      assertBridgeOptions('the mount', options);
    }).toThrow(new RegExp(`bridge\\.${name}`));
  });

  it('should refuse an overflow mode that is not one of the three', () => {
    // Given
    const options = { onOverflow: 'drop-everything' as unknown as BridgeOverflowMode };

    // When, Then
    expect(() => {
      assertBridgeOptions('the mount', options);
    }).toThrow(/drop-oldest, drop-new, disconnect/);
  });

  it('should refuse an empty entry in the allowlist, since an empty list already says nothing', () => {
    // Given
    // When, Then
    expect(() => {
      assertBridgeOptions('the mount', { channels: ['orders.created', ''] });
    }).toThrow(/empty channel address/);
  });
});

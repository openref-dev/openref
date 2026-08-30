import { describe, expect, it, vi } from 'vitest';
import { BridgeService, replyText, type BridgeSession, type IBridgeSource } from '../../src/index';
import { answerBridge } from '../../src/bridge/api/bridge-route';
import { drain, FakeClock, FakeSource, readEvents, type ReadEvent } from '../mocks/bridge';

/**
 * The bridge of SPEC 14.8 as a whole: what it refuses, what it paces, and what it tells the reader
 * it lost.
 *
 * NOTHING HERE CONNECTS TO A BROKER, per SPEC 19.4 and by construction: the source is the port a
 * host implements, so a suite implements one too and hands over messages by calling a function.
 * The clock and the timers are driven for the reason the mock file states, which is that every
 * control here is a rate or a ceiling.
 *
 * EVERY DROP CASE ASSERTS WHAT THE READER SEES AND NOT ONLY WHAT THE COUNTERS SAY. SPEC 19.8
 * forbids silent loss, and a counter nobody reads is exactly the silence it forbids: the assertion
 * is on the frames the stream wrote.
 */

/** Builds a bridge with the controls a case cares about and the rest at their defaults. */
function bridgeWith(
  clock: FakeClock,
  source: IBridgeSource,
  overrides: Partial<{
    channels: readonly string[];
    maxMessagesPerSecond: number;
    bufferSize: number;
    onOverflow: 'drop-oldest' | 'drop-new' | 'disconnect';
    maxConnectionSeconds: number;
    maxConcurrentSubscriptions: number;
  }> = {},
): BridgeService {
  return new BridgeService('the test mount', {
    enabled: true,
    channels: ['orders.created'],
    source,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides,
  });
}

/**
 * Opens a subscription and asserts it was not refused, so a case never reads a session off a
 * refusal by accident.
 *
 * @param bridge - The service
 * @param channel - What to ask for
 * @returns The session
 */
async function opened(bridge: BridgeService, channel: string): Promise<BridgeSession> {
  const result = await bridge.open(channel);
  expect(result.refused).toBeUndefined();
  if (result.session === undefined) throw new Error('the bridge refused where a session was due');

  return result.session;
}

/**
 * Every event the stream has written so far.
 *
 * @param session - The session
 * @returns The parsed events, in order
 */
function eventsOf(session: BridgeSession): readonly ReadEvent[] {
  return readEvents(drain(session.stream));
}

describe('BridgeService, what it refuses', () => {
  it('should refuse every subscription when the host turned nothing on', async () => {
    // Given, the default of SPEC 14.8, which is the state a host arrives in
    const bridge = new BridgeService('the test mount', undefined);

    // When
    const result = await bridge.open('orders.created');

    // Then, 403 rather than 404: the route exists so that off and absent stay distinguishable
    expect(bridge.enabled).toBe(false);
    expect(result.refused?.status).toBe(403);
    expect(result.refused?.reason).toMatch(/not enabled on this reference/);
  });

  it('should refuse a request that named no channel', async () => {
    // Given
    const bridge = bridgeWith(new FakeClock(), new FakeSource());

    // When
    const result = await bridge.open(undefined);

    // Then, and the sentence says how to ask
    expect(result.refused?.status).toBe(400);
    expect(result.refused?.reason).toMatch(/\?channel=/);
  });

  it('should refuse a channel that is not on the allowlist, before the source is asked anything', async () => {
    // Given, the allowlist is explicit and a document declaring a channel does not widen it
    const source = new FakeSource();
    const bridge = bridgeWith(new FakeClock(), source, { channels: ['orders.created'] });

    // When
    const result = await bridge.open('orders.deleted');

    // Then, the refusal, and the source was never reached: the only value a request carries is
    // this name, and nothing downstream of the allowlist ever sees one it did not admit
    expect(result.refused?.status).toBe(403);
    expect(result.refused?.reason).toMatch(/allowlist/);
    expect(source.subscribed).toEqual([]);
  });

  it('should refuse everything when the allowlist is empty, which is how a host says nothing', async () => {
    // Given
    const source = new FakeSource();
    const bridge = bridgeWith(new FakeClock(), source, { channels: [] });

    // When
    const result = await bridge.open('orders.created');

    // Then
    expect(result.refused?.status).toBe(403);
    expect(source.subscribed).toEqual([]);
  });

  it('should refuse past the concurrency ceiling with a reason naming both numbers', async () => {
    // Given, the ceiling asserted reachable first: three open and the fourth refused
    const clock = new FakeClock();
    const bridge = bridgeWith(clock, new FakeSource(), { maxConcurrentSubscriptions: 3 });
    const held = [
      await opened(bridge, 'orders.created'),
      await opened(bridge, 'orders.created'),
      await opened(bridge, 'orders.created'),
    ];

    // When
    const refused = await bridge.open('orders.created');

    // Then
    expect(bridge.liveSubscriptions).toBe(3);
    expect(refused.refused?.status).toBe(429);
    expect(refused.refused?.reason).toMatch(/serves 3 subscriptions at once and 3 are open/);

    // And a slot comes back when one closes, so the ceiling is a ceiling and not a fuse
    held[0]?.close('done');
    expect(bridge.liveSubscriptions).toBe(2);
    expect((await bridge.open('orders.created')).refused).toBeUndefined();
  });

  it('should not spend a subscription slot on a request it was going to refuse', async () => {
    // Given, the order of the refusals is part of them: a channel nobody may hear is refused
    // before the ceiling is consulted, so it cannot fill one on its way out
    const bridge = bridgeWith(new FakeClock(), new FakeSource(), { maxConcurrentSubscriptions: 1 });

    // When
    for (let attempt = 0; attempt < 20; attempt += 1) await bridge.open('orders.deleted');

    // Then
    expect(bridge.liveSubscriptions).toBe(0);
    expect((await bridge.open('orders.created')).refused).toBeUndefined();
  });

  it('should release the slot and rethrow when the source will not subscribe', async () => {
    // Given, a host whose broker is unreachable
    const clock = new FakeClock();
    const failing: IBridgeSource = {
      subscribe: () => {
        throw new Error('no broker');
      },
    };
    const bridge = bridgeWith(clock, failing);

    // When
    await expect(bridge.open('orders.created')).rejects.toThrow('no broker');

    // Then, the slot is back and nothing is left armed
    expect(bridge.liveSubscriptions).toBe(0);
    expect(clock.armed).toBe(0);
  });
});

describe('BridgeService, what the reader is told it lost', () => {
  it('should hold a producer of ten thousand a second to a limit of fifty, and say what it dropped', async () => {
    // Given the clause of T056, driven: ten thousand messages offered over one virtual second
    // against a limit of fifty, with a five hundred entry ring
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, { maxMessagesPerSecond: 50, bufferSize: 500 });
    const session = await opened(bridge, 'orders.created');

    // When, a hundred messages every ten milliseconds for a second
    for (let step = 0; step < 100; step += 1) {
      for (let message = 0; message < 100; message += 1) source.emit(`{"n":${String(message)}}`);
      clock.advance(10);
    }

    // Then, the numbers reconcile exactly and the limit held
    const counts = session.counts();
    expect(counts.received).toBe(10_000);
    expect(counts.delivered).toBeLessThanOrEqual(100);
    expect(counts.received).toBe(counts.delivered + counts.dropped + counts.buffered);
    expect(counts.buffered).toBeLessThanOrEqual(500);

    // And the reader was told, in the stream it is watching, that messages went and how many
    const notices = eventsOf(session).filter((event) => event.event === 'dropped');
    expect(notices.length).toBeGreaterThan(0);
    const last = JSON.parse(notices[notices.length - 1]?.data ?? '{}') as Record<string, unknown>;
    expect(last.mode).toBe('drop-oldest');
    expect(last.total).toBeGreaterThan(9_000);
  });

  it('should keep the newest under drop-oldest, and say so in the notice', async () => {
    // Given
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, {
      maxMessagesPerSecond: 1,
      bufferSize: 2,
      onOverflow: 'drop-oldest',
    });
    const session = await opened(bridge, 'orders.created');
    // The burst token is spent on the first message, so the ring is what holds the rest
    source.emit('one');
    drain(session.stream);

    // When
    source.emit('two');
    source.emit('three');
    source.emit('four');
    clock.advance(5_000);

    // Then, `two` is the one that went and the surviving pair is the newest
    const events = eventsOf(session);
    const delivered = events
      .filter((event) => event.event === 'message')
      .map((event) => event.data);
    expect(delivered).toEqual(['three', 'four']);
    expect(events.filter((event) => event.event === 'dropped')).toEqual([
      { event: 'dropped', data: JSON.stringify({ dropped: 1, total: 1, mode: 'drop-oldest' }) },
    ]);
  });

  it('should keep the oldest under drop-new, and say so in the notice', async () => {
    // Given the falsification pair for the case above: the same traffic, the other mode
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, {
      maxMessagesPerSecond: 1,
      bufferSize: 2,
      onOverflow: 'drop-new',
    });
    const session = await opened(bridge, 'orders.created');
    source.emit('one');
    drain(session.stream);

    // When
    source.emit('two');
    source.emit('three');
    source.emit('four');
    clock.advance(5_000);

    // Then, `four` is the one that went and the surviving pair is the oldest
    const events = eventsOf(session);
    expect(events.filter((event) => event.event === 'message').map((event) => event.data)).toEqual([
      'two',
      'three',
    ]);
    expect(events.filter((event) => event.event === 'dropped')).toEqual([
      { event: 'dropped', data: JSON.stringify({ dropped: 1, total: 1, mode: 'drop-new' }) },
    ]);
  });

  it('should end the session under disconnect, naming the reason and the count', async () => {
    // Given
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, {
      maxMessagesPerSecond: 1,
      bufferSize: 2,
      onOverflow: 'disconnect',
    });
    const session = await opened(bridge, 'orders.created');
    source.emit('one');
    drain(session.stream);

    // When
    source.emit('two');
    source.emit('three');
    source.emit('four');

    // Then, the indicator fires here too: the closing event carries the reason and the number of
    // messages this subscription never delivered, which is the two still queued plus the one that
    // met the full ring
    const closing = eventsOf(session).filter((event) => event.event === 'closed');
    expect(closing).toHaveLength(1);
    const notice = JSON.parse(closing[0]?.data ?? '{}') as Record<string, unknown>;
    expect(notice.reason).toMatch(/onOverflow: disconnect/);
    expect(notice.dropped).toBe(3);
    expect(notice.delivered).toBe(1);

    // And everything it held is released
    expect(bridge.liveSubscriptions).toBe(0);
    expect(source.closed).toBe(1);
    expect(clock.armed).toBe(0);
  });

  it('should count a message that arrived after the reader left rather than deliver it', async () => {
    // Given, an ended session and a broker that has not noticed yet
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source);
    const session = await opened(bridge, 'orders.created');
    session.close('the reader left');
    const before = session.counts();

    // When
    source.emit('too late');

    // Then, the session is closed and nothing about it moved
    expect(session.counts()).toEqual(before);
  });

  it('should coalesce the drop notice rather than send one per lost message', async () => {
    // Given, a notice per drop against a producer this fast is the flood the bridge refuses
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, { maxMessagesPerSecond: 1, bufferSize: 1 });
    const session = await opened(bridge, 'orders.created');

    // When, three virtual seconds of a hundred a second
    for (let step = 0; step < 300; step += 1) {
      source.emit(`{"n":${String(step)}}`);
      clock.advance(10);
    }

    // Then, with the loss asserted large first, so a small notice count is a measurement
    const counts = session.counts();
    expect(counts.dropped).toBeGreaterThan(200);
    expect(eventsOf(session).filter((event) => event.event === 'dropped').length).toBeLessThan(6);
  });
});

describe('BridgeService, the ceilings on a subscription', () => {
  it('should end a subscription at its connection ceiling and say which one it was', async () => {
    // Given
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, { maxConnectionSeconds: 30 });
    const session = await opened(bridge, 'orders.created');

    // When, one second short and then past it
    clock.advance(29_000);
    const early = eventsOf(session).filter((event) => event.event === 'closed');
    clock.advance(2_000);

    // Then, with the negative asserted first so the ceiling is what ended it
    expect(early).toEqual([]);
    const closing = eventsOf(session).filter((event) => event.event === 'closed');
    expect(closing).toHaveLength(1);
    expect(closing[0]?.data).toMatch(/ceiling of 30 seconds/);
    expect(source.live).toBe(false);
    expect(bridge.liveSubscriptions).toBe(0);
  });

  it('should release the source when the reader leaves rather than run to the ceiling', async () => {
    // Given, the ordinary ending: a reader closes the tab, the platform destroys the response
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source);
    const session = await opened(bridge, 'orders.created');
    expect(source.live).toBe(true);

    // When
    session.stream.destroy();
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    // Then
    expect(source.closed).toBe(1);
    expect(bridge.liveSubscriptions).toBe(0);
    expect(clock.armed).toBe(0);
  });

  it('should end every open subscription on shutdown, with words rather than a dropped socket', async () => {
    // Given
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, { maxConcurrentSubscriptions: 2 });
    const first = await opened(bridge, 'orders.created');
    const second = await opened(bridge, 'orders.created');

    // When
    bridge.closeAll('this reference is shutting down');

    // Then
    for (const session of [first, second]) {
      const closing = eventsOf(session).filter((event) => event.event === 'closed');
      expect(closing).toHaveLength(1);
      expect(closing[0]?.data).toMatch(/shutting down/);
    }
    expect(bridge.liveSubscriptions).toBe(0);
    expect(clock.armed).toBe(0);
  });

  it('should open with the channel it subscribed to, before the broker says anything', async () => {
    // Given
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source);

    // When
    const session = await opened(bridge, 'orders.created');

    // Then, one event and it is the open, so a quiet channel is not a server that never answered
    expect(eventsOf(session)).toEqual([
      { event: 'open', data: JSON.stringify({ channel: 'orders.created' }) },
    ]);
    expect(source.subscribed).toEqual(['orders.created']);
  });

  it('should carry a broker id through to the reader as the event id', async () => {
    // Given
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source);
    const session = await opened(bridge, 'orders.created');

    // When
    source.emit('{"total":9}', 'offset-42');

    // Then
    expect(eventsOf(session).filter((event) => event.event === 'message')).toEqual([
      { event: 'message', data: '{"total":9}', id: 'offset-42' },
    ]);
  });

  it('should stop draining while the reader is not reading, and hold the queue in the ring', async () => {
    // Given, a reader on a slow link is the limit the network chose rather than the one this
    // package chose, and the ring is what bounds the queue while either one is stopped
    const clock = new FakeClock();
    const source = new FakeSource();
    const bridge = bridgeWith(clock, source, { maxMessagesPerSecond: 1_000_000, bufferSize: 50 });
    const session = await opened(bridge, 'orders.created');
    const big = 'x'.repeat(4_000);

    // When, far more than the sixteen kilobyte high water mark, with nobody reading
    for (let index = 0; index < 200; index += 1) source.emit(big);
    clock.advance(1_000);

    // Then, the stream stopped taking frames and the rest is bounded by the ring, not by the heap
    const counts = session.counts();
    expect(counts.received).toBe(200);
    expect(counts.delivered).toBeLessThan(200);
    expect(counts.buffered).toBeLessThanOrEqual(50);
    expect(counts.received).toBe(counts.delivered + counts.dropped + counts.buffered);

    // And it resumes when the reader reads
    const before = counts.delivered;
    drain(session.stream);
    clock.advance(10);
    expect(session.counts().delivered).toBeGreaterThan(before);
  });
});

describe('answerBridge, the reply the route hands back', () => {
  /** The request shape the route table produces, reduced to what this route reads. */
  function request(channel?: string): {
    readonly params: Readonly<Record<string, string>>;
    readonly headers: Readonly<Record<string, string>>;
    readonly query?: Readonly<Record<string, string>>;
  } {
    return {
      params: {},
      headers: {},
      ...(channel === undefined ? {} : { query: { channel } }),
    };
  }

  it('should answer a stream with the headers a reader and a reverse proxy both need', async () => {
    // Given
    const clock = new FakeClock();
    const bridge = bridgeWith(clock, new FakeSource());

    // When
    const reply = await answerBridge(bridge, request('orders.created'), undefined);

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers).toEqual({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    expect(typeof reply.body).not.toBe('string');
    bridge.closeAll('the case is over');
  });

  it('should carry a refusal through with its own status and its own words', async () => {
    // Given
    const bridge = new BridgeService('the test mount', undefined);

    // When
    const reply = await answerBridge(bridge, request('orders.created'), undefined);

    // Then
    expect(reply.status).toBe(403);
    expect((JSON.parse(replyText(reply)) as { error: string }).error).toMatch(
      /not enabled on this reference/,
    );
  });

  it('should answer 502 and report the cause when the broker will not take a subscription', async () => {
    // Given, a host whose broker is unreachable: the detail is the host's and the reader gets a
    // status, which is the rule the proxy of SPEC 14.5 keeps for the same class of failure
    const cause = new Error('connect ECONNREFUSED 10.0.0.7:9092');
    const failing: IBridgeSource = {
      subscribe: () => {
        throw cause;
      },
    };
    const onError = vi.fn();
    const bridge = bridgeWith(new FakeClock(), failing);

    // When
    const reply = await answerBridge(bridge, request('orders.created'), onError);

    // Then, the address the broker refused reaches the reporter and never the reader
    expect(reply.status).toBe(502);
    expect(replyText(reply)).toBe('{"error":"the broker subscription did not open"}');
    expect(replyText(reply)).not.toContain('10.0.0.7');
    expect(onError).toHaveBeenCalledWith(cause);
  });

  it('should refuse a request whose query the adapter did not supply at all', async () => {
    // Given, an adapter that supplies no query is a supported deployment, per the port's own note
    const bridge = bridgeWith(new FakeClock(), new FakeSource());

    // When
    const reply = await answerBridge(bridge, request(), undefined);

    // Then
    expect(reply.status).toBe(400);
    expect(replyText(reply)).toMatch(/\?channel=/);
  });
});

describe('BridgeService, the subscription handle itself', () => {
  it('should await a source whose close is asynchronous rather than treat it as done', async () => {
    // Given, a broker client whose unsubscribe returns a promise, which most of them do
    let closed = 0;
    const asyncClose: IBridgeSource = {
      subscribe: () => ({
        close: async (): Promise<void> => {
          await Promise.resolve();
          closed += 1;
        },
      }),
    };
    const bridge = bridgeWith(new FakeClock(), asyncClose);
    const session = await opened(bridge, 'orders.created');

    // When
    session.close('the case is over');
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    // Then, and the slot went back without waiting for the broker, which is the point of the slot
    expect(closed).toBe(1);
    expect(bridge.liveSubscriptions).toBe(0);
  });

  it('should release the slot even when the source throws on the way out', async () => {
    // Given, a broker that is already gone: failing to unsubscribe from it is the host's problem
    // and must not become an unhandled rejection that takes the process down
    const throwingClose: IBridgeSource = {
      subscribe: () => ({
        close: (): void => {
          throw new Error('the connection is already gone');
        },
      }),
    };
    const bridge = bridgeWith(new FakeClock(), throwingClose);
    const session = await opened(bridge, 'orders.created');

    // When
    expect(() => {
      session.close('the case is over');
    }).not.toThrow();

    // Then
    expect(bridge.liveSubscriptions).toBe(0);
    expect(eventsOf(session).filter((event) => event.event === 'closed')).toHaveLength(1);
  });

  it('should close a subscription that arrived after the session it belonged to had ended', async () => {
    // Given, the race the code says it handles: a source that hands over messages synchronously
    // and only then resolves its handle, with enough of them to overflow a disconnect bridge, so
    // the session ends while the thing that has to be unsubscribed does not exist yet
    let closed = 0;
    const eager: IBridgeSource = {
      subscribe: async (_channel, deliver) => {
        deliver({ data: 'one' });
        deliver({ data: 'two' });
        deliver({ data: 'three' });
        await Promise.resolve();

        return {
          close: (): void => {
            closed += 1;
          },
        };
      },
    };
    const bridge = bridgeWith(new FakeClock(), eager, {
      maxMessagesPerSecond: 1,
      bufferSize: 1,
      onOverflow: 'disconnect',
    });

    // When
    const session = await opened(bridge, 'orders.created');
    await new Promise((resolve) => {
      setImmediate(resolve);
    });

    // Then, with the session asserted already over first, so the close is the late one
    expect(session.counts().received).toBe(3);
    expect(eventsOf(session).filter((event) => event.event === 'closed')).toHaveLength(1);
    expect(closed).toBe(1);
    expect(bridge.liveSubscriptions).toBe(0);
  });
});

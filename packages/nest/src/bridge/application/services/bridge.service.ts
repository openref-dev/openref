/**
 * The broker bridge of SPEC 14.8: a bounded queue with a slow drain, and a reader who is told
 * everything it lost.
 *
 * THE LIMITER IS THE FEATURE. A broker delivers thousands of messages a second and a response that
 * takes them all is a Node process that dies by memory, on somebody else's deployment, at whatever
 * hour their traffic peaks. So the shape here is a queue rather than a pipe: the ring holds at most
 * `bufferSize` entries, the rate gate drains it at `maxMessagesPerSecond`, and overflow is what
 * happens when the source outruns the drain. Memory is flat under any producer because the only
 * thing that grows with the producer is a counter.
 *
 * ONE MECHANISM COVERS TWO KINDS OF SLOWNESS, AND THAT IS WHY THERE IS ONE. The rate gate is a
 * limit this package chose; a reader on a slow link is a limit the network chose, and it arrives as
 * `Readable.push` returning false. Both stop the drain, and the ring is what bounds the queue while
 * either one is stopped. A design with a rate limiter and no answer for backpressure would hold the
 * line at fifty messages a second and still die against a reader who stopped reading.
 *
 * NOTHING IS LOST IN SILENCE, per SPEC 19.8. Every drop increments two counters and the reader is
 * told, in the stream it is watching, how many went and which end they went from. The notice is
 * coalesced to one per second because a notice per drop against a producer at ten thousand a second
 * is the flood this whole file exists to refuse.
 */

import { Readable } from 'node:stream';
import {
  BRIDGE_DROP_NOTICE_MS,
  assertBridgeOptions,
  resolveBridgeOptions,
  type BridgeOptions,
  type ResolvedBridgeOptions,
} from '../../domain/bridge-options';
import { MessageRing } from '../../domain/message-ring';
import { RateGate } from '../../domain/rate-gate';
import { sseClosed, sseDropped, sseMessage, ssePrelude } from '../../domain/sse';
import type { BridgeMessage, BridgeSubscription, IBridgeSource } from '../ports/bridge-source.port';

/** How a bridge service is built. */
export interface BridgeServiceOptions extends BridgeOptions {
  /** Clock, so a rate can be asserted without waiting for one. */
  readonly now?: () => number;
  /** Timer, injected for the same reason. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  /** How an injected timer is cancelled. */
  readonly clearTimer?: (handle: unknown) => void;
}

/** Why a subscription was not opened, and what the wire should say. */
export interface BridgeRefusal {
  readonly status: number;
  readonly reason: string;
}

/** What one subscription carried. */
export interface BridgeCounts {
  /** Messages the source handed over. */
  readonly received: number;
  /** Messages written to the reader. */
  readonly delivered: number;
  /** Messages lost, by overflow or by a close that discarded a queue. */
  readonly dropped: number;
  /** Messages waiting in the ring. */
  readonly buffered: number;
}

/** One live subscription. */
export interface BridgeSession {
  /** The channel it carries. */
  readonly channel: string;
  /** What the response body is. */
  readonly stream: Readable;
  /** The four numbers, read at this instant. */
  counts(): BridgeCounts;
  /**
   * Ends it, telling the reader why.
   *
   * @param reason - Words the reader sees in the closing event
   */
  close(reason: string): void;
}

/** The answer to one request for a subscription. */
export type BridgeOpenResult =
  | { readonly refused: BridgeRefusal; readonly session?: undefined }
  | { readonly refused?: undefined; readonly session: BridgeSession };

/** Serves the subscriptions of one mount, and refuses everything it was not configured for. */
export class BridgeService {
  private readonly settings: ResolvedBridgeOptions;

  /**
   * The source, held only when this bridge is on, so that being on and having one is one fact.
   *
   * TWO MEMBERS WOULD MAKE A STATE THAT CANNOT HAPPEN LOOK LIKE ONE THAT CAN. `assertBridgeOptions`
   * refuses an enabled bridge with no source at construction, so "on and nothing behind it" never
   * reaches a request; a separate `enabled` flag beside an optional source would still have made
   * the code ask about it on every open, and the answer would have been a refusal no reader could
   * ever have received. SPEC 14.8 says the state does not exist on the wire, and this is what makes
   * that true rather than merely asserted.
   */
  private readonly ready: { readonly source: IBridgeSource } | null;

  private readonly now: () => number;

  private readonly setTimer: (callback: () => void, ms: number) => unknown;

  private readonly clearTimer: (handle: unknown) => void;

  private live = 0;

  private readonly sessions = new Set<BridgeSession>();

  /**
   * @param label - What is being configured, for a refusal raised at construction
   * @param options - The controls of SPEC 14.8, plus the clock and timer seams
   * @throws {InvalidOptionsError} When the configuration cannot be honoured
   */
  constructor(label: string, options: BridgeServiceOptions | undefined) {
    assertBridgeOptions(label, options);

    this.settings = resolveBridgeOptions(options);
    this.ready =
      this.settings.enabled && options?.source !== undefined ? { source: options.source } : null;
    this.now = options?.now ?? Date.now;
    // UNREFERENCED BY DEFAULT, so a pending connection ceiling never keeps a process alive that
    // has otherwise finished. The ceiling exists to end a subscription that outstays its welcome,
    // not to hold the event loop open waiting for one that already went.
    this.setTimer =
      options?.setTimer ?? ((callback, ms): unknown => setTimeout(callback, ms).unref());
    this.clearTimer =
      options?.clearTimer ??
      ((handle): void => {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      });
  }

  /** Whether this bridge can carry anything at all. False is the default and is not an error. */
  get enabled(): boolean {
    return this.ready !== null;
  }

  /** How many subscriptions are open right now. */
  get liveSubscriptions(): number {
    return this.live;
  }

  /**
   * Opens one subscription, or says why it will not.
   *
   * THE ORDER OF THE REFUSALS IS PART OF THEM, exactly as it is in the proxy of SPEC 14.5. The
   * allowlist is consulted before the concurrency ceiling, so a request for a channel nobody may
   * subscribe to cannot consume a subscription slot on its way to being refused, and the source is
   * asked nothing at all until both have passed.
   *
   * @param channel - The channel the reader named, from the query string
   * @returns The session, or the refusal with the status the wire should carry
   */
  async open(channel: string | undefined): Promise<BridgeOpenResult> {
    const ready = this.ready;
    if (ready === null) {
      return {
        refused: {
          status: 403,
          reason:
            'the broker bridge is not enabled on this reference. It is off unless a host turns ' +
            'it on, and off refuses every subscription rather than opening an empty one',
        },
      };
    }

    if (channel === undefined || channel === '') {
      return {
        refused: {
          status: 400,
          reason:
            'this route carries one channel per connection and the request named none. Ask for ' +
            'it as ?channel=<address>',
        },
      };
    }

    if (!this.settings.channels.includes(channel)) {
      return {
        refused: {
          status: 403,
          reason:
            `no channel named "${channel}" is on this bridge's allowlist. The list is explicit ` +
            'and an empty one allows nothing, so a channel the document declares is still not a ' +
            'channel a reader may subscribe to until a host names it here',
        },
      };
    }

    if (this.live >= this.settings.maxConcurrentSubscriptions) {
      return {
        refused: {
          status: 429,
          reason:
            `this bridge serves ${String(this.settings.maxConcurrentSubscriptions)} subscriptions ` +
            `at once and ${String(this.live)} are open. Close one, or raise ` +
            'maxConcurrentSubscriptions on the host',
        },
      };
    }

    return { session: await this.start(ready.source, channel) };
  }

  /**
   * Ends every open subscription, which is what a shutting down application owes its readers.
   *
   * @param reason - Words the readers see in the closing event
   */
  closeAll(reason: string): void {
    for (const session of [...this.sessions]) session.close(reason);
  }

  /**
   * Builds one session and subscribes it.
   *
   * @param source - The host's source, already known to exist
   * @param channel - The channel, already known to be on the allowlist
   * @returns The session
   */
  private async start(source: IBridgeSource, channel: string): Promise<BridgeSession> {
    const settings = this.settings;
    const now = this.now;
    // THE SECOND CEILING IS MEASURED ON WHAT GOES OUT AND NOT ON WHAT CAME IN, per SPEC 14.8. A
    // message costs the reader its payload plus its id, and both travel; measuring the payload
    // alone would let an id nobody bounded carry the memory the payload was refused.
    const ring = new MessageRing<BridgeMessage>(
      settings.bufferSize,
      settings.onOverflow,
      settings.maxBufferedBytes,
      (message) => message.data.length + (message.id?.length ?? 0),
    );
    const gate = new RateGate(settings.maxMessagesPerSecond, now);

    let received = 0;
    let delivered = 0;
    let dropped = 0;
    let pending = 0;
    let lastNoticeAt = now();
    let thirsty = true;
    let ended = false;
    let released = false;
    let pumpTimer: unknown;
    let subscription: BridgeSubscription | undefined;

    const stream = new Readable({
      read: (): void => {
        thirsty = true;
        pump();
      },
    });

    /**
     * Writes one frame, noticing when the reader stopped keeping up.
     *
     * @param frame - What to write
     * @returns Whether the reader is still taking more
     */
    function write(frame: string): boolean {
      if (ended) return false;

      const accepted = stream.push(frame);
      if (!accepted) thirsty = false;

      return accepted;
    }

    /** Releases the host's subscription and this mount's slot, once and only once. */
    const release = (): void => {
      if (released) return;
      released = true;
      this.live -= 1;
      this.sessions.delete(session);

      // THE HOST IS TOLD AT ONCE AND NOT ON A MICROTASK, which is a defect this suite caught: a
      // close deferred to a promise leaves a broker subscription live for as long as the queue
      // takes to turn, and "released" then means "will be released", which is not the same fact.
      try {
        const closing = subscription?.close();

        // FAILURE TO UNSUBSCRIBE IS THE HOST'S AND MUST NOT BECOME AN UNHANDLED REJECTION, which
        // would take the process down over a broker that is already gone. There is nothing this
        // side can do with it and the slot is released either way.
        if (closing !== undefined) void Promise.resolve(closing).catch(() => undefined);
      } catch (cause: unknown) {
        void cause;
      }
    };

    /** Whether the slot and the subscription have already gone back. */
    const wasReleased = (): boolean => released;

    /** Cancels the pending drain, if there is one. */
    const clearPump = (): void => {
      if (pumpTimer === undefined) return;
      this.clearTimer(pumpTimer);
      pumpTimer = undefined;
    };

    /**
     * Ends the stream with a reason the reader can read.
     *
     * @param reason - Why it ends
     */
    const finish = (reason: string): void => {
      if (ended) return;

      dropped += ring.clear();
      pending = 0;
      ended = true;
      clearPump();
      this.clearTimer(ceiling);
      stream.push(sseClosed({ reason, dropped, delivered }));
      stream.push(null);
      release();
    };

    /** Emits the coalesced drop indicator when one is due, per SPEC 19.8. */
    function noticeIfDue(): void {
      if (pending === 0) return;
      if (now() - lastNoticeAt < BRIDGE_DROP_NOTICE_MS) return;

      const since = pending;
      pending = 0;
      lastNoticeAt = now();
      write(sseDropped({ dropped: since, total: dropped, mode: settings.onOverflow }));
    }

    /** Arms the next drain, when there is anything left to drain or to announce. */
    const schedule = (): void => {
      clearPump();
      if (ended || !thirsty) return;

      const waits: number[] = [];
      if (ring.size > 0) waits.push(gate.waitMs());
      if (pending > 0) waits.push(Math.max(1, BRIDGE_DROP_NOTICE_MS - (now() - lastNoticeAt)));
      if (waits.length === 0) return;

      pumpTimer = this.setTimer(
        (): void => {
          pumpTimer = undefined;
          pump();
        },
        Math.min(...waits),
      );
    };

    /** Drains what the gate and the reader will take, then arms the next attempt. */
    function pump(): void {
      if (ended) return;
      if (!thirsty) return;

      noticeIfDue();

      let budget = gate.available();
      while (budget > 0 && ring.size > 0) {
        const message = ring.shift();
        if (message === undefined) break;

        budget -= 1;
        gate.spend(1);
        delivered += 1;

        // THE LOOP ENDS ON WHAT THE WRITE ANSWERED AND NOT ON THE FLAG IT SET, because a flag a
        // closure sets is one the compiler has already narrowed to its declared value here. The
        // returned boolean says the same thing and says it where the reader of this loop is.
        if (!write(sseMessage(message.data, message.id))) break;
      }

      schedule();
    }

    /**
     * Files one message from the broker.
     *
     * @param message - What the source handed over
     */
    function deliver(message: BridgeMessage): void {
      if (ended) return;

      received += 1;
      const push = ring.push(message);

      // THE COUNT COMES FROM THE RING AND IS NOT ASSUMED TO BE ONE, since the byte ceiling of
      // `T059`: making room for one large message can evict several small ones, and a caller that
      // added one per push would tell the reader it had lost fewer than it had.
      if (push.discarded > 0) {
        dropped += push.discarded;
        pending += push.discarded;
      }

      if (push.outcome === 'overflowed') {
        // `disconnect`: the message that met the full ring is lost too, so it is counted before
        // the close, and the closing event carries the total rather than a number short by one.
        dropped += 1;
        finish(
          `the buffer of ${String(settings.bufferSize)} messages or ` +
            `${String(settings.maxBufferedBytes)} bytes overflowed and this bridge is ` +
            'configured with onOverflow: disconnect',
        );

        return;
      }

      pump();
    }

    const ceiling = this.setTimer((): void => {
      finish(
        `this subscription reached its ceiling of ${String(settings.maxConnectionSeconds)} seconds`,
      );
    }, settings.maxConnectionSeconds * 1000);

    const session: BridgeSession = {
      channel,
      stream,
      counts: (): BridgeCounts => ({ received, delivered, dropped, buffered: ring.size }),
      close: (reason: string): void => {
        finish(reason);
      },
    };

    // THE READER LEAVING IS THE ORDINARY ENDING AND IT ARRIVES HERE. Whatever the platform does
    // with a response whose reader hung up, it destroys this stream, and a subscription that
    // outlived its reader is the leak this ceiling and this listener both exist to prevent.
    stream.on('close', (): void => {
      ended = true;
      clearPump();
      this.clearTimer(ceiling);
      release();
    });

    this.live += 1;
    this.sessions.add(session);

    // THE PRELUDE GOES BEFORE THE SUBSCRIPTION AND NOT AFTER IT, because a source is allowed to
    // hand over a message from inside `subscribe`, synchronously, and a stream whose first frame
    // is a broker message is one the reader never saw open.
    stream.push(ssePrelude(channel));

    try {
      subscription = await source.subscribe(channel, deliver);
    } catch (cause: unknown) {
      ended = true;
      clearPump();
      this.clearTimer(ceiling);
      release();
      stream.destroy();
      throw cause;
    }

    // A SOURCE THAT RESOLVED AFTER THE READER LEFT STILL HAS TO BE CLOSED, which is why this is
    // checked rather than assumed: `release` ran already, `released` is set, and the subscription
    // it was supposed to close did not exist yet. It is read through a call for the reason the
    // loop above gives, which is that the compiler holds this flag at its declared value.
    if (wasReleased()) void Promise.resolve(subscription.close()).catch(() => undefined);

    return session;
  }
}

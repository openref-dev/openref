/**
 * What the bridge suites drive the limiter with: a clock, a timer wheel, a source and a drain.
 *
 * TIME IS DRIVEN AND NEVER WAITED FOR. Every control SPEC 14.8 names is a rate or a ceiling, so a
 * suite that waited would spend its budget measuring the machine rather than the rule; the soak
 * would spend ten minutes proving something a driven clock proves in seconds, and the connection
 * ceiling would cost five real minutes per case. The seams are the ones `BridgeService` declares,
 * so nothing here is a shape invented for testing.
 */

import type { Readable } from 'node:stream';
import type { BridgeMessage, BridgeSubscription, IBridgeSource } from '../../src/index';

/** A clock and a timer wheel that only move when a case says so. */
export class FakeClock {
  private at = 0;

  private next = 1;

  private readonly pending = new Map<number, { due: number; run: () => void }>();

  /** The clock, in milliseconds. */
  readonly now = (): number => this.at;

  /**
   * Arms a timer.
   *
   * @param callback - What to run
   * @param ms - How long from now
   * @returns The handle
   */
  readonly setTimer = (callback: () => void, ms: number): unknown => {
    const handle = this.next;
    this.next += 1;
    this.pending.set(handle, { due: this.at + ms, run: callback });

    return handle;
  };

  /**
   * Cancels a timer.
   *
   * @param handle - What `setTimer` returned
   */
  readonly clearTimer = (handle: unknown): void => {
    this.pending.delete(handle as number);
  };

  /** How many timers are armed, so a case can assert that nothing was left running. */
  get armed(): number {
    return this.pending.size;
  }

  /**
   * Moves the clock, firing every timer that comes due on the way.
   *
   * TIMERS ARMED BY A TIMER RUN IN THE SAME ADVANCE, which is what makes a drain that reschedules
   * itself behave here as it does in a process. The loop is bounded by the target instant rather
   * than by a count, so a timer that rearms itself for the same instant would hang the case, which
   * is the honest outcome for a hot loop.
   *
   * @param ms - How far to move
   */
  advance(ms: number): void {
    const target = this.at + ms;

    for (;;) {
      let due: { handle: number; due: number; run: () => void } | undefined;
      for (const [handle, timer] of this.pending) {
        if (timer.due > target) continue;
        if (due === undefined || timer.due < due.due) due = { handle, ...timer };
      }
      if (due === undefined) break;

      this.pending.delete(due.handle);
      this.at = Math.max(this.at, due.due);
      due.run();
    }

    this.at = target;
  }
}

/** A source a case hands messages to, which records what the bridge asked of it. */
export class FakeSource implements IBridgeSource {
  /** Channels `subscribe` was called with, in order. */
  readonly subscribed: string[] = [];

  /** How many subscriptions were closed. */
  closed = 0;

  private deliver: ((message: BridgeMessage) => void) | undefined;

  /** @inheritdoc */
  subscribe(channel: string, deliver: (message: BridgeMessage) => void): BridgeSubscription {
    this.subscribed.push(channel);
    this.deliver = deliver;

    return {
      close: (): void => {
        this.closed += 1;
        this.deliver = undefined;
      },
    };
  }

  /**
   * Hands one message to whatever is subscribed.
   *
   * @param data - The payload
   * @param id - The broker's own id, when the case wants one
   */
  emit(data: string, id?: string): void {
    this.deliver?.(id === undefined ? { data } : { data, id });
  }

  /** Whether anything is listening, so a case can prove a subscription really went. */
  get live(): boolean {
    return this.deliver !== undefined;
  }

  /**
   * Forgets what it recorded, in place.
   *
   * IN PLACE AND NOT BY REPLACEMENT, which is a defect the route suite caught with two red cases
   * at once. A module's `forRoot` options capture the source object when the class is declared, so
   * a suite that assigns a fresh instance between cases is reading one object while the mount
   * holds another, and every `emit` after the first case goes nowhere.
   */
  reset(): void {
    this.subscribed.length = 0;
    this.closed = 0;
    this.deliver = undefined;
  }
}

/** One parsed server sent event. */
export interface ReadEvent {
  readonly event: string;
  readonly data: string;
  readonly id?: string;
}

/**
 * Takes everything buffered in a stream, without waiting for a tick.
 *
 * @param stream - The bridge session's stream
 * @returns The bytes read as text
 */
export function drain(stream: Readable): string {
  let text = '';

  for (;;) {
    const chunk: unknown = stream.read();
    if (typeof chunk === 'string') {
      text += chunk;
      continue;
    }
    // A stream with no encoding set hands back a Buffer, which is what the bridge produces; the
    // two arms are named rather than coerced, so a third kind of chunk ends the read loudly here
    // instead of arriving as the string "[object Object]".
    if (chunk instanceof Uint8Array) {
      text += Buffer.from(chunk).toString('utf8');
      continue;
    }
    break;
  }

  return text;
}

/**
 * Parses the frames a bridge stream wrote.
 *
 * THE COMMENT LINE IS DROPPED AND NOTHING ELSE IS, so a case asserting the whole sequence of
 * events sees exactly what a reader's `EventSource` would dispatch.
 *
 * @param text - What `drain` returned
 * @returns One entry per event, in order
 */
export function readEvents(text: string): readonly ReadEvent[] {
  const events: ReadEvent[] = [];

  for (const block of text.split('\n\n')) {
    const lines = block.split('\n').filter((line) => line !== '' && !line.startsWith(':'));
    if (lines.length === 0) continue;

    const name = lines.find((line) => line.startsWith('event: '))?.slice('event: '.length) ?? '';
    const id = lines.find((line) => line.startsWith('id: '))?.slice('id: '.length);
    const data = lines
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice('data: '.length))
      .join('\n');

    events.push(id === undefined ? { event: name, data } : { event: name, data, id });
  }

  return events;
}

/**
 * The bounded queue of SPEC 14.8, and the one reason the bridge cannot run a process out of memory.
 *
 * IT IS A REAL RING AND NOT A COPY ON APPEND, which is the difference between this and the socket
 * log of SPEC 14.7 that keeps the same kind of window. The log is filled by a reader's own session
 * and rebuilds its array so that a consumer holding the previous state sees a value that did not
 * move; this is filled by a broker at ten thousand messages a second, where rebuilding a five
 * hundred entry array per message is five million allocations a second and the memory the whole
 * feature exists to bound. The slots are allocated once and overwritten in place.
 *
 * DROPPING IS COUNTED, NEVER PERFORMED IN SILENCE. Every `push` says what it did, and the caller
 * turns that into something the reader is told. SPEC 19.8 forbids silent loss and this is the
 * place where loss happens, so this is the place that has to be loud.
 */

import type { BridgeOverflowMode } from './bridge-options';

/** What one `push` did with the value it was handed. */
export type RingOutcome =
  /** The value is in the ring and nothing was lost. */
  | 'accepted'
  /** The ring was full, the oldest entry left to make room, and the value is in. */
  | 'dropped-oldest'
  /** The ring was full and the value was refused, so the ring is unchanged. */
  | 'dropped-new'
  /** The ring was full under `disconnect`, so the session ends and the value is not in. */
  | 'overflowed';

/** A fixed size queue that says what it lost. */
export class MessageRing<T> {
  private readonly slots: (T | undefined)[];

  /**
   * Entries held at once, floored at one.
   *
   * THE FLOOR IS HERE AND NOT ONLY ON THE ARRAY, which is a defect this file's own suite caught: a
   * capacity of zero left `full` reading true before anything was pushed, so every message
   * overflowed a ring that had a slot free. `assertBridgeOptions` refuses zero at the boundary, and
   * this is the second place, because a caller inside this package does not go through that check.
   */
  private readonly capacity: number;

  private head = 0;

  private length = 0;

  /**
   * @param capacity - Entries held at once, at least one
   * @param onOverflow - What a full ring does with a message, per SPEC 14.8
   */
  constructor(
    capacity: number,
    private readonly onOverflow: BridgeOverflowMode,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.slots = new Array<T | undefined>(this.capacity).fill(undefined);
  }

  /** How many entries are waiting. */
  get size(): number {
    return this.length;
  }

  /** Whether the next push will overflow. */
  get full(): boolean {
    return this.length >= this.capacity;
  }

  /**
   * Files one message, applying the overflow mode when there is no room.
   *
   * @param value - The message
   * @returns What happened to it, which is what the reader has to be told
   */
  push(value: T): RingOutcome {
    if (!this.full) {
      this.slots[(this.head + this.length) % this.slots.length] = value;
      this.length += 1;

      return 'accepted';
    }

    if (this.onOverflow === 'drop-new') return 'dropped-new';
    if (this.onOverflow === 'disconnect') return 'overflowed';

    // `drop-oldest`: the head slot is overwritten and the head moves on, so the array never grows
    // and the entry that leaves is released for collection in the same statement.
    this.slots[this.head] = value;
    this.head = (this.head + 1) % this.slots.length;

    return 'dropped-oldest';
  }

  /**
   * Takes the oldest entry.
   *
   * @returns The entry, or undefined when the ring is empty
   */
  shift(): T | undefined {
    if (this.length === 0) return undefined;

    const value = this.slots[this.head];

    // CLEARED AND NOT MERELY STEPPED OVER. A slot still holding a reference keeps a payload alive
    // for as long as the ring lives, which is a retained set that grows to `capacity` payloads and
    // never shrinks. It is small, it is bounded, and it is still the class of leak this file is
    // about, so the slot is emptied.
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.slots.length;
    this.length -= 1;

    return value;
  }

  /**
   * Empties the ring.
   *
   * @returns How many entries were discarded, which is what a closing session owes the reader
   */
  clear(): number {
    const discarded = this.length;

    this.slots.fill(undefined);
    this.head = 0;
    this.length = 0;

    return discarded;
  }
}

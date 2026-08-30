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

/** What one `push` did, and how many entries it cost. */
export interface RingPush {
  readonly outcome: RingOutcome;
  /**
   * Entries lost by this push, which is not always one.
   *
   * ADDED AT `T059` WITH THE BYTE CEILING, because a byte ceiling can evict more than one entry to
   * make room for a large message, and a caller that counted one per push would report a loss the
   * stream had not had. Zero for `accepted` and for `overflowed`, whose offending message the caller
   * counts itself because the session ends with it.
   */
  readonly discarded: number;
}

/** How large one entry is, in whatever unit the byte ceiling is expressed in. */
export type RingSizeOf<T> = (value: T) => number;

/**
 * A fixed size queue that says what it lost.
 *
 * TWO CEILINGS AND NOT ONE, SINCE `T059`, AND SPEC 14.8 CARRIES THE MEASUREMENT. Entries bound how
 * many messages wait; bytes bound how large they are, and without the second the first is not a
 * memory bound at all: 200 messages of a megabyte against a ring of fifty left fifty buffered,
 * 50.0 MB retained where the byte ceiling retains 1.0 MB. The quantity is retention rather than
 * resident memory, which reads between 351 and 403 MB on unchanged code and so cannot tell the two
 * shapes apart. Both are the same question, so both are answered by the same three overflow voices
 * and counted into the same number.
 */
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

  /** Bytes held at once, floored at one for the reason the entry capacity is. */
  private readonly byteCapacity: number;

  private readonly sizeOf: RingSizeOf<T>;

  private head = 0;

  private length = 0;

  private bytes = 0;

  /**
   * @param capacity - Entries held at once, at least one
   * @param onOverflow - What a full ring does with a message, per SPEC 14.8
   * @param byteCapacity - Bytes held at once, at least one
   * @param sizeOf - How large one entry is
   */
  constructor(
    capacity: number,
    private readonly onOverflow: BridgeOverflowMode,
    byteCapacity: number,
    sizeOf: RingSizeOf<T>,
  ) {
    this.capacity = Math.max(1, Math.floor(capacity));
    this.byteCapacity = Math.max(1, Math.floor(byteCapacity));
    this.sizeOf = sizeOf;
    this.slots = new Array<T | undefined>(this.capacity).fill(undefined);
  }

  /** How many entries are waiting. */
  get size(): number {
    return this.length;
  }

  /** How many bytes those entries hold, which is the ceiling the entry count cannot express. */
  get byteSize(): number {
    return this.bytes;
  }

  /** Whether the next push will overflow on the entry ceiling. */
  get full(): boolean {
    return this.length >= this.capacity;
  }

  /**
   * Files one message, applying the overflow mode when there is no room by either ceiling.
   *
   * A MESSAGE LARGER THAN THE WHOLE CEILING IS LOST WITHOUT EVICTING ANYTHING, per SPEC 14.8.
   * Emptying the ring for a value that still would not fit destroys the reader's data for nothing,
   * so the value is refused where it stands and counted as the one thing that was lost.
   *
   * @param value - The message
   * @returns What happened to it and how many entries it cost, which is what the reader is told
   */
  push(value: T): RingPush {
    const size = Math.max(0, this.sizeOf(value));

    if (size > this.byteCapacity) {
      return this.onOverflow === 'disconnect'
        ? { outcome: 'overflowed', discarded: 0 }
        : { outcome: 'dropped-new', discarded: 1 };
    }

    if (this.full || this.bytes + size > this.byteCapacity) {
      if (this.onOverflow === 'drop-new') return { outcome: 'dropped-new', discarded: 1 };
      if (this.onOverflow === 'disconnect') return { outcome: 'overflowed', discarded: 0 };

      // `drop-oldest`: the head leaves until the value fits by both ceilings. The array never
      // grows and each entry that leaves is released for collection as its slot is emptied.
      let discarded = 0;
      while (this.length > 0 && (this.full || this.bytes + size > this.byteCapacity)) {
        this.dropHead();
        discarded += 1;
      }

      this.store(value, size);

      return { outcome: 'dropped-oldest', discarded };
    }

    this.store(value, size);

    return { outcome: 'accepted', discarded: 0 };
  }

  /**
   * Writes one value into the tail slot.
   *
   * @param value - The message
   * @param size - Its size, already measured, so it is not measured twice
   */
  private store(value: T, size: number): void {
    this.slots[(this.head + this.length) % this.slots.length] = value;
    this.length += 1;
    this.bytes += size;
  }

  /** Releases the oldest entry without returning it. */
  private dropHead(): void {
    const leaving = this.slots[this.head];
    if (leaving !== undefined) this.bytes -= Math.max(0, this.sizeOf(leaving));

    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.slots.length;
    this.length -= 1;
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
    this.dropHead();

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
    this.bytes = 0;

    return discarded;
  }
}

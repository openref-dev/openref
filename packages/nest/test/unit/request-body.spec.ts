import { describe, expect, it } from 'vitest';
import { readRequestBody } from '../../src/http/domain/request-body';

/**
 * The two halves of the fix that made a body taking route always answer, each on its own.
 *
 * WHY THIS FILE EXISTS RATHER THAN THE INTEGRATION SUITE ALONE. The defect the second review of
 * `T058` asked about is closed twice over, and measured over the wire the two halves are
 * indistinguishable: removing the classification leaves the suite green because the ended stream
 * guard absorbs it, removing the guard leaves it green because the classification never reaches a
 * stream, and only removing both reddens, at three cases. A falsification that can only remove
 * both proves the pair and says nothing about either, which is the shape of evidence this
 * repository calls a figure nothing compares. Each case below drives one half against a request
 * the other half cannot answer.
 *
 * THE FAKE STREAM NEVER EMITS, WHICH IS THE WHOLE INSTRUMENT. A real drained socket is exactly a
 * stream that will never emit `end` again, so a reader that reaches one and waits produces no
 * value at all; the deadline turns that absence into a rejection a case can assert about.
 */

/** What a read that never settled is reported as, so an absence becomes a value. */
const NEVER = 'the read never settled';

/** A readable that registers listeners and never calls any of them. */
function silentStream(ended: boolean): Record<string, unknown> {
  return {
    on: (): unknown => undefined,
    destroy: (): unknown => undefined,
    readableEnded: ended,
  };
}

/** Whatever the read produced, or {@link NEVER} when it produced nothing in time. */
async function within(deadlineMs: number, read: Promise<string>): Promise<string> {
  return Promise.race([
    read,
    new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(NEVER);
      }, deadlineMs);
    }),
  ]);
}

describe('readRequestBody', () => {
  it('should answer a parsed scalar body without reaching the stream at all', async () => {
    // Given a request the framework parsed into a number, beside a stream that will never emit.
    // The stream is deliberately not marked ended, so the guard cannot answer this one: only the
    // classification can, which is what makes this case discriminating.
    const request = { ...silentStream(false), body: 42, headers: {} };

    // When
    const body = await within(500, readRequestBody(request));

    // Then, `42` is a legal JSON document and a parser really does hand it over as a number
    expect(body).toBe('42');
  });

  it('should answer the null literal the same way, which the first edition read as no body', async () => {
    // Given
    const request = { ...silentStream(false), body: null, headers: {} };

    // When
    const body = await within(500, readRequestBody(request));

    // Then
    expect(body).toBe('null');
  });

  it('should answer no bytes rather than waiting when the stream has already ended', async () => {
    // Given a request the framework parsed nothing from, beside a stream that has ended and will
    // never emit again. The classification cannot answer this one, because there is genuinely no
    // parsed body: only the guard can.
    const request = { ...silentStream(true), headers: {} };

    // When
    const body = await within(500, readRequestBody(request));

    // Then
    expect(body).toBe('');
  });

  it('should still wait on a stream that has not ended, which is the ordinary path', async () => {
    // Given the presence half of the case above: without it, a guard that answered `''` for every
    // request would pass that case while breaking every real body
    const request = { ...silentStream(false), headers: {} };

    // When
    const body = await within(300, readRequestBody(request));

    // Then it really is waiting for bytes, rather than having answered early
    expect(body).toBe(NEVER);
  });

  it('should read an object body as the JSON it was parsed from', async () => {
    // Given, the case that worked before the fix and has to keep working
    const request = { ...silentStream(false), body: { a: 1 }, headers: {} };

    // When
    const body = await within(500, readRequestBody(request));

    // Then
    expect(body).toBe('{"a":1}');
  });

  it('should answer no text for a value no JSON parser produces', async () => {
    // Given, `JSON.stringify` answers `undefined` for a function and its declared return type
    // says otherwise, so the branch is named rather than left to it
    const request = { ...silentStream(false), body: (): void => undefined, headers: {} };

    // When
    const body = await within(500, readRequestBody(request));

    // Then
    expect(body).toBe('');
  });
});

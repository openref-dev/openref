import { describe, expect, it } from 'vitest';
import { ErrorCode, RemoteUnavailableError } from '@openref/core';
import { remoteStatusOf, toStateError } from '../../src/index';
import type { RemoteAttemptOutcome, RemoteStatus } from '../../src/index';

/**
 * The status partition and the error reduction: the two pure pieces every visible state is
 * built from.
 */

describe('remoteStatusOf', () => {
  it('should cover the whole partition of attempt outcome and version presence', () => {
    // Given: every combination of the two facts the status is defined over
    const cases: [RemoteAttemptOutcome, boolean, RemoteStatus][] = [
      ['none', false, 'pending'],
      ['none', true, 'stale'],
      ['success', false, 'fresh'],
      ['success', true, 'fresh'],
      ['failure', false, 'failed'],
      ['failure', true, 'degraded'],
    ];

    // When / Then
    for (const [outcome, hasVersion, expected] of cases) {
      expect(remoteStatusOf(outcome, hasVersion)).toBe(expected);
    }
  });
});

describe('toStateError', () => {
  it('should keep the ErrorCode of a project error', () => {
    // Given
    const cause = new RemoteUnavailableError('gone', ErrorCode.FED_REMOTE_UNAVAILABLE);

    // When
    const recorded = toStateError(cause, '2026-08-28T10:00:00.000Z');

    // Then
    expect(recorded).toEqual({
      at: '2026-08-28T10:00:00.000Z',
      code: 'FED_REMOTE_UNAVAILABLE',
      message: 'gone',
    });
  });

  it('should keep the name of a foreign error, because a fetch can fail outside this project', () => {
    // Given
    const cause = new TypeError('fetch failed');

    // When
    const recorded = toStateError(cause, '2026-08-28T10:00:00.000Z');

    // Then
    expect(recorded.code).toBe('TypeError');
    expect(recorded.message).toBe('fetch failed');
  });

  it('should reduce a thrown non-error to text rather than lose it', () => {
    // Given
    const cause = 'a string somebody threw';

    // When
    const recorded = toStateError(cause, '2026-08-28T10:00:00.000Z');

    // Then
    expect(recorded.code).toBe('UnknownError');
    expect(recorded.message).toBe('a string somebody threw');
  });
});

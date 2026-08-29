import { describe, expect, it } from 'vitest';
import { ErrorCode, InvalidOptionsError } from '@openref/core';
import {
  DEFAULT_FAILURE_MODE,
  DEFAULT_FETCH_TIMEOUT_MS,
  DEFAULT_REFRESH_MS,
  MAX_BACKOFF_MULTIPLIER,
  refreshDelayMs,
  resolveFailureMode,
  resolveIntervalMs,
  validateRemotes,
} from '../../src/index';
import type { FederationRemoteConfig } from '../../src/index';

/**
 * The configuration grammar of the remote lifecycle: what is refused before the first request,
 * and the deterministic backoff schedule.
 */

function remote(overrides: Partial<FederationRemoteConfig> = {}): FederationRemoteConfig {
  return { id: 'billing', url: 'https://billing.internal/openapi.json', ...overrides };
}

describe('validateRemotes', () => {
  it('should accept http and https remotes with distinct valid ids', () => {
    // Given
    const remotes = [
      remote(),
      remote({ id: 'orders', url: 'http://orders.internal:3000/openapi.json', prefix: '/orders' }),
    ];

    // When / Then
    expect(() => {
      validateRemotes(remotes);
    }).not.toThrow();
  });

  it('should refuse an empty remote list', () => {
    // Given
    const remotes: FederationRemoteConfig[] = [];

    // When / Then
    expect(() => {
      validateRemotes(remotes);
    }).toThrow(InvalidOptionsError);
  });

  it('should refuse two remotes with one id, holding remotes to the merge service rule', () => {
    // Given
    const remotes = [remote(), remote({ url: 'https://elsewhere.internal/openapi.json' })];

    // When
    const failure = (): void => {
      validateRemotes(remotes);
    };

    // Then
    expect(failure).toThrow(InvalidOptionsError);
    expect(failure).toThrow(/two services are configured with the id "billing"/);
  });

  it('should refuse an id outside the federation service alphabet', () => {
    // Given
    const remotes = [remote({ id: 'Billing' })];

    // When / Then
    expect(() => {
      validateRemotes(remotes);
    }).toThrow(/lower case letters, digits and hyphens/);
  });

  it('should refuse a prefix that is not an absolute path, by the merge rule', () => {
    // Given
    const remotes = [remote({ prefix: 'billing' })];

    // When / Then
    expect(() => {
      validateRemotes(remotes);
    }).toThrow(/is not an absolute path/);
  });

  it('should refuse a url that does not parse as an absolute URL', () => {
    // Given
    const remotes = [remote({ url: 'not a url' })];

    // When
    const failure = (): void => {
      validateRemotes(remotes);
    };

    // Then
    expect(failure).toThrow(InvalidOptionsError);
    expect(failure).toThrow(/is not an absolute URL/);
  });

  it.each(['ftp://host/spec.json', 'file:///etc/passwd', 'javascript:alert(1)'])(
    'should refuse the scheme of %s, because a remote is fetched over http or https only',
    (url) => {
      // Given
      const remotes = [remote({ url })];

      // When
      const failure = (): void => {
        validateRemotes(remotes);
      };

      // Then
      expect(failure).toThrow(InvalidOptionsError);
      expect(failure).toThrow(/http or https only/);
    },
  );
});

describe('resolveFailureMode', () => {
  it('should default to degrade, which is the mode SPEC 15 configures in its example', () => {
    // Given / When
    const mode = resolveFailureMode(undefined);

    // Then
    expect(mode).toBe(DEFAULT_FAILURE_MODE);
    expect(mode).toBe('degrade');
  });

  it('should refuse a mode that SPEC 15 does not define', () => {
    // Given
    const configured = 'explode' as unknown as 'degrade';

    // When
    let caught: unknown;
    try {
      resolveFailureMode(configured);
    } catch (cause) {
      caught = cause;
    }

    // Then
    expect(caught).toBeInstanceOf(InvalidOptionsError);
    expect((caught as InvalidOptionsError).code).toBe(ErrorCode.CONFIG_INVALID_OPTIONS);
  });
});

describe('resolveIntervalMs', () => {
  it('should fall back to the defaults SPEC 15 and the task name', () => {
    // Given / When / Then
    expect(resolveIntervalMs(undefined, 'refreshMs', DEFAULT_REFRESH_MS)).toBe(60_000);
    expect(resolveIntervalMs(undefined, 'timeoutMs', DEFAULT_FETCH_TIMEOUT_MS)).toBe(10_000);
    expect(resolveIntervalMs(45_000, 'refreshMs', DEFAULT_REFRESH_MS)).toBe(45_000);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'should refuse %s, because a duration is a positive integer of milliseconds',
    (value) => {
      // Given / When / Then
      expect(() => resolveIntervalMs(value, 'refreshMs', DEFAULT_REFRESH_MS)).toThrow(
        InvalidOptionsError,
      );
    },
  );
});

describe('refreshDelayMs', () => {
  it('should poll at the plain interval while healthy and after a single failure', () => {
    // Given
    const refreshMs = 1000;

    // When / Then: one blip does not deserve a penalty, so recovery is noticed at the same rate
    expect(refreshDelayMs(refreshMs, 0)).toBe(1000);
    expect(refreshDelayMs(refreshMs, 1)).toBe(1000);
  });

  it('should double on sustained failure and stop at the cap', () => {
    // Given
    const refreshMs = 1000;

    // When
    const delays = [2, 3, 4, 5, 50].map((failures) => refreshDelayMs(refreshMs, failures));

    // Then: 2x, 4x, then the cap, which stays the cap however long the outage lasts
    expect(delays).toEqual([2000, 4000, 8000, 8000, 8000]);
    expect(delays[4]).toBe(refreshMs * MAX_BACKOFF_MULTIPLIER);
  });

  it('should be deterministic: the same inputs always produce one delay, with no jitter', () => {
    // Given
    const inputs: [number, number][] = [
      [60_000, 0],
      [60_000, 3],
      [500, 7],
    ];

    // When / Then
    for (const [refreshMs, failures] of inputs) {
      expect(refreshDelayMs(refreshMs, failures)).toBe(refreshDelayMs(refreshMs, failures));
    }
  });
});

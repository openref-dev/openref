import { describe, expect, it, vi } from 'vitest';
import { createPageRunner } from '../../src/browser/runner-factory';

/**
 * The transport branch of T033: the page model's `proxyPath` decides what the console sends
 * through, and nothing else does.
 *
 * The runner package is replaced wholesale, because what this file owns is the choice and not
 * the transports: which class is constructed, from which fact, and that a page with no proxy
 * builds the runner it always built, with no `transport` key at all rather than an undefined
 * one, so the runner's own default stays the runner's.
 */

const mocks = vi.hoisted(() => ({
  createRunner: vi.fn((options: Record<string, unknown>) => ({ options })),
}));

vi.mock('@openref/runner', () => ({
  createRunner: mocks.createRunner,
  FetchStreamTransport: class FetchStreamTransport {
    readonly kind = 'stream';
  },
  ProxyHttpTransport: class ProxyHttpTransport {
    constructor(readonly options: { readonly endpoint: string }) {}
  },
}));

describe('createPageRunner', () => {
  it('should choose the proxy transport when the page carries the proxy path', async () => {
    // Given
    const { ProxyHttpTransport } = await import('@openref/runner');

    // When
    createPageRunner({ proxyPath: '/docs/_proxy' });

    // Then
    const options = mocks.createRunner.mock.calls.at(-1)?.[0] ?? {};
    expect(options.transport).toBeInstanceOf(ProxyHttpTransport);
    expect((options.transport as { options: { endpoint: string } }).options.endpoint).toBe(
      '/docs/_proxy',
    );
  });

  it('should build the direct runner, with no transport key, when the page carries none', () => {
    // Given a page whose host serves no proxy

    // When
    createPageRunner({});

    // Then, absent rather than undefined, so the runner default is the runner's own
    const options = mocks.createRunner.mock.calls.at(-1)?.[0] ?? {};
    expect('transport' in options).toBe(false);
    expect(options.visibility).toBe('public');
    expect(options.storage).toBe('session');
  });
});

import { RunnerError } from '@openref/core';
import { describe, expect, it, vi } from 'vitest';
import { ProxyHttpTransport } from '../../src/send/infrastructure/adapters/proxy-transport.adapter';
import type {
  FetchLike,
  FetchResponseLike,
} from '../../src/send/infrastructure/adapters/fetch-transport.adapter';
import type { RequestPlan } from '../../src/request/domain/request-plan';

/**
 * The browser half of the proxy of SPEC 14.5, which is deliberately the dumb half.
 *
 * EVERYTHING THAT KEEPS THE PROXY NARROW IS ON THE SERVER, and this file is about the two things
 * that are not: that the envelope goes to this origin and nowhere else, and that the proxy's own
 * status is never read as the API's. The second is the one worth a test rather than a comment: a
 * 403 from the documentation server refusing to send and a 403 from the API refusing the caller
 * are the same three digits, and a console that shows the first as the second has told a reader
 * their credentials are wrong when the truth is that nothing was sent.
 */

/** The init object this transport hands to `fetch`, as the stub records it. */
type FetchInit = Parameters<FetchLike>[1];

/** A plan as `buildRequest` produces one. */
const PLAN: RequestPlan = {
  method: 'GET',
  url: 'https://api.example.com/v1/orders',
  headers: { authorization: 'Bearer token-123' },
  body: null,
};

/**
 * A `fetch` that answers with one canned response and records the call.
 *
 * @param status - What the proxy route answers
 * @param body - Its body
 * @returns The stub, with the calls it received
 */
function stubFetch(
  status: number,
  body: string,
): { call: FetchLike; calls: { url: string; init: FetchInit }[] } {
  const calls: { url: string; init: FetchInit }[] = [];

  const call: FetchLike = (url, init) => {
    calls.push({ url, init });

    const response: FetchResponseLike = {
      status,
      statusText: '',
      headers: { forEach: () => undefined },
      text: () => Promise.resolve(body),
    };

    return Promise.resolve(response);
  };

  return { call, calls };
}

/** The envelope the proxy route answers a forwarded request with. */
const FORWARDED = JSON.stringify({
  status: 403,
  statusText: 'Forbidden',
  headers: [['content-type', 'application/json']],
  body: '{"error":"scope missing"}',
});

describe('ProxyHttpTransport', () => {
  it('should refuse an endpoint that is not a path on this origin', () => {
    // Given the one thing this transport must never do, which is send the envelope somewhere
    // else. A path cannot name an origin, so the type of the option is the check.
    // When, Then
    expect(
      () => new ProxyHttpTransport({ endpoint: 'https://elsewhere.example.com/_proxy' }),
    ).toThrow(RunnerError);
    expect(() => new ProxyHttpTransport({ endpoint: '//elsewhere.example.com/_proxy' })).toThrow(
      RunnerError,
    );
  });

  it('should post the request as an envelope to this origin, with no cookies of ours', async () => {
    // Given
    const { call, calls } = stubFetch(200, FORWARDED);
    const transport = new ProxyHttpTransport({ endpoint: '/docs/_proxy', fetch: call });

    // When
    await transport.send(PLAN);

    // Then the target is in the body rather than in the url, and the fetch to our own origin
    // carries none of the reader's session with the documentation site
    expect(calls[0]?.url).toBe('/docs/_proxy');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      method: 'GET',
      url: 'https://api.example.com/v1/orders',
      headers: { authorization: 'Bearer token-123' },
      body: null,
    });
  });

  it('should read the API status out of the envelope rather than off the response', async () => {
    // Given a proxy that forwarded the request and an API that refused the caller. The route
    // answered 200 carrying a 403, and the reader has to be shown the API's answer.
    const { call } = stubFetch(200, FORWARDED);
    const transport = new ProxyHttpTransport({ endpoint: '/docs/_proxy', fetch: call });

    // When
    const response = await transport.send(PLAN);

    // Then
    expect(response.status).toBe(403);
    expect(response.statusText).toBe('Forbidden');
    expect(response.body).toBe('{"error":"scope missing"}');
    expect(response.headers).toEqual([['content-type', 'application/json']]);
  });

  it('should report a refusal as a refusal and not as the API answering', async () => {
    // Given the proxy declining to send, which is a 403 from our own server. Reading it as the
    // API's status would tell a reader their credentials were rejected by a host that was never
    // contacted.
    const { call } = stubFetch(403, JSON.stringify({ error: 'the loopback' }));
    const transport = new ProxyHttpTransport({ endpoint: '/docs/_proxy', fetch: call });

    // When, Then
    await expect(transport.send(PLAN)).rejects.toThrow(/did not send this request: the loopback/);
  });

  it('should refuse a body of bytes rather than decoding it into the envelope', async () => {
    // Given a multipart body carrying a file. Putting it in a JSON string would decode it through
    // UTF-8, replace every byte that is not a code point, and upload a corrupted file with a 200.
    const { call, calls } = stubFetch(200, FORWARDED);
    const transport = new ProxyHttpTransport({ endpoint: '/docs/_proxy', fetch: call });

    // When, Then
    await expect(
      transport.send({ ...PLAN, method: 'POST', body: new Uint8Array([0xff, 0xfe]) }),
    ).rejects.toThrow(/carries bytes/);
    expect(calls).toEqual([]);
  });

  it('should refuse an answer that is not an envelope', async () => {
    // Given something answering on that path that is not this proxy, which is what a
    // misconfigured mount or an intercepting service worker looks like
    const { call } = stubFetch(200, '<html>not this</html>');
    const transport = new ProxyHttpTransport({ endpoint: '/docs/_proxy', fetch: call });

    // When, Then
    await expect(transport.send(PLAN)).rejects.toThrow(/not a proxy envelope/);
  });

  it('should stop waiting after the timeout rather than holding the console open', async () => {
    // Given a proxy that never answers, and the same bound every other transport here carries
    vi.useFakeTimers();
    const abort = vi.fn();
    const call: FetchLike = (_url, init) => {
      init.signal?.addEventListener('abort', abort);

      return new Promise<FetchResponseLike>(() => undefined);
    };
    const transport = new ProxyHttpTransport({
      endpoint: '/docs/_proxy',
      fetch: call,
      timeoutMs: 100,
    });

    try {
      // When
      void transport.send(PLAN);
      await vi.advanceTimersByTimeAsync(150);

      // Then
      expect(abort).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

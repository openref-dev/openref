import { RunnerError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { PathRewriteHttpTransport } from '../../src/send/infrastructure/adapters/path-rewrite-transport.adapter';
import type {
  FetchLike,
  FetchResponseLike,
} from '../../src/send/infrastructure/adapters/fetch-transport.adapter';
import type { RequestPlan } from '../../src/request/domain/request-plan';

/**
 * The browser half of the generated proxy of SPEC 16.2, which is the half that has to agree with
 * a configuration file it cannot see.
 *
 * WHAT IS UNDER TEST IS AN AGREEMENT RATHER THAN A BEHAVIOUR. The rules were written at build
 * time by `@openref/static`: one rule per pinned upstream at `<prefix>/u<N>/`, indexed by
 * position, with a suffix guard that answers 403. This transport has to address exactly those
 * rules and refuse exactly what they refuse, and every case below is one clause of that
 * agreement. The rules themselves are proved on the other side, in `proxy-files.spec.ts` and in
 * `proxy-config-tools.spec.ts`, which run the real platform parsers over the generated files.
 */

/** The init object this transport hands to `fetch`, as the stub records it. */
type FetchInit = Parameters<FetchLike>[1];

/** The two upstreams a document with two servers pins, in `u<N>` order. */
const UPSTREAMS = ['https://api.example.com/v1', 'https://eu.api.example.com'];

/** A `fetch` that answers 200 with an empty body and records what it was called with. */
function stubFetch(): { call: FetchLike; calls: { url: string; init: FetchInit }[] } {
  const calls: { url: string; init: FetchInit }[] = [];

  const call: FetchLike = (url, init) => {
    calls.push({ url, init });

    const response: FetchResponseLike = {
      status: 204,
      statusText: 'No Content',
      headers: {
        forEach: (callback) => {
          callback('yes', 'x-seen');
        },
        get: () => null,
      },
      text: () => Promise.resolve(''),
    };

    return Promise.resolve(response);
  };

  return { call, calls };
}

/** A plan for one url, as `buildRequest` produces one. */
function planFor(url: string): RequestPlan {
  return { method: 'GET', url, headers: { authorization: 'Bearer token-123' }, body: null };
}

/** A transport over the two pinned upstreams and a stubbed `fetch`. */
function transportWith(call: FetchLike, prefix = '/docs/_proxy'): PathRewriteHttpTransport {
  return new PathRewriteHttpTransport({ prefix, upstreams: UPSTREAMS, fetch: call });
}

describe('PathRewriteHttpTransport, the address it builds', () => {
  it('should refuse a prefix that is not a path on this origin', () => {
    // Given the one thing this transport must never do, which is send somewhere else. A path
    // cannot name an origin, so the constructor is where that is settled.
    // When, Then
    expect(
      () =>
        new PathRewriteHttpTransport({
          prefix: 'https://elsewhere.example.com/_proxy',
          upstreams: UPSTREAMS,
        }),
    ).toThrow(RunnerError);
    expect(
      () =>
        new PathRewriteHttpTransport({
          prefix: '//elsewhere.example.com/_proxy',
          upstreams: UPSTREAMS,
        }),
    ).toThrow(RunnerError);
  });

  it('should send to the rule of the upstream it matched, with the base path stripped', async () => {
    // Given
    const { call, calls } = stubFetch();

    // When
    await transportWith(call).send(planFor('https://api.example.com/v1/orders/42?limit=10'));

    // Then the address is a path on this origin, under `u0`, carrying what the rule concatenates
    // onto its pinned base. The `/v1` is the upstream's own and must not be sent twice.
    expect(calls[0]?.url).toBe('/docs/_proxy/u0/orders/42?limit=10');
  });

  it('should index by position in the pinned list rather than by anything about the host', async () => {
    // Given the second upstream, which is `u1` because it is second and for no other reason
    const { call, calls } = stubFetch();

    // When
    await transportWith(call).send(planFor('https://eu.api.example.com/orders'));

    // Then
    expect(calls[0]?.url).toBe('/docs/_proxy/u1/orders');
  });

  it('should take the first matching rule when two upstreams overlap', async () => {
    // Given an origin pinned twice, once bare and once with a path under it. Every generated
    // format matches its rules in order, so the earlier rule is the one that serves the request
    // and the transport has to agree rather than prefer the longer base.
    const { call, calls } = stubFetch();
    const transport = new PathRewriteHttpTransport({
      prefix: '/_proxy',
      upstreams: ['https://api.example.com', 'https://api.example.com/v1'],
      fetch: call,
    });

    // When
    await transport.send(planFor('https://api.example.com/v1/orders'));

    // Then u0, whose base is the bare origin, keeping the `/v1` in the suffix
    expect(calls[0]?.url).toBe('/_proxy/u0/v1/orders');
  });

  it('should keep a trailing slash so an empty suffix still matches a rule', async () => {
    // Given a request for the upstream root itself. `<prefix>/u0` on its own matches no
    // generated rule, so it would be answered by the site's own 404 rather than by the API.
    const { call, calls } = stubFetch();

    // When
    await transportWith(call).send(planFor('https://api.example.com/v1'));

    // Then
    expect(calls[0]?.url).toBe('/docs/_proxy/u0/');
  });

  it('should not match an upstream on a path that merely starts with the same characters', async () => {
    // Given `https://api.example.com/v1` pinned and a request to `/v11`, which is a different
    // path. A prefix comparison alone would send it to u0, which concatenates onto `/v1`.
    const { call } = stubFetch();

    // When, Then
    await expect(
      transportWith(call).send(planFor('https://api.example.com/v11/orders')),
    ).rejects.toThrow(RunnerError);
  });

  it('should omit the reader credentials that belong to the documentation site', async () => {
    // Given, the request travels to this origin, which is where the reader's docs cookies live.
    // The API credentials are in the headers the runner built and travel as headers.
    const { call, calls } = stubFetch();

    // When
    await transportWith(call).send(planFor('https://api.example.com/v1/orders'));

    // Then
    expect(calls[0]?.init.credentials).toBe('omit');
    expect(calls[0]?.init.headers.authorization).toBe('Bearer token-123');
  });

  it('should read the real response back rather than looking for an envelope', async () => {
    // Given, unlike the SPEC 14.5 proxy there is no JSON envelope here: what comes back is the
    // API's own answer, forwarded by the platform.
    const { call } = stubFetch();

    // When
    const response = await transportWith(call).send(planFor('https://api.example.com/v1/orders'));

    // Then
    expect(response.status).toBe(204);
    expect(response.statusText).toBe('No Content');
    expect(response.headers).toEqual([['x-seen', 'yes']]);
  });
});

describe('PathRewriteHttpTransport, what it refuses', () => {
  it('should refuse a url no pinned upstream serves rather than sending it direct', async () => {
    // Given, the whole point of a console under generated rules is that it cannot address a host
    // the deployment did not pin. A fallback to direct mode would be that guarantee not holding.
    const { call, calls } = stubFetch();

    // When, Then
    await expect(
      transportWith(call).send(planFor('https://evil.example.com/v1/orders')),
    ).rejects.toThrow(RunnerError);
    expect(calls).toHaveLength(0);
  });

  it('should name the origin it refused and never the url, which carries the query', async () => {
    // Given a plan whose query holds an apiKey, which is where SPEC 14.2 puts one
    const { call } = stubFetch();
    const url = 'https://evil.example.com/orders?api_key=secret-value';

    // When
    const failure = await transportWith(call)
      .send(planFor(url))
      .catch((error: unknown) => error);

    // Then the reader is told which host was refused and the credential is not in the message
    expect(failure).toBeInstanceOf(RunnerError);
    expect(String(failure)).toContain('https://evil.example.com');
    expect(String(failure)).not.toContain('secret-value');
  });

  it('should refuse a relative server, which no generated rule was written for', async () => {
    // Given a document server such as `/api`, which `planUpstreams` skips as this site's own
    // origin. No rule exists for it, so there is no rule to address.
    const { call } = stubFetch();

    // When, Then
    await expect(transportWith(call).send(planFor('/api/orders'))).rejects.toThrow(RunnerError);
  });

  it('should refuse a scheme a route rewrite cannot carry', async () => {
    // Given
    const { call } = stubFetch();

    // When, Then
    await expect(transportWith(call).send(planFor('ftp://api.example.com/v1/x'))).rejects.toThrow(
      RunnerError,
    );
  });

  it('should refuse a suffix the generated guard refuses, rather than forming a 403', async () => {
    // Given a doubly encoded dot segment, which survives the URL parser and which the guard in
    // the Nitro route, the Pages Function and the CloudFront function all answer 403 to. The
    // server side is the enforcement; this is the client agreeing with it.
    const { call, calls } = stubFetch();

    // When, Then
    await expect(
      transportWith(call).send(planFor('https://api.example.com/v1/%252e%252e/secrets')),
    ).rejects.toThrow(RunnerError);
    expect(calls).toHaveLength(0);
  });

  it('should refuse an encoded separator that is still encoded after one decode', async () => {
    // Given `%252f`, which one decode turns back into `%2f`: still ambiguous to whoever decodes
    // next, which is exactly what the generated guard's second expression is for.
    const { call, calls } = stubFetch();

    // When, Then
    await expect(
      transportWith(call).send(planFor('https://api.example.com/v1/a%252fb')),
    ).rejects.toThrow(RunnerError);
    expect(calls).toHaveLength(0);
  });

  it('should let an ordinary encoded value through, because the guard is not a ban on percent signs', async () => {
    // Given a path parameter whose value carried a slash, which `encodeValue` percent encoded.
    // A guard that refused this would refuse the matrix of SPEC 14.2 rather than a traversal.
    const { call, calls } = stubFetch();

    // When
    await transportWith(call).send(planFor('https://api.example.com/v1/orders/a%2Fb'));

    // Then
    expect(calls[0]?.url).toBe('/docs/_proxy/u0/orders/a%2Fb');
  });
});

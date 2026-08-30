import { describe, expect, it } from 'vitest';
import { replyText } from '../../src/http/domain/reply';
import {
  forwardableRequestHeaders,
  forwardableResponseHeaders,
  proxyLogRecord,
  type ProxyLogRecord,
} from '../../src/proxy/domain/forwarding';
import { ReferenceService } from '../../src/reference/application/services/reference.service';
import { referenceRoutes } from '../../src/reference/domain/routes';
import { assetPlan, specification } from '../mocks/fixtures';
import type {
  IAddressResolver,
  IOutboundHttp,
  OutboundRequest,
  OutboundResponse,
} from '../../src/proxy/application/ports/proxy-outbound.port';
import type { ProxyOptions } from '../../src/reference/application/services/reference.service';

/**
 * What crosses the proxy, what is left behind, and what the route answers when it will not send.
 *
 * THE ROUTE EXISTS ON EVERY MOUNT AND REFUSES ON MOST OF THEM. A proxy route registered only where
 * the proxy is enabled makes "off" and "misconfigured" the same 404 from outside, so this one
 * answers 403 and says which it is. The first case below is that state, because it is the default
 * and the one nobody configures their way into deliberately.
 */

/** A resolver that answers with one public address for anything. */
const publicResolver: IAddressResolver = {
  resolve: (): Promise<readonly string[]> => Promise.resolve(['93.184.216.34']),
};

/** A transport that records the request and answers with a fixture. */
class RecordingOutbound implements IOutboundHttp {
  readonly sent: OutboundRequest[] = [];

  /** @param response - What to answer with */
  constructor(
    private readonly response: OutboundResponse = {
      status: 200,
      statusText: 'OK',
      headers: [
        ['content-type', 'application/json'],
        ['set-cookie', 'session=abc; Path=/'],
      ],
      body: '{"ok":true}',
    },
  ) {}

  /** @inheritdoc */
  send(request: OutboundRequest): Promise<OutboundResponse> {
    this.sent.push(request);

    return Promise.resolve(this.response);
  }
}

/**
 * A reference whose proxy is configured as the case needs.
 *
 * @param proxy - The proxy options, absent for a mount that never turned it on
 * @returns The service
 */
function service(proxy?: ProxyOptions): ReferenceService {
  return new ReferenceService({
    document: specification(),
    basePath: '/docs',
    assets: assetPlan(),
    highlight: false,
    ...(proxy === undefined ? {} : { proxy }),
  });
}

/**
 * One proxied request, as the page sends it.
 *
 * @param envelope - What to put in the body
 * @returns The request
 */
function proxyRequest(envelope: unknown): {
  params: Record<string, string>;
  headers: Record<string, string>;
  body: string;
} {
  return { params: {}, headers: {}, body: JSON.stringify(envelope) };
}

/** The target every case here sends to, which is under the fixture's declared server. */
const TARGET = 'https://api.example.test/orders/7';

describe('the proxy route', () => {
  it('should be registered on every mount, as the one route that is not a GET', () => {
    // Given the route table for a mount
    const routes = referenceRoutes('/docs');

    // When
    const proxy = routes.filter((route) => route.id === 'proxy');

    // Then
    expect(proxy).toEqual([{ id: 'proxy', pattern: '/docs/_proxy', method: 'post' }]);
    expect(routes.filter((route) => route.method === 'post')).toHaveLength(1);
  });

  it('should refuse when the host never turned the proxy on, which is the default', async () => {
    // Given a mount configured exactly as every mount before M2 was
    const reference = service();

    // When
    const reply = await reference.handle('proxy', proxyRequest({ method: 'GET', url: TARGET }));

    // Then
    expect(reply.status).toBe(403);
    expect(replyText(reply)).toContain('not enabled');
    expect(reply.headers['cache-control']).toBe('no-store');
  });

  it('should refuse a target outside the document servers, with the reason and no request sent', async () => {
    // Given
    const outbound = new RecordingOutbound();
    const reference = service({ enabled: true, resolver: publicResolver, outbound });

    // When
    const reply = await reference.handle(
      'proxy',
      proxyRequest({ method: 'GET', url: 'https://evil.example.com/steal' }),
    );

    // Then
    expect(reply.status).toBe(403);
    expect(replyText(reply)).toContain('is not under any server');
    expect(outbound.sent).toEqual([]);
  });

  it('should forward an allowed request and carry the answer inside a 200', async () => {
    // Given. The API's status travels inside the envelope: a 403 from the API and a refusal from
    // the proxy have to be different things on the wire, or a reader debugs the wrong system.
    const outbound = new RecordingOutbound();
    const reference = service({ enabled: true, resolver: publicResolver, outbound });

    // When
    const reply = await reference.handle('proxy', proxyRequest({ method: 'GET', url: TARGET }));

    // Then
    expect(reply.status).toBe(200);
    expect(reply.headers['cache-control']).toBe('no-store');
    const envelope = JSON.parse(replyText(reply)) as { status: number; body: string };
    expect(envelope.status).toBe(200);
    expect(envelope.body).toBe('{"ok":true}');
  });

  it('should refuse a body that is not an envelope rather than defaulting its way to a request', async () => {
    // Given
    const outbound = new RecordingOutbound();
    const reference = service({ enabled: true, resolver: publicResolver, outbound });

    // When
    const reply = await reference.handle('proxy', {
      params: {},
      headers: {},
      body: 'not json at all',
    });

    // Then
    expect(reply.status).toBe(403);
    expect(outbound.sent).toEqual([]);
  });

  it('should keep the reader cookie out of the request unless the host asked for it', async () => {
    // Given a page whose reader has a session with the documentation site, and a request the
    // console built. SPEC 19.10 puts the switch off, and off means the API is not handed the
    // reader's session with somebody else's server.
    const outbound = new RecordingOutbound();
    const reference = service({ enabled: true, resolver: publicResolver, outbound });

    // When
    const reply = await reference.handle('proxy', {
      params: {},
      headers: {},
      body: JSON.stringify({
        method: 'GET',
        url: TARGET,
        headers: { cookie: 'docs_session=secret', authorization: 'Bearer token-123' },
      }),
    });

    // Then the cookie did not cross and the authorization did, which is the request's own
    expect(reply.status).toBe(200);
    expect(outbound.sent[0]?.headers.cookie).toBeUndefined();
    expect(outbound.sent[0]?.headers.authorization).toBe('Bearer token-123');
  });

  it('should keep a Set-Cookie out of the answer unless the host asked for it', async () => {
    // Given an API that sets a cookie, and a proxy that has not been told to carry them
    const outbound = new RecordingOutbound();
    const reference = service({ enabled: true, resolver: publicResolver, outbound });

    // When
    const reply = await reference.handle('proxy', proxyRequest({ method: 'GET', url: TARGET }));

    // Then
    const envelope = JSON.parse(replyText(reply)) as { headers: [string, string][] };
    expect(envelope.headers.map(([name]) => name)).not.toContain('set-cookie');
  });

  it('should carry cookies in both directions once the host turns them on', async () => {
    // Given the switch on, which is what makes a cookie parameter of SPEC 14.2 sendable at all
    const outbound = new RecordingOutbound();
    const reference = service({
      enabled: true,
      forwardCookies: true,
      resolver: publicResolver,
      outbound,
    });

    // When
    const reply = await reference.handle('proxy', {
      params: {},
      headers: {},
      body: JSON.stringify({ method: 'GET', url: TARGET, headers: { cookie: 'sid=1' } }),
    });

    // Then
    expect(outbound.sent[0]?.headers.cookie).toBe('sid=1');
    const envelope = JSON.parse(replyText(reply)) as { headers: [string, string][] };
    expect(envelope.headers.map(([name]) => name)).toContain('set-cookie');
  });
});

describe('forwardableRequestHeaders', () => {
  it('should leave Host and every X-Forwarded header behind', () => {
    // Given a page's headers as a browser and a load balancer between them would write them.
    // `Host` names this documentation server, so forwarding it asks the API to answer as
    // somebody else; `X-Forwarded-For` is read as a claim about who is calling.
    const headers = {
      host: 'docs.example.com',
      'X-Forwarded-For': '10.0.0.1',
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'docs.example.com',
      forwarded: 'for=10.0.0.1',
      via: '1.1 vegur',
      origin: 'https://docs.example.com',
      referer: 'https://docs.example.com/docs/get-orders',
      'content-length': '17',
      connection: 'keep-alive',
      accept: 'application/json',
    };

    // When
    const forwarded = forwardableRequestHeaders(headers);

    // Then exactly one header crossed, and it is the one that describes the request
    expect(forwarded).toEqual({ accept: 'application/json' });
  });

  it('should lower case what it forwards, so one header cannot arrive twice', () => {
    // Given
    // When
    const forwarded = forwardableRequestHeaders({ 'Content-Type': 'application/json' });

    // Then
    expect(forwarded).toEqual({ 'content-type': 'application/json' });
  });
});

describe('forwardableResponseHeaders', () => {
  it('should strip the headers that describe a body this proxy re-encodes', () => {
    // Given an answer that was gzipped and chunked on the way in, which says nothing true about
    // the JSON envelope it leaves in
    // When
    const forwarded = forwardableResponseHeaders([
      ['content-type', 'application/json'],
      ['content-encoding', 'gzip'],
      ['transfer-encoding', 'chunked'],
      ['content-length', '12'],
    ]);

    // Then
    expect(forwarded).toEqual([['content-type', 'application/json']]);
  });
});

describe('proxyLogRecord', () => {
  it('should carry no token from a request that had one', () => {
    // Given the request a signed in reader sends, with a bearer token in a header and an apiKey
    // in the query string, which is where SPEC 14.4 puts one
    const record = proxyLogRecord({
      method: 'GET',
      url: 'https://api.example.test/orders?api_key=secret-key',
      status: 200,
      refusedBecause: null,
      durationMs: 12,
      headers: { authorization: 'Bearer token-123', cookie: 'sid=abc' },
    });

    // When
    const written = JSON.stringify(record);

    // Then nothing secret is in the line, in any field, including the query the url carried
    expect(written).not.toContain('token-123');
    expect(written).not.toContain('secret-key');
    expect(written).not.toContain('sid=abc');
    expect(record.target).toBe('https://api.example.test/orders');
  });

  it('should still say which headers were carried, because that is the fact an operator needs', () => {
    // Given, and this is what keeps the case above from passing on a record that says nothing
    const record: ProxyLogRecord = proxyLogRecord({
      method: 'GET',
      url: 'https://api.example.test/orders',
      status: 200,
      refusedBecause: null,
      durationMs: 12,
      headers: { Authorization: 'Bearer token-123' },
    });

    // When, Then
    expect(record.headerNames).toEqual(['authorization']);
  });

  it('should record a refusal with its reason and no status', () => {
    // Given
    const record = proxyLogRecord({
      method: 'GET',
      url: 'https://api.example.test/orders',
      status: null,
      refusedBecause: 'the loopback',
      durationMs: 1,
      headers: {},
    });

    // When, Then
    expect(record.status).toBeNull();
    expect(record.refusedBecause).toBe('the loopback');
  });
});

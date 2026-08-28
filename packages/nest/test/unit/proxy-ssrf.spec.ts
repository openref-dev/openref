import { addressRefusal, isAddressLiteral, parseIpv4, ProxyBlockedError } from '@openref/core';
import { describe, expect, it } from 'vitest';
import { buildAllowlist, decideTarget } from '../../src/proxy/domain/allowlist';
import { ProxyService } from '../../src/proxy/application/services/proxy.service';
import type {
  IAddressResolver,
  IOutboundHttp,
  OutboundRequest,
  OutboundResponse,
} from '../../src/proxy/application/ports/proxy-outbound.port';

/**
 * The SSRF defence of SPEC 14.5, attacked rather than demonstrated.
 *
 * WHAT MAKES THESE CASES DIFFERENT FROM THE REST OF THIS PACKAGE'S TESTS is that a passing proxy
 * test proves the least of any test here. "The request went through" is what a proxy with no
 * checks at all also does, so every case below is about a request that must not go through, and
 * the assertion that matters in each is the one about what the transport was never asked to send.
 *
 * THE TRANSPORT RECORDS EVERY REQUEST IT WAS GIVEN, and that recording is the subject. A refusal
 * asserted only by catching an error would pass on an implementation that sends the request and
 * then throws, which is a proxy that has already done the damage.
 */

/** A resolver that answers from a script, one answer per call. */
class ScriptedResolver implements IAddressResolver {
  readonly calls: string[] = [];

  /** @param answers - What to return, in order; the last one repeats */
  constructor(private readonly answers: readonly (readonly string[])[]) {}

  /** @inheritdoc */
  resolve(hostname: string): Promise<readonly string[]> {
    const index = Math.min(this.calls.length, this.answers.length - 1);
    this.calls.push(hostname);

    return Promise.resolve(this.answers[index] ?? []);
  }
}

/** A transport that records what it was asked to send and answers with a fixture. */
class RecordingOutbound implements IOutboundHttp {
  readonly sent: OutboundRequest[] = [];

  /** @param response - What to answer with */
  constructor(
    private readonly response: OutboundResponse = {
      status: 200,
      statusText: 'OK',
      headers: [['content-type', 'application/json']],
      body: '{"ok":true}',
    },
  ) {}

  /** @inheritdoc */
  send(request: OutboundRequest): Promise<OutboundResponse> {
    this.sent.push(request);

    return Promise.resolve(this.response);
  }
}

/** The document's servers, as every case here declares them. */
const SERVERS = ['https://api.example.com/v1'];

/**
 * A proxy over one hostname's resolution.
 *
 * @param answers - What the resolver says, one entry per call
 * @param outbound - The transport, so a test can read what was sent
 * @param servers - The document's servers, defaulting to one public API
 * @returns The service under test
 */
function proxyOver(
  answers: readonly (readonly string[])[],
  outbound: RecordingOutbound,
  servers: readonly string[] = SERVERS,
): ProxyService {
  return new ProxyService({
    allowlist: buildAllowlist(servers),
    resolver: new ScriptedResolver(answers),
    outbound,
  });
}

describe('addressRefusal', () => {
  it('should refuse the four addresses a forged request aims at', () => {
    // Given the loopback, the cloud instance metadata service, a private network and the IPv4
    // mapped form of the loopback, which is the one that looks like none of the others
    // When, Then
    expect(addressRefusal('127.0.0.1')).toContain('loopback');
    expect(addressRefusal('169.254.169.254')).toContain('link local');
    expect(addressRefusal('10.1.2.3')).toContain('private');
    expect(addressRefusal('::ffff:127.0.0.1')).toContain('mapped');
  });

  it('should refuse a range a denylist would have to have remembered', () => {
    // Given the blocks that are not in anybody's first draft. The policy is an allowlist of
    // address space, so each of these is refused by not being global unicast rather than by
    // somebody having thought of it.
    // When, Then
    expect(addressRefusal('0.0.0.0')).not.toBeNull();
    expect(addressRefusal('100.64.0.1')).not.toBeNull();
    expect(addressRefusal('198.18.0.1')).not.toBeNull();
    expect(addressRefusal('255.255.255.255')).not.toBeNull();
    expect(addressRefusal('fd00::1')).not.toBeNull();
    expect(addressRefusal('fe80::1')).not.toBeNull();
    expect(addressRefusal('::1')).not.toBeNull();
  });

  it('should refuse a dotted quad written with a leading zero rather than reading it', () => {
    // Given `0177.0.0.1`, which is octal to a C resolver and 177.0.0.1 to a parser that strips
    // zeros. The same text naming two hosts is not something to have an opinion about.
    // When, Then
    expect(parseIpv4('0177.0.0.1')).toBeNull();
    expect(addressRefusal('0177.0.0.1')).toContain('not an IP address');
  });

  it('should admit a public address, so the refusals above are not refusing everything', () => {
    // Given, and this is the case that keeps every assertion above from passing on a function
    // that returns a reason for anything at all
    // When, Then
    expect(addressRefusal('93.184.216.34')).toBeNull();
    expect(addressRefusal('2606:2800:220:1:248:1893:25c8:1946')).toBeNull();
  });

  it('should tell an address literal from a name', () => {
    // Given, When, Then
    expect(isAddressLiteral('127.0.0.1')).toBe(true);
    expect(isAddressLiteral('[::1]')).toBe(true);
    expect(isAddressLiteral('api.example.com')).toBe(false);
  });
});

describe('the allowlist', () => {
  it('should refuse everything when the document declares no server', () => {
    // Given the default state, which is what a document with no `servers` block produces and the
    // one a hurried reader ends up in. An empty allowlist is the proxy being off, and a loop over
    // no entries that refuses nothing is the proxy being open.
    const allowlist = buildAllowlist([]);

    // When
    const decision = decideTarget(allowlist, 'https://api.example.com/v1/orders');

    // Then
    expect(decision.allowed).toBe(false);
    expect(decision.allowed ? '' : decision.reason).toContain('the proxy is off');
  });

  it('should admit a url under a declared server and refuse one beside it', () => {
    // Given a server with a base path, and a second API on the same host under a path that
    // begins with the same characters
    const allowlist = buildAllowlist(SERVERS);

    // When, Then
    expect(decideTarget(allowlist, 'https://api.example.com/v1/orders/7').allowed).toBe(true);
    expect(decideTarget(allowlist, 'https://api.example.com/v10/orders').allowed).toBe(false);
    expect(decideTarget(allowlist, 'https://api.example.com/admin').allowed).toBe(false);
    expect(decideTarget(allowlist, 'https://other.example.com/v1/orders').allowed).toBe(false);
    expect(decideTarget(allowlist, 'http://api.example.com/v1/orders').allowed).toBe(false);
  });

  it('should report a server it cannot read rather than dropping it', () => {
    // Given a relative server and a templated one, both of which a document may declare and
    // neither of which names a host the proxy could reach
    const allowlist = buildAllowlist(['/api', '{scheme}://api.example.com']);

    // When, Then
    expect(allowlist.targets).toEqual([]);
    expect(allowlist.ignored).toHaveLength(2);
  });
});

/**
 * The prefix is a boundary only while the suffix cannot climb out of it.
 *
 * FOUND BY THE PRE-M4 REVIEW, AND IT WAS THE FOURTH THING ASKING THIS QUESTION WITH NO GUARD.
 * `T040` measured 23 leaks across the three generated artefacts and closed them with one shared
 * refusal; this route, which concatenates a client contributed suffix onto a pinned base in
 * exactly the same way, never received it. Measured then: of eight spellings driven through
 * `decideTarget`, seven were admitted and forwarded to the wire encoded, and the single refusal
 * came from `new URL` collapsing a literal `../` rather than from any policy here.
 */
describe('decideTarget, a suffix that climbs above the pinned base', () => {
  const allowlist = buildAllowlist(['https://api.example.com/v1']);

  it.each([
    'https://api.example.com/v1/../secret',
    'https://api.example.com/v1/..%2fsecret',
    'https://api.example.com/v1/%2e%2e%2fsecret',
    'https://api.example.com/v1/%252e%252e/secret',
    'https://api.example.com/v1/..;/secret',
    'https://api.example.com/v1/..%5csecret',
    'https://api.example.com/v1/..%2f..%2fadmin',
    'https://api.example.com/v1/%zz',
  ])('should refuse %s', (candidate) => {
    // Given the allowlist above and a url whose path below the base is a dot segment

    // When
    const decision = decideTarget(allowlist, candidate);

    // Then it is refused, in whichever spelling it arrived
    expect(decision.allowed).toBe(false);
  });

  it.each([
    'https://api.example.com/v1',
    'https://api.example.com/v1/orders',
    'https://api.example.com/v1/orders/42',
    'https://api.example.com/v1/a%20b/c',
  ])('should still admit the ordinary request %s', (candidate) => {
    // Given the same allowlist and a request a reader would really send

    // When
    const decision = decideTarget(allowlist, candidate);

    // Then it passes, because a proxy that refuses everything is not the fix
    expect(decision.allowed).toBe(true);
  });

  it('should apply the same refusal to a server mounted at the root', () => {
    // Given a server with no base path, where the suffix is the whole path
    const root = buildAllowlist(['https://api.example.com']);

    // When, Then
    expect(decideTarget(root, 'https://api.example.com/..%2fsecret').allowed).toBe(false);
    expect(decideTarget(root, 'https://api.example.com/orders').allowed).toBe(true);
  });
});

describe('ProxyService', () => {
  it('should refuse a hostname that resolves to the loopback, sending nothing', async () => {
    // Given
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['127.0.0.1']], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(ProxyBlockedError);

    // And nothing was sent, which is the assertion a refusal after the fact would fail
    expect(outbound.sent).toEqual([]);
  });

  it('should refuse a hostname that resolves to the instance metadata service', async () => {
    // Given the address every cloud forgery aims at
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['169.254.169.254']], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/link local/);
    expect(outbound.sent).toEqual([]);
  });

  it('should refuse a hostname that resolves to a mapped IPv6 loopback', async () => {
    // Given the form that reaches the same interface and matches none of the strings a check
    // written against IPv4 would compare
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['::ffff:127.0.0.1']], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/mapped/);
    expect(outbound.sent).toEqual([]);
  });

  it('should refuse a hostname that resolves to a private range', async () => {
    // Given
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['10.0.0.7']], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/private/);
    expect(outbound.sent).toEqual([]);
  });

  it('should refuse a name that answers with one public address and one private one', async () => {
    // Given a resolution whose usable address depends on which entry a connection picks. Checking
    // the first would pass this and connect to the second on a machine whose resolver orders them
    // the other way.
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['93.184.216.34', '10.0.0.7']], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/10\.0\.0\.7/);
    expect(outbound.sent).toEqual([]);
  });

  it('should send to the address it checked, so a second lookup cannot change it', async () => {
    // Given the rebinding case: a name that answers with a public address now and the loopback a
    // moment later. What closes it is that the address travels with the request, so the second
    // answer is never asked for and never used.
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['93.184.216.34'], ['127.0.0.1']], outbound);

    // When
    await proxy.forward({
      method: 'GET',
      url: 'https://api.example.com/v1/orders',
      headers: {},
      body: null,
    });

    // Then the transport was told which address to open, and it is the checked one
    expect(outbound.sent[0]?.address).toBe('93.184.216.34');
  });

  it('should refuse the second send when the name has rebound to the loopback', async () => {
    // Given the same name, checked again on the next request, which is what makes the defence a
    // property of every send rather than of the first one
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['93.184.216.34'], ['127.0.0.1']], outbound);
    const send = async (): Promise<unknown> =>
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      });

    // When
    await send();

    // Then
    await expect(send()).rejects.toThrow(/127\.0\.0\.1/);
    expect(outbound.sent).toHaveLength(1);
  });

  it('should refuse an address literal in the url without asking a resolver anything', async () => {
    // Given a target that names an address rather than a name. There is nothing to resolve, so a
    // proxy whose only check is on a resolution has no check at all here.
    const outbound = new RecordingOutbound();
    const resolver = new ScriptedResolver([['93.184.216.34']]);
    const proxy = new ProxyService({
      allowlist: buildAllowlist(['http://127.0.0.1:8080']),
      resolver,
      outbound,
    });

    // When, Then
    await expect(
      proxy.forward({ method: 'GET', url: 'http://127.0.0.1:8080/admin', headers: {}, body: null }),
    ).rejects.toThrow(/loopback/);
    expect(resolver.calls).toEqual([]);
    expect(outbound.sent).toEqual([]);
  });

  it('should not follow a 302 to an internal address', async () => {
    // Given an API that answers with a redirect to the loopback, which is the shape that turns a
    // proxy with a correct allowlist into a proxy with none
    const outbound = new RecordingOutbound({
      status: 302,
      statusText: 'Found',
      headers: [['location', 'http://127.0.0.1:8080/admin']],
      body: '',
    });
    const proxy = proxyOver([['93.184.216.34']], outbound);

    // When
    const result = await proxy.forward({
      method: 'GET',
      url: 'https://api.example.com/v1/orders',
      headers: {},
      body: null,
    });

    // Then the redirect is what the reader is given, and exactly one request was sent
    expect(result.status).toBe(302);
    expect(outbound.sent).toHaveLength(1);
    expect(result.headers).toContainEqual(['location', 'http://127.0.0.1:8080/admin']);
  });

  it('should refuse a method it does not send', async () => {
    // Given
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['93.184.216.34']], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'TRACE',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/TRACE/);
    expect(outbound.sent).toEqual([]);
  });

  it('should refuse every request when the allowlist is empty, which is the default', async () => {
    // Given a document with no servers, and a target that would be perfectly ordinary otherwise
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([['93.184.216.34']], outbound, []);

    // When, Then
    expect(proxy.enabled).toBe(false);
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/the proxy is off/);
    expect(outbound.sent).toEqual([]);
  });

  it('should refuse a name that resolves to nothing', async () => {
    // Given. An empty resolution is not an address to check and is not an address to reach, and
    // falling through it is how a proxy comes to connect by name after all.
    const outbound = new RecordingOutbound();
    const proxy = proxyOver([[]], outbound);

    // When, Then
    await expect(
      proxy.forward({
        method: 'GET',
        url: 'https://api.example.com/v1/orders',
        headers: {},
        body: null,
      }),
    ).rejects.toThrow(/resolves to no address/);
    expect(outbound.sent).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { IRServer } from '@openref/core';
import { planUpstreams, UPSTREAM_EXPANSION_LIMIT, UPSTREAM_TOTAL_LIMIT } from '../../src/index';

describe('planUpstreams, the pinning of SPEC 16.2', () => {
  it('should pin an absolute http(s) server as one upstream, trailing slash normalized', () => {
    // Given
    const servers: IRServer[] = [
      { url: 'https://api.example.com/v1/' },
      { url: 'http://other.example.com:8080' },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual(['https://api.example.com/v1', 'http://other.example.com:8080']);
    expect(plan.warnings).toEqual([]);
  });

  it('should deduplicate upstreams and keep first seen order', () => {
    // Given: two spellings of one upstream and a second real one.
    const servers: IRServer[] = [
      { url: 'https://api.example.com/v1' },
      { url: 'https://api.example.com/v1/' },
      { url: 'https://eu.example.com' },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then: one rule per unique upstream, per SPEC 16.2.
    expect(plan.upstreams).toEqual(['https://api.example.com/v1', 'https://eu.example.com']);
  });

  it('should expand a variable from its enum, in declared order', () => {
    // Given
    const servers: IRServer[] = [
      {
        url: 'https://{region}.example.com/{version}',
        variables: {
          region: { default: 'eu', enum: ['eu', 'us'] },
          version: { default: 'v1', enum: ['v1', 'v2'] },
        },
      },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then: the whole declared product, first variable slowest.
    expect(plan.upstreams).toEqual([
      'https://eu.example.com/v1',
      'https://eu.example.com/v2',
      'https://us.example.com/v1',
      'https://us.example.com/v2',
    ]);
  });

  it('should skip a server whose variable declares no enum, with a warning naming it', () => {
    // Given: a default alone is one host out of an open set, and pinning it would silently
    // narrow the API surface, so SPEC 16.2 says enum or nothing.
    const servers: IRServer[] = [
      { url: 'https://{tenant}.example.com', variables: { tenant: { default: 'acme' } } },
      { url: 'https://api.example.com' },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then: the resolvable server still pins; the warning names the server and the variable.
    expect(plan.upstreams).toEqual(['https://api.example.com']);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('https://{tenant}.example.com');
    expect(plan.warnings[0]).toContain('"tenant"');
    expect(plan.warnings[0]).toContain('no enum');
  });

  it('should skip a server whose variable is not declared at all', () => {
    // Given
    const servers: IRServer[] = [{ url: 'https://{ghost}.example.com' }];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings[0]).toContain('"ghost"');
  });

  it('should treat a relative server as this origin, with no rule and no warning', () => {
    // Given: T004-R1 gives every serverless document exactly this shape.
    const servers: IRServer[] = [{ url: '/' }, { url: '/api/v2' }];

    // When
    const plan = planUpstreams(servers);

    // Then: nothing to pin and nothing wrong.
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it('should skip a scheme relative server with a warning rather than guessing a scheme', () => {
    // Given
    const servers: IRServer[] = [{ url: '//api.example.com/v1' }];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings[0]).toContain('scheme relative');
  });

  it('should skip a non http(s) server with a warning', () => {
    // Given: a broker url an event document may carry.
    const servers: IRServer[] = [{ url: 'wss://broker.example.com' }];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings[0]).toContain('not an http(s) url');
  });

  it('should skip a server whose enums expand past the limit, naming the product', () => {
    // Given: 8 x 8 = 64 combinations, above the limit of 50.
    const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const servers: IRServer[] = [
      {
        url: 'https://{x}{y}.example.com',
        variables: {
          x: { default: 'a', enum: values },
          y: { default: 'a', enum: values },
        },
      },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings[0]).toContain('64');
    expect(plan.warnings[0]).toContain(String(UPSTREAM_EXPANSION_LIMIT));
  });

  it('should refuse an upstream carrying a character that injects into a generated format', () => {
    // Given: a quote breaks a generated string literal, and a dollar expands as an nginx
    // variable in a rewrite replacement. Both are legal characters in a parsed url path.
    const servers: IRServer[] = [
      { url: "https://api.example.com/v'1" },
      { url: 'https://api.example.com/v$1' },
      { url: 'https://api.example.com/clean' },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual(['https://api.example.com/clean']);
    expect(plan.warnings).toHaveLength(2);
    expect(plan.warnings[0]).toContain('injection');
    expect(plan.warnings[1]).toContain('injection');
  });

  it('should refuse an upstream whose path carries a colon, which two targets read as a placeholder', () => {
    // Given: the same server shape without the colon pins, so the refusal below is the colon's.
    const clean = planUpstreams([{ url: 'https://api.example.com/splat/v1' }]);
    expect(clean.upstreams).toEqual(['https://api.example.com/splat/v1']);
    expect(clean.warnings).toEqual([]);

    // When: `:splat` reads as a placeholder in a Netlify destination and `:name` in a Vercel
    // rewrite, whose validator rejects a destination placeholder the source does not bind.
    const plan = planUpstreams([{ url: 'https://api.example.com/:splat/v1' }]);

    // Then: refused at planning time, for every target, with the character and server named.
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('https://api.example.com/:splat/v1');
    expect(plan.warnings[0]).toContain('":"');
  });

  it('should keep the colon legal where it is structural: the scheme and the port', () => {
    // Given: both colons an origin must carry.
    const servers: IRServer[] = [{ url: 'http://other.example.com:8080/base' }];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual(['http://other.example.com:8080/base']);
    expect(plan.warnings).toEqual([]);
  });

  it('should drop credentials a server url carries rather than pinning them into a config', () => {
    // Given: a userinfo component is a credential, and SPEC 19.7 keeps credentials out of
    // every build artefact.
    const servers: IRServer[] = [{ url: 'https://user:secret@api.example.com/v1' }];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual(['https://api.example.com/v1']);
    expect(JSON.stringify(plan)).not.toContain('secret');
  });
});

/**
 * The `T043` finding that the per template cap does not bound what a document can generate.
 *
 * MEASURED BEFORE THE FIX: forty servers, each with a fifty value enum and so each under
 * `UPSTREAM_EXPANSION_LIMIT`, pinned two thousand upstreams; a thousand such servers pinned fifty
 * thousand and produced a 1.69 MB Cloudflare Pages Function from a 379 KB specification, over
 * that platform's script limit, with the build reporting success.
 */
describe('planUpstreams, the total a document may pin', () => {
  /** One server whose enum expands to `count` upstreams, all distinct. */
  const templateOf = (zone: number, count: number): IRServer => ({
    url: `https://{host}.z${String(zone)}.example.com`,
    variables: {
      host: {
        default: 'h0',
        enum: Array.from({ length: count }, (_, index) => `h${String(index)}`),
      },
    },
  });

  it('should pin nothing and name the number when the templates multiply past the total', () => {
    // Given: forty templates of fifty, every one of them under the per template cap.
    const servers = Array.from({ length: 40 }, (_, zone) => templateOf(zone, 50));

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings.join('')).toContain(`more than ${String(UPSTREAM_TOTAL_LIMIT)}`);
  });

  it('should pin a document that stays under the total, so the cap is about the total', () => {
    // Given: nine templates of fifty, which is 450 and under the limit.
    const servers = Array.from({ length: 9 }, (_, zone) => templateOf(zone, 50));

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toHaveLength(450);
    expect(plan.warnings).toEqual([]);
  });

  it('should never materialise more than the limit, whatever the product would have been', () => {
    // Given: a product of 100000, two hundred times the limit. The first version of this case
    // asserted a duration against a budget set at about twice the mutated figure, so it stayed
    // green with the guard removed on a machine that was merely fast. The property is the count,
    // not the clock, and the plan now reports it.
    const servers = Array.from({ length: 2000 }, (_, zone) => templateOf(zone, 50));

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.materialized).toBeLessThanOrEqual(UPSTREAM_TOTAL_LIMIT + 1);
  });

  it('should report what it materialised for a document it accepts, so the count is not only a refusal', () => {
    // Given
    const servers = Array.from({ length: 9 }, (_, zone) => templateOf(zone, 50));

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.materialized).toBe(450);
    expect(plan.upstreams).toHaveLength(450);
  });

  it('should still pin the two hundred distinct upstreams the adversarial task names', () => {
    // Given
    const servers = Array.from({ length: 200 }, (_, index) => ({
      url: `https://api${String(index)}.example.com/v1`,
    }));

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toHaveLength(200);
    expect(plan.warnings).toEqual([]);
  });
});

/**
 * The verification finding of `T043`: a generated gateway aimed at the machine it runs on.
 *
 * SPEC 16.2 SAID THE SSRF CLASS DISAPPEARS BY CONSTRUCTION, and it does, for the client: a
 * reader's request cannot choose a host. The host is chosen by `servers[]` of a document this
 * project did not write, and nothing checked it. Measured: a specification naming three cloud
 * metadata endpoints pinned eight upstreams and produced eight rules with no warning at all.
 */
describe('planUpstreams, a server that names infrastructure rather than an API', () => {
  it.each([
    ['IPv4 link local, where cloud metadata answers', 'http://169.254.169.254/latest/meta-data'],
    ['a metadata host by name', 'http://metadata.google.internal/computeMetadata/v1'],
    ['another metadata address', 'http://100.100.100.200/latest'],
    ['IPv6 link local', 'http://[fe80::1]/x'],
    ['IPv6 unique local', 'http://[fd00::1]/x'],
    ['loopback by name', 'http://localhost:9000/x'],
    ['loopback by address', 'http://127.0.0.1:9000/x'],
  ])('should pin nothing for %s, and say why', (_reason, url) => {
    // Given the server above

    // When
    const plan = planUpstreams([{ url }]);

    // Then
    expect(plan.upstreams).toEqual([]);
    expect(plan.warnings).toHaveLength(1);
    expect(plan.warnings[0]).toContain('public gateway to infrastructure');
  });

  it('should keep pinning the ordinary servers of a document that also names one', () => {
    // Given: a skip is per server, so one hostile entry does not disarm the whole proxy.
    const servers = [
      { url: 'http://169.254.169.254/latest' },
      { url: 'https://api.example.com/v1' },
    ];

    // When
    const plan = planUpstreams(servers);

    // Then
    expect(plan.upstreams).toEqual(['https://api.example.com/v1']);
    expect(plan.warnings).toHaveLength(1);
  });
});

/**
 * The task's own bullet about an upstream that is an IP address, a port and a path.
 *
 * DRIVEN BY HAND DURING THE PASS AND PINNED HERE, because a measured negative nobody committed is
 * not evidence: all four spellings pinned correctly and nothing would have said so again.
 */
describe('planUpstreams, an upstream that is an address rather than a name', () => {
  it.each([
    ['a public IPv4 address', 'https://203.0.113.7/internal', 'https://203.0.113.7/internal'],
    [
      'an address with a port and a path',
      'http://198.51.100.5:8443/edge/api',
      'http://198.51.100.5:8443/edge/api',
    ],
    [
      'an IPv6 address with a port',
      'https://[2001:db8::1]:9443/v6',
      'https://[2001:db8::1]:9443/v6',
    ],
    [
      'a name with a port and a path',
      'https://api.example.com:8443/v1',
      'https://api.example.com:8443/v1',
    ],
  ])('should pin %s exactly as written', (_reason, url, expected) => {
    // Given the server above

    // When
    const plan = planUpstreams([{ url }]);

    // Then
    expect(plan.upstreams).toEqual([expected]);
    expect(plan.warnings).toEqual([]);
  });
});

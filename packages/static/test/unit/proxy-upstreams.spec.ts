import { describe, expect, it } from 'vitest';
import type { IRServer } from '@openref/core';
import { planUpstreams, UPSTREAM_EXPANSION_LIMIT } from '../../src/index';

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

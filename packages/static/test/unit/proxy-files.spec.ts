import { describe, expect, it } from 'vitest';
import {
  generateProxyFiles,
  planUpstreams,
  PROXY_CONFIG_TARGETS,
  PROXY_GATEWAY_COMMENT,
  VERCEL_FILE_NOTICE,
  type ProxyConfigTarget,
  type ProxyFileOptions,
} from '../../src/index';

/** Two upstreams, one with a base path and one with a port, which is the shape that bends. */
const OPTIONS: ProxyFileOptions = {
  upstreams: ['https://api.example.com/v1', 'http://other.example.com:8080'],
  basePath: '/docs',
  forwardCookies: false,
};

function fileFor(target: ProxyConfigTarget, options: ProxyFileOptions = OPTIONS) {
  const files = generateProxyFiles(target, options);
  expect(files).toHaveLength(1);
  const file = files[0];
  if (file === undefined) throw new Error('generateProxyFiles produced nothing');
  return file;
}

describe('generateProxyFiles, what every target shares', () => {
  it('should be deterministic: two generations produce identical bytes', () => {
    // Given, When: two independent generations, not one compared with itself.
    for (const target of PROXY_CONFIG_TARGETS) {
      const first = generateProxyFiles(target, OPTIONS);
      const second = generateProxyFiles(target, OPTIONS);

      // Then
      expect(second).toEqual(first);
    }
  });

  it('should carry the SPEC 16.2 gateway comment in every config that can hold one', () => {
    // Given: vercel.json is the one format whose validator admits no comment, so its notice
    // lives in the build output instead, and this test pins both halves of that split.
    for (const target of PROXY_CONFIG_TARGETS) {
      // When
      const { content } = fileFor(target);

      // Then
      if (target === 'vercel') {
        expect(content).not.toContain('anonymous gateway');
        expect(VERCEL_FILE_NOTICE).toContain(PROXY_GATEWAY_COMMENT);
      } else {
        expect(content).toContain('anonymous gateway to the API');
        expect(content).toContain('traffic quota');
      }
    }
  });

  it('should write one rule per unique upstream, per SPEC 16.2', () => {
    // Given: the declarative formats carry one route literal per upstream; the two executable
    // artefacts carry one table entry per upstream behind one prefix, which their own runner
    // suite exercises index by index.
    for (const target of ['netlify', 'vercel', 'nginx', 'caddy', 's3-cloudfront'] as const) {
      // When
      const { content } = fileFor(target);

      // Then
      expect(content).toContain('/docs/_proxy/u0/');
      expect(content).toContain('/docs/_proxy/u1/');
      expect(content).not.toContain('u2');
    }

    for (const target of ['nitro', 'cloudflare-pages'] as const) {
      // When
      const { content } = fileFor(target);

      // Then: the prefix once, and exactly as many pinned entries as upstreams.
      expect(content).toContain('"/docs/_proxy/"');
      expect([...content.matchAll(/"https?:\/\//g)]).toHaveLength(2);
    }
  });

  it('should weave the base path into every rule, and none when the base is the root', () => {
    // Given
    const rooted: ProxyFileOptions = { ...OPTIONS, basePath: '' };

    for (const target of PROXY_CONFIG_TARGETS) {
      // When
      const based = fileFor(target).content;
      const bare = fileFor(target, rooted).content;

      // Then
      expect(based).toContain('/docs/_proxy/');
      expect(bare).toContain('/_proxy/');
      expect(bare).not.toContain('/docs/_proxy/');
    }
  });

  it('should name where each file lives, for the deployer who moves it', () => {
    // Given, When, Then: the placement sentence rides in the file, per SPEC 16.2.
    expect(fileFor('nginx').content).toContain('Include this file inside the server block');
    expect(fileFor('caddy').content).toContain('Import this file inside the site block');
    expect(fileFor('netlify').content).toContain('root of the publish directory');
    expect(fileFor('nitro').content).toContain('server/routes/docs/_proxy/[...].ts');
    expect(fileFor('cloudflare-pages').content).toContain('root of the Pages');
  });
});

describe('generateProxyFiles, SPEC 19.9 per declarative target: no client named address', () => {
  it('netlify: every destination host is a pinned literal and the splat is path only', () => {
    // Given
    const { file, content } = fileFor('netlify');

    // When
    const rules = content.split('\n').filter((line) => line !== '' && !line.startsWith('#'));

    // Then
    expect(file).toBe('_redirects');
    expect(rules).toEqual([
      '/docs/_proxy/u0/* https://api.example.com/v1/:splat 200',
      '/docs/_proxy/u1/* http://other.example.com:8080/:splat 200',
    ]);
    // The placeholder sits after the pinned origin, never inside the host.
    for (const rule of rules) {
      const destination = rule.split(' ')[1] ?? '';
      const host = new URL(destination.replace('/:splat', '/')).host;
      expect(['api.example.com', 'other.example.com:8080']).toContain(host);
    }
  });

  it('vercel: every rewrite destination is a pinned origin with a path only parameter', () => {
    // Given
    const { file, content } = fileFor('vercel');

    // When
    const parsed = JSON.parse(content) as {
      rewrites: readonly { source: string; destination: string }[];
    };

    // Then
    expect(file).toBe('vercel.json');
    expect(parsed.rewrites).toHaveLength(2);
    for (const rewrite of parsed.rewrites) {
      const host = new URL(rewrite.destination.replace('/:path*', '/')).host;
      expect(['api.example.com', 'other.example.com:8080']).toContain(host);
      expect(rewrite.source.startsWith('/docs/_proxy/u')).toBe(true);
    }
    // Strict JSON with nothing but the rewrites: the platform schema refuses unknown members.
    expect(Object.keys(parsed)).toEqual(['rewrites']);
  });

  it('nginx: proxy_pass is a literal origin with no variable, and cookies are stripped', () => {
    // Given
    const { content } = fileFor('nginx');

    // When
    const passes = [...content.matchAll(/proxy_pass (.+);/g)].map((match) => match[1]);

    // Then: a variable in proxy_pass is runtime resolution, which is the door this closes.
    expect(passes).toEqual(['https://api.example.com', 'http://other.example.com:8080']);
    for (const pass of passes) expect(pass).not.toContain('$');
    expect(content).toContain('proxy_set_header Cookie "";');
    expect(content).toContain('proxy_ssl_server_name on;');
  });

  it('nginx: the rewrite replacement carries only the pinned path and the capture', () => {
    // Given
    const { content } = fileFor('nginx');

    // When
    const rewrites = [...content.matchAll(/rewrite \^(\S+) (\S+) break;/g)];

    // Then
    expect(rewrites.map((match) => match[2])).toEqual(['/v1/$1', '/$1']);
  });

  it('caddy: reverse_proxy addresses are pinned literals and the cookie is removed', () => {
    // Given
    const { file, content } = fileFor('caddy');

    // When
    const addresses = [...content.matchAll(/reverse_proxy (\S+) \{/g)].map((match) => match[1]);

    // Then
    expect(file).toBe('openref-proxy.caddy');
    expect(addresses).toEqual(['https://api.example.com', 'http://other.example.com:8080']);
    expect(content).toContain('header_up -Cookie');
    expect(content).toContain('header_up Host {upstream_hostport}');
    // The upstream base path is prepended by the rewrite, only where there is one.
    expect(content).toContain('rewrite * /v1{uri}');
  });

  it('cloudflare fragment: origins are pinned domains, caching is off, cookies excluded', () => {
    // Given
    const { file, content } = fileFor('s3-cloudfront');

    // When
    const parsed = JSON.parse(content) as {
      Comment: string;
      Origins: readonly { DomainName: string; OriginPath: string }[];
      CacheBehaviors: readonly { PathPattern: string; CachePolicyId: string }[];
      OriginRequestPolicy: {
        HeadersConfig: { HeaderBehavior: string; Headers: readonly string[] };
        CookiesConfig: { CookieBehavior: string };
      };
      Function: { Code: string };
    };

    // Then
    expect(file).toBe('openref-proxy.cloudfront.json');
    expect(parsed.Origins.map((origin) => origin.DomainName)).toEqual([
      'api.example.com',
      'other.example.com',
    ]);
    expect(parsed.Origins.map((origin) => origin.OriginPath)).toEqual(['/v1', '']);
    expect(parsed.CacheBehaviors.map((behavior) => behavior.PathPattern)).toEqual([
      '/docs/_proxy/u0/*',
      '/docs/_proxy/u1/*',
    ]);
    // A cached proxy answer is one reader's response served to another.
    for (const behavior of parsed.CacheBehaviors) {
      expect(behavior.CachePolicyId).toBe('4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    }
    expect(parsed.OriginRequestPolicy.HeadersConfig).toEqual({
      HeaderBehavior: 'allExcept',
      Headers: ['host'],
    });
    expect(parsed.OriginRequestPolicy.CookiesConfig.CookieBehavior).toBe('none');
    // The function strips the prefix and nothing else: no request fact enters the target.
    expect(parsed.Function.Code).toContain('request.uri.replace');
    expect(parsed.Comment).toContain('anonymous gateway');
  });

  it('netlify and vercel: no upstream contributes a placeholder reading byte to the emission', () => {
    // Given: a colon path server beside a clean and a ported one; without the refusal it would
    // emit `/:splat` and `/:name` bytes both platforms read as placeholders, and the shape is
    // first shown emitting its rule when clean, so the absence below is the colon's.
    const clean = planUpstreams([{ url: 'https://api.example.com/splat/v1' }]);
    const [cleanRedirects] = generateProxyFiles('netlify', {
      upstreams: clean.upstreams,
      basePath: '/docs',
      forwardCookies: false,
    });
    expect(cleanRedirects?.content).toContain(
      '/docs/_proxy/u0/* https://api.example.com/splat/v1/:splat 200',
    );

    const plan = planUpstreams([
      { url: 'https://api.example.com/:splat/v1' },
      { url: 'https://api.example.com/v1' },
      { url: 'http://other.example.com:8080/base' },
    ]);
    expect(plan.upstreams).toEqual([
      'https://api.example.com/v1',
      'http://other.example.com:8080/base',
    ]);
    const options: ProxyFileOptions = {
      upstreams: plan.upstreams,
      basePath: '/docs',
      forwardCookies: false,
    };

    // When
    const redirects = fileFor('netlify', options).content;
    const vercel = JSON.parse(fileFor('vercel', options).content) as {
      rewrites: readonly { source: string; destination: string }[];
    };

    // Then: every colon in a netlify rule is the scheme, the port or the generator's `:splat`.
    const rules = redirects.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      const [source, destination] = rule.split(' ');
      expect(source).not.toContain(':');
      expect(destination?.endsWith('/:splat')).toBe(true);
      const pinned = destination?.slice(0, -'/:splat'.length) ?? '';
      expect(new URL(pinned).pathname).not.toContain(':');
    }

    // And every colon in a vercel rewrite is the scheme, the port or the generator's `:path*`.
    expect(vercel.rewrites).toHaveLength(2);
    for (const rewrite of vercel.rewrites) {
      expect(rewrite.source.split(':')).toHaveLength(2);
      expect(rewrite.source.endsWith('/:path*')).toBe(true);
      expect(rewrite.destination.endsWith('/:path*')).toBe(true);
      const pinned = rewrite.destination.slice(0, -'/:path*'.length);
      expect(new URL(pinned).pathname).not.toContain(':');
    }
  });

  it('all three executable artefacts carry one suffix guard, byte for byte the same', () => {
    // Given: the guard block of each artefact, sliced by its own first and last line. Three
    // copies of a security check drift; one copy emitted three times cannot.
    const guardOf = (content: string): string => {
      const start = content.indexOf('  const DOT_SEGMENT =');
      const end = content.indexOf('DOT_SEGMENT.test(decodedRest);');
      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      return content.slice(start, end);
    };

    // When
    const fragment = JSON.parse(fileFor('s3-cloudfront').content) as { Function: { Code: string } };
    const guards = [
      guardOf(fileFor('nitro').content),
      guardOf(fileFor('cloudflare-pages').content),
      guardOf(fragment.Function.Code),
    ];

    // Then: identical, and carrying the separator class the refusal rests on.
    expect(guards[1]).toBe(guards[0]);
    expect(guards[2]).toBe(guards[0]);
    expect(guards[0]).toContain('[/\\\\;]|%2f|%5c|%3b');
    expect(guards[0]).toContain('const AMBIGUOUS = /%(2e|2f|5c|3b)/i;');
  });

  it('nitro and cloudflare: the upstream table is JSON quoted literals, injection proof', () => {
    // Given: a quote in a path would otherwise break out of the generated string literal.
    for (const target of ['nitro', 'cloudflare-pages'] as const) {
      // When
      const { content } = fileFor(target);

      // Then
      expect(content).toContain('"https://api.example.com/v1",');
      expect(content).toContain('"http://other.example.com:8080",');
      expect(content).toContain('const PREFIX = "/docs/_proxy/";');
    }
  });
});

describe('generateProxyFiles, forwardCookies', () => {
  it('should stop stripping cookies only when a caller explicitly turns forwarding on', () => {
    // Given
    const forwarding: ProxyFileOptions = { ...OPTIONS, forwardCookies: true };

    // Then: the strip is present by default, proven before its absence is read as intent.
    expect(fileFor('nginx').content).toContain('proxy_set_header Cookie "";');
    expect(fileFor('nginx', forwarding).content).not.toContain('proxy_set_header Cookie');
    expect(fileFor('caddy').content).toContain('header_up -Cookie');
    expect(fileFor('caddy', forwarding).content).not.toContain('header_up -Cookie');
    expect(fileFor('nitro').content).toContain("headers: { cookie: '' }");
    expect(fileFor('nitro', forwarding).content).not.toContain("headers: { cookie: '' }");
    expect(fileFor('cloudflare-pages').content).toContain("headers.delete('cookie');");
    expect(fileFor('cloudflare-pages', forwarding).content).not.toContain('headers.delete');

    const policy = (options: ProxyFileOptions): string =>
      (
        JSON.parse(fileFor('s3-cloudfront', options).content) as {
          OriginRequestPolicy: { CookiesConfig: { CookieBehavior: string } };
        }
      ).OriginRequestPolicy.CookiesConfig.CookieBehavior;
    expect(policy(OPTIONS)).toBe('none');
    expect(policy(forwarding)).toBe('all');
  });

  it('should say inside the netlify file that the platform cannot strip cookies', () => {
    // Given, When
    const { content } = fileFor('netlify');

    // Then: an unenforceable default is named, never implied.
    expect(content).toContain('cannot remove request headers');
  });
});

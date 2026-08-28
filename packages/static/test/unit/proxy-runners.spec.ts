import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateProxyFiles } from '../../src/index';

/**
 * SPEC 19.9, RUN RATHER THAN READ: every executable artefact is generated, loaded and called
 * with requests that try to name a target address or climb out of the pinned base, and each one
 * either reaches its pinned upstream or is refused. A textual assertion over generated code
 * proves the text; this proves the behaviour, which is what the claim promises.
 *
 * THREE ARTEFACTS, NOT TWO: the CloudFront viewer-request function is executable code the build
 * writes as surely as the other two, and it was the artefact whose suffix went unvetted longest
 * precisely because it rides inside a JSON fragment and reads like configuration.
 *
 * THE NITRO ROUTE RUNS THROUGH THE PLATFORM'S OWN TOOLCHAIN: the generated TypeScript is
 * transpiled by the `typescript` compiler and executed against a recorded fake of `h3`,
 * resolved from a node_modules written beside it, so the artefact itself runs, not a copy of
 * its logic. The CloudFront function runs verbatim in a fresh `node:vm` context, with nothing
 * appended to its bytes, because a function declaration there is the context's own `handler`.
 */

const OPTIONS = {
  upstreams: ['https://api.example.com/v1', 'http://other.example.com:8080'],
  basePath: '/docs',
  forwardCookies: false,
};

/**
 * Suffixes that try to climb above the pinned base path, inside the pinned origin.
 *
 * The host stays pinned throughout, so this is the address property's neighbour rather than the
 * address property itself: the reader cannot choose the host and must not choose the base either.
 * Every spelling here was measured reaching an upstream before the refusal existed.
 */
const TRAVERSAL_PATHS = [
  // Raw.
  '/docs/_proxy/u0/../secret',
  '/docs/_proxy/u0/..',
  // Single encoded, in the three spellings the URL standard admits, and mixed case.
  '/docs/_proxy/u0/%2e%2e/secret',
  '/docs/_proxy/u0/.%2e/secret',
  '/docs/_proxy/u0/%2e./secret',
  '/docs/_proxy/u0/%2E%2e/secret',
  // An encoded slash gluing the dot segment to its neighbour, so one decode reveals it.
  '/docs/_proxy/u0/..%2fsecret',
  '/docs/_proxy/u0/%2e%2e%2fsecret',
  // Double encoded, refused while still encoded rather than decoded a second time.
  '/docs/_proxy/u0/%252e%252e/secret',
  '/docs/_proxy/u0/%252E%252e/secret',
  '/docs/_proxy/u0/..%252fsecret',
  '/docs/_proxy/u0/%252e%252e%252fsecret',
  // A path parameter after the dot segment, which a Tomcat class server strips before routing.
  '/docs/_proxy/u0/..;/secret',
  // An encoded backslash, which a server that normalizes it reads as a separator.
  '/docs/_proxy/u0/..%5csecret',
  // Percent encoding one decode cannot resolve at all, so what it means upstream is unknowable.
  '/docs/_proxy/u0/%zz',
];

/** Requests that try to choose a host, each with the reason it must not work. */
const HOSTILE_PATHS = [
  // An index the table does not hold.
  '/docs/_proxy/u2/orders',
  '/docs/_proxy/u99/orders',
  // No index at all, and the prefix alone.
  '/docs/_proxy/orders',
  '/docs/_proxy/',
  // A path outside the proxy entirely.
  '/docs/other/u0/orders',
  // An index that is not a `u<N>` literal.
  '/docs/_proxy/uu0/orders',
  '/docs/_proxy/u0x/orders',
  // And every suffix that tries to climb, which is the same refusal by a different route.
  ...TRAVERSAL_PATHS,
];

const PINNED_HOSTS = ['api.example.com', 'other.example.com:8080'];

interface CloudflareModule {
  onRequest(context: { request: Request }): Promise<Response>;
}

/**
 * What the generated route actually reads off the request url, and therefore the exact surface
 * a platform parser hands it: a `URL` satisfies it, and so does a legacy parser's product that
 * never collapsed a dot segment, which is what the raw spelling test below feeds it.
 */
interface RequestUrlFacts {
  readonly pathname: string;
  readonly search: string;
}

/** What a CloudFront viewer-request function is handed, and what it may hand back. */
interface CloudFrontRequest {
  uri: string;
  querystring: string;
}

/** The refusal shape of the CloudFront runtime: a response instead of the request. */
interface CloudFrontRefusal {
  readonly statusCode: number;
  readonly statusDescription: string;
}

type CloudFrontResult = CloudFrontRequest | CloudFrontRefusal;
type CloudFrontHandler = (event: { request: CloudFrontRequest }) => CloudFrontResult;

/** Whether the function answered instead of forwarding, which is its only way to refuse. */
function isRefusal(result: CloudFrontResult): result is CloudFrontRefusal {
  return 'statusCode' in result;
}

let directory = '';
let cloudflare: CloudflareModule;
let nitroHandler: (event: { url: RequestUrlFacts }) => unknown;
let cloudFrontFunction: CloudFrontHandler;
let h3Calls: { target: string; opts: Record<string, unknown> }[];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openref-proxy-runners-'));

  // The Cloudflare Pages Function, byte for byte as generated, imported as the module it is.
  const [cloudflareFile] = generateProxyFiles('cloudflare-pages', OPTIONS);
  if (cloudflareFile === undefined) throw new Error('no cloudflare file generated');
  const cloudflarePath = join(directory, 'cloudflare.mjs');
  await writeFile(cloudflarePath, cloudflareFile.content);
  cloudflare = (await import(pathToFileURL(cloudflarePath).href)) as CloudflareModule;

  // The Nitro route, transpiled by the TypeScript compiler and run against a recorded h3.
  const [nitroFile] = generateProxyFiles('nitro', OPTIONS);
  if (nitroFile === undefined) throw new Error('no nitro file generated');
  const transpiled = ts.transpileModule(nitroFile.content, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  expect(transpiled.diagnostics ?? []).toEqual([]);

  const h3Directory = join(directory, 'node_modules', 'h3');
  await mkdir(h3Directory, { recursive: true });
  await writeFile(
    join(h3Directory, 'package.json'),
    JSON.stringify({ name: 'h3', version: '0.0.0', type: 'module', main: 'index.mjs' }),
  );
  await writeFile(
    join(h3Directory, 'index.mjs'),
    [
      'export const defineEventHandler = (handler) => handler;',
      'export const getRequestURL = (event) => event.url;',
      'export const proxyRequest = (event, target, opts) => {',
      '  globalThis.__orefH3Calls.push({ target, opts });',
      '  return { proxied: target };',
      '};',
      'export const createError = (input) => Object.assign(new Error(input.statusMessage), input);',
      '',
    ].join('\n'),
  );

  const nitroPath = join(directory, 'server', 'routes', 'docs', '_proxy', 'route.mjs');
  await mkdir(dirname(nitroPath), { recursive: true });
  await writeFile(nitroPath, transpiled.outputText);

  h3Calls = [];
  (globalThis as { __orefH3Calls?: unknown }).__orefH3Calls = h3Calls;
  const module = (await import(pathToFileURL(nitroPath).href)) as {
    default: (event: { url: RequestUrlFacts }) => unknown;
  };
  nitroHandler = module.default;

  // The CloudFront viewer-request function, its bytes lifted out of the generated fragment and
  // run as they are: a function declaration in a script becomes a property of its own global.
  const [fragmentFile] = generateProxyFiles('s3-cloudfront', OPTIONS);
  if (fragmentFile === undefined) throw new Error('no cloudfront fragment generated');
  const fragment = JSON.parse(fragmentFile.content) as { Function: { Code: string } };
  const context: { handler?: CloudFrontHandler } = {};
  runInNewContext(fragment.Function.Code, context);
  if (context.handler === undefined) throw new Error('the generated function declared no handler');
  cloudFrontFunction = context.handler;
});

afterAll(async () => {
  delete (globalThis as { __orefH3Calls?: unknown }).__orefH3Calls;
  await rm(directory, { recursive: true, force: true });
});

describe('the generated Cloudflare Pages Function, executed', () => {
  /** Calls the function with a stubbed fetch and reports what it did. */
  async function call(
    path: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ): Promise<{
    readonly status: number;
    readonly fetched: { url: string; init: RequestInit } | null;
  }> {
    let fetched: { url: string; init: RequestInit } | null = null;
    const original = globalThis.fetch;
    globalThis.fetch = (input: string | URL | Request, requestInit?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetched = { url, init: requestInit ?? {} };
      return Promise.resolve(new Response('upstream answer', { status: 200 }));
    };

    try {
      const request = new Request(`https://docs.example.com${path}`, {
        method: init.method ?? 'GET',
        headers: init.headers ?? {},
        ...(init.body === undefined ? {} : { body: init.body, duplex: 'half' }),
      });
      const response = await cloudflare.onRequest({ request });
      return { status: response.status, fetched };
    } finally {
      globalThis.fetch = original;
    }
  }

  it('should forward a legitimate request to the pinned upstream, suffix and query intact', async () => {
    // Given, When: the trap is first shown seeing traffic, so a later zero means zero.
    const { status, fetched } = await call('/docs/_proxy/u0/orders/42?limit=3');

    // Then
    expect(status).toBe(200);
    expect(fetched).not.toBeNull();
    expect(fetched?.url).toBe('https://api.example.com/v1/orders/42?limit=3');
    expect(fetched?.init.redirect).toBe('manual');
  });

  it('should reach the second upstream by its own index and never by anything else', async () => {
    // When
    const { fetched } = await call('/docs/_proxy/u1/ping');

    // Then
    expect(fetched?.url).toBe('http://other.example.com:8080/ping');
  });

  it('should refuse every request that tries to name a target, without sending anything', async () => {
    for (const path of HOSTILE_PATHS) {
      // When
      const { status, fetched } = await call(path);

      // Then: 403 and no outbound call at all.
      expect(status, path).toBe(403);
      expect(fetched, path).toBeNull();
    }
  });

  it('should keep the pinned host whatever the query and headers claim', async () => {
    // Given: every channel a request has, each carrying another address.
    const { fetched } = await call('/docs/_proxy/u0/orders?url=https://evil.example.com/x', {
      headers: {
        host: 'evil.example.com',
        'x-forwarded-host': 'evil.example.com',
        authorization: 'Bearer token',
      },
    });

    // Then
    expect(fetched).not.toBeNull();
    const target = new URL(fetched?.url ?? '');
    expect(PINNED_HOSTS).toContain(target.host);

    // The query rides as data on the pinned target, never as the target.
    expect(target.searchParams.get('url')).toBe('https://evil.example.com/x');
  });

  it('should strip the cookie and keep the rest of the headers', async () => {
    // Given
    const { fetched } = await call('/docs/_proxy/u0/orders', {
      headers: { cookie: 'session=secret', authorization: 'Bearer token' },
    });

    // Then: the cookie was present on the request, absent on the forward; the authorization
    // header proves the strip is a removal and not a fresh header set.
    expect(fetched).not.toBeNull();
    const headers = new Headers(fetched?.init.headers);
    expect(headers.get('cookie')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer token');
  });

  it('should send no body for GET and the body for POST', async () => {
    // When
    const get = await call('/docs/_proxy/u0/orders');
    const post = await call('/docs/_proxy/u0/orders', { method: 'POST', body: '{"a":1}' });

    // Then
    expect(get.fetched?.init.body).toBeUndefined();
    expect(post.fetched?.init.method).toBe('POST');
    expect(post.fetched?.init.body).not.toBeUndefined();
  });
});

describe('the generated Nitro route, transpiled by TypeScript and executed', () => {
  /** Calls the handler and reports the proxied target or the refusal. */
  function call(path: string): { readonly target: string | null; readonly status: number | null } {
    const before = h3Calls.length;
    try {
      nitroHandler({ url: new URL(`https://docs.example.com${path}`) });
      const entry = h3Calls[before];
      return { target: entry === undefined ? null : entry.target, status: null };
    } catch (error) {
      return { target: null, status: (error as { statusCode?: number }).statusCode ?? -1 };
    }
  }

  it('should forward a legitimate request to the pinned upstream, suffix and query intact', () => {
    // When
    const { target, status } = call('/docs/_proxy/u0/orders/42?limit=3');

    // Then
    expect(status).toBeNull();
    expect(target).toBe('https://api.example.com/v1/orders/42?limit=3');
  });

  it('should refuse every request that tries to name a target, with a 403 and no proxying', () => {
    for (const path of HOSTILE_PATHS) {
      // Given
      const before = h3Calls.length;

      // When
      const { status } = call(path);

      // Then
      expect(status, path).toBe(403);
      expect(h3Calls.length, path).toBe(before);
    }
  });

  it('should keep the pinned host whatever the path suffix carries', () => {
    // When
    const { target } = call('/docs/_proxy/u1/x?url=https://evil.example.com');

    // Then
    expect(new URL(target ?? '').host).toBe('other.example.com:8080');
  });

  it('should refuse every dot segment spelling a platform parser did not collapse', () => {
    // Given: a WHATWG parser collapses the raw and single encoded spellings before the artefact
    // runs, which through the calls above ejects the `u0` segment and lands in the unknown
    // upstream refusal, so those alternatives of the pattern would otherwise never be executed.
    // A platform on a legacy parser hands the pathname over uncollapsed, so every spelling is
    // fed to the artefact's own suffix check directly: refusal rather than repair on each.
    for (const pathname of [
      ...TRAVERSAL_PATHS,
      // Two more that only a parser which does not collapse can deliver at all.
      '/docs/_proxy/u0/a/../secret',
      '/docs/_proxy/u0/..\\secret',
    ]) {
      const before = h3Calls.length;

      // When
      let status: number | null = null;
      try {
        nitroHandler({ url: { pathname, search: '' } });
      } catch (error) {
        status = (error as { statusCode?: number }).statusCode ?? -1;
      }

      // Then: 403 from the suffix check itself, and nothing proxied.
      expect(status, pathname).toBe(403);
      expect(h3Calls.length, pathname).toBe(before);
    }
  });

  it('should hand proxyRequest the blanked cookie and the manual redirect', () => {
    // When
    call('/docs/_proxy/u0/orders');
    const last = h3Calls[h3Calls.length - 1];

    // Then: forwardCookies is false and 3xx passes through, both in the artefact's own call.
    expect(last?.opts).toEqual({
      headers: { cookie: '' },
      fetchOptions: { redirect: 'manual' },
    });
  });
});

describe('the generated CloudFront viewer-request function, executed in its own context', () => {
  /** Calls the function on one uri, as CloudFront delivers it: raw, nothing collapsed. */
  function call(uri: string): { readonly result: CloudFrontResult; readonly sent: string } {
    const request: CloudFrontRequest = { uri, querystring: '' };
    const result = cloudFrontFunction({ request });
    return { result, sent: request.uri };
  }

  it('should strip the route prefix so the pinned origin path carries the rest', () => {
    // Given, When: the trap is first shown rewriting, so a later refusal means the guard spoke.
    // The behaviour pins the origin and the distribution prepends OriginPath, so this uri is
    // what reaches api.example.com/v1, and no part of it names a host.
    const { result } = call('/docs/_proxy/u0/orders/42');

    // Then
    expect(isRefusal(result)).toBe(false);
    expect((result as CloudFrontRequest).uri).toBe('/orders/42');
  });

  it('should strip any index, since the behaviour and not the function binds the origin', () => {
    // When
    const { result } = call('/docs/_proxy/u1/ping');

    // Then
    expect((result as CloudFrontRequest).uri).toBe('/ping');
  });

  it('should refuse every suffix that climbs, answering 403 with the uri never rewritten', () => {
    for (const uri of TRAVERSAL_PATHS) {
      // When
      const { result, sent } = call(uri);

      // Then: a response instead of the request, so CloudFront answers and the origin is never
      // asked; and the request object it was handed goes on carrying what the client wrote.
      expect(isRefusal(result), uri).toBe(true);
      expect(isRefusal(result) ? result.statusCode : 0, uri).toBe(403);
      expect(sent, uri).toBe(uri);
    }
  });

  it('should leave an ordinary encoded suffix alone, so the refusal is not a blanket one', () => {
    // Given: a single encoded dot, a space and a percent sign, none of them a dot segment.
    for (const [uri, expected] of [
      ['/docs/_proxy/u0/file%2etxt', '/file%2etxt'],
      ['/docs/_proxy/u0/name%20with%20space', '/name%20with%20space'],
      ['/docs/_proxy/u0/50%25off', '/50%25off'],
      ['/docs/_proxy/u0/a.b.c', '/a.b.c'],
    ] as const) {
      // When
      const { result } = call(uri);

      // Then
      expect(isRefusal(result), uri).toBe(false);
      expect((result as CloudFrontRequest).uri, uri).toBe(expected);
    }
  });
});

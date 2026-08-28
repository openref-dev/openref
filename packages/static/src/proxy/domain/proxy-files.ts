/**
 * The generated proxy configurations of SPEC 16.2, one generator per platform.
 *
 * EVERY UPSTREAM IS A LITERAL IN THE OUTPUT AND THE CLIENT CONTRIBUTES A PATH SUFFIX, which is
 * the whole of SPEC 19.9: no generated rule reads a host, a header, a query parameter or a body
 * to decide where to send, so there is no channel through which a client could name a target
 * address. The two executable artefacts, the Nitro route and the Cloudflare Pages Function,
 * keep the property the same way: a table of literals indexed by a `u<N>` path segment, a 403
 * for anything else, and string concatenation of the remaining path onto the pinned base.
 *
 * DETERMINISTIC BY CONSTRUCTION, per SPEC 16.3: everything here is a pure function of the
 * document's servers, the base path and the options, with no clock, no environment and no
 * randomness anywhere.
 */

import { PROXY_SEGMENT } from '@openref/render';
import type { ProxyConfigTarget } from './proxy-target';

/** One generated file, relative to the output directory. */
export interface GeneratedProxyFile {
  readonly file: string;
  readonly content: string;
}

/**
 * The comment SPEC 16.2 requires in every generated configuration.
 *
 * One constant because every generator speaks it and two spellings of one warning is the drift
 * this project exists to catch.
 */
export const PROXY_GATEWAY_COMMENT =
  'A public documentation page with a proxy is an anonymous gateway to the API: anyone who ' +
  'finds these routes can call the API through this deployment, unattributed, and every such ' +
  "request consumes this deployment's traffic quota.";

/**
 * What the Vercel target cannot say in its own file, said in the build output instead.
 *
 * `vercel.json` is validated strictly by the platform and admits neither a comment nor an
 * unknown member, so the SPEC 16.2 comment cannot ride in it without breaking the deploy it
 * configures. Recorded in SPEC 16.2; the build prints this beside the file it wrote.
 */
export const VERCEL_FILE_NOTICE =
  'vercel.json is validated strictly by Vercel and admits no comment, so what the file cannot ' +
  `say is said here: ${PROXY_GATEWAY_COMMENT} Vercel rewrites also cannot remove request ` +
  "headers, so cookies for this site's domain pass through the rewrite and forwardCookies: " +
  'false is not enforced by the platform.';

/** What the Netlify file says about the same platform boundary, inside the file itself. */
const NETLIFY_COOKIE_NOTE =
  "forwardCookies is false, but Netlify's redirect engine cannot remove request headers, so " +
  "cookies for this site's domain do pass through these rules.";

/** What every generator takes. */
export interface ProxyFileOptions {
  /** The pinned upstreams, in `u<N>` order. */
  readonly upstreams: readonly string[];
  /** The build's base path, `''` or `/docs`, never with a trailing slash. */
  readonly basePath: string;
  /** SPEC 16.2's `forwardCookies`, false unless a caller explicitly turns it on. */
  readonly forwardCookies: boolean;
}

/**
 * The proxy path prefix every rule lives under: `<base>/_proxy`.
 *
 * @param basePath - The build's base path
 * @returns The prefix, without a trailing slash
 */
export function proxyPathPrefix(basePath: string): string {
  return `${basePath}/${PROXY_SEGMENT}`;
}

/**
 * The files for one target.
 *
 * @param target - A target with rewrite capability
 * @param options - Upstreams, base path and the cookie switch
 * @returns The generated files, at the path each platform reads relative to the deploy root
 */
export function generateProxyFiles(
  target: ProxyConfigTarget,
  options: ProxyFileOptions,
): readonly GeneratedProxyFile[] {
  switch (target) {
    case 'netlify':
      return [netlifyRedirects(options)];
    case 'vercel':
      return [vercelJson(options)];
    case 'nginx':
      return [nginxSnippet(options)];
    case 'caddy':
      return [caddySnippet(options)];
    case 'nitro':
      return [nitroRoute(options)];
    case 'cloudflare-pages':
      return [cloudflarePagesFunction(options)];
    case 's3-cloudfront':
      return [cloudFrontFragment(options)];
  }
}

/** Wraps one sentence into comment lines of readable width. */
function commentLines(prefix: string, text: string): string {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = prefix;

  for (const word of words) {
    if (line !== prefix && line.length + 1 + word.length > 96) {
      lines.push(line);
      line = prefix;
    }
    line = line === prefix ? `${prefix}${word}` : `${line} ${word}`;
  }

  if (line !== prefix) lines.push(line);
  return lines.join('\n');
}

/** Escapes a literal for use inside a regular expression. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Escapes a literal path for a path-to-regexp source pattern, the syntax Vercel matches with. */
function escapePathPattern(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\:!]/g, '\\$&');
}

/** `_redirects` for Netlify: one rewrite per upstream, status 200, per SPEC 16.2. */
function netlifyRedirects(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = proxyPathPrefix(options.basePath);
  const header = [
    '# openref proxy for Netlify, generated by openref build. Do not edit by hand.',
    '# This file lives at the root of the publish directory, which is where the build wrote it.',
    commentLines('# ', PROXY_GATEWAY_COMMENT),
    ...(options.forwardCookies ? [] : [commentLines('# ', NETLIFY_COOKIE_NOTE)]),
  ];

  const rules = options.upstreams.map(
    (upstream, index) => `${prefix}/u${String(index)}/* ${upstream}/:splat 200`,
  );

  return { file: '_redirects', content: `${[...header, ...rules].join('\n')}\n` };
}

/** `vercel.json`: the `rewrites` of SPEC 16.2, strict JSON with nothing the schema refuses. */
function vercelJson(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = escapePathPattern(proxyPathPrefix(options.basePath));

  const rewrites = options.upstreams.map((upstream, index) => ({
    source: `${prefix}/u${String(index)}/:path*`,
    destination: `${upstream}/:path*`,
  }));

  return { file: 'vercel.json', content: `${JSON.stringify({ rewrites }, null, 2)}\n` };
}

/** The nginx snippet: one `location` per upstream, for `include` inside a `server` block. */
function nginxSnippet(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = proxyPathPrefix(options.basePath);
  const blocks = options.upstreams.map((upstream, index) => {
    const parsed = new URL(upstream);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const route = `${prefix}/u${String(index)}`;
    const lines = [
      `location ${route}/ {`,
      `    rewrite ^${escapeRegExp(route)}/(.*)$ ${path}/$1 break;`,
      `    proxy_pass ${parsed.origin};`,
      ...(options.forwardCookies ? [] : ['    proxy_set_header Cookie "";']),
      ...(parsed.protocol === 'https:' ? ['    proxy_ssl_server_name on;'] : []),
      '}',
    ];
    return lines.join('\n');
  });

  const header = [
    '# openref proxy for nginx, generated by openref build. Do not edit by hand.',
    '# Include this file inside the server block that serves the static output; it does not',
    '# belong in the published directory itself.',
    commentLines('# ', PROXY_GATEWAY_COMMENT),
    '# nginx does not verify upstream certificates by default. Set proxy_ssl_verify on with',
    "# proxy_ssl_trusted_certificate for your distribution's CA bundle to verify them.",
  ];

  return {
    file: 'openref-proxy.nginx.conf',
    content: `${[...header, '', ...blocks].join('\n')}\n`,
  };
}

/** The Caddy snippet: one `handle_path` per upstream, for import into the site block. */
function caddySnippet(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = proxyPathPrefix(options.basePath);
  const blocks = options.upstreams.map((upstream, index) => {
    const parsed = new URL(upstream);
    const path = parsed.pathname === '/' ? '' : parsed.pathname;
    const lines = [
      `handle_path ${prefix}/u${String(index)}/* {`,
      ...(path === '' ? [] : [`    rewrite * ${path}{uri}`]),
      `    reverse_proxy ${parsed.origin} {`,
      '        header_up Host {upstream_hostport}',
      ...(options.forwardCookies ? [] : ['        header_up -Cookie']),
      '    }',
      '}',
    ];
    return lines.join('\n');
  });

  const header = [
    '# openref proxy for Caddy, generated by openref build. Do not edit by hand.',
    '# Import this file inside the site block that serves the static output; it does not belong',
    '# in the published directory itself.',
    commentLines('# ', PROXY_GATEWAY_COMMENT),
  ];

  return { file: 'openref-proxy.caddy', content: `${[...header, '', ...blocks].join('\n')}\n` };
}

/** The shared body of the two table driven artefacts: resolve `u<N>` against the pinned table. */
const RESOLVE_LINES = [
  '  const tail = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) : null;',
  "  const slash = tail === null ? -1 : tail.indexOf('/');",
  "  const name = tail === null ? '' : slash === -1 ? tail : tail.slice(0, slash);",
  "  const rest = tail === null || slash === -1 ? '' : tail.slice(slash + 1);",
  '  const match = /^u([0-9]+)$/.exec(name);',
  '  const upstream = match === null ? undefined : UPSTREAMS[Number(match[1])];',
];

/**
 * The client suffix guard as source text, for the three artefacts that cannot import it.
 *
 * Reads one variable, `rest`, and answers one, `refusedRest`; each generated artefact defines the
 * first before including these lines and refuses in its own platform's vocabulary after them.
 *
 * WRITTEN IN THE SYNTAX ALL THREE RUNTIMES ACCEPT: no optional catch binding and nothing past the
 * ES6 subset the `cloudfront-js-2.0` runtime documents, since one of the three targets is not a
 * general JavaScript engine.
 */
export const SUFFIX_GUARD_LINES: readonly string[] = [
  '  // A dot segment in the suffix climbs above the pinned base path, inside the pinned origin,',
  '  // so it is refused rather than repaired: the four spellings of ".." the URL standard admits,',
  '  // read across slash, backslash and their encodings as one separator class and through a ";"',
  '  // path parameter, checked on the suffix as received and again after exactly one decode.',
  '  // A suffix whose one decode still spells an encoded dot, separator or path parameter stays',
  '  // ambiguous to whoever decodes next, so it is refused rather than decoded a second time, and',
  '  // a suffix that one decode cannot resolve at all is refused for the same reason.',
  '  const DOT_SEGMENT = /(^|[/\\\\;]|%2f|%5c|%3b)(\\.\\.|\\.%2e|%2e\\.|%2e%2e)([/\\\\;]|%2f|%5c|%3b|$)/i;',
  '  const AMBIGUOUS = /%(2e|2f|5c|3b)/i;',
  '  const decodedRest = (() => {',
  '    try {',
  '      return decodeURIComponent(rest);',
  '    } catch (decodeError) {',
  '      return null;',
  '    }',
  '  })();',
  '  const refusedRest =',
  '    DOT_SEGMENT.test(rest) ||',
  '    decodedRest === null ||',
  '    AMBIGUOUS.test(decodedRest) ||',
  '    DOT_SEGMENT.test(decodedRest);',
];

/** The Nitro route of SPEC 16.2's table: `server/routes<base>/_proxy/[...].ts`. */
function nitroRoute(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = proxyPathPrefix(options.basePath);
  const file = `server/routes${options.basePath}/${PROXY_SEGMENT}/[...].ts`;

  const lines = [
    '// openref proxy for Nitro, generated by openref build. Do not edit by hand.',
    `// This file lives at ${file} of the Nuxt or Nitro application serving the static output;`,
    '// it does not belong in the published directory itself.',
    commentLines('// ', PROXY_GATEWAY_COMMENT),
    "import { createError, defineEventHandler, getRequestURL, proxyRequest } from 'h3';",
    '',
    '// The upstreams pinned at build time. The request contributes a path suffix and nothing',
    '// else, so no request can name a host these literals do not.',
    'const UPSTREAMS = [',
    // JSON QUOTED, NOT INTERPOLATED: a path may legally carry a quote, and a quote inside a
    // generated string literal is code injection into the deployer's server.
    ...options.upstreams.map((upstream) => `  ${JSON.stringify(upstream)},`),
    '] as const;',
    '',
    `const PREFIX = ${JSON.stringify(`${prefix}/`)};`,
    '',
    'export default defineEventHandler((event) => {',
    '  const url = getRequestURL(event);',
    ...RESOLVE_LINES,
    ...SUFFIX_GUARD_LINES,
    '',
    '  if (upstream === undefined) {',
    "    throw createError({ statusCode: 403, statusMessage: 'unknown proxy upstream' });",
    '  }',
    '',
    '  if (refusedRest) {',
    "    throw createError({ statusCode: 403, statusMessage: 'forbidden path suffix' });",
    '  }',
    '',
    '  // A 3xx is returned to the reader as the answer, never followed, per SPEC 14.5.',
    ...(options.forwardCookies
      ? []
      : ['  // forwardCookies is false: cookie values for this site never reach the API.']),
    "  return proxyRequest(event, upstream + '/' + rest + url.search, {",
    ...(options.forwardCookies ? [] : ["    headers: { cookie: '' },"]),
    "    fetchOptions: { redirect: 'manual' },",
    '  });',
    '});',
  ];

  return { file, content: `${lines.join('\n')}\n` };
}

/** The Cloudflare Pages Function of SPEC 16.2's table: `functions<base>/_proxy/[[path]].js`. */
function cloudflarePagesFunction(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = proxyPathPrefix(options.basePath);
  const file = `functions${options.basePath}/${PROXY_SEGMENT}/[[path]].js`;

  const lines = [
    '// openref proxy for Cloudflare Pages, generated by openref build. Do not edit by hand.',
    `// This file lives at ${file}, with the functions directory at the root of the Pages`,
    '// project, beside the published directory.',
    commentLines('// ', PROXY_GATEWAY_COMMENT),
    '',
    '// The upstreams pinned at build time. The request contributes a path suffix and nothing',
    '// else, so no request can name a host these literals do not.',
    'const UPSTREAMS = [',
    // JSON quoted for the reason the Nitro route gives: a quote in a path is code injection.
    ...options.upstreams.map((upstream) => `  ${JSON.stringify(upstream)},`),
    '];',
    '',
    `const PREFIX = ${JSON.stringify(`${prefix}/`)};`,
    '',
    'export async function onRequest(context) {',
    '  const url = new URL(context.request.url);',
    ...RESOLVE_LINES,
    ...SUFFIX_GUARD_LINES,
    '',
    '  if (upstream === undefined) {',
    "    return new Response('unknown proxy upstream', { status: 403 });",
    '  }',
    '',
    '  if (refusedRest) {',
    "    return new Response('forbidden path suffix', { status: 403 });",
    '  }',
    '',
    '  const headers = new Headers(context.request.headers);',
    ...(options.forwardCookies
      ? []
      : [
          '  // forwardCookies is false: cookie values for this site never reach the API.',
          "  headers.delete('cookie');",
        ]),
    '',
    '  const method = context.request.method;',
    '  // A 3xx is returned to the reader as the answer, never followed, per SPEC 14.5.',
    "  return fetch(upstream + '/' + rest + url.search, {",
    '    method,',
    '    headers,',
    "    body: method === 'GET' || method === 'HEAD' ? undefined : context.request.body,",
    "    redirect: 'manual',",
    '  });',
    '}',
  ];

  return { file, content: `${lines.join('\n')}\n` };
}

/**
 * The managed CachePolicy id of `Managed-CachingDisabled`, a global AWS constant.
 *
 * CACHING IS OFF BECAUSE A CACHED PROXY ANSWER IS ONE READER'S RESPONSE SERVED TO ANOTHER,
 * which for an authenticated API is a credential leak wearing a performance feature's clothes.
 */
const CLOUDFRONT_CACHING_DISABLED = '4135ea2d-6df8-44a3-9df3-4b5a84be39ad';

/** The S3 with CloudFront fragment: second origin with a path pattern, per SPEC 16.2's table. */
function cloudFrontFragment(options: ProxyFileOptions): GeneratedProxyFile {
  const prefix = proxyPathPrefix(options.basePath);

  const origins = options.upstreams.map((upstream, index) => {
    const parsed = new URL(upstream);
    return {
      Id: `openref-proxy-u${String(index)}`,
      DomainName: parsed.hostname,
      OriginPath: parsed.pathname === '/' ? '' : parsed.pathname,
      CustomOriginConfig: {
        OriginProtocolPolicy: parsed.protocol === 'https:' ? 'https-only' : 'http-only',
        HTTPPort: parsed.protocol === 'http:' && parsed.port !== '' ? Number(parsed.port) : 80,
        HTTPSPort: parsed.protocol === 'https:' && parsed.port !== '' ? Number(parsed.port) : 443,
      },
    };
  });

  const behaviors = options.upstreams.map((_, index) => ({
    PathPattern: `${prefix}/u${String(index)}/*`,
    TargetOriginId: `openref-proxy-u${String(index)}`,
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'POST', 'PATCH', 'DELETE'],
    CachePolicyId: CLOUDFRONT_CACHING_DISABLED,
    FunctionAssociations: [{ EventType: 'viewer-request', FunctionName: 'openref-proxy-rewrite' }],
  }));

  const fragment = {
    Comment:
      'openref proxy for S3 with CloudFront, generated by openref build. This is a fragment ' +
      'to merge into the DistributionConfig of the distribution serving the S3 origin, not a ' +
      'complete configuration: add the Origins and CacheBehaviors to the distribution, create ' +
      'the OriginRequestPolicy and the CloudFront Function below, and associate them as ' +
      `written. ${PROXY_GATEWAY_COMMENT} The cache policy is the managed CachingDisabled, ` +
      "because a cached proxy answer is one reader's response served to another.",
    Origins: origins,
    CacheBehaviors: behaviors,
    OriginRequestPolicy: {
      Name: 'openref-proxy-headers',
      HeadersConfig: { HeaderBehavior: 'allExcept', Headers: ['host'] },
      CookiesConfig: { CookieBehavior: options.forwardCookies ? 'all' : 'none' },
      QueryStringsConfig: { QueryStringBehavior: 'all' },
    },
    Function: {
      Name: 'openref-proxy-rewrite',
      Runtime: 'cloudfront-js-2.0',
      Code: [
        '// openref proxy rewrite for CloudFront, generated by openref build. Do not edit by hand.',
        '// The behaviour that carries this function already pins the origin, so the function',
        '// chooses no host: it strips the route prefix and vets what the client contributed.',
        'function handler(event) {',
        '  const request = event.request;',
        `  const rest = request.uri.replace(/^${escapeRegExp(prefix)}\\/u[0-9]+/, '');`,
        ...SUFFIX_GUARD_LINES,
        '',
        '  if (refusedRest) {',
        "    return { statusCode: 403, statusDescription: 'Forbidden' };",
        '  }',
        '',
        '  request.uri = rest;',
        '  return request;',
        '}',
        '',
      ].join('\n'),
    },
  };

  return {
    file: 'openref-proxy.cloudfront.json',
    content: `${JSON.stringify(fragment, null, 2)}\n`,
  };
}

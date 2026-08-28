/**
 * What each route answers, with nothing framework shaped in it.
 *
 * The document is normalized once, at setup, and everything after that is a pure function of
 * the resulting IR. Pages go through the SPEC 12 cache keyed by document hash; the search
 * index and the two specification serializations are built once and kept, because they depend
 * on the document and on nothing else about a request.
 *
 * SETUP IS FAIL CLOSED AND REQUESTS ARE NOT. A document that cannot be normalized stops the
 * application at boot, where the person who can fix it is watching, per the normalizer policy
 * of STANDARDS 8. A request for a node that does not exist is a 404, because a reader
 * following a stale link is not a broken deployment.
 *
 * A NONCE NEVER ENTERS THE CACHE. `renderPage` returns markup with no nonce in it and the
 * shell writes one per response, which is the T011 decision and the reason the cache can be
 * shared across readers at all.
 */

import { createHash } from 'node:crypto';
import {
  ErrorCode,
  InvalidOptionsError,
  IR_VERSION,
  normalizeOpenApiDocument,
  parseSpecification,
  proxyServers,
  ProxyBlockedError,
  type IRDocument,
} from '@openref/core';
import { mergeSyntheticSchemas } from '../../../schemas/domain/synthetic-schemas';
import {
  buildAssetCatalog,
  buildNavigation,
  createMemoryRenderCache,
  createOpenRefHighlighter,
  pathSegmentOf,
  plainHighlighter,
  OAUTH_MARKER,
  PAGE_MODEL_VERSION,
  RENDER_VERSION,
  renderHtmlDocument,
  renderPage,
  type AssetCatalog,
  type AssetPlan,
  type IHighlighter,
  type IRenderCache,
  type PageKind,
  type ThemeDefinition,
} from '@openref/render';
import { buildSearchIndex } from '@openref/search';
import { stringify as stringifyYaml } from 'yaml';
import {
  assetHref,
  ASSET_PARAM,
  NAVIGATION_PARAM,
  NODE_PARAM,
  PROXY_SEGMENT,
  SCHEMA_PARAM,
  type ReferenceRouteId,
} from '../../domain/routes';

import {
  IMMUTABLE,
  NO_STORE,
  REVALIDATE,
  notFoundReply,
  type ErrorReporter,
} from '../../../http/domain/reply';
import type {
  ReferenceReply,
  ReferenceRequest,
} from '../../../http/application/ports/reference-http.port';
import { buildAllowlist } from '../../../proxy/domain/allowlist';
import type { ProxyLogRecord } from '../../../proxy/domain/forwarding';
import type {
  IAddressResolver,
  IOutboundHttp,
} from '../../../proxy/application/ports/proxy-outbound.port';
import { ProxyService, type ProxyRequest } from '../../../proxy/application/services/proxy.service';
import { NodeAddressResolver } from '../../../proxy/infrastructure/adapters/node-address-resolver.adapter';
import { NodeOutboundHttp } from '../../../proxy/infrastructure/adapters/node-outbound.adapter';

/** How the service is built. */
export interface ReferenceServiceOptions {
  /** The OpenAPI document, as an object or as JSON or YAML text. */
  readonly document: unknown;
  /** Mount point, already normalized, without a trailing slash. */
  readonly basePath: string;
  /** Files to serve and which of them the shell links. */
  readonly assets: AssetPlan;
  /** Render cache, defaulting to the bounded in memory one. */
  readonly cache?: IRenderCache;
  /** Syntax highlighting on the server. On by default, per SPEC 12. */
  readonly highlight?: boolean;
  /** Value of the `lang` attribute on the document. */
  readonly lang?: string;
  /** Forces a colour scheme instead of following the reader's system preference. */
  readonly colorScheme?: 'light' | 'dark';
  /** Where an unexpected failure is reported. */
  readonly onError?: ErrorReporter;
  /**
   * The runtime pass of SPEC 6, applied between normalization and everything derived from it.
   *
   * A HOOK RATHER THAN AN ALREADY NORMALIZED DOCUMENT, so that normalization stays in one place
   * and every caller gets the same parsing, the same failures and the same fail closed policy.
   * `forRoot` is the only caller: `setup` is not a module and cannot reach the container, which
   * is the whole difference between the two entry points.
   *
   * WHATEVER IT RETURNS IS TAKEN AS THE DOCUMENT, INCLUDING ITS HASH. The cache of SPEC 12 and
   * the navigation route are keyed by that hash, so an implementation that attaches facts and
   * leaves the hash alone serves a reader the page from before the pass. `runRuntimePass` retakes
   * it with `hashDocument`, which is the one canonical way.
   */
  readonly augment?: (document: IRDocument) => IRDocument;
  /**
   * The same origin proxy of SPEC 14.5, off unless a host turns it on.
   *
   * OFF IS THE DEFAULT AND IT IS TWO REFUSALS DEEP. A host that says nothing gets a proxy route
   * that answers 403, and a host that turns it on for a document declaring no absolute server
   * gets the same, because the allowlist is derived from those servers and an empty allowlist
   * means off rather than open. Neither state is an error and both say which one they are.
   */
  readonly proxy?: ProxyOptions;
  /** The theme in force, validated here so both entry points pass one choke point. */
  readonly theme?: OpenRefThemeOptions;
}

/**
 * The theme in force for one mounted reference, per SPEC 10.4 and the T033 amendment.
 *
 * A PAIR AND NOT A DEFINITION ALONE, because a theme with components is two artefacts by
 * construction. The definition renders the server half; the components reach a reader only
 * inside a browser entry BUILT with the same definition, so there is one bundle and therefore
 * one `@openref/vue` instance, which is what keeps `inject` reading the key `provide` wrote.
 * Selection is a build time and server side fact: the host names the theme, the server serves
 * the entry built for it, and the browser resolves nothing.
 */
export interface OpenRefThemeOptions {
  /** The definition, as the theme package exports it. The server renders with it. */
  readonly definition: ThemeDefinition;
  /**
   * Browser entry built with the same definition, as a package specifier or an absolute path.
   *
   * Required the moment the definition carries a `layout` or any `components`: a page rendered
   * with an override and hydrated by the default entry is a hydration mismatch on that
   * position, which is silent. An L0 theme, tokens and stylesheets alone, needs none, because
   * its markup IS the default entry's markup.
   */
  readonly bundle?: string;
}

/** How the proxy of SPEC 14.5 is configured for one mounted document. */
export interface ProxyOptions {
  /** Turns the proxy on. Absent or false means every proxied request is refused. */
  readonly enabled?: boolean;
  /** Whether a cookie crosses in either direction. Off by default, per SPEC 19.10. */
  readonly forwardCookies?: boolean;
  /** How long one proxied exchange may take. */
  readonly timeoutMs?: number;
  /** How many bytes of proxied response body are read. */
  readonly maxResponseBytes?: number;
  /** Where one line per proxied request goes. Absent writes nothing anywhere. */
  readonly log?: (record: ProxyLogRecord) => void;
  /** Name resolution, injected so the SSRF defence is tested rather than the network. */
  readonly resolver?: IAddressResolver;
  /** The outbound client, injected for the same reason. */
  readonly outbound?: IOutboundHttp;
}

/** Answers the routes of SPEC 13.3 for one mounted document. */
export class ReferenceService {
  /** The normalized document. Everything served is derived from this. */
  readonly document: IRDocument;

  /** The source document, parsed and with the synthetic schemas of SPEC 13.5 merged in. */
  private readonly source: unknown;

  private readonly basePath: string;
  private readonly catalog: AssetCatalog;
  private readonly cache: IRenderCache;
  private readonly stylesheetHrefs: readonly string[];
  private readonly moduleHrefs: readonly string[];
  private readonly options: ReferenceServiceOptions;

  /** The proxy of SPEC 14.5, or null when the host did not turn it on. */
  private readonly proxyService: ProxyService | null;

  /**
   * Node and schema ids by the path segment `links.ts` writes for them.
   *
   * A page's link carries `pathSegmentOf(id)` since T039, so the parameter a route matches is
   * the segment and not the id. For every ordinary id the two are the same string; for an id
   * carrying a character the segment function escapes, the map is the only way back, and there
   * is exactly one spelling of each address rather than a raw alias beside an escaped one.
   */
  private readonly nodeIdBySegment: ReadonlyMap<string, string>;
  private readonly schemaIdBySegment: ReadonlyMap<string, string>;

  private highlighter: Promise<IHighlighter> | null = null;
  private specificationJson: string | null = null;
  private specificationYaml: string | null = null;
  private searchIndexJson: string | null = null;
  private navigationJson: string | null = null;

  /** @param options - Document, mount point, assets and rendering choices */
  constructor(options: ReferenceServiceOptions) {
    assertThemePair(options.theme);
    this.options = options;
    this.basePath = options.basePath;
    // THE SYNTHETIC SCHEMAS OF SPEC 13.5 GO IN HERE, ONCE, BEFORE ANYTHING READS THE DOCUMENT.
    // Both readers are downstream of this line: the normalizer below, and the `openapi.json`
    // route, which serves this object rather than the host's. A merge on only one of the two
    // paths would mean the page and the file a generator downloads described different documents.
    this.source = mergeSyntheticSchemas(sourceObject(options.document));
    const normalized = normalizeOpenApiDocument(this.source);
    this.document = options.augment === undefined ? normalized : options.augment(normalized);
    this.catalog = buildAssetCatalog(options.assets.sources);
    this.cache = options.cache ?? createMemoryRenderCache();

    const hrefOf = (name: string): string => {
      const asset = this.catalog.byName.get(name);
      // Unreachable through `loadDefaultAssets`, which puts every linked file in the same
      // list it names. It is checked rather than asserted because a host may pass its own.
      if (asset === undefined) throw notLinked(name);

      return assetHref(this.basePath, asset.servedName);
    };

    this.stylesheetHrefs = options.assets.stylesheetNames.map(hrefOf);
    this.moduleHrefs = [hrefOf(options.assets.moduleName)];
    this.proxyService = buildProxy(this.document, options.proxy);
    this.nodeIdBySegment = segmentIndex(this.document.nodes.keys());
    this.schemaIdBySegment = segmentIndex(this.document.schemas.keys());
  }

  /**
   * Answers one route.
   *
   * @param id - Which route was matched
   * @param request - Parameters, headers and the nonce for this response
   * @returns The reply
   */
  async handle(id: ReferenceRouteId, request: ReferenceRequest): Promise<ReferenceReply> {
    switch (id) {
      case 'overview':
        return this.page(request, 'overview', null, null);
      case 'node':
        return this.page(request, 'node', request.params[NODE_PARAM] ?? null, null);
      case 'schema':
        return this.page(request, 'schema', null, request.params[SCHEMA_PARAM] ?? null);
      case 'bench':
        return this.page(request, 'bench', request.params[NODE_PARAM] ?? null, null);
      case 'health':
        return this.page(request, 'health', null, null);
      case 'shapes':
        return this.page(request, 'shapes', null, request.params[SCHEMA_PARAM] ?? null);
      case 'states':
        return this.page(request, 'states', null, null);
      // RESERVED UNTIL M4, per SPEC 13.3: no federated services are mounted before the merge
      // engine exists, so every id names nothing, and the words differ from the node 404 so
      // the address is tellable from an unregistered one.
      case 'service':
        return Promise.resolve(notFoundReply('service'));
      case 'openapi-json':
        return Promise.resolve(this.specification(request, 'json'));
      case 'openapi-yaml':
        return Promise.resolve(this.specification(request, 'yaml'));
      case 'search-index':
        return Promise.resolve(this.searchIndex(request));
      case 'navigation':
        return Promise.resolve(this.navigation(request));
      case 'status':
        return Promise.resolve(this.status());
      case 'oauth-callback':
        return Promise.resolve(this.oauthCallback(request));
      case 'proxy':
        return this.proxied(request);
      case 'asset':
        return Promise.resolve(this.asset(request));
    }
  }

  /** Assets as they are served, for a host that wants to publish them itself. */
  get assets(): AssetCatalog {
    return this.catalog;
  }

  /**
   * Renders one page.
   *
   * @param request - The request, for its nonce and its validators
   * @param kind - Which page, per SPEC 13.3
   * @param nodeId - Node to show, or null
   * @param schemaId - Schema to show, or null
   * @returns The page, a 304, or a 404 when the id names nothing
   */
  private async page(
    request: ReferenceRequest,
    kind: PageKind,
    nodeSegment: string | null,
    schemaSegment: string | null,
  ): Promise<ReferenceReply> {
    // THE PARAMETER IS THE PATH SEGMENT, NOT THE ID, since T039: what a page links is
    // `pathSegmentOf(id)`, so the segment index is what a request resolves through. For every
    // ordinary id the segment is the id and nothing changes.
    const nodeId = nodeSegment === null ? null : (this.nodeIdBySegment.get(nodeSegment) ?? null);
    const schemaId =
      schemaSegment === null ? null : (this.schemaIdBySegment.get(schemaSegment) ?? null);

    if (nodeSegment !== null && nodeId === null) return notFoundReply('operation');
    if (schemaSegment !== null && schemaId === null) return notFoundReply('schema');

    // A CHANNEL HAS NO BENCH. Nothing links here for one, per SPEC 11's dead link rule, so a
    // reader arrives only by hand and the honest answer is that the address holds nothing.
    if (kind === 'bench' && this.document.nodes.get(nodeId ?? '')?.kind !== 'operation') {
      return notFoundReply('bench');
    }

    const tag = this.etag(`page:${kind}:${nodeId ?? ''}:${schemaId ?? ''}`);
    const cached = notModified(request, tag);
    if (cached !== null) return cached;

    const rendered = await renderPage(this.document, {
      page: kind,
      nodeId,
      schemaId,
      basePath: this.basePath,
      cache: this.cache,
      highlighter: await this.highlighterFor(),
      // THE FACT THE RUNNER FACTORY READS, per the T033 amendment. Only this side knows whether
      // the proxy is mounted, so the page carries it, and a host with none carries nothing.
      ...(this.proxyService === null ? {} : { proxyPath: `${this.basePath}/${PROXY_SEGMENT}` }),
      ...(this.options.theme === undefined ? {} : { theme: this.options.theme.definition }),
    });

    const tokens = this.options.theme?.definition.tokens;
    const html = renderHtmlDocument(rendered, {
      ...(request.nonce === undefined ? {} : { nonce: request.nonce }),
      assets: { stylesheets: this.stylesheetHrefs, modules: this.moduleHrefs },
      ...(this.options.lang === undefined ? {} : { lang: this.options.lang }),
      ...(this.options.colorScheme === undefined ? {} : { colorScheme: this.options.colorScheme }),
      // THE L0 SURFACE OF SPEC 10.4, consumed since T033: the theme's token values, as the one
      // inline form a strict CSP can authorize, after the links so they win the cascade.
      ...(tokens === undefined ? {} : { tokens }),
    });

    return {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': REVALIDATE,
        etag: tag,
      },
      body: html,
    };
  }

  /**
   * The specification as the host handed it over, serialized in the order it was written.
   *
   * The source document rather than the IR, because this route is what an SDK generator and
   * a diff tool read, and neither wants this project's internal model.
   *
   * SERIALIZED AS CONSTRUCTED, NOT CANONICALIZED, per SPEC 12. This called `canonicalize`,
   * which sorts keys by code point because a hash needs one order out of many equal ones, and
   * the sorting reached the one route whose whole purpose is to hand back what the author
   * wrote: every schema's `properties` came out alphabetical, so a generated SDK listed fields
   * in an order nobody chose and a diff against the author's own file was noise. Two runs
   * still produce identical bytes, and they do so because the host hands over the same object
   * and `JSON.stringify` walks it the same way, which is where determinism belongs.
   *
   * @param request - The request, for its validators
   * @param format - `json` or `yaml`
   * @returns The specification, or a 304
   */
  private specification(request: ReferenceRequest, format: 'json' | 'yaml'): ReferenceReply {
    const tag = this.etag(`openapi:${format}`);
    const cached = notModified(request, tag);
    if (cached !== null) return cached;

    if (this.specificationJson === null) {
      this.specificationJson = JSON.stringify(this.source);
      this.specificationYaml = stringifyYaml(JSON.parse(this.specificationJson));
    }

    const json = format === 'json';

    return {
      status: 200,
      headers: {
        'content-type': json
          ? 'application/json; charset=utf-8'
          : 'application/yaml; charset=utf-8',
        'cache-control': REVALIDATE,
        etag: tag,
      },
      body: json ? this.specificationJson : (this.specificationYaml ?? ''),
    };
  }

  /**
   * The serialized search index of T007.
   *
   * @param request - The request, for its validators
   * @returns The index, or a 304
   */
  private searchIndex(request: ReferenceRequest): ReferenceReply {
    const tag = this.etag('search-index');
    const cached = notModified(request, tag);
    if (cached !== null) return cached;

    this.searchIndexJson ??= buildSearchIndex(this.document).serialized;

    return {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': REVALIDATE,
        etag: tag,
      },
      body: this.searchIndexJson,
    };
  }

  /**
   * The whole navigation, which a page ships a slice of.
   *
   * ADDRESSED BY DOCUMENT HASH AND IMMUTABLE FOR A YEAR, like an asset and for the same
   * reason: the bytes are a pure function of the name, so a changed document is a changed url
   * and no cache anywhere can answer with a navigation that does not match the page holding
   * it. A request for another hash is a 404 rather than the current navigation, because
   * answering it would hand a reader whose page is stale a sidebar that disagrees with it.
   *
   * Serialized once. It is the largest thing this service returns, and it is the same bytes
   * for every reader of a deployment.
   *
   * @param request - The request, for the hash it asks for
   * @returns The payload, or a 404
   */
  private navigation(request: ReferenceRequest): ReferenceReply {
    if (request.params[NAVIGATION_PARAM] !== this.document.hash) {
      return notFoundReply('navigation');
    }

    // Serialized as constructed, per SPEC 12: `buildNavigation` is deterministic code over a
    // deterministic IR, so two runs give one string without anything being sorted on the way
    // out, and the entries reach the reader in the order the document put them in.
    this.navigationJson ??= JSON.stringify({
      documentHash: this.document.hash,
      navigation: buildNavigation(this.document),
    });

    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': IMMUTABLE },
      body: this.navigationJson,
    };
  }

  /**
   * The OAuth2 redirect uri of SPEC 14.4: put the reader back where they were.
   *
   * THIS ROUTE HOLDS NO SESSION, READS NO CODE AND TOUCHES NO TOKEN. It exists because a redirect
   * uri has to be one fixed path registered with the provider, and the reader was on an operation
   * page. It sends them back to that page with the answer still attached, and the exchange happens
   * in the browser, where the PKCE verifier is. A server that took part in the exchange would be a
   * server holding somebody's token, which a documentation tool has no business doing.
   *
   * THE RETURN PATH COMES OUT OF `state` AND IS CHECKED BEFORE IT IS USED. It is base64url after
   * the first dot, written by the runner. A value that is not a path under this mount is refused
   * and the reader goes to the overview instead: a redirect uri that forwards to whatever its
   * query says is an open redirector, and this one is registered with an authorization server,
   * which is the worst place to have one.
   *
   * @param request - The request, for the query the authorization server answered with
   * @returns A 302 back to the page the reader started from
   */
  private oauthCallback(request: ReferenceRequest): ReferenceReply {
    const query = request.query ?? {};
    const target = this.returnPathOf(query.state ?? '');

    const forwarded = new URLSearchParams();
    forwarded.set(OAUTH_MARKER, '1');
    for (const [name, value] of Object.entries(query)) forwarded.append(name, value);

    const separator = target.includes('?') ? '&' : '?';

    return {
      status: 302,
      headers: {
        location: `${target}${separator}${forwarded.toString()}`,
        // NO STORE, BECAUSE THE URL BEING REDIRECTED TO CARRIES AN AUTHORIZATION CODE. It is
        // single use and about to be spent, and a cache holding it is a cache holding a credential.
        'cache-control': NO_STORE,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: '',
    };
  }

  /**
   * The same origin proxy of SPEC 14.5.
   *
   * EVERY ANSWER THIS ROUTE GIVES IS THE PROXY'S OWN, AND NEVER THE API'S STATUS ON THE OUTSIDE.
   * A refusal is a 403 from this server and a forwarded answer is a 200 carrying the API's status
   * inside the envelope, which is what keeps "the API said 403" and "the proxy refused" from being
   * the same thing on the wire. The console shows one as a response and the other as a refusal,
   * and a reader who cannot tell them apart is a reader debugging the wrong system.
   *
   * @param request - The request, for the envelope in its body
   * @returns The answer, always `no-store`
   */
  private async proxied(request: ReferenceRequest): Promise<ReferenceReply> {
    if (this.proxyService === null) {
      return proxyRefusal(
        'the proxy is not enabled on this reference. It is off unless a host turns it on, and ' +
          'off refuses every request rather than passing it through',
      );
    }

    const envelope = readProxyEnvelope(request.body ?? '');
    if (envelope === null) {
      return proxyRefusal('the request body is not a proxy envelope this route can read');
    }

    try {
      const result = await this.proxyService.forward(envelope);

      return {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
        body: JSON.stringify({
          status: result.status,
          statusText: result.statusText,
          headers: result.headers,
          body: result.body,
        }),
      };
    } catch (cause: unknown) {
      if (cause instanceof ProxyBlockedError) return proxyRefusal(cause.message);

      // AN UNEXPECTED FAILURE IS A 502 AND CARRIES NO DETAIL, because what went wrong here is a
      // fact about a network this reader is not on. The reporter gets the object.
      this.options.onError?.(cause);

      return {
        status: 502,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
        body: JSON.stringify({ error: 'the proxied request did not complete' }),
      };
    }
  }

  /** The page a callback goes back to, or this mount's overview when the state names none. */
  private returnPathOf(state: string): string {
    const encoded = state.slice(state.indexOf('.') + 1);
    const overview = this.basePath === '' ? '/' : this.basePath;
    if (encoded === '' || !state.includes('.')) return overview;

    // LENIENT ON THE WAY IN AND STRICT ON THE WAY OUT. `Buffer.from` accepts a string that is not
    // base64url rather than throwing, so nothing is decided by whether this failed; what decides
    // is the shape of what came out, which is checked below.
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');

    // A PATH UNDER THIS MOUNT AND NOTHING ELSE. `//host` is a protocol relative url that a browser
    // follows off site, a backslash is treated as a slash by some of them, and anything with a
    // scheme in it is another origin. Each is checked rather than one of them, because this is the
    // check that keeps a registered redirect uri from becoming somebody's open redirector.
    const path = decoded.split('#')[0] ?? '';
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return overview;

    // AND A CHARACTER A BROWSER DELETES BEFORE IT READS THE URL IS AS GOOD AS ABSENT, which is the
    // hole the three checks above left open at the root mount. Found by the pre-M4 review and
    // driven to the wire: `/\t/evil.example/x` passes all three, Node's header validator admits a
    // horizontal tab in a `Location`, and every browser strips tab, carriage return and line feed
    // out of a url per the WHATWG standard, so what the reader follows is `//evil.example/x`. The
    // `\n` and `\r` spellings are refused by Node itself, so the tab was the live one; all three
    // are refused here rather than the one that happened to get through. Under a mounted base path
    // the check below already contained this, which is why it read as safe.
    if (/[\t\n\r]/.test(path)) return overview;

    if (this.basePath !== '' && !path.startsWith(`${this.basePath}/`) && path !== this.basePath) {
      return overview;
    }

    return path;
  }

  /**
   * What is mounted here and what it was built from.
   *
   * DELIBERATELY NOT THE DOCUMENTATION HEALTH REPORT OF SPEC 7: that is a page now, at
   * `<route>/health`, and this is the machine readable liveness answer that lived at that
   * address until `TX-FRAME` moved it to `_health`, per SPEC 13.3 as amended 2026-08-14.
   * It answers what a probe can use honestly: that the reference is up, and which document
   * it is serving.
   *
   * @returns The report
   */
  private status(): ReferenceReply {
    // A literal object, serialized as written, per SPEC 12. Sorting it would put `document`
    // before `status` for no reason a reader of this route benefits from.
    const body = JSON.stringify({
      status: 'ok',
      document: {
        id: this.document.id,
        title: this.document.info.title,
        version: this.document.info.version,
        hash: this.document.hash,
        nodes: this.document.nodes.size,
        schemas: this.document.schemas.size,
      },
      versions: {
        ir: IR_VERSION,
        pageModel: PAGE_MODEL_VERSION,
        render: RENDER_VERSION,
      },
    });

    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
      body,
    };
  }

  /**
   * One static file.
   *
   * The name carries the digest of the bytes, so the response is immutable for a year: a
   * changed file is a changed name and a different url, and no deployment can serve a stale
   * one. A name that is not in the catalog is a 404 and never a file system lookup.
   *
   * @param request - The request, for the asset parameter
   * @returns The file, or a 404
   */
  private asset(request: ReferenceRequest): ReferenceReply {
    const name = request.params[ASSET_PARAM] ?? '';
    const asset = this.catalog.byServedName.get(name);

    if (asset === undefined) return notFoundReply('asset');

    return {
      status: 200,
      headers: { 'content-type': asset.contentType, 'cache-control': IMMUTABLE },
      body: asset.bytes,
    };
  }

  /**
   * The highlighter, built once.
   *
   * FAIL OPEN, unlike everything else here. Highlighting is presentation: losing it costs
   * colour, while refusing to render the page costs the documentation. A failure is reported
   * through `onError` rather than swallowed, so it is a visible degradation and not a silent
   * one.
   *
   * @returns The shiki backed highlighter, or the plain one when it could not be built
   */
  private async highlighterFor(): Promise<IHighlighter> {
    if (this.options.highlight === false) return plainHighlighter;

    this.highlighter ??= createOpenRefHighlighter().catch((cause: unknown) => {
      this.options.onError?.(cause);
      return plainHighlighter;
    });

    return this.highlighter;
  }

  /**
   * Validator for one response.
   *
   * Everything that can change the bytes is in it: the document, the model version and the
   * render version. A cached page served after a deployment that changed the markup is the
   * failure this exists to prevent, and it is the same set the render cache key carries.
   *
   * @param scope - What is being served
   * @returns A strong entity tag
   */
  private etag(scope: string): string {
    const versions = `${String(IR_VERSION)}.${String(PAGE_MODEL_VERSION)}.${String(RENDER_VERSION)}`;
    const digest = createHash('sha256')
      .update(`${this.document.hash}:${versions}:${this.basePath}:${scope}`)
      .digest('hex')
      .slice(0, 32);

    return `"${digest}"`;
  }
}

/**
 * The 304 for a request that already holds this exact response.
 *
 * @param request - The request
 * @param tag - Entity tag of the response that would be sent
 * @returns A 304 reply, or null when the request holds something else
 */
function notModified(request: ReferenceRequest, tag: string): ReferenceReply | null {
  const asked = request.headers['if-none-match'];
  if (asked === undefined) return null;

  const matches = asked
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .includes(tag);

  if (!matches) return null;

  return { status: 304, headers: { 'cache-control': REVALIDATE, etag: tag }, body: '' };
}

/**
 * The document as an object, whether it arrived as one or as text.
 *
 * @param input - What the host passed as `document`
 * @returns The parsed document
 */
function sourceObject(input: unknown): unknown {
  return typeof input === 'string' ? parseSpecification(input, { source: 'document' }) : input;
}

/**
 * The proxy for one document, or null when it is off.
 *
 * THE ALLOWLIST IS THE DOCUMENT'S OWN SERVERS AND NOTHING ELSE, document level and operation
 * level alike, because those are exactly the addresses the console can offer to send to. A host
 * cannot widen it, and a page cannot: the list is built here, from the IR this server normalized.
 *
 * @param document - The normalized document
 * @param options - What the host configured, if anything
 * @returns The proxy, or null when the host did not enable one
 */
/**
 * Refuses a theme whose two halves cannot meet, before anything is rendered with it.
 *
 * The pair rule of {@link OpenRefThemeOptions}: component overrides exist only as code, code
 * reaches a reader only inside a browser entry built with the definition, and a definition
 * that carries overrides while naming no such entry would render pages the shipped entry
 * cannot hydrate. Refused rather than half applied, the way `NOT_YET_BUILT` refuses an option
 * that does nothing, and for the same reason.
 *
 * @param theme - What the host passed, or nothing
 * @throws InvalidOptionsError when overrides are declared and no bundle carries them
 */
function assertThemePair(theme?: OpenRefThemeOptions): void {
  if (theme === undefined || theme.bundle !== undefined) return;

  const definition = theme.definition;
  const overrides =
    definition.layout !== undefined || Object.keys(definition.components ?? {}).length > 0;
  if (!overrides) return;

  throw new InvalidOptionsError(
    `the theme "${definition.name}" declares component overrides and names no browser bundle built with them. ` +
      'A page rendered with an override and hydrated by the default entry is a silent hydration ' +
      'mismatch, so the pair is refused rather than half applied: pass theme.bundle, the entry ' +
      'artefact the theme package ships, or a definition carrying tokens and stylesheets alone',
    ErrorCode.CONFIG_INVALID_OPTIONS,
    undefined,
    { theme: definition.name },
  );
}

function buildProxy(document: IRDocument, options?: ProxyOptions): ProxyService | null {
  if (options?.enabled !== true) return null;

  // THE UNION OF DOCUMENT AND NODE SERVERS, and since the pre-M4 review it is `proxyServers` in
  // `@openref/core` rather than this expression, because `@openref/static` was pinning its own
  // upstreams from `document.servers` alone and refusing what this admitted. SPEC 14.5 carries
  // the rule now; it was a real guarantee with no line anywhere before.
  const servers = proxyServers(document).map((server) => server.url);

  return new ProxyService({
    allowlist: buildAllowlist(servers),
    resolver: options.resolver ?? new NodeAddressResolver(),
    outbound: options.outbound ?? new NodeOutboundHttp(),
    ...(options.forwardCookies === undefined ? {} : { forwardCookies: options.forwardCookies }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxResponseBytes === undefined
      ? {}
      : { maxResponseBytes: options.maxResponseBytes }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });
}

/**
 * Reads the envelope a page sends to the proxy, refusing anything that is not one.
 *
 * NOTHING IS DEFAULTED HERE. A missing method or a missing url is a refusal rather than a `GET` to
 * somewhere, because a defaulted field in this object is the proxy deciding what to send on behalf
 * of a page that did not say.
 *
 * @param text - The request body
 * @returns The envelope, or null when the body is not one
 */
function readProxyEnvelope(text: string): ProxyRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;

  if (typeof candidate.method !== 'string' || typeof candidate.url !== 'string') return null;

  const headers: Record<string, string> = {};
  if (typeof candidate.headers === 'object' && candidate.headers !== null) {
    for (const [name, value] of Object.entries(candidate.headers)) {
      if (typeof value === 'string') headers[name] = value;
    }
  }

  return {
    method: candidate.method,
    url: candidate.url,
    headers,
    body: typeof candidate.body === 'string' ? candidate.body : null,
  };
}

/**
 * The 403 a refused proxy request gets.
 *
 * @param reason - What to tell the reader
 * @returns The reply
 */
function proxyRefusal(reason: string): ReferenceReply {
  return {
    status: 403,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': NO_STORE },
    body: JSON.stringify({ error: reason }),
  };
}

/**
 * Ids by the path segment their links carry.
 *
 * @param ids - Node or schema ids
 * @returns Segment to id
 */
function segmentIndex(ids: Iterable<string>): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const id of ids) index.set(pathSegmentOf(id), id);
  return index;
}

/**
 * The error for a linked asset that is not in the catalog.
 *
 * @param name - Name that was linked
 * @returns The error to throw
 */
function notLinked(name: string): Error {
  return new InvalidOptionsError(
    `the asset "${name}" is linked by the page but was not offered to the catalog`,
    ErrorCode.CONFIG_INVALID_OPTIONS,
    undefined,
    { name },
  );
}

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
  type IRDocument,
} from '@openref/core';
import { mergeSyntheticSchemas } from '../../../schemas/domain/synthetic-schemas';
import {
  buildNavigation,
  createMemoryRenderCache,
  createOpenRefHighlighter,
  plainHighlighter,
  PAGE_MODEL_VERSION,
  RENDER_VERSION,
  renderHtmlDocument,
  renderPage,
  type IHighlighter,
  type IRenderCache,
} from '@openref/render';
import { buildSearchIndex } from '@openref/search';
import { stringify as stringifyYaml } from 'yaml';
import {
  assetHref,
  ASSET_PARAM,
  NAVIGATION_PARAM,
  NODE_PARAM,
  SCHEMA_PARAM,
  type ReferenceRouteId,
} from '../../domain/routes';
import { buildAssetCatalog, type AssetCatalog } from '../../../assets/domain/asset-catalog';
import type { AssetPlan } from '../../../assets/infrastructure/adapters/package-assets.adapter';
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

  private highlighter: Promise<IHighlighter> | null = null;
  private specificationJson: string | null = null;
  private specificationYaml: string | null = null;
  private searchIndexJson: string | null = null;
  private navigationJson: string | null = null;

  /** @param options - Document, mount point, assets and rendering choices */
  constructor(options: ReferenceServiceOptions) {
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
        return this.page(request, null, null);
      case 'node':
        return this.page(request, request.params[NODE_PARAM] ?? null, null);
      case 'schema':
        return this.page(request, null, request.params[SCHEMA_PARAM] ?? null);
      case 'openapi-json':
        return Promise.resolve(this.specification(request, 'json'));
      case 'openapi-yaml':
        return Promise.resolve(this.specification(request, 'yaml'));
      case 'search-index':
        return Promise.resolve(this.searchIndex(request));
      case 'navigation':
        return Promise.resolve(this.navigation(request));
      case 'health':
        return Promise.resolve(this.health());
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
   * @param nodeId - Node to show, or null
   * @param schemaId - Schema to show, or null
   * @returns The page, a 304, or a 404 when the id names nothing
   */
  private async page(
    request: ReferenceRequest,
    nodeId: string | null,
    schemaId: string | null,
  ): Promise<ReferenceReply> {
    if (nodeId !== null && !this.document.nodes.has(nodeId)) return notFoundReply('operation');
    if (schemaId !== null && !this.document.schemas.has(schemaId)) return notFoundReply('schema');

    const tag = this.etag(`page:${nodeId ?? ''}:${schemaId ?? ''}`);
    const cached = notModified(request, tag);
    if (cached !== null) return cached;

    const rendered = await renderPage(this.document, {
      nodeId,
      schemaId,
      basePath: this.basePath,
      cache: this.cache,
      highlighter: await this.highlighterFor(),
    });

    const html = renderHtmlDocument(rendered, {
      ...(request.nonce === undefined ? {} : { nonce: request.nonce }),
      assets: { stylesheets: this.stylesheetHrefs, modules: this.moduleHrefs },
      ...(this.options.lang === undefined ? {} : { lang: this.options.lang }),
      ...(this.options.colorScheme === undefined ? {} : { colorScheme: this.options.colorScheme }),
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
   * What is mounted here and what it was built from.
   *
   * DELIBERATELY NOT THE DOCUMENTATION HEALTH REPORT OF SPEC 7, which needs the drift engine
   * of M1 and does not exist yet. This route answers what M0 can answer honestly: that the
   * reference is up, and which document it is serving. Claiming a health score before
   * anything measures one would be the worst kind of green.
   *
   * @returns The report
   */
  private health(): ReferenceReply {
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

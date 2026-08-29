import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as VUE_PACKAGE } from '@openref/vue';

/**
 * `@openref/render`: the server render pipeline of SPEC 12.
 *
 * Internal, bundled into `@openref/nest`. It holds everything that must not reach the
 * browser: the markdown parser, the sanitizer and the syntax highlighter. What the browser
 * gets is in `@openref/render/browser`, which imports none of the three.
 */

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/render';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE, VUE_PACKAGE];

export {
  ALLOWED_ATTRIBUTES,
  ALLOWED_TAGS,
  FORBIDDEN_ATTRIBUTES,
  FORBIDDEN_TAGS,
  sanitizeHtml,
} from './markdown/domain/sanitize';
export { createMarkdownRenderer } from './markdown/domain/markdown';
export type { IMarkdownRenderer, MarkdownOptions } from './markdown/domain/markdown';

export {
  codeBlockHtml,
  createOpenRefHighlighter,
  fontStyleClasses,
  HIGHLIGHT_CLASS_PREFIX,
  HIGHLIGHT_LANGUAGES,
  plainHighlighter,
  tokenClass,
} from './highlight/domain/highlight';
export type { IHighlighter } from './highlight/domain/highlight';

export { escapeHtml, escapeJsonForScript } from './shared/html';
export {
  callbackParams,
  completeSignIn,
  writeSignInNotice,
  OAUTH_MARKER,
  SIGN_IN_NOTICE_KEY,
  type SignInNotice,
} from './shared/oauth-landing';
export { navigateTo, readSignInNotice, redirectTargets } from './shared/oauth-console';
export { statusClass } from './shared/status';
export { eventValue } from './shared/dom';
export type { ValueEvent, ValueTarget } from './shared/dom';

// THE ASSET CATALOG LIVES HERE SINCE T039, moved from `@openref/nest` because the static build
// needs the same naming, the same rewrites and the same digests as the served mode, and `static`
// may not import `nest`. It was always framework free; `nest` re-exports it unchanged.
export {
  buildAssetCatalog,
  chunkReferences,
  contentTypeFor,
  DIGEST_LENGTH,
  digestOf,
  hashedName,
  rewriteCssUrls,
  rewriteJsSpecifiers,
  siblingReferences,
} from './assets/domain/asset-catalog';
export type { AssetCatalog, AssetSource, CatalogAsset } from './assets/domain/asset-catalog';
export {
  CLIENT_BUNDLE_SPECIFIER,
  DEFAULT_THEME_STYLESHEETS,
  loadDefaultAssets,
  resolveAssetPath,
} from './assets/infrastructure/adapters/package-assets.adapter';
export type {
  AssetPlan,
  DefaultAssetOptions,
} from './assets/infrastructure/adapters/package-assets.adapter';

export type {
  IObservableRenderCache,
  IRenderCache,
  RenderCacheStats,
  RenderedPage,
} from './cache/application/ports/render-cache.port';
export {
  createMemoryRenderCache,
  DEFAULT_MEMORY_CACHE_ENTRIES,
} from './cache/infrastructure/adapters/memory-render-cache.adapter';
export type { MemoryRenderCacheOptions } from './cache/infrastructure/adapters/memory-render-cache.adapter';

export {
  buildNavigation,
  buildPageModel,
  PAGE_MODEL_VERSION,
  typeLabel,
} from './page/domain/page-model';
// THE PROJECTION TYPES LIVE IN `@openref/vue` SINCE `TX-SLOTWIRE` and are re-exported here, so
// that a consumer of the renderer still finds them where they were. They moved because the slot
// contract is declared in terms of them and the headless layer may not import this package.
export type {
  CodeSampleModel,
  DriftModel,
  FrameModel,
  FrameStatsModel,
  FrameTabKind,
  FrameTabModel,
  HealthCheckModel,
  HealthModel,
  HealthRuleModel,
  MediaTypeModel,
  NavEntryModel,
  NodeHeaderModel,
  NodeModel,
  PageKind,
  PageModel,
  PaletteHitModel,
  ParameterModel,
  ResponseModel,
  RuntimeModel,
  RuntimeRowKind,
  RuntimeRowModel,
  RuntimeValueModel,
  SchemaPageModel,
  SecurityModel,
  ServicePageModel,
  StaticProxyModel,
} from '@openref/vue';
// THE THEME CONTRACT TYPES RIDE THE SAME RE-EXPORT, since T033: `@openref/nest` takes a theme
// as an option and its one upstream for renderer shapes is this package, not `@openref/vue`.
export type { ThemeAssets, ThemeDefinition, ThemeTokens } from '@openref/vue';
// AND `materializeNode` RIDES IT SINCE T039, for the same reason and one more: it is the one
// function that decides what a node is called, and `@openref/static` must name a node in
// `llms.txt` exactly as the page does. A second spelling of a title is two titles.
export { materializeNode } from '@openref/vue';
export type { NodeView } from '@openref/vue';
export type { PageModelOptions } from './page/domain/page-model';
export {
  buildHealthModel,
  buildRuntimeModel,
  rateLimitLabel,
  streamingLabel,
} from './page/domain/runtime-model';
export {
  buildSchemaPayload,
  SCHEMA_PAYLOAD_LIMIT,
  schemaMapOf,
} from './page/domain/schema-payload';
export type { SchemaPayload } from './page/domain/schema-payload';
export {
  chunkAt,
  chunkOfActive,
  chunkRows,
  chunkWindow,
  expandedInSlice,
  flattenNavigation,
  NAV_CHUNK_ROWS,
  NAV_CHUNK_WINDOW,
  NAV_MAX_ROWS,
} from './page/domain/nav-rows';
export { ancestorsOfActive, sliceNavigation } from './page/domain/nav-payload';
export type { NavigationSlice } from './page/domain/nav-payload';
export { readNavigationPayload } from './page/domain/nav-source';
export type { NavigationLoader, NavigationPayload } from './page/domain/nav-source';
export { createNavigationStore, NAVIGATION_KEY } from './page/api/nav-context';
export type { NavigationStore, NavigationStoreOptions } from './page/api/nav-context';
export type { NavRow, ScrollPosition } from './page/domain/nav-rows';
export { NAV_HIT_LIMIT, searchNavigation } from './page/domain/nav-search';
export type { NavHit } from './page/domain/nav-search';
export {
  BENCH_SEGMENT,
  benchHref,
  FEDERATION_SEGMENT,
  federationHref,
  HEALTH_PAGE_SEGMENT,
  healthPageHref,
  navigationHref,
  NAVIGATION_SEGMENT,
  nodeHref,
  OVERVIEW_PATH,
  overviewHref,
  pathSegmentOf,
  PROXY_SEGMENT,
  SCHEMA_SEGMENT,
  schemaHref,
  SEARCH_INDEX_SEGMENT,
  searchIndexHref,
  SERVICE_SEGMENT,
  serviceHref,
  SHAPES_SEGMENT,
  shapesHref,
  STATES_SEGMENT,
  statesHref,
} from './page/domain/links';
export { assertNonce, renderHtmlDocument, STATE_ELEMENT_ID } from './page/domain/shell';
export type { ShellAssets, ShellHead, ShellOptions } from './page/domain/shell';

// EVERY DEFAULT OF THE 21 SLOTS IS EXPORTED, and that is what makes an L1 theme composable
// rather than all or nothing: a theme that wants to wrap the reference's own header, or to draw
// its own tree beside the shipped one, needs the component it is replacing.
export { APP_ROOT_ID, ReferenceApp } from './components/ReferenceApp';
export { AppShell, MAIN_ID } from './components/AppShell';
export { AuthPanel } from './components/AuthPanel';
export { CodeSample } from './components/CodeSample';
export { CommandPalette } from './components/CommandPalette';
export { DocumentOverview } from './components/DocumentOverview';
export { DriftCard } from './components/DriftCard';
export { HealthPanel } from './components/HealthPanel';
export { MarkdownBlock } from './components/MarkdownBlock';
export { NavigationTree } from './components/NavigationTree';
export { NodePanel } from './components/NodePanel';
export { OperationHeader } from './components/OperationHeader';
export { PaletteOverlay } from './components/PaletteOverlay';
export { ParamTable } from './components/ParamTable';
export { ProvenanceTag } from './components/ProvenanceTag';
export { ResponseList } from './components/ResponseList';
export { ResponseView } from './components/ResponseView';
export { RuntimePanel } from './components/RuntimePanel';
export { SchemaPanel } from './components/SchemaPanel';
export { SchemaTree } from './components/SchemaTree';
export { SchemaView } from './components/SchemaView';
export { SendButton } from './components/SendButton';
export { ServerSelect } from './components/ServerSelect';
export { ShapeForm } from './components/ShapeForm';
export { StateNotice } from './components/StateNotice';
export { StreamLog } from './components/StreamLog';
export { TryItPanel } from './components/TryItPanel';

export {
  renderAllPages,
  renderCacheKey,
  RENDER_VERSION,
  renderPage,
  serializePageModel,
} from './render/application/services/render.service';
export type { RenderPageOptions } from './render/application/services/render.service';

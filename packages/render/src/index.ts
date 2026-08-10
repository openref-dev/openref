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

export { buildPageModel, PAGE_MODEL_VERSION, typeLabel } from './page/domain/page-model';
export type {
  MediaTypeModel,
  NavEntryModel,
  NodeModel,
  PageModel,
  PageModelOptions,
  ParameterModel,
  ResponseModel,
  SecurityModel,
} from './page/domain/page-model';
export { nodeHref, OVERVIEW_PATH, overviewHref } from './page/domain/links';
export { assertNonce, renderHtmlDocument, STATE_ELEMENT_ID } from './page/domain/shell';
export type { ShellAssets, ShellOptions } from './page/domain/shell';

export { APP_ROOT_ID, ReferenceApp } from './components/ReferenceApp';
export { MarkdownBlock } from './components/MarkdownBlock';
export { NavigationTree } from './components/NavigationTree';
export { NodePanel } from './components/NodePanel';

export {
  renderAllPages,
  renderCacheKey,
  RENDER_VERSION,
  renderPage,
  serializePageModel,
} from './render/application/services/render.service';
export type { RenderPageOptions } from './render/application/services/render.service';

/**
 * The view model one page is rendered from.
 *
 * Everything expensive and everything server only happens here: markdown is turned into
 * sanitized HTML, code is highlighted, examples are generated. What comes out is plain
 * JSON, which is what makes the same model serve both the server render and the client
 * hydration without shipping `marked`, `isomorphic-dompurify` or `shiki` to the browser.
 *
 * A model is a pure function of the document, the node id and the renderer. That is what
 * lets the result be cached by document hash, per SPEC 12.
 */

import {
  compareByCodePoint,
  generateExample,
  type IRDocument,
  type IRDriftIssue,
  type IRJsonSchema,
  type IRJsonValue,
  type IRMediaType,
  type IRNavNode,
  type IROperation,
  type IRParameter,
  type IRSchema,
  type IRSchemaDialect,
  type IRSchemaSlot,
  type IRSchemaView,
} from '@openref/core';
import {
  materializeNode,
  resolveSchemaSlot,
  runnerOperationOf,
  schemaDisplayName,
} from '@openref/vue';
import type {
  CodeSampleModel,
  FrameModel,
  FrameStatsModel,
  FrameTabModel,
  MediaTypeModel,
  NavEntryModel,
  NodeModel,
  PageKind,
  PageModel,
  ParameterModel,
  ResponseModel,
  SchemaPageModel,
} from '@openref/vue';
import { benchHref, healthPageHref, nodeHref, overviewHref, schemaHref } from './links';
import { sliceNavigation } from './nav-payload';
import { buildHealthModel, buildRuntimeModel } from './runtime-model';
import { buildSchemaPayload } from './schema-payload';
import type { IMarkdownRenderer } from '../../markdown/domain/markdown';

/**
 * Version of the page model shape, part of the cache key.
 *
 * 12 SINCE `TX-MARKUP`: the header promise widened to `tags` and `operationId`, the runtime
 * block carries `responseMarks` and `contracts` for the merged responses and the error grid,
 * and a schema page carries `dialect`. A page cached before this hydrates a header with no
 * kicker and a responses block that says nothing the runtime knows, which is the page from
 * before the markup landed rather than a broken one.
 *
 * 11 SINCE `TX-FRAME`: `kind` and `frame` on the model, `driftCount` on every navigation
 * entry, and the health panel travels with the health page rather than the overview, per
 * SPEC 13.3 and 7.3 as amended 2026-08-14. A page cached before this hydrates a shell with
 * no tab bar data and an overview that still claims the panel, which is the frame from
 * before the layout landed rather than a broken one.
 *
 * 10 SINCE `TX-GUTTER`: `RuntimeModel.parity`, the parity scale of SPEC 6.3, and
 * `DriftModel.code`, the display code of SPEC 7.1's table. A page cached before this hydrates
 * an operation whose runtime block has no scale to adopt and whose findings cite no code,
 * which is the page from before the design landed rather than a broken one, and the version
 * is what keeps the two from being mixed on one screen.
 *
 * 9 SINCE T033: `proxyPath`, the same origin proxy endpoint of SPEC 14.5, optional and absent
 * when the host serves no proxy. It is the fact the runner factory reads to choose the proxy
 * transport, per the T033 amendment: the server knows whether the proxy is mounted and the
 * browser cannot, so the page carries the fact, about 27 bytes where a host has one and none
 * where it does not. A page cached before this serves a console that sends directly on a host
 * whose proxy is up, which is the defence existing and not being offered.
 *
 * 8 SINCE `TX-SLOTWIRE`. Two changes, and both are about what a slot can be handed. A runtime
 * value carries `confidence` and `collector` where it carried `code`, `markClass` and
 * `markTitle`, because `ProvenanceTag` is declared in terms of the two facts and not of the three
 * strings the reference draws from them; and a node carries `codeSamples`, per SPEC 18. A page
 * cached before that draws a runtime block with no provenance marks at all, which is the half of
 * SPEC 6.1 a reader uses to decide how much to trust a row.
 *
 * 7 WAS T028. Every scheme in `run.security` now carries the flows it declares and, for the two
 * a browser cannot send, the sentence saying why. A page cached before that draws a console with
 * no sign in for an `oauth2` scheme and, worse, nothing at all where `mutualTLS` should say what
 * it needs, which is the failure the field was added to prevent.
 *
 * 6 was T027: `run.bodyMediaTypes`, a list of strings, became `run.body`, a list of media types
 * each carrying the editor its schema asks for and the fields it is made of.
 */
export const PAGE_MODEL_VERSION = 12;

/** Media types an example is generated for. */
const JSON_MEDIA_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i;

/**
 * THE SHAPES THIS BUILDS LIVE IN `@openref/vue`, since `TX-SLOTWIRE`.
 *
 * `PageModel` and everything under it is the projection a theme is handed, and the slot contract
 * is declared in terms of it, so it belongs to the package a theme is written against. The
 * building stays here, because it needs markdown, a sanitizer, a highlighter and the example
 * generator, and none of those may cross into the headless layer. Both are re-exported from this
 * package's index, so nothing that used them had to move.
 */

/** What building a page model needs. */
export interface PageModelOptions {
  /**
   * Which page to build, per SPEC 13.3.
   *
   * Absent keeps the pre `TX-FRAME` derivation: a node id means the node page, else a schema
   * id means the schema page, else the overview. `bench` reads `nodeId`, `shapes` reads
   * `schemaId`, `health` and `states` read neither.
   */
  readonly page?: PageKind;
  /** Node to show, or null for the document overview. */
  readonly nodeId?: string | null;
  /** Named schema to show, for a schema page. Ignored when `nodeId` is set. */
  readonly schemaId?: string | null;
  readonly markdown: IMarkdownRenderer;
  /** Where the reference is mounted, so the client can build the links the server built. */
  readonly basePath?: string;
  /** Greatest serialized size of the schema payload. Defaults to the measured limit. */
  readonly schemaPayloadLimit?: number;
  /**
   * The same origin proxy endpoint, when the host mounted one, per SPEC 14.5.
   *
   * Only the server knows, so it enters the model here or the browser never learns it.
   */
  readonly proxyPath?: string;
}

/**
 * What every step of the build shares.
 *
 * `schemaBodies` exists because the document keeps `IRSchema` wrappers while the example
 * generator follows `$ref` through bodies. Deriving it once per page rather than per
 * position keeps a document with a thousand schemas from rebuilding the map per parameter.
 */
interface ModelContext {
  readonly document: IRDocument;
  readonly markdown: IMarkdownRenderer;
  readonly schemaBodies: ReadonlyMap<string, IRJsonSchema>;
  /** Mount point, which a finding's jump to its subject is built from. */
  readonly basePath: string;
}

function schemaBodiesOf(document: IRDocument): ReadonlyMap<string, IRJsonSchema> {
  const bodies = new Map<string, IRJsonSchema>();

  for (const [id, schema] of document.schemas) {
    if (schema.normalized !== undefined) bodies.set(id, schema.normalized);
  }

  return bodies;
}

function navHint(document: IRDocument, nodeId: string | undefined): string {
  if (nodeId === undefined) return '';

  const node = document.nodes.get(nodeId);
  if (node === undefined) return '';
  if (node.kind === 'channel') return node.address ?? '';

  return `${node.method.toUpperCase()} ${node.path}`;
}

/** The method of an operation entry, for the rail's badge. Empty for everything else. */
function navMethod(document: IRDocument, nodeId: string | undefined): string {
  if (nodeId === undefined) return '';

  const node = document.nodes.get(nodeId);
  return node === undefined || node.kind === 'channel' ? '' : node.method.toUpperCase();
}

/**
 * Findings per subject, counted once per document rather than once per entry.
 *
 * Keyed by node id and by schema id in one map, because a navigation entry carries at most one
 * of the two and the report addresses a finding to at most one of the two.
 */
function driftCounts(document: IRDocument): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const issues: readonly IRDriftIssue[] = document.health?.drift ?? [];

  for (const issue of issues) {
    const subject = issue.nodeId ?? issue.schemaId;
    if (subject === undefined) continue;
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }

  return counts;
}

function navEntry(
  document: IRDocument,
  node: IRNavNode,
  counts: ReadonlyMap<string, number>,
): NavEntryModel {
  const children = node.children.map((child) => navEntry(document, child, counts));
  const own = counts.get(node.nodeId ?? node.schemaId ?? '') ?? 0;

  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    nodeId: node.nodeId ?? null,
    schemaId: node.schemaId ?? null,
    deprecated: node.deprecated ?? false,
    // A group's count is its children's, so a closed group still says what it holds; an
    // entry that is both a page and a parent, which the tree does not produce today, would
    // still count each finding once because a finding names one subject.
    driftCount: own + children.reduce((sum, child) => sum + child.driftCount, 0),
    hint: navHint(document, node.nodeId),
    method: navMethod(document, node.nodeId),
    childCount: node.children.length,
    children,
  };
}

/**
 * The whole navigation of a document, as the model carries it.
 *
 * Separate from `buildPageModel` because it is separately served: a page ships a slice of this
 * and the rest arrives from `<mount>/_navigation/<hash>` when a reader opens a closed group or
 * the palette. One function builds both, so the two can never describe different documents.
 *
 * @param document - The normalized document
 * @returns Every navigation entry, in tree shape
 */
export function buildNavigation(document: IRDocument): NavEntryModel[] {
  const counts = driftCounts(document);
  return document.navigation.map((entry) => navEntry(document, entry, counts));
}

/**
 * Names the type at a use site in one short string.
 *
 * A named schema shows its name, without the identity suffix an external target carries.
 * An anonymous one shows its JSON Schema type. The full structure is the schema viewer's
 * job, in T012; this is the one line that sits next to a parameter name.
 *
 * @param slot - Schema slot, or undefined when the position declares no schema
 * @param schemas - The document's schema map
 * @returns A short label, empty when nothing is declared
 */
export function typeLabel(
  slot: IRSchemaSlot | undefined,
  schemas: ReadonlyMap<string, IRSchema>,
): string {
  if (slot === undefined) return '';

  if (slot.kind === 'named') {
    return schemaDisplayName(schemas.get(slot.schemaId), slot.schemaId);
  }

  const body = slot.schema.normalized;
  if (body === undefined) return schemaDisplayName(slot.schema, slot.schema.id);

  if (body.$ref !== undefined) {
    return schemaDisplayName(schemas.get(body.$ref), body.$ref);
  }

  return jsonSchemaTypeLabel(body);
}

function jsonSchemaTypeLabel(body: IRJsonSchema): string {
  if (body.title !== undefined && body.title !== '') return body.title;
  if (body.$cycle !== undefined) return `${body.$cycle} (cycle)`;
  if (body.enum !== undefined) return 'enum';
  if (body.type === undefined) return 'any';

  return typeof body.type === 'string' ? body.type : body.type.join(' | ');
}

/**
 * The example the document declared on this media type, if it declared one.
 *
 * `example` wins over the `examples` map, which is OpenAPI's own precedence; a map without a
 * plain `example` contributes its first member by code point, because a deterministic page
 * cannot depend on the order a document happened to list them in.
 *
 * @param media - The media type
 * @returns The declared value, or nothing
 */
function declaredMediaExample(media: IRMediaType): IRJsonValue | undefined {
  if (media.example !== undefined) return media.example;
  if (media.examples === undefined) return undefined;

  const first = Object.keys(media.examples).sort(compareByCodePoint)[0];
  return first === undefined ? undefined : media.examples[first]?.value;
}

/**
 * The body block under a media type: the declared example, or a generated one.
 *
 * THE DECLARED EXAMPLE WINS, per SPEC 5.5's 2026-08-14 line, and for any media type rather
 * than only JSON. It is the document's statement about this one response, so it is the only
 * form that can differ between two responses sharing a schema; the generated example is a pure
 * function of the schema and printed the same body under 400 and 429, stating a status neither
 * of them has. The `missing-example` rule's suggested edit adds exactly this field, so before
 * this branch existed the suggestion led to an edit that changed nothing on the page.
 *
 * A declared string under a non JSON media type renders as the text it is, which is what the
 * receipt's `text/csv` example asks for; under a JSON media type every value is printed as the
 * JSON it would be on the wire.
 */
function exampleHtml(media: IRMediaType, context: ModelContext, view: IRSchemaView): string {
  const declared = declaredMediaExample(media);
  const json = JSON_MEDIA_TYPE.test(media.mediaType);

  if (declared !== undefined) {
    const text =
      !json && typeof declared === 'string' ? declared : JSON.stringify(declared, null, 2);
    return context.markdown.renderCode(`${text.replace(/\n$/, '')}\n`, json ? 'json' : '');
  }

  if (!json) return '';
  if (media.schema === undefined) return '';

  const schema = resolveSchemaSlot(media.schema, context.document.schemas);
  if (schema?.normalized === undefined) return '';

  const value = generateExample(schema.normalized, { schemas: context.schemaBodies, view });
  return context.markdown.renderCode(`${JSON.stringify(value, null, 2)}\n`, 'json');
}

function mediaTypeModel(
  media: IRMediaType,
  context: ModelContext,
  view: IRSchemaView,
): MediaTypeModel {
  return {
    mediaType: media.mediaType,
    typeLabel: typeLabel(media.schema, context.document.schemas),
    exampleHtml: exampleHtml(media, context, view),
    schema: media.schema ?? null,
    view,
  };
}

/**
 * Call samples of an operation, highlighted here rather than in the browser.
 *
 * SAME RULE AS EVERY OTHER BLOCK OF CODE ON A PAGE, per SPEC 12: the highlighter is 300 KB and
 * stays on the server, so what travels is the markup it produced. A sample in a language the
 * highlighter does not know renders as plain text, which is what `renderCode` already does for
 * a fenced block in an unknown language.
 *
 * @param node - The operation
 * @param context - The markdown renderer, which owns the highlighter
 * @returns One entry per sample the document wrote
 */
function codeSampleModels(node: IROperation, context: ModelContext): CodeSampleModel[] {
  return (node.codeSamples ?? []).map((sample) => ({
    lang: sample.lang,
    label: sample.label,
    sourceHtml: context.markdown.renderCode(sample.source, sample.lang),
  }));
}

function parameterModel(parameter: IRParameter, context: ModelContext): ParameterModel {
  return {
    name: parameter.name,
    location: parameter.in,
    required: parameter.required,
    deprecated: parameter.deprecated ?? false,
    typeLabel: typeLabel(parameter.schema, context.document.schemas),
    descriptionHtml: context.markdown.render(parameter.description),
    schema: parameter.schema ?? null,
  };
}

/** Every use site on a node page, which is what the schema payload is seeded from. */
function slotsOf(node: NodeModel): IRSchemaSlot[] {
  const slots: IRSchemaSlot[] = [];

  for (const parameter of node.parameters)
    if (parameter.schema !== null) slots.push(parameter.schema);
  for (const media of node.requestBody) if (media.schema !== null) slots.push(media.schema);
  for (const response of node.responses) {
    for (const media of response.content) if (media.schema !== null) slots.push(media.schema);
  }

  return slots;
}

/**
 * The dialect line of the schema page head, in the reader's words.
 *
 * `unknown` renders as nothing: a page that prints the word unknown about its own schema is
 * reporting on the instrument in the line that exists to state a fact about the document.
 */
const DIALECT_LABELS: Readonly<Record<IRSchemaDialect, string>> = {
  'json-schema-2020-12': 'JSON Schema 2020-12',
  'openapi-3.0': 'OpenAPI 3.0 schema',
  'asyncapi-schema': 'AsyncAPI schema',
  avro: 'Avro',
  protobuf: 'Protobuf',
  unknown: '',
};

function schemaPageModel(context: ModelContext, schemaId: string): SchemaPageModel {
  const entry = context.document.schemas.get(schemaId);

  if (entry === undefined) {
    return {
      id: schemaId,
      name: schemaDisplayName(undefined, schemaId),
      descriptionHtml: '',
      deprecated: false,
      missing: true,
      dialect: '',
    };
  }

  const body = entry.normalized;

  return {
    id: schemaId,
    name: schemaDisplayName(entry, schemaId),
    descriptionHtml: context.markdown.render(body?.description),
    deprecated: body?.deprecated ?? false,
    missing: false,
    dialect: DIALECT_LABELS[entry.dialect],
  };
}

function nodeModel(context: ModelContext, nodeId: string): NodeModel | null {
  const { document, markdown } = context;
  const node = document.nodes.get(nodeId);
  if (node === undefined) return null;

  const view = materializeNode(node, document);

  const base = {
    id: view.id,
    kind: view.kind,
    title: view.title,
    deprecated: view.deprecated,
    tags: node.tags,
    summary: node.summary ?? '',
    descriptionHtml: markdown.render(node.description),
  };

  const runtime = buildRuntimeModel(document, nodeId, context.basePath);

  if (view.kind === 'channel') {
    return {
      ...base,
      // A channel has no operationId: the field is OpenAPI's, and an empty string is the
      // honest answer the kicker draws nothing from.
      operationId: '',
      method: null,
      path: null,
      address: view.node.address ?? null,
      parameters: [],
      requestBody: [],
      responses: [],
      security: [],
      codeSamples: [],
      run: null,
      runtime,
    };
  }

  const parameters = [...view.parameters.values()]
    .flat()
    .map((parameter) => parameterModel(parameter, context));

  return {
    ...base,
    // The public operation id of SPEC 5.4: the author's own whenever they wrote a real one,
    // which is what the kicker quotes.
    operationId: view.node.operationId ?? '',
    method: view.node.method.toUpperCase(),
    path: view.node.path,
    address: null,
    parameters,
    requestBody: (view.node.requestBody?.content ?? []).map((media) =>
      mediaTypeModel(media, context, 'request'),
    ),
    responses: view.responses.map((response) => ({
      statusCode: response.statusCode,
      descriptionHtml: markdown.render(response.description),
      content: response.content.map((media) => mediaTypeModel(media, context, 'response')),
    })),
    security: view.security.map((requirement) => ({
      schemeId: requirement.schemeId,
      type: requirement.scheme?.type ?? 'unknown',
      scopes: requirement.scopes,
    })),
    codeSamples: codeSampleModels(view.node, context),
    run: runnerOperationOf(view.node, document),
    runtime,
  };
}

/**
 * The first named schema an operation touches, request body before responses in served order.
 *
 * This is what the schema tab follows, per SPEC 11: the layout's schema page shows the request
 * schema of the operation the reader came from. Only a named schema has a page, so an inline
 * slot counts exactly when its whole body is a reference to one.
 */
function primarySchemaIdOf(document: IRDocument, node: NodeModel): string | null {
  const slots = [
    ...node.requestBody.map((media) => media.schema),
    ...node.responses.flatMap((response) => response.content.map((media) => media.schema)),
  ];

  for (const slot of slots) {
    if (slot === null) continue;
    if (slot.kind === 'named' && document.schemas.has(slot.schemaId)) return slot.schemaId;
    if (slot.kind === 'inline') {
      const ref = slot.schema.normalized?.$ref;
      if (ref !== undefined && document.schemas.has(ref)) return ref;
    }
  }

  return null;
}

/** Whether a navigation subtree holds the given schema. */
function holdsSchema(entry: IRNavNode, schemaId: string): boolean {
  if (entry.schemaId === schemaId) return true;
  return entry.children.some((child) => holdsSchema(child, schemaId));
}

/**
 * Breadcrumb of the current node, per SPEC 11: the group, then what the node answers on.
 *
 * A SCHEMA'S GROUP IS READ OFF THE NAVIGATION AND NEVER SPELLED HERE, since `TX-MARKUP`
 * completed the crumb for the one page kind whose crumb was bare. The registry group's label is
 * `schemasLabel ?? 'Schemas'` in core, so a second spelling of the word in this file would
 * drift the day a host renames the group.
 */
function crumbOf(
  document: IRDocument,
  node: NodeModel | null,
  schema: SchemaPageModel | null,
): string {
  if (node !== null) {
    const address =
      node.method !== null ? `${node.method} ${node.path ?? ''}` : (node.address ?? '');
    return [node.tags[0], address].filter((part) => part !== undefined && part !== '').join(' / ');
  }

  if (schema === null) return '';

  const group = document.navigation.find(
    (entry) =>
      entry.nodeId === undefined && entry.schemaId === undefined && holdsSchema(entry, schema.id),
  );

  return [group?.label, schema.name]
    .filter((part) => part !== undefined && part !== '')
    .join(' / ');
}

/** The rail's stats row: the document's counts, per SPEC 7.3's null-against-zero rule. */
function frameStats(document: IRDocument): FrameStatsModel {
  return {
    operations: document.nodes.size,
    groups: document.navigation.filter(
      (entry) => entry.nodeId === undefined && entry.schemaId === undefined,
    ).length,
    drift: document.health === undefined ? null : document.health.drift.length,
  };
}

/**
 * The frame of one page: which tabs have targets, and where they lead.
 *
 * A TAB WITHOUT A TARGET IS NOT BUILT, per SPEC 11: a drawn dead link is the F14 class of lie.
 * The three operation tabs exist only where a current operation does, which is the node page
 * and its bench; the schema tab on a schema page targets the page itself; the health tab is
 * on every page, because the report is about the document.
 */
function buildFrame(
  document: IRDocument,
  kind: PageKind,
  node: NodeModel | null,
  schema: SchemaPageModel | null,
  basePath: string,
): FrameModel {
  const tabs: FrameTabModel[] = [];

  if (node !== null && (kind === 'node' || kind === 'bench')) {
    tabs.push({
      kind: 'node',
      href: nodeHref(node.id, basePath),
      active: kind === 'node',
      count: node.runtime?.drift.length ?? 0,
    });

    const primarySchema = primarySchemaIdOf(document, node);
    if (primarySchema !== null) {
      tabs.push({
        kind: 'schema',
        href: schemaHref(primarySchema, basePath),
        active: false,
        count: 0,
      });
    }

    if (node.run !== null) {
      tabs.push({
        kind: 'bench',
        href: benchHref(node.id, basePath),
        active: kind === 'bench',
        count: 0,
      });
    }
  }

  if (schema !== null && kind === 'schema') {
    tabs.push({ kind: 'schema', href: schemaHref(schema.id, basePath), active: true, count: 0 });
  }

  tabs.push({
    kind: 'health',
    href: healthPageHref(basePath),
    active: kind === 'health',
    count: document.health?.drift.length ?? 0,
  });

  const backHref =
    kind === 'overview'
      ? ''
      : kind === 'bench' && node !== null
        ? nodeHref(node.id, basePath)
        : kind === 'shapes' && schema !== null
          ? schemaHref(schema.id, basePath)
          : overviewHref(basePath);

  return { tabs, crumb: crumbOf(document, node, schema), backHref, stats: frameStats(document) };
}

/** The page kind, stated by the caller or derived the way it was before `TX-FRAME`. */
function resolveKind(options: PageModelOptions): PageKind {
  if (options.page !== undefined) return options.page;
  if ((options.nodeId ?? null) !== null) return 'node';
  if ((options.schemaId ?? null) !== null) return 'schema';
  return 'overview';
}

/**
 * Builds the model for one page.
 *
 * An unknown node id produces the overview rather than an error. A reference is served
 * over HTTP and a stale link is a normal event, not a failure of the renderer; the caller
 * decides whether to answer 404, and `PageModel.node` being null is what tells it. A bench
 * of an unknown node degrades the same way, to the overview.
 *
 * @param document - The normalized document
 * @param options - Which page, what to show on it, and the markdown renderer to use
 * @returns A model made only of JSON values
 */
export function buildPageModel(document: IRDocument, options: PageModelOptions): PageModel {
  const { markdown } = options;
  const basePath = options.basePath ?? '';
  const context: ModelContext = {
    document,
    markdown,
    schemaBodies: schemaBodiesOf(document),
    basePath,
  };
  const requested = resolveKind(options);
  const wantsNode = requested === 'node' || requested === 'bench';
  const wantsSchema = requested === 'schema' || requested === 'shapes';

  const requestedNode = wantsNode ? (options.nodeId ?? null) : null;
  const node = requestedNode === null ? null : nodeModel(context, requestedNode);
  const requestedSchema = wantsSchema && node === null ? (options.schemaId ?? null) : null;
  const schema = requestedSchema === null ? null : schemaPageModel(context, requestedSchema);

  // A requested page whose subject does not exist degrades to the page that can render:
  // the caller answers 404 off the same absence, and a direct call keeps the old behaviour.
  const kind: PageKind = wantsNode && node === null ? 'overview' : requested;

  const slots: IRSchemaSlot[] =
    node !== null && kind === 'node'
      ? slotsOf(node)
      : schema !== null && !schema.missing
        ? [{ kind: 'named', schemaId: schema.id }]
        : [];

  // THE PANEL TRAVELS WITH THE HEALTH PAGE AND WITH NOTHING ELSE, per SPEC 7.3 as amended
  // 2026-08-14. A report of four hundred findings shipped on every node page would be the
  // largest thing on a page it is not about; the overview lost it to the page the tab names.
  const health = kind === 'health' ? buildHealthModel(document, basePath) : null;

  const payload = buildSchemaPayload(document, slots, options.schemaPayloadLimit);
  const navigation = sliceNavigation(
    buildNavigation(document),
    node === null ? null : node.id,
    schema === null ? null : schema.id,
  );

  return {
    pageModelVersion: PAGE_MODEL_VERSION,
    kind,
    frame: buildFrame(document, kind, node, schema, basePath),
    documentId: document.id,
    documentHash: document.hash,
    title: document.info.title,
    version: document.info.version,
    descriptionHtml: markdown.render(document.info.description),
    basePath,
    ...(options.proxyPath === undefined ? {} : { proxyPath: options.proxyPath }),
    servers: document.servers.map((server) => server.url),
    navigation: navigation.entries,
    navigationComplete: navigation.complete,
    navigationRows: navigation.total,
    activeNodeId: node === null ? null : node.id,
    activeSchemaId: schema === null ? null : schema.id,
    node,
    schema,
    schemas: payload.schemas,
    truncatedSchemas: payload.truncated,
    health,
    healthRendered: health !== null,
  };
}

export type {
  CodeSampleModel,
  MediaTypeModel,
  NavEntryModel,
  NodeModel,
  PageModel,
  ParameterModel,
  ResponseModel,
  SchemaPageModel,
};

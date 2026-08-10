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
  generateExample,
  type IRDocument,
  type IRJsonSchema,
  type IRMediaType,
  type IRNavNode,
  type IRParameter,
  type IRSchema,
  type IRSchemaSlot,
  type IRSchemaView,
} from '@openref/core';
import {
  materializeNode,
  resolveSchemaSlot,
  runnerOperationOf,
  schemaDisplayName,
} from '@openref/vue';
import type { RunnerOperationView } from '@openref/vue';
import { buildSchemaPayload } from './schema-payload';
import type { IMarkdownRenderer } from '../../markdown/domain/markdown';

/** Version of the page model shape, part of the cache key. */
export const PAGE_MODEL_VERSION = 2;

/** Media types an example is generated for. */
const JSON_MEDIA_TYPE = /^application\/(?:[\w.+-]+\+)?json$/i;

/** One entry of the navigation tree, flattened to what a renderer needs. */
export interface NavEntryModel {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly nodeId: string | null;
  readonly schemaId: string | null;
  readonly deprecated: boolean;
  /**
   * The second line: `METHOD /path` for an operation, the address for a channel, empty for a
   * group.
   *
   * It exists because the label is the operation's summary when it has one, and a reader
   * searching for `/orders/{id}` would otherwise find nothing on a document whose authors
   * wrote summaries. It is what the command palette matches on as well as shows.
   */
  readonly hint: string;
  readonly children: readonly NavEntryModel[];
}

/** One parameter row. */
export interface ParameterModel {
  readonly name: string;
  readonly location: string;
  readonly required: boolean;
  readonly deprecated: boolean;
  readonly typeLabel: string;
  readonly descriptionHtml: string;
  /** Where the schema viewer starts for this row, null when the parameter declares none. */
  readonly schema: IRSchemaSlot | null;
}

/** One media type of a body or a response, with its example already highlighted. */
export interface MediaTypeModel {
  readonly mediaType: string;
  readonly typeLabel: string;
  /** Highlighted example, empty when the media type is not one an example is generated for. */
  readonly exampleHtml: string;
  /** Where the schema viewer starts for this media type, null when it declares no schema. */
  readonly schema: IRSchemaSlot | null;
  /** Which half of a schema this position shows, so the viewer filters the same way. */
  readonly view: IRSchemaView;
}

/** A named schema shown on a page of its own. */
export interface SchemaPageModel {
  /** Key into the shipped schema map, suffix and all. */
  readonly id: string;
  /** What a reader is shown, which is never the identity suffix of an external target. */
  readonly name: string;
  readonly descriptionHtml: string;
  readonly deprecated: boolean;
  /** True when the id names nothing in the document, so the page says so instead of blanking. */
  readonly missing: boolean;
}

/** One response row. */
export interface ResponseModel {
  readonly statusCode: string;
  readonly descriptionHtml: string;
  readonly content: readonly MediaTypeModel[];
}

/** One security requirement, resolved against the document's schemes. */
export interface SecurityModel {
  readonly schemeId: string;
  readonly type: string;
  readonly scopes: readonly string[];
}

/** The node a page is about. */
export interface NodeModel {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly deprecated: boolean;
  /** HTTP method, uppercase, absent for a channel. */
  readonly method: string | null;
  /** Path template, absent for a channel. */
  readonly path: string | null;
  /** Channel address, absent for an operation. */
  readonly address: string | null;
  readonly summary: string;
  readonly descriptionHtml: string;
  readonly tags: readonly string[];
  readonly parameters: readonly ParameterModel[];
  readonly requestBody: readonly MediaTypeModel[];
  readonly responses: readonly ResponseModel[];
  readonly security: readonly SecurityModel[];
  /**
   * What the try-it console needs to send this operation, or null for a channel.
   *
   * The projection travels with the page rather than the IR, which is what lets a console work
   * on a static file. It carries no credential and never will: those live in the runner, behind
   * the storage policy of SPEC 14.4, and a page that carried one would be a page that published
   * it.
   */
  readonly run: RunnerOperationView | null;
}

/** Everything one page renders from. */
export interface PageModel {
  readonly pageModelVersion: number;
  readonly documentId: string;
  readonly documentHash: string;
  readonly title: string;
  readonly version: string;
  readonly descriptionHtml: string;
  readonly servers: readonly string[];
  readonly navigation: readonly NavEntryModel[];
  readonly activeNodeId: string | null;
  /** Set on a schema page, so the navigation can mark the entry that is open. */
  readonly activeSchemaId: string | null;
  /** Null on the overview page, which shows the document rather than a node. */
  readonly node: NodeModel | null;
  /** Set only on a schema page. */
  readonly schema: SchemaPageModel | null;
  /**
   * The schemas this page carries, bounded per `schema-payload.ts`.
   *
   * The viewer expands on the client, so the bodies travel with the page rather than the
   * document travelling with every page.
   */
  readonly schemas: Readonly<Record<string, IRSchema>>;
  /** Ids referenced from this page and left behind by the bound, shown as links. */
  readonly truncatedSchemas: readonly string[];
}

/** What building a page model needs. */
export interface PageModelOptions {
  /** Node to show, or null for the document overview. */
  readonly nodeId?: string | null;
  /** Named schema to show, for a schema page. Ignored when `nodeId` is set. */
  readonly schemaId?: string | null;
  readonly markdown: IMarkdownRenderer;
  /** Greatest serialized size of the schema payload. Defaults to the measured limit. */
  readonly schemaPayloadLimit?: number;
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

function navEntry(document: IRDocument, node: IRNavNode): NavEntryModel {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    nodeId: node.nodeId ?? null,
    schemaId: node.schemaId ?? null,
    deprecated: node.deprecated ?? false,
    hint: navHint(document, node.nodeId),
    children: node.children.map((child) => navEntry(document, child)),
  };
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

function exampleHtml(media: IRMediaType, context: ModelContext, view: IRSchemaView): string {
  if (!JSON_MEDIA_TYPE.test(media.mediaType)) return '';
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

function schemaPageModel(context: ModelContext, schemaId: string): SchemaPageModel {
  const entry = context.document.schemas.get(schemaId);

  if (entry === undefined) {
    return {
      id: schemaId,
      name: schemaDisplayName(undefined, schemaId),
      descriptionHtml: '',
      deprecated: false,
      missing: true,
    };
  }

  const body = entry.normalized;

  return {
    id: schemaId,
    name: schemaDisplayName(entry, schemaId),
    descriptionHtml: context.markdown.render(body?.description),
    deprecated: body?.deprecated ?? false,
    missing: false,
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

  if (view.kind === 'channel') {
    return {
      ...base,
      method: null,
      path: null,
      address: view.node.address ?? null,
      parameters: [],
      requestBody: [],
      responses: [],
      security: [],
      run: null,
    };
  }

  const parameters = [...view.parameters.values()]
    .flat()
    .map((parameter) => parameterModel(parameter, context));

  return {
    ...base,
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
    run: runnerOperationOf(view.node, document),
  };
}

/**
 * Builds the model for one page.
 *
 * An unknown node id produces the overview rather than an error. A reference is served
 * over HTTP and a stale link is a normal event, not a failure of the renderer; the caller
 * decides whether to answer 404, and `PageModel.node` being null is what tells it.
 *
 * @param document - The normalized document
 * @param options - Node to show and the markdown renderer to use
 * @returns A model made only of JSON values
 */
export function buildPageModel(document: IRDocument, options: PageModelOptions): PageModel {
  const { markdown } = options;
  const context: ModelContext = { document, markdown, schemaBodies: schemaBodiesOf(document) };
  const requestedNode = options.nodeId ?? null;
  const node = requestedNode === null ? null : nodeModel(context, requestedNode);
  const requestedSchema = node === null ? (options.schemaId ?? null) : null;
  const schema = requestedSchema === null ? null : schemaPageModel(context, requestedSchema);

  const slots: IRSchemaSlot[] =
    node !== null
      ? slotsOf(node)
      : schema !== null && !schema.missing
        ? [{ kind: 'named', schemaId: schema.id }]
        : [];

  const payload = buildSchemaPayload(document, slots, options.schemaPayloadLimit);

  return {
    pageModelVersion: PAGE_MODEL_VERSION,
    documentId: document.id,
    documentHash: document.hash,
    title: document.info.title,
    version: document.info.version,
    descriptionHtml: markdown.render(document.info.description),
    servers: document.servers.map((server) => server.url),
    navigation: document.navigation.map((entry) => navEntry(document, entry)),
    activeNodeId: node === null ? null : node.id,
    activeSchemaId: schema === null ? null : schema.id,
    node,
    schema,
    schemas: payload.schemas,
    truncatedSchemas: payload.truncated,
  };
}

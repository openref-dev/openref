import type { IRChannel, IRDocument, IRNode, IROperation } from '@openref/core';
import { compareByCodePoint } from '@openref/core';

/**
 * The searchable surface of an IR document, per SPEC 11 and BUILD T007.
 *
 * The index is a projection of the IR, not a second model of it. Everything here is derived
 * from `IRDocument` by a pure function, so an index is a function of the document hash and
 * two builds of one document produce the same bytes.
 *
 * Channels are projected from M0 even though AsyncAPI intake lands in M5. The field is the
 * cheap part; leaving it out would mean changing the serialized index format later, and an
 * index format is the kind of thing that ends up cached and versioned.
 */

/** What a search hit points at. */
export type SearchDocumentKind = 'operation' | 'channel' | 'schema';

/**
 * One indexed record.
 *
 * Field names are part of the serialized index and therefore part of a format that gets
 * cached. They are short because the 250 KB budget in SPEC 20 is measured over a thousand of
 * these, and every field name is repeated once per record in the serialized form.
 */
export interface SearchDocument {
  /** Key into `IRDocument.nodes` or `IRDocument.schemas`, and the search result id. */
  readonly id: string;
  readonly kind: SearchDocumentKind;
  /** What a result list shows: the summary, the schema name, or the route. */
  readonly title: string;
  readonly summary?: string;
  readonly description?: string;
  /** Route of an HTTP operation. */
  readonly path?: string;
  /** Method of an HTTP operation, lowercase. */
  readonly method?: string;
  /** Address of an event channel, reserved for M5. */
  readonly address?: string;
  readonly tags?: readonly string[];
  /** Names of the schemas an operation refers to, so a route can be found by its type. */
  readonly schemaNames?: readonly string[];
  readonly deprecated?: boolean;
}

function isOperation(node: IRNode): node is IROperation {
  return node.kind === 'operation';
}

function isChannel(node: IRNode): node is IRChannel {
  return node.kind === 'channel';
}

/**
 * Collects the names of every named schema an operation reaches through its use sites.
 *
 * Only named schemas, because only those have a name worth searching for. This walks the
 * slots rather than the schema bodies: a slot either names a schema or it does not, and
 * following the bodies would mean walking the whole graph for no extra name.
 */
function schemaNamesOf(operation: IROperation): string[] {
  const names = new Set<string>();

  const takeSlot = (
    slot: { readonly kind: string; readonly schemaId?: string } | undefined,
  ): void => {
    if (slot?.kind === 'named' && slot.schemaId !== undefined) names.add(slot.schemaId);
  };

  for (const parameter of operation.parameters) takeSlot(parameter.schema);

  for (const media of operation.requestBody?.content ?? []) takeSlot(media.schema);

  for (const response of operation.responses) {
    for (const media of response.content) takeSlot(media.schema);
    for (const header of Object.values(response.headers ?? {})) takeSlot(header.schema);
  }

  return [...names].sort(compareByCodePoint);
}

function operationDocument(operation: IROperation): SearchDocument {
  const document: { -readonly [Key in keyof SearchDocument]: SearchDocument[Key] } = {
    id: operation.id,
    kind: 'operation',
    title: operation.summary ?? `${operation.method.toUpperCase()} ${operation.path}`,
    path: operation.path,
    method: operation.method.toLowerCase(),
  };

  if (operation.summary !== undefined) document.summary = operation.summary;
  if (operation.description !== undefined) document.description = operation.description;
  if (operation.tags.length > 0) document.tags = [...operation.tags].sort(compareByCodePoint);
  if (operation.deprecated) document.deprecated = true;

  const schemaNames = schemaNamesOf(operation);
  if (schemaNames.length > 0) document.schemaNames = schemaNames;

  return document;
}

function channelDocument(channel: IRChannel): SearchDocument {
  const document: { -readonly [Key in keyof SearchDocument]: SearchDocument[Key] } = {
    id: channel.id,
    kind: 'channel',
    title: channel.title ?? channel.address ?? channel.id,
  };

  if (channel.address !== undefined) document.address = channel.address;
  if (channel.summary !== undefined) document.summary = channel.summary;
  if (channel.description !== undefined) document.description = channel.description;
  if (channel.tags.length > 0) document.tags = [...channel.tags].sort(compareByCodePoint);
  if (channel.deprecated) document.deprecated = true;

  return document;
}

/**
 * Projects an IR document onto the records the index is built from.
 *
 * Ordering is canonical, by id, so that the serialized index does not depend on the order the
 * source document happened to be written in.
 *
 * @param document - Normalized IR document
 * @returns Records ordered by kind and then by id
 *
 * @example
 * collectSearchDocuments(document).map((record) => record.id);
 */
export function collectSearchDocuments(document: IRDocument): SearchDocument[] {
  const records: SearchDocument[] = [];

  const nodes = [...document.nodes.values(), ...document.webhooks.values()].sort((left, right) =>
    compareByCodePoint(left.id, right.id),
  );

  for (const node of nodes) {
    if (isOperation(node)) records.push(operationDocument(node));
    else if (isChannel(node)) records.push(channelDocument(node));
  }

  const schemaIds = [...document.schemas.keys()].sort(compareByCodePoint);
  for (const id of schemaIds) {
    const schema = document.schemas.get(id);
    if (schema?.name === undefined) continue;

    const record: { -readonly [Key in keyof SearchDocument]: SearchDocument[Key] } = {
      id,
      kind: 'schema',
      title: schema.name,
    };

    const title = schema.normalized?.title;
    const description = schema.normalized?.description;
    if (title !== undefined && title !== schema.name) record.summary = title;
    if (description !== undefined) record.description = description;

    records.push(record);
  }

  return records;
}

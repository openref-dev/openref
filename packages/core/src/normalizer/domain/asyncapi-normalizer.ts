import { compareByCodePoint } from '../../hashing/domain/canonical';
import { finalizeDocument } from '../../hashing/domain/hash';
import type { IRDocument, IRServer } from '../../ir/domain/document.types';
import type {
  IRChannel,
  IRChannelDirection,
  IRChannelOperation,
  IRExample,
  IRMessage,
  IRNode,
  IRServerOverride,
} from '../../ir/domain/node.types';
import type { IRJsonValue, IRSchema } from '../../ir/domain/schema.types';
import {
  CycleDepthError,
  ErrorCode,
  RefResolutionError,
  UnsupportedDialectError,
} from '../../shared/errors/index';
import { dialectFromSchemaFormat, isJsonSchemaCompatible } from './dialect';
import {
  collectNamedSchemas,
  documentSlug,
  invalidDocument,
  produceDeclaredSchemas,
  readExtensions,
  readInfo,
  readServerVariables,
  readTagNames,
  readTags,
  schemaOptions,
  schemaSlot,
  type SchemaContext,
} from './document-parts';
import { asJsonValue, asString, isPlainObject, isUnknownArray } from './guards';
import { buildNavigation } from './navigation';
import { parseReference, resolveJsonPointer } from './json-pointer';
import { pathSlug } from './operation-identity';
import { normalizeSchema } from './schema-normalizer';
import { createSchemaRegistry } from './schema-registry';

/**
 * AsyncAPI intake for 3.0 and 3.1, per SPEC 8.1, SPEC 8.2 and SPEC 5.2.
 *
 * EVENTS AND HTTP ARE ONE MODEL AND NOT TWO PIPELINES. What comes out of here is an
 * {@link IRDocument} of the same shape an OpenAPI document produces: channels are nodes under the
 * `channel` discriminant of SPEC 5.1, named schemas live in the one map of SPEC 5.1.1, the
 * navigation is built by the same builder, and the hash is taken the same way. Nothing downstream
 * of `core` learns which specification a document was written in, which is the whole point of the
 * discriminant having been reserved since M0.
 *
 * 3.1 IS A BACKWARDS COMPATIBLE MINOR OF 3.0 AND THE VERSION DOES NOT REACH THE IR. Per SPEC 8.1
 * the target format is 3.1 for both inputs, and 3.1 adds one protocol binding to a set this
 * normalizer carries verbatim whatever it is called. So a 3.0 document and the same document
 * declaring 3.1 normalize to one IR with one hash, and the version string is read to be refused
 * or accepted rather than to be recorded.
 *
 * ORDERING IS CANONICAL RATHER THAN TAKEN FROM OBJECT ITERATION, for the reason SPEC 5.3 gives.
 * AsyncAPI keys `servers`, `channels`, `operations` and a channel's `messages` by name, and a
 * parsed object hands those back in an order no document controls once a key looks like an
 * integer. Every one of them is walked in code point order of its key.
 */

/** Options for {@link normalizeAsyncApiDocument}. */
export interface NormalizeAsyncApiOptions {
  /** Identity of the document, used as the federation key. Defaults to a slug of the title. */
  readonly documentId?: string;
  /** Documents that external schema references point at, keyed by the URI before the `#`. */
  readonly externalDocuments?: Readonly<Record<string, unknown>>;
  /** Limit on how deeply anonymous schemas may nest. */
  readonly cycleDepth?: number;
}

const SUPPORTED_ASYNCAPI_MAJOR_MINOR = ['3.0', '3.1'];

/**
 * What separates a channel node id from an operation node id, per SPEC 5.4.
 *
 * An operation id is `<method>-<path-slug>` and a channel id is this plus a slug of the address,
 * so the two cannot meet inside one document. They have to share `IRDocument.nodes`, and a mixed
 * HTTP and events document is the point of the milestone rather than an edge case, so a channel
 * called `get/orders` must not be able to take the id of `GET /orders`.
 */
const CHANNEL_ID_PREFIX = 'channel-';

/** A mutable draft of an IR value, so optional members can be filled in conditionally. */
type Draft<Value> = { -readonly [Key in keyof Value]: Value[Key] };

/**
 * How deep the merge of a trait into its target may go before it is refused.
 *
 * DECLARED RATHER THAN INHERITED FROM THE STACK, per SPEC 5.3's second finding. The merge
 * descends only where both sides hold an object at one key, which a document written by hand
 * never does more than a couple of levels, but a YAML alias can make a value that contains
 * itself, and an undeclared limit turns that into a bare `RangeError` instead of a refusal.
 */
const MAX_TRAIT_MERGE_DEPTH = 12;

interface Context extends SchemaContext {
  /** Every server the document declares, keyed by the name it declares it under. */
  readonly servers: ReadonlyMap<string, IRServer>;
  /** The name of a server, keyed by the object a reference to it resolves to. */
  readonly serverNames: ReadonlyMap<object, string>;
  /** Document level `defaultContentType`, which a message with none of its own inherits. */
  readonly defaultContentType: string | undefined;
}

/**
 * Follows a chain of `$ref` members to the object a structural reference names.
 *
 * IT TERMINATES BY CONSTRUCTION rather than by a depth counter: each hop records the object it
 * came from, and a document holds finitely many objects, so the walk either reaches something
 * that is not a reference or meets an object it has already stood on. The second is a cycle and
 * is refused, because a channel that is its own definition describes nothing.
 *
 * A STRUCTURAL REFERENCE STAYS INSIDE ITS DOCUMENT, which is not the rule for schemas. SPEC 5.1.1
 * gives an external schema target an id space and a registry; a channel, a message or a server in
 * another file has neither, so pointing at one is refused rather than resolved to nothing.
 *
 * @param context - The document being normalized
 * @param value - The member as written, which may or may not be a reference
 * @param where - What is being resolved, for the message a reader gets
 * @returns The object the reference names, or the value itself when it is not one
 * @throws {RefResolutionError} When the reference leaves the document or resolves to nothing
 * @throws {CycleDepthError} When the chain of references returns to where it has been
 */
function followReference(context: Context, value: unknown, where: string): unknown {
  const visited = new Set<object>();
  let current = value;

  while (isPlainObject(current)) {
    const reference = asString(current.$ref);
    if (reference === undefined) return current;

    if (visited.has(current)) {
      throw new CycleDepthError(
        `${where} follows a chain of references that returns to ${reference}`,
        ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED,
        undefined,
        { reference, where },
      );
    }
    visited.add(current);

    const parsed = parseReference(reference);
    if (parsed.external) {
      throw new RefResolutionError(
        `${where} points at ${reference}, and a channel, message or server is resolved inside ` +
          'the document that writes it rather than in another file',
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { reference, where },
      );
    }

    current = resolveJsonPointer(context.document, parsed.pointer);
  }

  return current;
}

/**
 * Merges one trait underneath its target, by the rule AsyncAPI states for traits.
 *
 * A PROPERTY OF A TRAIT NEVER OVERRIDES THE SAME PROPERTY OF THE TARGET, which is the sentence
 * the specification uses, and the merge is the JSON Merge Patch shape rather than a shallow
 * assignment: a trait declaring `bindings.amqp` and a message declaring `bindings.kafka` leave
 * both bindings standing, where an assignment would leave one.
 *
 * @param target - The object the trait is applied to
 * @param trait - The trait
 * @param depth - How far down the merge already is
 * @returns The merged object
 * @throws {CycleDepthError} Past {@link MAX_TRAIT_MERGE_DEPTH}
 */
function mergeTrait(target: unknown, trait: unknown, depth: number): unknown {
  if (!isPlainObject(target) || !isPlainObject(trait)) return target;

  if (depth > MAX_TRAIT_MERGE_DEPTH) {
    throw new CycleDepthError(
      `a trait nests deeper than the ${String(MAX_TRAIT_MERGE_DEPTH)} levels this merges`,
      ErrorCode.NORM_CYCLE_DEPTH_EXCEEDED,
      undefined,
      { limit: MAX_TRAIT_MERGE_DEPTH },
    );
  }

  const merged: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(trait)) {
    merged[key] = Object.hasOwn(merged, key) ? mergeTrait(merged[key], value, depth + 1) : value;
  }

  return merged;
}

/**
 * Applies the `traits` of an operation or a message, in the order the document declares them.
 *
 * TRAITS ARE READ BECAUSE NOT READING THEM LOSES FIELDS IN SILENCE. A document that puts an
 * operation's bindings in a trait, which the reference AsyncAPI examples do, would otherwise
 * normalize to an operation with no bindings and nothing anywhere saying it had any. Nothing
 * about the merge is a guess: it is the specification's own mechanism, applied in the
 * specification's own order.
 *
 * @param context - The document being normalized
 * @param source - The object as written, resolved
 * @param where - What is being merged, for the message a reader gets
 * @returns The object with its traits underneath it, or the object itself when it declares none
 */
function applyTraits(
  context: Context,
  source: Record<string, unknown>,
  where: string,
): Record<string, unknown> {
  const traits = source.traits;
  if (!isUnknownArray(traits)) return source;

  let merged: Record<string, unknown> = source;
  for (const [index, entry] of traits.entries()) {
    const trait = followReference(context, entry, `trait ${String(index)} of ${where}`);
    const result = mergeTrait(merged, trait, 0);
    if (isPlainObject(result)) merged = result;
  }

  return merged;
}

/**
 * Reads the Protocol Bindings of a channel, an operation or a message, verbatim.
 *
 * THIS IS THE ONE PART OF AN ASYNCAPI DOCUMENT WITH NO OPENAPI ANALOGUE, per SPEC 8.2, so there
 * is nothing to reduce it to. A partition key, an exchange type and a QoS level are read by
 * whoever knows the protocol, and this normalizer is not that reader: the block is carried as
 * written, keyed by the protocol name the document used, and a binding for a protocol invented
 * after this code was written survives exactly as one for a protocol that predates it.
 *
 * @param raw - The `bindings` member, untrusted
 * @returns The bindings keyed by protocol name, or nothing when there are none
 */
function readBindings(raw: unknown): Record<string, IRJsonValue> | undefined {
  if (!isPlainObject(raw)) return undefined;

  const bindings: Record<string, IRJsonValue> = {};
  for (const protocol of Object.keys(raw).sort(compareByCodePoint)) {
    const value = asJsonValue(raw[protocol]);
    if (value !== undefined) bindings[protocol] = value;
  }

  return Object.keys(bindings).length > 0 ? bindings : undefined;
}

/**
 * Reads the servers a document declares, keyed by name.
 *
 * `url` IS RECONSTRUCTED, BECAUSE ASYNCAPI 3 DOES NOT WRITE ONE. It splits what 2.x called a url
 * into `host`, `pathname` and `protocol`, and {@link IRServer} carries a url and a protocol
 * beside it, so the url is `<protocol>://<host><pathname>` and the protocol also stands on its
 * own field. Nothing here treats that url as an HTTP address: SPEC 14.5's allowlist reads it,
 * finds a scheme its proxy does not speak, and reports the server as one it cannot reach, which
 * is the correct answer for a broker.
 *
 * A server missing `host` or `protocol` is skipped, the way a server object with no url is
 * skipped on the OpenAPI side. Both are required members, and a declaration that carries neither
 * an address nor a way to speak to it names nothing.
 *
 * @param context - The document being normalized, with an empty server map
 * @param raw - The `servers` member, untrusted
 * @returns The servers by declared name, in code point order of that name
 */
function readAsyncApiServers(context: Context, raw: unknown): Map<string, IRServer> {
  const servers = new Map<string, IRServer>();
  if (!isPlainObject(raw)) return servers;

  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const source = followReference(context, raw[name], `server ${name}`);
    if (!isPlainObject(source)) continue;

    const host = asString(source.host);
    const protocol = asString(source.protocol);
    if (host === undefined || protocol === undefined) continue;

    const server: Draft<IRServer> = {
      url: `${protocol}://${host}${asString(source.pathname) ?? ''}`,
      protocol,
    };

    const description = asString(source.description);
    const protocolVersion = asString(source.protocolVersion);
    if (description !== undefined) server.description = description;
    if (protocolVersion !== undefined) server.protocolVersion = protocolVersion;

    const variables = readServerVariables(source.variables);
    if (variables !== undefined) server.variables = variables;

    servers.set(name, server);
  }

  return servers;
}

/** A channel as the document wrote it, with the identity this normalizer gave it. */
interface RawChannel {
  /** The key the document files the channel under. */
  readonly key: string;
  readonly source: Record<string, unknown>;
  /** Node id, unique within the document. */
  readonly id: string;
  /** The channel's messages by the key its own `messages` map files them under. */
  readonly messages: readonly RawMessage[];
}

/** One message of a channel, as the document wrote it. */
interface RawMessage {
  readonly key: string;
  readonly source: Record<string, unknown>;
}

/**
 * Reads a channel's own `messages` map, in code point order of its keys.
 *
 * The key is the message id in the IR, and it is the key rather than the message's `name`
 * because that is what an operation refers to: `#/channels/<channel>/messages/<key>`.
 *
 * @param context - The document being normalized
 * @param source - The channel object
 * @param key - The channel's key, for the message a reader gets
 * @returns The messages, in canonical order
 */
function collectMessages(
  context: Context,
  source: Record<string, unknown>,
  key: string,
): RawMessage[] {
  const raw = source.messages;
  if (!isPlainObject(raw)) return [];

  const messages: RawMessage[] = [];
  for (const name of Object.keys(raw).sort(compareByCodePoint)) {
    const resolved = followReference(context, raw[name], `message ${name} of channel ${key}`);
    if (!isPlainObject(resolved)) continue;
    messages.push({ key: name, source: resolved });
  }

  return messages;
}

/**
 * Reads the Correlation ID Object down to the one thing the IR holds.
 *
 * `IRMessage.correlationId` IS THE RUNTIME EXPRESSION AND NOT THE OBJECT. AsyncAPI writes
 * `{ location, description }`, and `location` is the whole of the fact: it says where in the
 * message the value that ties a request to its reply is found. The description is prose about
 * that expression and the IR has nowhere to put it, so it is left rather than folded into a
 * field that means something else.
 *
 * @param context - The document being normalized
 * @param raw - The `correlationId` member, untrusted
 * @param where - What is being read, for the message a reader gets
 * @returns The runtime expression, or nothing when the document wrote none
 */
function readCorrelationId(context: Context, raw: unknown, where: string): string | undefined {
  if (raw === undefined) return undefined;

  const source = followReference(context, raw, where);
  if (!isPlainObject(source)) return undefined;

  return asString(source.location);
}

/**
 * Reads a message's examples, which AsyncAPI writes as a list rather than as a map.
 *
 * THE VALUE IS THE MESSAGE AND NOT ONLY ITS PAYLOAD. An AsyncAPI example carries `headers` and
 * `payload`, and {@link IRExample.value} is one value, so taking the payload alone would drop the
 * headers of every example that has them without saying so. The value is therefore an object
 * carrying whichever of the two the document wrote, under those names, which is the same shape
 * for every example and so is something a renderer can draw one way.
 *
 * @param raw - The `examples` member of a message, untrusted
 * @returns The examples keyed by their declared name, or by position when they declare none
 */
function readMessageExamples(raw: unknown): Record<string, IRExample> | undefined {
  if (!isUnknownArray(raw)) return undefined;

  const examples: Record<string, IRExample> = {};
  for (const [index, entry] of raw.entries()) {
    if (!isPlainObject(entry)) continue;

    const position = `example-${String(index + 1)}`;
    const declared = asString(entry.name) ?? position;
    // Two examples may carry one name, and the second must not replace the first in silence.
    const key = Object.hasOwn(examples, declared) ? `${declared}-${position}` : declared;

    const example: Draft<IRExample> = {};
    const summary = asString(entry.summary);
    if (summary !== undefined) example.summary = summary;

    const value: Record<string, IRJsonValue> = {};
    const headers = asJsonValue(entry.headers);
    const payload = asJsonValue(entry.payload);
    if (headers !== undefined) value.headers = headers;
    if (payload !== undefined) value.payload = payload;
    if (Object.keys(value).length > 0) example.value = value;

    examples[key] = example;
  }

  return Object.keys(examples).length > 0 ? examples : undefined;
}

/**
 * Builds one message of a channel.
 *
 * `payload` AND `headers` BOTH GO THROUGH THE MULTI FORMAT SCHEMA OBJECT PATH OF SPEC 5.2, which
 * is `T005`'s and is shared with everything else that reads a schema. A JSON Schema compatible
 * payload takes the common pipeline and fills `normalized`; Avro, Protobuf and a format this
 * version does not know keep `raw` with the `schemaFormat` string inside it, so the renderer can
 * show annotated source and name the language.
 *
 * @param context - The document being normalized
 * @param entry - The message, resolved
 * @param channelId - Node id of the channel it belongs to, for the inline schema ids
 * @returns The message
 */
function readMessage(context: Context, entry: RawMessage, channelId: string): IRMessage {
  const { key } = entry;
  const source = applyTraits(context, entry.source, `message ${key}`);
  const message: Draft<IRMessage> = { id: key };

  const name = asString(source.name);
  const title = asString(source.title);
  const summary = asString(source.summary);
  const description = asString(source.description);
  // A message that names no content type takes the document's `defaultContentType`, which is
  // what that field is for. Leaving it empty would report a message as untyped on a document
  // that typed all of them in one place.
  const contentType = asString(source.contentType) ?? context.defaultContentType;
  if (name !== undefined) message.name = name;
  if (title !== undefined) message.title = title;
  if (summary !== undefined) message.summary = summary;
  if (description !== undefined) message.description = description;
  if (contentType !== undefined) message.contentType = contentType;

  const payload = schemaSlot(source.payload, context, `${channelId}.messages.${key}.payload`);
  const headers = schemaSlot(source.headers, context, `${channelId}.messages.${key}.headers`);
  if (payload !== undefined) message.payload = payload;
  if (headers !== undefined) message.headers = headers;

  const correlationId = readCorrelationId(
    context,
    source.correlationId,
    `the correlationId of message ${key}`,
  );
  if (correlationId !== undefined) message.correlationId = correlationId;

  const bindings = readBindings(source.bindings);
  const examples = readMessageExamples(source.examples);
  if (bindings !== undefined) message.bindings = bindings;
  if (examples !== undefined) message.examples = examples;

  return message;
}

/**
 * The IR override that names one server, description and all.
 *
 * @param server - The server as the document declared it
 * @returns The override a node carries for it
 */
function serverOverride(server: IRServer): IRServerOverride {
  const override: Draft<IRServerOverride> = { url: server.url };
  if (server.description !== undefined) override.description = server.description;
  return override;
}

/**
 * Builds the servers a channel is bound to, both as IR overrides and as the servers themselves.
 *
 * ABSENT AND EMPTY BOTH MEAN EVERY SERVER, WHICH IS ASYNCAPI'S OWN SENTENCE AND NOT A CHOICE MADE
 * HERE. The Channel Object's `servers` field, in `spec/asyncapi.md` of `asyncapi/spec` at both
 * `v3.0.0` and `v3.1.0`, word for word: "If `servers` is absent or empty, this channel MUST be
 * available on all the servers defined in the Servers Object". The OpenAPI side keeps "said
 * nothing" apart from "said none" for an operation's `security`, and SPEC 8.2 used to carry that
 * distinction over to here, which was reading one specification by the other one's rule.
 *
 * SO THE LIST IS RESOLVED RATHER THAN LEFT EMPTY. A reader of `IRChannel.servers` alone gets the
 * servers the channel is on, in the canonical order `IRDocument.servers` keeps, instead of an
 * empty array that says "on no server" about a channel that is on all of them.
 *
 * @param context - The document being normalized
 * @param source - The channel object
 * @param key - The channel's key, for the message a reader gets
 * @returns The overrides for the IR, and the servers they name
 * @throws {RefResolutionError} When a reference names no server the document declares
 */
function readChannelServers(
  context: Context,
  source: Record<string, unknown>,
  key: string,
): { readonly overrides: IRServerOverride[]; readonly bound: IRServer[] } {
  const raw = Object.hasOwn(source, 'servers') ? source.servers : undefined;

  // A member written as something other than an array is read as one that was not written, the
  // way every other member of the wrong shape is skipped here, so it lands on the same default.
  if (!isUnknownArray(raw) || raw.length === 0) {
    const every = [...context.servers.values()];
    return { overrides: every.map(serverOverride), bound: every };
  }

  const overrides: IRServerOverride[] = [];
  const bound: IRServer[] = [];

  for (const [index, entry] of raw.entries()) {
    const where = `server ${String(index)} of channel ${key}`;
    const resolved = followReference(context, entry, where);
    if (!isPlainObject(resolved)) continue;

    const name = context.serverNames.get(resolved);
    const server = name === undefined ? undefined : context.servers.get(name);
    if (server === undefined) {
      throw new RefResolutionError(
        `${where} names no server this document declares under servers`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { channel: key, index },
      );
    }

    overrides.push(serverOverride(server));
    bound.push(server);
  }

  return { overrides, bound };
}

/**
 * The one protocol a channel speaks, when the document leaves no doubt about which it is.
 *
 * AsyncAPI puts the protocol on the server rather than on the channel, and a channel is bound to
 * a set of servers. So the protocol of a channel is the protocol of its servers when they agree,
 * and nothing when they do not: a topic offered over both `kafka` and `ws` has two protocols, and
 * naming one of them would be this normalizer choosing on the document's behalf.
 *
 * @param bound - The servers the channel is available on
 * @returns The protocol they agree on, or nothing
 */
function channelProtocol(bound: readonly IRServer[]): string | undefined {
  const protocols = new Set<string>();
  for (const server of bound) {
    if (server.protocol !== undefined) protocols.add(server.protocol);
  }

  return protocols.size === 1 ? [...protocols][0] : undefined;
}

/**
 * Collects every channel, resolved, in code point order of its key, with a node id each.
 *
 * THE ID IS DERIVED FROM THE ADDRESS AND NOT FROM THE KEY WHEN THERE IS ONE, because the address
 * is what a reader sees and what a deep link should say. A channel with no address, which
 * AsyncAPI permits for one whose address is decided at runtime, falls back to its key, since a
 * node still needs a permalink. A clash between two derived ids takes a numeric suffix in
 * canonical order, the same resolution operation identity uses.
 *
 * @param context - The document being normalized
 * @param raw - The `channels` member, untrusted
 * @returns The channels, in canonical order
 */
function collectChannels(context: Context, raw: unknown): RawChannel[] {
  if (!isPlainObject(raw)) return [];

  const channels: RawChannel[] = [];
  const taken = new Set<string>();

  for (const key of Object.keys(raw).sort(compareByCodePoint)) {
    const source = followReference(context, raw[key], `channel ${key}`);
    if (!isPlainObject(source)) continue;

    const derived = `${CHANNEL_ID_PREFIX}${pathSlug(asString(source.address) ?? key)}`;
    let id = derived;
    let suffix = 2;
    while (taken.has(id)) {
      id = `${derived}-${String(suffix)}`;
      suffix += 1;
    }
    taken.add(id);

    channels.push({ key, source, id, messages: collectMessages(context, source, key) });
  }

  return channels;
}

/**
 * Reads the root `operations` block and files each operation under the channel it names.
 *
 * FAIL CLOSED ON BOTH REQUIRED MEMBERS. `action` has two legal values and `channel` has to point
 * at a channel this document lists, so an operation missing either is not a malformed optional
 * member to skip past: it is an operation that would leave the reference with nothing anywhere
 * recording that the document had it. The channel is matched by the object a reference resolves
 * to rather than by the text of the pointer, so a document that reaches its channel through
 * `#/components/channels/...` is read correctly as long as the root `channels` block names the
 * same object.
 *
 * @param context - The document being normalized
 * @param raw - The `operations` member, untrusted
 * @param channels - The channels, already collected
 * @returns The operations of each channel, keyed by the channel's key
 * @throws {NormalizeError} When an operation declares no readable action
 * @throws {RefResolutionError} When an operation names a channel or a message that is not there
 */
function collectChannelOperations(
  context: Context,
  raw: unknown,
  channels: readonly RawChannel[],
): Map<string, IRChannelOperation[]> {
  const byChannel = new Map<string, IRChannelOperation[]>();
  for (const channel of channels) byChannel.set(channel.key, []);

  if (!isPlainObject(raw)) return byChannel;

  const channelKeys = new Map<object, string>();
  const messageKeys = new Map<object, { readonly channel: string; readonly message: string }>();
  for (const channel of channels) {
    channelKeys.set(channel.source, channel.key);
    for (const message of channel.messages) {
      messageKeys.set(message.source, { channel: channel.key, message: message.key });
    }
  }

  for (const key of Object.keys(raw).sort(compareByCodePoint)) {
    const resolved = followReference(context, raw[key], `operation ${key}`);
    if (!isPlainObject(resolved)) continue;
    const source = applyTraits(context, resolved, `operation ${key}`);

    const action = asString(source.action);
    if (action !== 'send' && action !== 'receive') {
      throw invalidDocument(
        `operation ${key} declares the action ${JSON.stringify(source.action)}, and an ` +
          'AsyncAPI operation is either send or receive',
        { operation: key, action: source.action },
      );
    }

    const target = followReference(context, source.channel, `the channel of operation ${key}`);
    const channelKey = isPlainObject(target) ? channelKeys.get(target) : undefined;
    if (channelKey === undefined) {
      throw new RefResolutionError(
        `operation ${key} names no channel this document lists under channels`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { operation: key },
      );
    }

    const channel = channels.find((candidate) => candidate.key === channelKey);
    const operation: Draft<IRChannelOperation> = {
      id: key,
      direction: action satisfies IRChannelDirection,
      messageIds: readOperationMessageIds(
        context,
        source.messages,
        key,
        channelKey,
        channel?.messages ?? [],
        messageKeys,
      ),
    };

    const summary = asString(source.summary);
    const description = asString(source.description);
    const bindings = readBindings(source.bindings);
    if (summary !== undefined) operation.summary = summary;
    if (description !== undefined) operation.description = description;
    if (bindings !== undefined) operation.bindings = bindings;

    byChannel.get(channelKey)?.push(operation);
  }

  return byChannel;
}

/**
 * The messages one operation carries, as ids into its own channel's message list.
 *
 * AN OPERATION THAT NAMES NO MESSAGE CARRIES ALL OF THEM, which is AsyncAPI's own default and is
 * a reading of the document rather than a guess about it. One that names messages must name
 * messages of its own channel: a reference into another channel's list would produce an id that
 * resolves to nothing, since `messageIds` are local names inside the channel that holds them.
 *
 * @param context - The document being normalized
 * @param raw - The operation's `messages` member, untrusted
 * @param key - The operation's key, for the message a reader gets
 * @param channelKey - Key of the channel the operation is on
 * @param messages - That channel's messages
 * @param messageKeys - Every message of every channel, by the object it resolves to
 * @returns The message ids, in the order the operation wrote them
 * @throws {RefResolutionError} When a reference names no message of that channel
 */
function readOperationMessageIds(
  context: Context,
  raw: unknown,
  key: string,
  channelKey: string,
  messages: readonly RawMessage[],
  messageKeys: ReadonlyMap<object, { readonly channel: string; readonly message: string }>,
): string[] {
  if (!isUnknownArray(raw)) return messages.map((message) => message.key);

  const ids: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const where = `message ${String(index)} of operation ${key}`;
    const resolved = followReference(context, entry, where);
    const found = isPlainObject(resolved) ? messageKeys.get(resolved) : undefined;

    if (found?.channel !== channelKey) {
      throw new RefResolutionError(
        `${where} names no message of channel ${channelKey}`,
        ErrorCode.NORM_REF_UNRESOLVED,
        undefined,
        { operation: key, channel: channelKey, index },
      );
    }

    if (!ids.includes(found.message)) ids.push(found.message);
  }

  return ids;
}

/**
 * Builds one channel node.
 *
 * @param context - The document being normalized
 * @param channel - The channel as written, with its id
 * @param operations - The operations that named it, in canonical order
 * @returns The channel node
 */
function readChannel(
  context: Context,
  channel: RawChannel,
  operations: readonly IRChannelOperation[],
): IRChannel {
  const { source, key, id } = channel;
  const { overrides, bound } = readChannelServers(context, source, key);

  const node: Draft<IRChannel> = {
    kind: 'channel',
    id,
    tags: readTagNames(source.tags),
    // AsyncAPI declares no `deprecated` on a channel, at any version this reads. The field is
    // required by the IR because an HTTP operation always answers it, so the honest answer here
    // is the one the document gives, which is that it says nothing.
    deprecated: false,
    servers: overrides,
    operations: [...operations],
    messages: channel.messages.map((message) => readMessage(context, message, id)),
  };

  const address = asString(source.address);
  const title = asString(source.title);
  const summary = asString(source.summary);
  const description = asString(source.description);
  const protocol = channelProtocol(bound);
  const bindings = readBindings(source.bindings);
  const extensions = readExtensions(source);

  if (address !== undefined) node.address = address;
  if (title !== undefined) node.title = title;
  if (summary !== undefined) node.summary = summary;
  if (description !== undefined) node.description = description;
  if (protocol !== undefined) node.protocol = protocol;
  if (bindings !== undefined) node.bindings = bindings;
  if (extensions !== undefined) node.extensions = extensions;

  return node;
}

/**
 * Splits `components.schemas` into the entries the shared pipeline can make and the rest.
 *
 * AN ENTRY CARRYING `schemaFormat` IS A MULTI FORMAT SCHEMA OBJECT AND NOT A JSON SCHEMA, so it
 * cannot go through the registry: `{ schemaFormat, schema }` normalized as a schema would produce
 * a body with two keywords JSON Schema has never heard of. Both halves of SPEC 5.2 are honoured
 * here instead. A JSON Schema compatible format has its inner `schema` normalized under the
 * declared name; Avro, Protobuf and a format this version does not recognise keep the whole
 * object in `raw` with the `schemaFormat` string inside it, which is what lets the renderer show
 * annotated source and say which language it is.
 *
 * @param context - The document being normalized
 * @returns The names to produce through the registry, and the schemas built here
 */
function readDeclaredSchemas(context: Context): {
  readonly plain: string[];
  readonly multiFormat: IRSchema[];
} {
  const components = context.document.components;
  const declared = isPlainObject(components) ? components.schemas : undefined;
  if (!isPlainObject(declared)) return { plain: [], multiFormat: [] };

  const plain: string[] = [];
  const multiFormat: IRSchema[] = [];

  for (const name of Object.keys(declared).sort(compareByCodePoint)) {
    const source = declared[name];
    if (!isPlainObject(source) || !('schemaFormat' in source)) {
      plain.push(name);
      continue;
    }

    const dialect = dialectFromSchemaFormat(source.schemaFormat);
    if (!isJsonSchemaCompatible(dialect)) {
      multiFormat.push({ id: name, name, dialect, raw: source });
      continue;
    }

    multiFormat.push({
      id: name,
      name,
      dialect,
      normalized: normalizeSchema(source.schema, schemaOptions(context)),
    });
  }

  return { plain, multiFormat };
}

/**
 * Reads and checks the `asyncapi` version field.
 *
 * @param document - The document, untrusted
 * @returns The major and minor version, for example `3.1`
 * @throws {NormalizeError} When the field is missing
 * @throws {UnsupportedDialectError} For a version outside 3.0 and 3.1
 */
function readVersion(document: Record<string, unknown>): string {
  const version = asString(document.asyncapi);
  if (version === undefined) {
    throw invalidDocument('the document has no asyncapi version field');
  }

  const majorMinor = version.split('.').slice(0, 2).join('.');
  if (SUPPORTED_ASYNCAPI_MAJOR_MINOR.includes(majorMinor)) return majorMinor;

  const major = Number.parseInt(version, 10);
  const legacy =
    Number.isInteger(major) && major < 3
      ? '; convert the document to AsyncAPI 3.x first'
      : `; supported versions are ${SUPPORTED_ASYNCAPI_MAJOR_MINOR.join(', ')}`;

  throw new UnsupportedDialectError(
    `AsyncAPI ${version} is not supported${legacy}`,
    ErrorCode.NORM_UNSUPPORTED_DIALECT,
    undefined,
    { version },
  );
}

/**
 * Normalizes an AsyncAPI 3.0 or 3.1 document into the intermediate representation.
 *
 * WHAT THIS DOCUMENT DOES NOT CARRY, SAID HERE RATHER THAN LEFT TO BE NOTICED. `security` is
 * empty and `relationships` is empty, and neither is an oversight. AsyncAPI declares thirteen
 * kinds of security scheme where {@link IRSecuritySchemeType} has the five OpenAPI names, so
 * reading the overlap would put a partial security picture on a page where partial is worse than
 * absent. `relationships` is SPEC 9 and is built by `T052` with the topology graph, from
 * declarations rather than from the shape of a channel list.
 *
 * @param input - Parsed document, untrusted
 * @param options - Document id, external documents and nesting depth
 * @returns The document, fully resolved, ordered canonically and hashed
 * @throws {UnsupportedDialectError} For an AsyncAPI version outside 3.0 and 3.1, and for a
 *         `schemaFormat` that names no schema language at all
 * @throws {NormalizeError} When the document is malformed
 *
 * @example
 * const ir = normalizeAsyncApiDocument(parseSpecification(text));
 */
export function normalizeAsyncApiDocument(
  input: unknown,
  options: NormalizeAsyncApiOptions = {},
): IRDocument {
  if (!isPlainObject(input)) throw invalidDocument('the document is not an object');

  readVersion(input);

  const components = isPlainObject(input.components) ? input.components : undefined;
  const servers = new Map<string, IRServer>();
  const serverNames = new Map<object, string>();

  const context: Context = {
    document: input,
    // The default schema language of AsyncAPI 3, which is JSON Schema compatible and so takes
    // the shared pipeline. A payload that declares a `schemaFormat` overrides this per SPEC 5.2.
    dialect: 'asyncapi-schema',
    namedSchemas: new Set(
      components !== undefined && isPlainObject(components.schemas)
        ? Object.keys(components.schemas)
        : [],
    ),
    externalDocuments: options.externalDocuments ?? {},
    cycleDepth: options.cycleDepth,
    registry: createSchemaRegistry(),
    servers,
    serverNames,
    defaultContentType: asString(input.defaultContentType),
  };

  const info = readInfo(input.info);

  const declared = readDeclaredSchemas(context);
  produceDeclaredSchemas(context, declared.plain);

  // The server map is filled in place, because a channel resolves a reference to a server and
  // has to find the entry this walk produced, and both are members of one context.
  const rawServers = isPlainObject(input.servers) ? input.servers : undefined;
  for (const [name, server] of readAsyncApiServers(context, input.servers)) {
    servers.set(name, server);
    const source =
      rawServers === undefined
        ? undefined
        : followReference(context, rawServers[name], `server ${name}`);
    if (isPlainObject(source)) serverNames.set(source, name);
  }

  const rawChannels = collectChannels(context, input.channels);
  const operations = collectChannelOperations(context, input.operations, rawChannels);

  const channels = rawChannels.map((channel) =>
    readChannel(context, channel, operations.get(channel.key) ?? []),
  );

  const byId = new Map<string, IRSchema>();
  for (const schema of collectNamedSchemas(context)) byId.set(schema.id, schema);
  // A multi format declaration wins its own name. A JSON schema elsewhere in the document may
  // have referred to it and left a normalized body under the same id, and of the two readings the
  // one the declaration itself states is the correct one.
  for (const schema of declared.multiFormat) byId.set(schema.id, schema);
  const schemas = [...byId.values()].sort((left, right) => compareByCodePoint(left.id, right.id));

  const nodes = new Map<string, IRNode>(channels.map((channel) => [channel.id, channel]));

  const document: Draft<IRDocument> = {
    id: options.documentId ?? documentSlug(info.title),
    kind: 'events',
    hash: '',
    info,
    // NO DEFAULT SERVER, WHICH IS THE OPPOSITE OF THE OPENAPI SIDE. OpenAPI declares that a
    // document with no `servers` has one server at `/`, meaning wherever the document is served
    // from. AsyncAPI declares no such default, and inventing one would put an HTTP relative
    // address in the broker list of a document that named no broker.
    servers: [...servers.values()],
    navigation: buildNavigation({
      tags: readTags(readInfoTags(input.info)),
      nodes: channels,
      schemas,
    }),
    nodes,
    schemas: new Map(schemas.map((schema) => [schema.id, schema])),
    security: [],
    relationships: [],
    webhooks: new Map<string, IRNode>(),
  };

  const extensions = readExtensions(input);
  if (extensions !== undefined) document.extensions = extensions;

  return finalizeDocument(document);
}

/**
 * The document level tag list, which AsyncAPI 3 writes under `info` rather than at the root.
 *
 * @param info - The `info` member, untrusted
 * @returns The `tags` member, or nothing
 */
function readInfoTags(info: unknown): unknown {
  return isPlainObject(info) ? info.tags : undefined;
}

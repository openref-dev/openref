import { canonicalize, compareByCodePoint } from '@openref/core';
import type { ApiChannelOptions, ApiMessageOptions } from '../../api/decorators/api-decorators';
import type { DiscoveryProblem } from '../../runtime/infrastructure/adapters/controller-discovery.adapter';
import type { DiscoveredChannel } from '../infrastructure/adapters/channel-discovery.adapter';
import { bySeniority, declaredValue, derived, type EventValue } from './event-metadata';

/**
 * Turning what the application declares into an AsyncAPI 3.1 document, per SPEC 8.3.
 *
 * A DOCUMENT AND NOT AN IR, WHICH IS THE WHOLE SHAPE OF THIS FEATURE. The events a NestJS
 * application serves reach the reference through `normalizeAsyncApiDocument` in `@openref/core`,
 * the same reader a hand written file goes through, so channels discovered from the container get
 * the reference resolution, the canonical ordering, the trait merge and the fail closed refusals
 * that `T048` built rather than a second, weaker path. It also means the `asyncapi.json` route
 * serves a real document that another tool can read.
 *
 * WHAT IS INVENTED HERE IS NOTHING, per SPEC 6.1 and CLAUDE.md. Every address, protocol and
 * payload comes from a metadata key or from a person's decorator, and where a fact is missing the
 * synthesis emits a {@link DiscoveryProblem} and leaves the member out. The one place that is not
 * obvious is the server host, and SPEC 8.3 records the reading: an application knows which
 * protocol it speaks and cannot know the address it is reachable at, so the server it declares
 * carries the protocol and an empty host, and a problem names every protocol whose address the
 * reference cannot state.
 */

/** One broker the host says its application is reachable at, per SPEC 8.3. */
export interface EventServerOptions {
  /** The protocol this server serves, as AsyncAPI spells it: `kafka`, `amqp`, `ws`. */
  readonly protocol: string;
  /** Host and port, such as `broker.example.com:9092`. */
  readonly host: string;
  /** Path, for a protocol that has one. */
  readonly pathname?: string;
  readonly description?: string;
  readonly protocolVersion?: string;
}

/** What the synthesis needs beyond the channels themselves. */
export interface SynthesizeEventsOptions {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
  /** The brokers the host configured, per SPEC 8.3. */
  readonly servers?: readonly EventServerOptions[];
  /**
   * Schemas a message may name, as a `components.schemas` object.
   *
   * IT EXISTS BECAUSE A CLASS IS A NAME AND NOT A SHAPE, per SPEC 13.6's rule for `@ApiStream`.
   * `@ApiMessage({ payload: OrderDto })` says the payload is an `OrderDto` and reflection cannot
   * say what an `OrderDto` is, so the document refers to a schema of that name and the host
   * supplies the schemas, usually the `components.schemas` of the document its HTTP side already
   * builds. A name no schema answers to reaches `doctor` rather than being invented.
   */
  readonly schemas?: Readonly<Record<string, unknown>>;
}

/** The synthesized document and everything that could not be stated. */
export interface SynthesizedEvents {
  /** An AsyncAPI 3.1 document, ready for `normalizeAsyncApiDocument`. */
  readonly document: Record<string, unknown>;
  readonly problems: readonly DiscoveryProblem[];
  /** Channel address by the node id the normalizer will give it, for the runtime pairing. */
  readonly channels: readonly SynthesizedChannel[];
}

/** One synthesized channel, and the handlers that serve it. */
export interface SynthesizedChannel {
  /** The key the document files the channel under, which is what the node id is derived from. */
  readonly key: string;
  readonly address: string;
  /** Every discovered handler that contributed an operation to this channel. */
  readonly handlers: readonly DiscoveredChannel[];
}

/** The version of AsyncAPI the synthesis writes, per SPEC 8.1. */
const ASYNCAPI_VERSION = '3.1.0';

/**
 * A key safe to file a channel, an operation or a message under.
 *
 * THE KEY IS NOT THE ADDRESS. A channel address may be `{"cmd":"sum"}` or `/socket.io/chat`, and a
 * document key holding a slash or a brace is legal but is what every `$ref` in the document has to
 * escape. The node id a reader sees comes from the address, per SPEC 8.2, so nothing about the
 * reference depends on this being readable; it only has to be stable and unique.
 *
 * @param text - Whatever is being filed
 * @returns The same text with everything outside the safe set replaced
 */
function documentKey(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'channel' : cleaned;
}

/**
 * Allocates a key nothing else has taken, with a numeric suffix in canonical order.
 *
 * @param preferred - The key that would be used if it were free
 * @param taken - Keys already allocated, written to
 * @returns The key allocated
 */
function allocate(preferred: string, taken: Set<string>): string {
  let key = preferred;
  let suffix = 2;
  while (taken.has(key)) {
    key = `${preferred}-${String(suffix)}`;
    suffix += 1;
  }
  taken.add(key);
  return key;
}

/**
 * The protocol a discovered channel speaks, when anything said what it is, with its level.
 *
 * THE DECLARED HALF WINS BECAUSE ITS LEVEL SAYS SO, per SPEC 6.1 and SPEC 8.3: a person writing
 * `@ApiChannel({ protocol })` is documenting the endpoint, and framework metadata is a routing
 * instruction that happens to be readable. `bySeniority` is what applies that rule, so the
 * `confidence` each reader carries is read rather than carried and dropped.
 *
 * @param channel - One discovered channel
 * @returns The protocol and the level it was read at, or nothing when nothing named one
 */
function protocolOf(channel: DiscoveredChannel): EventValue<string> | undefined {
  const declared = channel.declared?.value.protocol;
  const transport = channel.transport;

  return bySeniority<string>([
    declared === undefined || declared === '' ? undefined : declaredValue(declared),
    channel.protocol,
    // `derived` UNCONDITIONALLY, BECAUSE A TRANSPORT HAS NO OTHER LEVEL AND THE TYPE NOW SAYS SO.
    // This read the transport's own `confidence` and branched on it until the second review of
    // `T051` measured that nothing can produce a declared transport, so the declared arm was a
    // branch that could not be wrong. `DiscoveredChannel.transport` is a `DerivedValue`, and the
    // day a producer of a declared one appears, this line stops compiling rather than choosing.
    transport === undefined ? undefined : derived(transport.value.protocol),
  ]);
}

/** The members of `@ApiChannel` that describe the channel rather than one of its operations. */
type ChannelMember = 'title' | 'summary' | 'description' | 'tags';

/**
 * One channel level member of `@ApiChannel`, when every handler that wrote it wrote the same thing.
 *
 * TWO HANDLERS DISAGREEING ABOUT ONE CHANNEL IS THE AMBIGUITY RULE, AND IT APPLIES TO DOCUMENT
 * MEMBERS AS WELL AS TO RUNTIME FACTS. `channel-pairing.ts` refuses to attach a fact read off one
 * of several handlers, because a fact on the wrong endpoint is worse than no fact; a title read off
 * one of several handlers is the same failure in the document rather than in the runtime block.
 * This took the first declaring handler until the second review of `T051`, which is worse than a
 * wrong choice: the order of `handlers` is the order the container reported its providers in, so
 * two handlers with different titles produced a document that depended on a walk order nobody
 * controls, and `synthesizeEventsDocument`'s own determinism case could not see it because its
 * fixture agrees with itself.
 *
 * A MEMBER ONE HANDLER WROTE IS NOT AMBIGUOUS, AND NEITHER IS ONE THEY ALL AGREE ON. Only a
 * disagreement is, so a channel whose second handler carries no `@ApiChannel` at all keeps the
 * first one's description, which is the ordinary way a shared address is documented once.
 *
 * @param handlers - Every handler that contributed an operation to this channel
 * @param member - The member being resolved
 * @param address - The channel's address, for the problem a reader gets
 * @param problems - Accumulator
 * @returns The agreed value, or nothing when nobody wrote it or the writers disagree
 */
function agreedMember<Member extends ChannelMember>(
  handlers: readonly DiscoveredChannel[],
  member: Member,
  address: string,
  problems: DiscoveryProblem[],
): ApiChannelOptions[Member] | undefined {
  const written = handlers.flatMap((handler) => {
    const value = handler.declared?.value[member];
    return value === undefined ? [] : [{ handler, value }];
  });

  const first = written[0];
  if (first === undefined) return undefined;

  // Compared canonically, so two handlers writing the same tags in one order and the same tags in
  // another are one value rather than a disagreement, per SPEC 5.3.
  const spelling = canonicalize(first.value);
  const disagreeing = written.filter((entry) => canonicalize(entry.value) !== spelling);
  if (disagreeing.length === 0) return first.value;

  problems.push({
    subject: `the ${member} of channel ${address}`,
    reason:
      `${String(written.length)} handlers serve it and they do not write the same ${member}, so ` +
      'the channel carries none rather than the one whose class the container happened to report ' +
      'first. The handlers are ' +
      written
        .map((entry) => `${entry.handler.controllerName}.${entry.handler.handlerName}`)
        .join(', '),
  });

  return undefined;
}

/** The direction of the operation a discovered channel contributes. */
function directionOf(channel: DiscoveredChannel): 'send' | 'receive' {
  // `receive` is what a handler does and it is not a default in the guessing sense: a
  // `@MessagePattern` handler is the side that receives the message, which is what SPEC 8.3's
  // table states for all three sources. `@ApiChannel({ direction: 'send' })` is how a person
  // says the application publishes on this channel instead.
  return channel.declared?.value.direction ?? 'receive';
}

/**
 * The schema a message member names, resolved against the schemas the host supplied.
 *
 * @param declared - What `@ApiMessage` was given for this member
 * @param options - The synthesis options, for the schema table
 * @param subject - What is being described, for the problem a reader gets
 * @param problems - Accumulator
 * @returns The schema object to write, or nothing
 */
function schemaFor(
  declared: ApiMessageOptions['payload'],
  options: SynthesizeEventsOptions,
  subject: string,
  problems: DiscoveryProblem[],
): Record<string, unknown> | undefined {
  if (declared === undefined) return undefined;

  if (typeof declared === 'function') {
    const name = declared.name;
    if (name === '' || options.schemas?.[name] === undefined) {
      problems.push({
        subject,
        reason:
          `it names the class ${name === '' ? 'an anonymous class' : name} and no schema of ` +
          'that name was supplied, so the message carries no schema rather than an invented ' +
          'one. Pass the schemas the class is described by, per SPEC 8.3',
      });
      return undefined;
    }

    return { $ref: `#/components/schemas/${name}` };
  }

  return { ...declared };
}

/** The message one handler declares, when it declares one. */
function messageOf(
  channel: DiscoveredChannel,
  options: SynthesizeEventsOptions,
  problems: DiscoveryProblem[],
): Record<string, unknown> | undefined {
  const declared = channel.message?.value;
  if (declared === undefined) return undefined;

  const subject = `the message of ${channel.controllerName}.${channel.handlerName}`;
  const message: Record<string, unknown> = {};

  const payload = schemaFor(declared.payload, options, subject, problems);
  const headers = schemaFor(declared.headers, options, subject, problems);
  if (payload !== undefined) message.payload = payload;
  if (headers !== undefined) message.headers = headers;
  if (declared.name !== undefined) message.name = declared.name;
  if (declared.title !== undefined) message.title = declared.title;
  if (declared.summary !== undefined) message.summary = declared.summary;
  if (declared.description !== undefined) message.description = declared.description;
  if (declared.contentType !== undefined) message.contentType = declared.contentType;
  if (declared.correlationId !== undefined) {
    message.correlationId = { location: declared.correlationId };
  }

  return message;
}

/**
 * The servers block, one entry per protocol the application speaks.
 *
 * A SERVER PER PROTOCOL AND NOT PER CONFIGURED ENTRY, because a channel is bound to servers and
 * its protocol follows from them, per SPEC 8.2. Two configured brokers of one protocol are two
 * environments of one thing to a reader of the reference, and binding a channel to one of them
 * would be this package choosing an environment on the host's behalf.
 *
 * THE HOST MAY BE EMPTY AND THAT IS THE HONEST STATE. An application knows it speaks Kafka and
 * cannot know the address a reader would reach its broker at, so a protocol the host said nothing
 * about still gets a server and the problem list names it. The alternative was to leave the
 * server out, and a channel with no server is a channel with no protocol, which would have thrown
 * away the one fact the discovery does know.
 *
 * A CONFIGURED ENTRY THAT MATCHES NO CHANNEL IS THE SEVENTH FINDING OF SPEC 8.3, AND IT WAS
 * SILENT. The walk over `protocols` reads the configured entries and never reads the ones nothing
 * asked for, so `{ protocol: 'ws', host: 'kafka.example.com:9092' }` contributed no member of the
 * document and no word anywhere: measured on the built `examples/events` on 2026-09-04, the
 * served document read `"kafka":{"host":"","protocol":"kafka"}` and the page printed `kafka://`
 * and `kafka://orders.created` to a reader, while the mount's own problem list named only the
 * kafka broker. The host who wrote that entry believes it is in force, and the one thing this can
 * say about it is that nothing answered it, so it says that and names the host the entry carries.
 *
 * @param protocols - Every protocol the discovered channels speak
 * @param options - The synthesis options, for the hosts the host configured
 * @param problems - Accumulator
 * @returns The `servers` block, keyed by protocol
 */
function serversOf(
  protocols: ReadonlySet<string>,
  options: SynthesizeEventsOptions,
  problems: DiscoveryProblem[],
): Record<string, unknown> {
  const configured = new Map((options.servers ?? []).map((server) => [server.protocol, server]));
  const servers: Record<string, unknown> = {};

  // In code point order of the protocol, so the report does not depend on the order the host
  // happened to write its entries in, which is the rule the rest of this file is built to.
  for (const protocol of [...configured.keys()].sort(compareByCodePoint)) {
    if (protocols.has(protocol)) continue;

    problems.push({
      subject: `the configured ${protocol} server`,
      reason:
        `it names the host ${configured.get(protocol)?.host ?? ''} and no channel of this ` +
        `application speaks ${protocol}, so nothing is bound to it and the reference leaves it ` +
        'out of the document entirely. Give it the protocol its channels declare, per SPEC 8.3',
    });
  }

  for (const protocol of [...protocols].sort(compareByCodePoint)) {
    const declared = configured.get(protocol);
    if (declared === undefined) {
      problems.push({
        subject: `the ${protocol} broker`,
        reason:
          `the application serves channels over ${protocol} and no host was configured for it, ` +
          'so the reference names the protocol and cannot name the address. Configure it under ' +
          'the events servers option, per SPEC 8.3',
      });
    }

    const server: Record<string, unknown> = {
      host: declared?.host ?? '',
      protocol,
    };
    if (declared?.pathname !== undefined) server.pathname = declared.pathname;
    if (declared?.description !== undefined) server.description = declared.description;
    if (declared?.protocolVersion !== undefined) server.protocolVersion = declared.protocolVersion;

    servers[documentKey(protocol)] = server;
  }

  return servers;
}

/**
 * Builds an AsyncAPI 3.1 document from what the container declares.
 *
 * CHANNELS ARE GROUPED BY ADDRESS, because an address is what a channel is. Two handlers that
 * answer one pattern on two transports are one channel available on two brokers, which is exactly
 * what AsyncAPI's channel `servers` block says, and two channels of one address would put the same
 * topic in the navigation twice.
 *
 * @param discovered - The channels the discovery walk found
 * @param options - Title, version, brokers and the schemas a message may name
 * @returns The document, the channels by key, and everything that could not be stated
 *
 * @example
 * synthesizeEventsDocument(discoverChannels(discovery).channels, { title: 'Orders', version: '1' });
 */
export function synthesizeEventsDocument(
  discovered: readonly DiscoveredChannel[],
  options: SynthesizeEventsOptions,
): SynthesizedEvents {
  const problems: DiscoveryProblem[] = [];

  // Grouped in code point order of the address, so the document a run produces does not depend on
  // the order the container happened to report its providers in.
  const byAddress = new Map<string, DiscoveredChannel[]>();
  for (const channel of discovered) {
    const address = channel.address.value;
    const group = byAddress.get(address);
    if (group === undefined) byAddress.set(address, [channel]);
    else group.push(channel);
  }

  const protocols = new Set<string>();
  for (const channel of discovered) {
    const protocol = protocolOf(channel);
    if (protocol !== undefined) protocols.add(protocol.value);
  }

  const servers = serversOf(protocols, options, problems);
  const channels: Record<string, unknown> = {};
  const operations: Record<string, unknown> = {};
  const synthesized: SynthesizedChannel[] = [];
  const channelKeys = new Set<string>();
  const operationKeys = new Set<string>();

  for (const address of [...byAddress.keys()].sort(compareByCodePoint)) {
    const handlers = byAddress.get(address) ?? [];
    const key = allocate(documentKey(address), channelKeys);

    const channelProtocols = new Set<string>();
    for (const handler of handlers) {
      const protocol = protocolOf(handler);
      if (protocol !== undefined) channelProtocols.add(protocol.value);
    }

    const messages: Record<string, unknown> = {};
    const messageKeys = new Set<string>();

    const channel: Record<string, unknown> = { address };
    const title = agreedMember(handlers, 'title', address, problems);
    const summary = agreedMember(handlers, 'summary', address, problems);
    const description = agreedMember(handlers, 'description', address, problems);
    const tags = agreedMember(handlers, 'tags', address, problems);
    if (title !== undefined) channel.title = title;
    if (summary !== undefined) channel.summary = summary;
    if (description !== undefined) channel.description = description;
    if (tags !== undefined) channel.tags = tags.map((name) => ({ name }));
    // A channel names the servers of its own protocol. A handler that named no transport is
    // served on every microservice the host connected, which is what an absent block means in
    // AsyncAPI's own words, so it is left out rather than filled with every server by hand.
    if (channelProtocols.size > 0) {
      channel.servers = [...channelProtocols]
        .sort(compareByCodePoint)
        .map((protocol) => ({ $ref: `#/servers/${documentKey(protocol)}` }));
    }

    for (const handler of handlers) {
      const operationKey = allocate(
        documentKey(`${handler.controllerName}_${handler.handlerName}`),
        operationKeys,
      );
      const operation: Record<string, unknown> = {
        action: directionOf(handler),
        channel: { $ref: `#/channels/${key}` },
      };

      const message = messageOf(handler, options, problems);
      if (message !== undefined) {
        const messageKey = allocate(documentKey(handler.handlerName), messageKeys);
        messages[messageKey] = message;
        operation.messages = [{ $ref: `#/channels/${key}/messages/${messageKey}` }];
      }

      operations[operationKey] = operation;
    }

    if (Object.keys(messages).length > 0) channel.messages = messages;
    channels[key] = channel;
    synthesized.push({ key, address, handlers });
  }

  const document: Record<string, unknown> = {
    asyncapi: ASYNCAPI_VERSION,
    info: {
      title: options.title,
      version: options.version,
      ...(options.description === undefined ? {} : { description: options.description }),
    },
    channels,
    operations,
  };
  if (Object.keys(servers).length > 0) document.servers = servers;
  if (options.schemas !== undefined && Object.keys(options.schemas).length > 0) {
    document.components = { schemas: options.schemas };
  }

  return { document, problems, channels: synthesized };
}

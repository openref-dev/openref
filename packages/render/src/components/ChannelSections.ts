/**
 * The three sections a channel page has and an operation page does not, per SPEC 11.
 *
 * SERVER ONLY, THE `NodeSections` SHAPE. Each is markup over model fields with no state, no
 * handler and nothing the browser recomputes, so the browser fills their positions with childless
 * elements that adopt what the server drew, and this module is imported by `eager.ts` alone.
 *
 * THE PAYLOAD IS READ RATHER THAN EXPANDED, and that is a consequence of the line above rather
 * than a preference. `SchemaTree` draws a button per expandable row, and a button inside an
 * adopted position has nothing to hydrate it: the schema chunk arrives and finds no component in
 * that subtree, so every press would do nothing, which is the F14 class this project keeps
 * finding. So a payload is drawn by the reading half of SPEC 11, the rows `shapes.html` draws:
 * every branch at once, nothing hidden and nothing to expand, with a named position still a link
 * to its own page.
 *
 * AND A PAYLOAD NO JSON SCHEMA READER CAN READ KEEPS ITS SOURCE, per SPEC 11 and SPEC 5.2. An
 * Avro or Protobuf body is printed as highlighted source under its dialect's name, because
 * translating it to JSON Schema would lose union with null, default values and field order, which
 * is what those formats are taken for. It is never drawn as a schema view that failed.
 *
 * THE MARKUP VOCABULARY IS ALMOST ENTIRELY BORROWED, and that is the `TX-MARKUP` rule applied
 * rather than a saving. Every `oref-` name the reference leaves outside a position is a name two
 * themes must style, and both theme byte budgets are within a few hundred bytes of their caps. A
 * binding, a message body and a declared example are each a head naming a thing with a block of
 * source under it, which is exactly what `.oref-media` already is, so each takes that family with
 * a modifier of its own; the reading rows take the shapes page's own row family, because they are
 * the same rows; a labelled fact takes one family used by all three sections. What is new is a
 * fact row, a channel operation, a reply block and a message, and nothing else.
 */

import { handshakeBlockedCause } from '@openref/core';
import { h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { securityList } from './NodeSections';
import { shapeRowsOfBody, type ShapeRow } from '../page/domain/shape-rows';
import type { HandshakeBlockedCause, IRSchema } from '@openref/core';
import type {
  BindingModel,
  ChannelModel,
  ChannelOperationModel,
  MessageBodyModel,
  MessageExampleModel,
  MessageModel,
  SecurityModel,
} from '@openref/vue';

/** What the message list needs to resolve a payload's references. */
export interface MessageContext {
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly basePath: string;
}

/** A heading with the layout's count beside it, the rule `TX-PARITY-UI` set for every section. */
function sectionTitle(words: string, count: number, unit: string): VNode {
  return h('h2', { class: 'oref-section-title' }, [
    `${words} `,
    h(
      'span',
      { class: 'oref-section-count' },
      `${String(count)} ${count === 1 ? unit : `${unit}s`}`,
    ),
  ]);
}

/** One labelled fact. Drawn only where the document wrote one, per SPEC 6.3's absence rule. */
function fact(label: string, value: VNode | string): VNode {
  return h('li', { class: 'oref-fact', key: label }, [
    h('span', { class: 'oref-fact-label' }, label),
    h('span', { class: 'oref-fact-value' }, [value]),
  ]);
}

/** A list of facts, or nothing at all when every one of them was absent. */
function facts(rows: (VNode | null)[]): VNode | null {
  const drawn = rows.filter((row): row is VNode => row !== null);
  return drawn.length === 0 ? null : h('ul', { class: 'oref-facts' }, drawn);
}

/**
 * The `requires` row of one position, or no row at all when the position named no scheme.
 *
 * A LIST RATHER THAN A NULLABLE ROW, so a caller can splat it in beside its own facts without
 * carrying a hole. The key comes from the caller because the label does not identify the row:
 * two servers of one channel can each require something, and `fact` keys by label alone.
 *
 * THE ROW BORROWS THE SECURITY FAMILY THE OPERATION PAGE ALREADY DRAWS, which is the rule at the
 * top of this file: what a requirement says is the same on either page, so it is one renderer and
 * one set of names rather than a second family two themes would have to style.
 *
 * @param security - The requirements of one server or one channel operation
 * @param key - What tells this row from a sibling with the same label
 * @returns One row, or nothing
 */
function securityFact(security: readonly SecurityModel[], key: string): VNode[] {
  const list = securityList(security);
  if (list === null) return [];

  return [
    h('li', { class: 'oref-fact', key }, [
      h('span', { class: 'oref-fact-label' }, 'requires'),
      h('span', { class: 'oref-fact-value' }, [list]),
    ]),
  ];
}

/**
 * What a reader is told about a scheme a browser cannot present at a socket handshake, per SPEC
 * 14.7, one sentence per cause and total over the union.
 *
 * THE WORDS ARE THIS FILE'S AND THE CAUSE IS THE DOCUMENT'S, which is the `T028` split applied to
 * the second question of the same shape. `handshakeBlockedCause` in `@openref/core` answers which
 * of the five a scheme is, because the socket client and this page have to agree on that and
 * cannot see each other; what a reader reads belongs where a theme can say it differently.
 *
 * EACH SENTENCE NAMES ITS OWN ROUTE AND THEY ARE NOT THE SAME ROUTE. Pointing every one of them at
 * the server bridge would be short and would be false three times: a bridge does not put a
 * certificate in a browser, it does not decrypt a payload, and it does not tell a document where a
 * key travels. The task's clause, that a scheme needing an `Authorization` header at the handshake
 * points at the bridge as the only route, is the first row and is exactly true of that row.
 */
const HANDSHAKE_BLOCKED: Readonly<Record<HandshakeBlockedCause, string>> = {
  'handshake-header':
    'travels in a request header at the handshake, and a WebSocket opened by a browser cannot set one; a server bridge that opens the connection is the only route',
  'connection-credential':
    'is a credential of the broker connection itself, and a socket opened by a browser has no field to carry it; a server bridge that opens the connection is the only route',
  'transport-certificate':
    'asks for a client certificate during the TLS handshake, which the browser chooses and no code on this page takes part in; the connection has to be opened by something that holds the certificate',
  'message-encryption':
    'encrypts the messages themselves rather than the connection, with key material this document does not carry, so nothing on this page can apply it',
  undeclared:
    'is not described well enough to be placed: the document does not say where its value travels, so no handshake can carry it',
};

/**
 * The rows saying which of a position's schemes a browser cannot present when opening a socket.
 *
 * BESIDE THE `requires` ROW AND NOT IN A BLOCK OF ITS OWN, the placement SPEC 8.2 chose for the
 * requirement itself: what connecting to a server costs sits next to that server, so what a
 * browser cannot pay sits next to the cost. A position that requires nothing draws nothing, and a
 * position whose every scheme a browser can present draws nothing either, which is the absence
 * rule of SPEC 6.3 rather than a saving.
 *
 * SERVER MARKUP, SO THE STATEMENT IS THERE BEFORE ANY SCRIPT RUNS. The channel sections are
 * adopted by the browser rather than hydrated, per `TX-ADOPT`, so these rows cost a reader no
 * script at all and are in the document the moment it arrives, which is what "before any
 * connection is attempted" means when the page is the thing saying it.
 *
 * @param security - The requirements of one server or one channel operation
 * @param key - What tells these rows from a sibling position's
 * @returns One row per scheme a browser cannot present, empty when there is none
 */
function handshakeFacts(security: readonly SecurityModel[], key: string): VNode[] {
  const rows: VNode[] = [];

  for (const requirement of security) {
    const cause = handshakeBlockedCause(requirement);
    if (cause === undefined) continue;

    rows.push(
      h('li', { class: 'oref-fact', key: `${key}:${requirement.schemeId}` }, [
        h('span', { class: 'oref-fact-label' }, 'not from a browser'),
        h('span', { class: 'oref-fact-value' }, [
          h('code', {}, requirement.schemeId),
          ` ${HANDSHAKE_BLOCKED[cause]}`,
        ]),
      ]),
    );
  }

  return rows;
}

/**
 * A head naming something, with a block of source under it.
 *
 * ONE SHAPE FOR THREE SUBJECTS, per the note at the top of this file: a protocol binding, a
 * message body and a declared example are each exactly this, and `.oref-media` is the family the
 * reference already has for it. The modifier says which of the three a block is, so a theme can
 * still tell them apart without three families to style.
 */
function sourceBlock(
  modifier: string,
  name: string,
  note: string,
  body: VNode | null,
  key: string,
): VNode {
  return h('div', { class: `oref-media ${modifier}`, key }, [
    h('div', { class: 'oref-media-head' }, [
      h('code', { class: 'oref-media-type' }, name),
      note === '' ? null : h('span', { class: 'oref-media-schema' }, note),
    ]),
    body,
  ]);
}

/** The binding blocks of one subject, each under the protocol name the document wrote. */
function bindingBlocks(bindings: readonly BindingModel[]): VNode[] {
  return bindings.map((binding) =>
    sourceBlock(
      'oref-media-binding',
      binding.protocol,
      '',
      h(MarkdownBlock, { html: binding.sourceHtml, className: 'oref-example' }),
      `binding:${binding.protocol}`,
    ),
  );
}

/**
 * The channel's own facts: the variables of its address, its protocol, its servers, its bindings.
 *
 * THE ADDRESS ITSELF IS NOT HERE. The header draws it as the heading, and a page saying one thing
 * twice is the F15 class; what this section adds is what the braces in that heading mean.
 *
 * @param props - The channel of the page
 * @returns The section
 */
export function ChannelFacts(props: { readonly channel: ChannelModel }): VNode {
  const channel = props.channel;

  const variables = channel.parameters.map((parameter) =>
    h('li', { class: 'oref-fact', key: parameter.name }, [
      h('code', { class: 'oref-fact-label' }, `{${parameter.name}}`),
      h('span', { class: 'oref-fact-value' }, [
        h(MarkdownBlock, { html: parameter.descriptionHtml }),
        facts([
          parameter.values.length === 0 ? null : fact('one of', parameter.values.join(', ')),
          parameter.fallback === '' ? null : fact('default', parameter.fallback),
          parameter.examples.length === 0
            ? null
            : fact('for example', parameter.examples.join(', ')),
          parameter.location === '' ? null : fact('found at', h('code', {}, parameter.location)),
        ]),
      ]),
    ]),
  );

  // THE REQUIREMENT IS ITS OWN ROW BESIDE THE SERVER'S, per SPEC 8.2. It is a condition of
  // connecting to that one server, so it sits next to that server rather than in a block of its
  // own; a server that said nothing about security contributes no row at all.
  const servers = channel.servers.flatMap((server) => [
    fact(
      server.protocol === ''
        ? 'available on'
        : server.protocolVersion === ''
          ? server.protocol
          : `${server.protocol} ${server.protocolVersion}`,
      h('span', {}, [
        h('code', {}, server.url),
        server.description === ''
          ? null
          : h('span', { class: 'oref-description' }, server.description),
      ]),
    ),
    ...securityFact(server.security, `requires:${server.url}`),
    ...handshakeFacts(server.security, `handshake:${server.url}`),
  ]);

  return h('section', { class: 'oref-section oref-section-channel' }, [
    h('h2', { class: 'oref-section-title' }, 'Channel'),
    facts([channel.protocol === '' ? null : fact('protocol', channel.protocol), ...servers]),
    variables.length === 0 ? null : h('ul', { class: 'oref-facts' }, variables),
    ...bindingBlocks(channel.bindings),
  ]);
}

/** The reply half of one operation, drawn from the three members it really has. */
function replyBlock(operation: ChannelOperationModel): VNode | null {
  const reply = operation.reply;
  if (reply === null) return null;

  // AN EMPTY REPLY IS A STATEMENT, per SPEC 8.2: the operation is one half of a request-reply
  // pair and the document named no channel for the other half. Saying nothing here would lose
  // exactly the fact the empty record is carried to keep.
  const rows = facts([
    reply.channelId === ''
      ? null
      : fact(
          'on channel',
          h('a', { class: 'oref-schema-link', href: reply.channelHref }, reply.channelLabel),
        ),
    reply.messages.length === 0 ? null : fact('with message', reply.messages.join(', ')),
    reply.address === '' ? null : fact('address', h('code', {}, reply.address)),
  ]);

  return h('div', { class: 'oref-channel-reply' }, [
    h('h4', { class: 'oref-section-title' }, 'Reply'),
    rows ??
      h(
        'p',
        { class: 'oref-description' },
        'This operation expects a reply. The document does not say on which channel.',
      ),
  ]);
}

/**
 * The `send` and `receive` operations of a channel.
 *
 * THE DIRECTION IS A WORD BEFORE IT IS A COLOUR, the three signals rule of SPEC 11 read for a
 * badge that has only one job: `send` and `receive` are printed, so the distinction survives
 * monochrome print and a theme that gives the two modifiers no rule of its own.
 *
 * @param props - The channel of the page
 * @returns The section
 */
export function ChannelOperations(props: { readonly channel: ChannelModel }): VNode {
  const operations = props.channel.operations;

  return h('section', { class: 'oref-section oref-section-channel-operations' }, [
    sectionTitle('Operations', operations.length, 'operation'),
    h(
      'ul',
      { class: 'oref-channel-ops' },
      operations.map((operation) =>
        h('li', { class: 'oref-channel-op', key: operation.id }, [
          h('div', { class: 'oref-media-head' }, [
            h(
              'span',
              {
                class: `oref-badge ${
                  operation.direction === 'send' ? 'oref-direction-send' : 'oref-direction-receive'
                }`,
              },
              operation.direction,
            ),
            h('code', { class: 'oref-media-type' }, operation.id),
          ]),
          operation.summary === '' ? null : h('p', { class: 'oref-subtitle' }, operation.summary),
          h(MarkdownBlock, { html: operation.descriptionHtml }),
          facts([
            operation.messages.length === 0 ? null : fact('carries', operation.messages.join(', ')),
            operation.tags.length === 0 ? null : fact('tags', operation.tags.join(', ')),
            // WHAT PERFORMING IT COSTS, BESIDE WHAT CONNECTING COSTS, per SPEC 8.2: the server's
            // requirement is drawn in the facts section beside the server it belongs to, and this
            // is what the operation adds on top of it rather than what it replaces.
            ...securityFact(operation.security, `requires:${operation.id}`),
            ...handshakeFacts(operation.security, `handshake:${operation.id}`),
          ]),
          replyBlock(operation),
          ...bindingBlocks(operation.bindings),
        ]),
      ),
    ),
  ]);
}

/** One row of the reading half, the shapes page's own markup and its own class family. */
function readingRow(row: ShapeRow): VNode {
  const type =
    row.href === undefined
      ? h('span', { class: 'oref-shape-type' }, row.type)
      : h('a', { class: 'oref-shape-type oref-schema-link', href: row.href }, row.type);

  return h(
    'li',
    {
      class: [
        'oref-shape-row',
        `oref-shape-d${String(row.depth)}`,
        ...(row.kind === 'variant' ? ['oref-shape-variant'] : []),
        ...(row.kind === 'pattern' ? ['oref-shape-pattern-row'] : []),
      ],
      key: row.path,
    },
    [
      h('span', { class: 'oref-shape-name' }, row.name),
      type,
      row.requiredness === ''
        ? null
        : h(
            'span',
            {
              class: [
                'oref-shape-req',
                ...(row.requiredness === 'conditional' ? ['oref-shape-req-cond'] : []),
              ],
            },
            row.requiredness,
          ),
      row.when === '' ? null : h('span', { class: 'oref-shape-when' }, row.when),
    ],
  );
}

/**
 * One body of a message: the reading rows, or the source under its dialect's name.
 *
 * THE THREE OUTCOMES ARE NAMED AND THE THIRD IS SAID IN WORDS. A JSON Schema body with fields
 * draws rows; a body in another dialect draws its source; a body that is neither, a JSON Schema
 * declaring no fields or a dialect whose source the document did not write down, says so, because
 * an empty block under a heading reads as a broken product rather than as an honest absence.
 */
function bodyBlock(
  body: MessageBodyModel,
  part: string,
  context: MessageContext,
  key: string,
): VNode {
  const slot = body.schema;
  const rows =
    slot === null
      ? []
      : shapeRowsOfBody(
          slot.kind === 'inline'
            ? (slot.schema.normalized ?? {})
            : (context.schemas[slot.schemaId]?.normalized ?? {}),
          context.schemas,
          context.basePath,
          slot.kind === 'named' ? [slot.schemaId] : [],
        );

  const drawn =
    rows.length > 0
      ? h('ul', { class: 'oref-shape-rows' }, rows.map(readingRow))
      : body.sourceHtml !== ''
        ? h(MarkdownBlock, { html: body.sourceHtml, className: 'oref-example' })
        : h(
            'p',
            { class: 'oref-shape-empty' },
            'The document declares this part without saying what is in it.',
          );

  return sourceBlock('oref-media-body', part, body.dialect, drawn, key);
}

/** One declared example, which per SPEC 8.2 is a message and not only a payload. */
function exampleBlock(example: MessageExampleModel, key: string): VNode {
  return sourceBlock(
    'oref-media-example',
    example.name,
    example.summary,
    example.sourceHtml === ''
      ? null
      : h(MarkdownBlock, { html: example.sourceHtml, className: 'oref-example' }),
    key,
  );
}

/** One message: what it is called, what it carries, and how a reply is matched to it. */
function messageBlock(message: MessageModel, context: MessageContext): VNode {
  return h('li', { class: 'oref-message', key: message.id }, [
    h('div', { class: 'oref-media-head' }, [
      h('h3', { class: 'oref-section-title' }, message.title),
      message.name === '' ? null : h('code', { class: 'oref-media-type' }, message.name),
      message.contentType === ''
        ? null
        : h('span', { class: 'oref-media-schema' }, message.contentType),
    ]),
    message.summary === '' ? null : h('p', { class: 'oref-subtitle' }, message.summary),
    h(MarkdownBlock, { html: message.descriptionHtml }),
    // THE CORRELATION ID IS AN EXPRESSION AND IS DRAWN AS ONE, per SPEC 8.2: the IR carries the
    // `location` of the Correlation ID Object and never the prose beside it, so this row is a
    // runtime expression in code and not a sentence.
    facts([
      message.correlationId === ''
        ? null
        : fact('correlation id', h('code', {}, message.correlationId)),
      message.tags.length === 0 ? null : fact('tags', message.tags.join(', ')),
    ]),
    message.payload === null
      ? null
      : bodyBlock(message.payload, 'payload', context, `${message.id}:payload`),
    message.headers === null
      ? null
      : bodyBlock(message.headers, 'headers', context, `${message.id}:headers`),
    ...bindingBlocks(message.bindings),
    ...message.examples.map((example) => exampleBlock(example, `${message.id}:${example.name}`)),
  ]);
}

/**
 * The messages of a channel, each with its payload, its headers and its examples.
 *
 * @param props - The channel of the page and what its payloads resolve against
 * @returns The section
 */
export function MessageList(props: {
  readonly channel: ChannelModel;
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly basePath: string;
}): VNode {
  const messages = props.channel.messages;
  const context: MessageContext = { schemas: props.schemas, basePath: props.basePath };

  return h('section', { class: 'oref-section oref-section-messages' }, [
    sectionTitle('Messages', messages.length, 'message'),
    h(
      'ul',
      { class: 'oref-messages' },
      messages.map((message) => messageBlock(message, context)),
    ),
  ]);
}

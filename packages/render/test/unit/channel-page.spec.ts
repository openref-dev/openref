// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { buildPageModel } from '../../src/page/domain/page-model';
import {
  renderPage,
  serializePageModel,
} from '../../src/render/application/services/render.service';
import { ChannelFacts, ChannelOperations, MessageList } from '../../src/components/ChannelSections';
import { eventsDocument, runtimeDocument, smallDocument } from '../mocks/documents';
import type { IRDocument } from '@openref/core';
import type { ChannelModel, NodeModel, PageKind, PageModel } from '@openref/vue';

/**
 * The channel page of `T050`, per SPEC 8.2 and SPEC 11.
 *
 * WHAT THIS FILE IS ABOUT IS WHETHER A CHANNEL PAGE SAYS AS MUCH AS AN OPERATION PAGE, which is
 * the task's own definition of done, so the cases below name the subjects one by one: the address
 * variables, the protocol, the servers, the bindings, the two directions, the reply, the payload,
 * the headers, the correlation expression and the declared examples. A page that draws a section
 * and says nothing in it would pass a count and fail every one of these.
 *
 * AND WHETHER IT LIES ANYWHERE, which is the other half. An Avro payload is source under a named
 * dialect and never a schema view that failed; the security section is absent rather than empty,
 * because an events document's `security` is empty until `T051` and a block over nothing would be
 * a picture of a security posture the IR does not have; and the three sections carry no control,
 * because they are adopted positions and a button inside one has nothing to hydrate it.
 */

const markdown = await createMarkdownRenderer();

const REQUESTS = 'channel-orders-tenant-requests';
const REPLIES = 'channel-orders-replies';

function pageOf(nodeId: string): PageModel {
  return buildPageModel(eventsDocument(), { nodeId, markdown });
}

function nodeOf(nodeId: string): NodeModel {
  const node = pageOf(nodeId).node;
  if (node === null) throw new Error(`no node model for ${nodeId}`);
  return node;
}

function channelOf(nodeId: string): ChannelModel {
  const channel = nodeOf(nodeId).channel;
  if (channel === null) throw new Error(`no channel model for ${nodeId}`);
  return channel;
}

async function html(component: unknown, props: Record<string, unknown>): Promise<string> {
  return renderToString(createSSRApp(component as never, props));
}

/**
 * The words a reader sees, with the markup and the entities taken off.
 *
 * A HIGHLIGHTED BLOCK IS MARKUP AND NOT A STRING, so a case that asserted on the escaping would
 * be asserting on which highlighter the renderer was built with rather than on what the page
 * says. This reads the page the way a reader does.
 */
function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/**
 * The article of a page the reference renders, which is the region a channel's sections stand in.
 *
 * THE FRAME AROUND IT IS NOT PART OF THE QUESTION. The shell draws the palette button and the
 * navigation on every page there is, so a contrast taken over the whole document would say only
 * that both pages have a frame. This takes the article, which is the same region on both shapes.
 */
async function article(
  document: IRDocument,
  where: { readonly page?: PageKind; readonly nodeId?: string },
): Promise<string> {
  const markup = (await renderPage(document, { ...where, markdown })).appHtml;

  return markup.slice(markup.indexOf('<article'), markup.lastIndexOf('</article>'));
}

/** The whole channel page as the server renders it, sections and all. */
async function pageHtml(nodeId: string): Promise<string> {
  const page = pageOf(nodeId);
  const channel = channelOf(nodeId);

  const parts = await Promise.all([
    html(ChannelFacts, { channel }),
    html(ChannelOperations, { channel }),
    html(MessageList, { channel, schemas: page.schemas, basePath: page.basePath }),
  ]);

  return parts.join('');
}

describe('the channel model', () => {
  it('should carry a channel on a channel node and nothing on an HTTP operation', () => {
    // Given an events document and an HTTP one
    const httpPage = buildPageModel(smallDocument(), { nodeId: 'get-orders', markdown });

    // When both node models are built
    const channel = nodeOf(REQUESTS);

    // Then the channel has one and the operation does not, which is the question a theme asks
    expect(channel.channel).not.toBeNull();
    expect(httpPage.node?.id).toBe('get-orders');
    expect(httpPage.node?.channel).toBeNull();
  });

  it('should draw the three channel sections and none of the operation ones', () => {
    // Given the templated channel
    // When its model is built
    const node = nodeOf(REQUESTS);

    // Then the marks are the header, the description and the three of `T050`, in draw order
    expect(node.drawn).toEqual([
      'header',
      'description',
      'channel',
      'channel-operations',
      'messages',
    ]);
  });

  it('should carry the address variables with all five members the document wrote', () => {
    // Given the templated address `orders.{tenant}.requests`
    // When the channel model is built
    const channel = channelOf(REQUESTS);

    // Then the one variable carries every member of the Parameter Object the document wrote
    expect(channel.parameters).toEqual([
      {
        name: 'tenant',
        descriptionHtml: '<p>Which tenant the topic belongs to.</p>\n',
        values: ['acme', 'globex'],
        fallback: 'acme',
        examples: ['acme'],
        location: '$message.header#/TENANT',
      },
    ]);
  });

  it('should resolve each channel server against the document entry that declares it', () => {
    // Given a channel that names no servers of its own, so SPEC 8.2 gives it all of them
    // When the model is built
    const channel = channelOf(REQUESTS);

    // Then the url comes off the channel and the protocol off the document's own entry
    expect(channel.protocol).toBe('kafka');
    expect(channel.servers).toEqual([
      {
        url: 'kafka://kafka.example.com:9092',
        protocol: 'kafka',
        protocolVersion: '3.7',
        description: 'The production cluster',
      },
    ]);
  });

  it('should carry the reply as its three members rather than as one line', () => {
    // Given the `send` operation, which is answered on a second channel
    const channel = channelOf(REQUESTS);

    // When its reply is read
    const reply = channel.operations[0]?.reply;

    // Then the channel, the messages and the address are three separate facts, and the channel
    // is a link to a page this document really has
    expect(reply).toEqual({
      channelId: REPLIES,
      channelHref: `/${REPLIES}`,
      channelLabel: 'orders.replies',
      messages: ['CostingResponse'],
      address: '$message.header#/REPLY_TOPIC',
    });
  });

  it('should carry a correlation expression and never the prose beside it', () => {
    // Given a message with a Correlation ID Object
    // When the message model is built
    const message = channelOf(REQUESTS).messages[0];

    // Then the value is the `location` of SPEC 8.2 and the message keeps its own words apart
    expect(message?.correlationId).toBe('$message.header#/REQUEST_ID');
    expect(message?.summary).toBe('One costing request.');
    expect(message?.tags).toEqual(['costing']);
  });

  it('should keep an Avro payload as source with its dialect named, and translate nothing', () => {
    // Given the reply message, whose payload is a Multi Format Schema in Avro
    // When its body model is built
    const body = channelOf(REPLIES).messages[0]?.payload;

    // Then it is source under a named dialect rather than a schema, which is the product claim
    // of SPEC 11: a translation to JSON Schema would lose the three things asserted below
    expect(body?.dialect).toBe('Avro');
    expect(body?.schema).toBeNull();
    expect(body?.sourceHtml).not.toBe('');

    // And the three things a translation would lose are all still readable in the source: the
    // union with null, the default values, and the order the fields were declared in
    const source = text(body?.sourceHtml ?? '');
    expect(source).toContain('"null"');
    expect(source).toContain('"default": "EUR"');
    expect(source.indexOf('total')).toBeLessThan(source.indexOf('currency'));
  });

  it('should keep a JSON Schema payload as a slot the reading rows are built from', () => {
    // Given the request message, whose payload is an AsyncAPI schema
    // When its body model is built
    const body = channelOf(REQUESTS).messages[0]?.payload;

    // Then the slot survives and no source is drawn, which is the other of the two outcomes
    expect(body?.dialect).toBe('AsyncAPI schema');
    expect(body?.schema?.kind).toBe('inline');
    expect(body?.sourceHtml).toBe('');
  });

  it('should ship the named schemas a message payload points at, so a row can link to one', () => {
    // Given the request channel, whose headers reference `RequestId`
    // When the page is built
    const page = pageOf(REQUESTS);

    // Then the reference is in the page's bounded schema payload rather than truncated
    expect(Object.keys(page.schemas)).toContain('RequestId');
    expect(page.truncatedSchemas).not.toContain('RequestId');
  });

  it('should draw no security section, because an events document has no security to draw', () => {
    // Given an events document, whose `security` SPEC 8.2 records as empty until `T051`
    const document = eventsDocument();

    // When the page is built
    const node = nodeOf(REQUESTS);

    // Then the absence is the document's own and the page states it by drawing nothing, rather
    // than by drawing an empty block over a security posture the IR does not have
    expect(document.security).toEqual([]);
    expect(node.security).toEqual([]);
    expect(node.drawn).not.toContain('security');
  });

  it('should promise no bench, because a channel has nothing for a console to send', () => {
    // Given the channel page
    const page = pageOf(REQUESTS);

    // Then there is no runner projection and no bench tab, per the F14 rule
    expect(page.node?.run).toBeNull();
    expect(page.frame.tabs.map((tab) => tab.kind)).not.toContain('bench');
  });

  it('should leave the whole channel behind when the model crosses to the client', () => {
    // Given the served page, whose three channel sections are adopted positions
    const page = pageOf(REQUESTS);
    expect(page.node?.channel).not.toBeNull();

    // When it is serialized for the browser
    const state = JSON.parse(serializePageModel(page)) as PageModel;

    // Then the channel is gone and `drawn` is what the client walks, so the two sides draw the
    // same tree without the highlighted source crossing twice
    expect(state.node?.channel).toBeNull();
    expect(state.node?.drawn).toEqual(page.node?.drawn);
  });
});

describe('the channel page as markup', () => {
  it('should name the address variables beside the address the header draws', async () => {
    // Given the channel facts section
    // When it renders
    const markup = await html(ChannelFacts, { channel: channelOf(REQUESTS) });

    // Then the variable is named with its braces, and every member the document wrote is there
    expect(markup).toContain('{tenant}');
    expect(markup).toContain('acme, globex');
    expect(markup).toContain('$message.header#/TENANT');

    // And the address itself is not repeated here: the header is where it stands, per F15
    expect(markup).not.toContain('orders.{tenant}.requests');
  });

  it('should print the direction as a word, so it survives a monochrome page', async () => {
    // Given both channels, one sending and one receiving
    // When their operation sections render
    const send = await html(ChannelOperations, { channel: channelOf(REQUESTS) });
    const receive = await html(ChannelOperations, { channel: channelOf(REPLIES) });

    // Then each says which it is in words, not only in a class
    expect(send).toContain('>send<');
    expect(receive).toContain('>receive<');
    expect(send).toContain('oref-direction-send');
    expect(receive).toContain('oref-direction-receive');
  });

  it('should render an Avro payload as readable annotated source', async () => {
    // Given the reply channel, whose one message carries an Avro payload
    // When its message section renders
    const page = pageOf(REPLIES);
    const markup = await html(MessageList, {
      channel: channelOf(REPLIES),
      schemas: page.schemas,
      basePath: page.basePath,
    });

    // Then the dialect is named and the source is a highlighted code block
    expect(markup).toContain('>Avro<');
    expect(markup).toContain('oref-code');
    expect(markup).toContain('CostingResponse');

    // And it is not drawn as a schema view that failed: no reading rows, no empty notice
    expect(markup).not.toContain('oref-shape-rows');
    expect(markup).not.toContain('No schema declared');
  });

  it('should read a JSON Schema payload as rows, requiredness and links included', async () => {
    // Given the request channel
    // When its message section renders
    const markup = await pageHtml(REQUESTS);

    // Then the payload reads as rows with the shapes page's own vocabulary
    expect(markup).toContain('oref-shape-rows');
    expect(markup).toContain('>sku<');
    expect(markup).toContain('>required<');
    expect(markup).toContain('>quantity<');
    expect(markup).toContain('>optional<');

    // And a row that names a schema links to that schema's own page, which is where the rest is
    expect(markup).toContain('href="/schema/RequestId"');
  });

  it('should draw the payload, the headers, the correlation id and the example of one message', async () => {
    // Given the request channel, whose message writes all four
    // When the page renders
    const markup = await pageHtml(REQUESTS);

    // Then each subject is on the page, named
    expect(markup).toContain('>payload<');
    expect(markup).toContain('>headers<');
    expect(markup).toContain('correlation id');
    expect(markup).toContain('$message.header#/REQUEST_ID');

    // And the example is the message rather than the payload alone, per SPEC 8.2
    expect(markup).toContain('one line');
    expect(text(markup)).toContain('"REQUEST_ID": "r-1"');
    expect(markup).toContain('AB-1');
  });

  it('should carry the bindings of the channel, the operation and the message alike', async () => {
    // Given the request channel, which writes a binding at all three levels
    // When the page renders
    const markup = await pageHtml(REQUESTS);

    // Then all three blocks are there, each under the protocol name the document wrote
    expect(markup.match(/oref-media-binding/g)?.length).toBe(3);
    expect(markup).toContain('partitions');
    expect(markup).toContain('groupId');
    expect(text(markup)).toContain('"key"');
  });

  it('should offer no control a reader could press, because nothing would hydrate it', async () => {
    // Given each of the three controls on a page the reference really draws it on, in markup and
    // not as a mark in `drawn`, so each absence below is a property of these sections rather than
    // of the assertion. THE PAGE THIS CASE USED TO NAME WAS `get-orders`, WHOSE ARTICLE CARRIES NO
    // CONTROL OF ANY KIND: its parameters are a table and its responses are the compact index, so
    // it draws 0 of each of the three and the three assertions below could not have failed against
    // anything. Measured on this fixture: the request article draws exactly one button, the
    // expander of the schema tree; the bench article draws the console's fields; the health
    // article draws the disclosure of every finding group.
    const request = await article(smallDocument(), { nodeId: 'post-orders' });
    const bench = await article(smallDocument(), { page: 'bench', nodeId: 'post-orders' });
    const health = await article(runtimeDocument(), { page: 'health' });
    expect(await article(smallDocument(), { nodeId: 'get-orders' })).not.toContain('<button');
    expect(request.match(/<button/g) ?? []).toHaveLength(1);
    expect(request).toContain('<button class="oref-schema-row"');
    expect(bench).toContain('<input');
    expect(health).toContain('<details');

    // When the channel page's three sections render
    const markup = await pageHtml(REQUESTS);

    // Then there is no button and no other control in any of them: they are adopted positions,
    // so a control here would be the F14 class, pressable and attached to nothing
    expect(markup).not.toContain('<button');
    expect(markup).not.toContain('<input');
    expect(markup).not.toContain('<details');
  });

  it('should write no inline style and no script into any of the three sections', async () => {
    // Given both channel pages
    // When they render
    const markup = (await pageHtml(REQUESTS)) + (await pageHtml(REPLIES));

    // Then the strict CSP of SPEC 19 holds here as everywhere: no inline style attribute, no
    // style element, no script
    expect(/[\s'"`;{(]style\s*=/.test(markup)).toBe(false);
    expect(markup).not.toContain('<style');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('javascript:');
  });

  it('should say in words that a body was declared with nothing in it', async () => {
    // Given a message whose payload is a schema declaring no fields at all
    const channel = channelOf(REQUESTS);
    const empty: ChannelModel = {
      ...channel,
      messages: [
        {
          ...(channel.messages[0] ?? { id: 'x' }),
          payload: {
            dialect: '',
            schema: { kind: 'inline', schema: { id: 'x', dialect: 'unknown' } },
            sourceHtml: '',
          },
        } as ChannelModel['messages'][number],
      ],
    };

    // When the section renders
    const markup = await html(MessageList, { channel: empty, schemas: {}, basePath: '' });

    // Then it says so, rather than leaving an empty block under a heading
    expect(markup).toContain('without saying what is in it');
  });
});

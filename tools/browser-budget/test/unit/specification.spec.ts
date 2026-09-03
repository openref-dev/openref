import { describe, expect, it } from 'vitest';
import { normalizeAsyncApiDocument, normalizeOpenApiDocument } from '@openref/core';
import { largeDocument } from '../../../../packages/render/test/mocks/documents';
import {
  CHANNEL_ADDRESS,
  CHANNEL_GREETING,
  channelSpecification,
  largeSpecification,
  TTI_NODE_COUNT,
} from '../../src/fixture/specification';
import { TTI_PAGE, TTI_PAGE_MARKER } from '../../src/study';

/**
 * The generated document is the one the jsdom ceilings already use.
 *
 * `client-cost.spec.ts` in `@openref/render` bounds hydration work on a thousand nodes cheaply
 * and in every CI run, and this package measures the same page in a real browser. They are only
 * two views of one thing while they measure one document. Two generators drifting apart would
 * leave both claiming a thousand nodes and measuring different pages, and nothing would say so.
 *
 * Read across the package boundary on purpose. It is a test reading a test fixture, not an
 * import edge in `src`, so the dependency graph is untouched; `theme.spec.ts` reads the
 * renderer's source from disk for the same reason and records it.
 */
describe('the document TTI is measured on', () => {
  it('should be the same document the jsdom ceilings measure, hash included', () => {
    // Given
    const fromRenderMocks = largeDocument(TTI_NODE_COUNT);

    // When
    const fromFixture = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

    // Then
    expect(fromFixture.hash).toBe(fromRenderMocks.hash);
    expect(fromFixture.nodes.size).toBe(TTI_NODE_COUNT);
  });

  it('should carry the node count SPEC 20 writes the budget about', () => {
    // Given, the budget says a thousand nodes, so a fixture of nine hundred would pass a
    // threshold that was never about nine hundred.
    // When
    const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

    // Then
    expect(TTI_NODE_COUNT).toBe(1000);
    expect(document.nodes.size).toBe(1000);
  });
});

/**
 * The page the study navigates to, held to the fixture it is read off.
 *
 * A route and a marker written out by hand beside a generated document are two facts that can
 * disagree, and when they disagreed the study threw instead of measuring. That is the right
 * failure and it is a slow one: it costs a runner round trip to find out. This is the same
 * check, in the suite that runs on every push.
 */
describe('the page the study measures', () => {
  it('should be a real operation of the fixture, with the text the guard looks for', () => {
    // Given
    const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));
    const id = TTI_PAGE.replace('/docs/', '');

    // When
    const node = document.nodes.get(id);

    // Then
    expect(node).toBeDefined();
    expect(node?.summary).toBe(TTI_PAGE_MARKER);
  });

  it('should be a page out of the middle of the navigation rather than the first', () => {
    // Given, because the first page of a document is the one whose navigation slice is cheapest
    const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

    // When
    const position = [...document.nodes.keys()].indexOf(TTI_PAGE.replace('/docs/', ''));

    // Then
    expect(position).toBe(500);
  });
});

/**
 * The channel page the socket console is pressed on, held to the document it is read off.
 *
 * The same guard as the one above and for the same reason: `tx-socket-console.spec.ts` writes the
 * route out by hand, the node id is the normalizer's, and two facts that can disagree should say
 * so in the suite that runs on every push rather than in a browser run.
 */
describe('the channel page the socket console is proved on', () => {
  it('should be one channel node, at the address the browser case navigates to', () => {
    // Given
    const document = normalizeAsyncApiDocument(channelSpecification('127.0.0.1:1234'));

    // When
    const node = document.nodes.get('channel-orders-created');

    // Then
    expect([...document.nodes.keys()]).toEqual(['channel-orders-created']);
    expect(node?.kind).toBe('channel');
    expect(node?.kind === 'channel' ? node.address : '').toBe(CHANNEL_ADDRESS);
  });

  it('should declare exactly one server, which a browser can open a socket to', () => {
    // Given, because a channel whose only server speaks kafka draws a console whose Connect
    // button opens nothing, and a press proved against that would be proving the refusal
    const document = normalizeAsyncApiDocument(channelSpecification('127.0.0.1:1234'));

    // When
    const node = document.nodes.get('channel-orders-created');
    const servers = node?.kind === 'channel' ? node.servers : [];

    // Then
    expect(node?.kind === 'channel' ? node.protocol : '').toBe('ws');
    expect(servers.length).toBe(1);
    expect(servers[0]?.url).toBe('ws://127.0.0.1:1234');
  });

  it('should push a greeting the channel declares a message for', () => {
    // Given, because a pushed frame that matched nothing the document describes would be a shape
    // the reference never claimed, which is not what the window is being read for
    const payload: unknown = JSON.parse(CHANNEL_GREETING);

    // When
    const document = normalizeAsyncApiDocument(channelSpecification('127.0.0.1:1234'));
    const node = document.nodes.get('channel-orders-created');
    const messages = node?.kind === 'channel' ? node.messages : [];

    // Then
    expect(messages.length).toBe(1);
    expect(payload).toEqual({ id: 'ord_1024', quantity: 2 });
  });
});

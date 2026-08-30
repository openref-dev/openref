import { describe, expect, it } from 'vitest';
import { carriesControlCharacters, normalizeSpecification } from '@openref/core';
import { materializeNode, nodeHref, schemaHref } from '@openref/render';
import {
  agentExposure,
  buildLlmsFull,
  buildLlmsIndex,
  type LlmsTextOptions,
} from '../../src/index';
import {
  channelDocument,
  channelSource,
  ESCAPE_CHARACTER,
  orderDocument,
  orderSource,
  OVERRIDE,
} from '../mocks/documents';

const mounted: LlmsTextOptions = { basePath: '/docs', agent: { llmsTxt: true, mcp: false } };

describe('buildLlmsIndex', () => {
  it('should name every operation exactly as the page that answers its address does', () => {
    // Given a document whose nodes the reference also renders as pages
    const document = orderDocument();

    // When
    const index = buildLlmsIndex(document, mounted);

    // Then every row is the page's own title at the page's own address, which is the property
    // `materializeNode` and `links.ts` were centralised for: a second spelling of either is a
    // reader following a link to a page that calls the operation something else.
    //
    // THE SET IS THE EXPOSED ONE AND NOT EVERY NODE, since the second blind review of `T058`:
    // SPEC 18.1 filters `audience: internal` out of both text files on every surface, so a case
    // over every node would demand a row the file must not carry.
    const exposed = agentExposure(document).operations;
    expect(exposed.length).toBeGreaterThan(0);
    for (const node of exposed) {
      const title = materializeNode(node, document).title;
      expect(index).toContain(`- [${title}](${nodeHref(node.id, '/docs')})`);
    }
  });

  it('should list every named schema at the address its page answers on', () => {
    // Given
    const document = orderDocument();

    // When
    const index = buildLlmsIndex(document, mounted);

    // Then
    expect(index).toContain(`- [Order](${schemaHref('Order', '/docs')})`);
  });

  it('should offer the MCP address only when the host switched MCP on', () => {
    // Given one document and the two states of the switch
    const document = orderDocument();

    // When
    const off = buildLlmsIndex(document, mounted);
    const on = buildLlmsIndex(document, { basePath: '/docs', agent: { llmsTxt: true, mcp: true } });

    // Then, an index is read by something that follows what it finds, so an address that answers
    // 403 must not be in it
    expect(off).not.toContain('/docs/mcp');
    expect(on).toContain('/docs/mcp');
  });

  it('should offer the events document under its own name and never under OpenAPI', () => {
    // Given an AsyncAPI document
    const document = channelDocument();

    // When
    const index = buildLlmsIndex(document, mounted);

    // Then, per SPEC 13.3: one address never answers for the other family, and an index naming
    // `openapi.json` on an events mount would send a generator to a 404
    expect(index).toContain('- [AsyncAPI document](/docs/asyncapi.json)');
    expect(index).not.toContain('openapi.json');
  });

  it('should fall back to a sentence about the document when it wrote no description', () => {
    // Given a document with no description at all
    const document = channelDocument();

    // When
    const index = buildLlmsIndex(document, mounted);

    // Then the blockquote says what the reference is rather than standing empty
    expect(index).toContain('> API reference for Order events 2.0.0.');
  });

  it('should print no operations section on a document that has none', () => {
    // Given the events document, which carries channels and no HTTP operation
    const document = channelDocument();

    // When
    const index = buildLlmsIndex(document, mounted);

    // Then, an empty heading is a section that promises rows and has none
    expect(index).not.toContain('## Operations');
    expect(index).toContain('## Channels');
  });

  it('should carry no control character out of a document that carries them', () => {
    // Given a document whose own strings carry a bidirectional override and an escape, asserted
    // present first: a clean artefact and an artefact the text never reached look the same
    const source = orderSource();
    const info = source.info as Record<string, string>;
    info.title = `Orders${OVERRIDE}`;
    info.description = `${ESCAPE_CHARACTER}[31mred`;
    const document = normalizeSpecification(source);
    expect(carriesControlCharacters(document.info.title)).toBe(true);
    expect(carriesControlCharacters(document.info.description ?? '')).toBe(true);

    // When
    const index = buildLlmsIndex(document, mounted);

    // Then, per SPEC 19.1 as extended by T043: plain text has no syntax to escape into, so it
    // gets the property by removal, once, at the artefact boundary
    expect(carriesControlCharacters(index)).toBe(false);
    expect(index).toContain('# Orders');
  });
});

describe('buildLlmsFull', () => {
  it('should mark a mutating method as mutating and a safe one as not', () => {
    // Given a document with one of each
    const document = orderDocument();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain(
      '### GET /orders\n\nTitle: List orders\nAddress: /docs/get-orders\nMutating: no',
    );
    expect(full).toContain(
      '### POST /orders\n\nTitle: Create an order\nAddress: /docs/post-orders\nMutating: yes',
    );
  });

  it('should carry the security requirement with its scopes', () => {
    // Given
    const document = orderDocument();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('Security: bearer (orders:write)');
  });

  it('should name the schema behind a response rather than inlining it', () => {
    // Given a response whose media type refers to a named schema
    const document = orderDocument();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then the name is what a reader looks up in this same file
    expect(full).toContain('- 200 (application/json of Order): The orders');
  });

  it('should print a schema one level deep, with required marked per property', () => {
    // Given
    const document = orderDocument();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(full).toContain('- id (string, required): Identity of the order.');
    expect(full).toContain('- amount (integer, optional)');
  });

  it('should head a titled channel with the name the index gives it, not with its address', () => {
    // Given a channel that declares a title, which `channelTitle` prefers over the address.
    // Found by the blind review of `T058`: this file derived `address ?? id` and the index used
    // `materializeNode`, so a titled channel had two names in two files a reader opens together.
    const source = channelSource();
    const channels = source.channels as Record<string, Record<string, unknown>>;
    const channel = channels.orderCreated;
    if (channel === undefined) throw new Error('the fixture lost its channel');
    channel.title = 'Order created feed';
    const document = normalizeSpecification(source);
    const node = document.nodes.get('channel-orders-created');
    if (node === undefined) throw new Error('the fixture lost its node');
    const title = materializeNode(node, document).title;

    // When
    const index = buildLlmsIndex(document, mounted);
    const full = buildLlmsFull(document, mounted);

    // Then, with the presence half first: the title really is not the address, so the two files
    // agreeing is the fix rather than a coincidence of a channel that declared nothing
    expect(title).toBe('Order created feed');
    expect(title).not.toBe(node.kind === 'channel' ? node.address : '');
    expect(index).toContain(`- [${title}](${nodeHref(node.id, '/docs')})`);
    expect(full).toContain(`### ${title}`);
    // And the address is a fact of its own rather than a casualty of the fix
    expect(full).toContain('Channel address: orders.created');
  });

  it('should give an operation the same title in both files as well', () => {
    // Given, the same rule for the other node kind: no name in either file is derived here
    const document = orderDocument();
    const node = document.nodes.get('get-orders');
    if (node === undefined) throw new Error('the fixture lost GET /orders');
    const title = materializeNode(node, document).title;

    // When
    const index = buildLlmsIndex(document, mounted);
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(index).toContain(`- [${title}](${nodeHref(node.id, '/docs')})`);
    expect(full).toContain(`Title: ${title}`);
  });

  it('should say a channel is not called over HTTP rather than calling it safe', () => {
    // Given an events document
    const document = channelDocument();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then, "safe" would be a claim about an HTTP method a channel does not have
    expect(full).toContain('Mutating: not applicable, a channel is not called over HTTP');
    expect(full).toContain('- receive: created (An order was created)');
  });

  it('should carry no control character out of a document that carries them', () => {
    // Given a document whose operation summary carries an override, asserted present first
    const source = orderSource();
    const paths = source.paths as Record<string, Record<string, Record<string, unknown>>>;
    const operation = paths['/orders']?.get;
    if (operation === undefined) throw new Error('the fixture lost its GET /orders');
    operation.summary = `List${OVERRIDE} orders`;
    const document = normalizeSpecification(source);
    expect(carriesControlCharacters(document.nodes.get('get-orders')?.summary ?? '')).toBe(true);

    // When
    const full = buildLlmsFull(document, mounted);

    // Then
    expect(carriesControlCharacters(full)).toBe(false);
  });

  it('should say when a runtime pass ran and stated nothing about an operation', () => {
    // Given a document that went through no runtime pass at all
    const document = orderDocument();

    // When
    const full = buildLlmsFull(document, mounted);

    // Then nothing claims a pass happened, because none did: "no collector said anything" and
    // "no collector ever ran" are different facts and only the first one has a sentence here
    expect(document.runtime).toBeUndefined();
    expect(full).not.toContain('Runtime:');
    expect(full).not.toContain('no collector stated anything');
  });
});

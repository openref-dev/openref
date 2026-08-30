import { describe, expect, it } from 'vitest';
import { normalizeAsyncApiDocument, parseSpecification } from '@openref/core';
import telltale from '../../src/theme';
import { createMarkdownRenderer } from '../../../render/src/markdown/domain/markdown';
import { renderPage } from '../../../render/src/render/application/services/render.service';

/**
 * The statement of SPEC 14.7 under an L2 theme, which is the half a structural argument misses.
 *
 * WHY THIS FILE EXISTS IS THE `topology-strip.spec.ts` FINDING MET A SECOND TIME. `T055` draws the
 * limitation inside the channel sections, which are core markup rather than a registry position, so
 * the reasoning that it survives a theme is an argument about which components a theme replaces.
 * That argument is exactly what was true of the topology graph until the graph turned out to be
 * inside a position this theme overrides, and the boundary sweep could not report it: a sweep sees
 * class names that survive, and a whole statement lost inside an override survives as nothing.
 *
 * SO THE CLAIM IS MADE ON A RENDERED TELLTALE PAGE RATHER THAN ON THE REFERENCE'S. What is asserted
 * is what a reader of this theme sees: the scheme named, the limitation named, the route named, and
 * the pair that makes it the document's fact rather than the theme's, since a channel whose schemes
 * a browser can present says none of it.
 *
 * THE FIXTURE IS BUILT HERE AND NOT ADDED TO THE MOCKS. The mock events document is what the
 * boundary sweep renders, and giving it security would move what that sweep measures for a reason
 * that has nothing to do with the boundary. This one is local to the question.
 */

const markdown = await createMarkdownRenderer();

/** An events document whose channel requires one blocked scheme and one a browser can present. */
function blockedChannelDocument(): ReturnType<typeof normalizeAsyncApiDocument> {
  return normalizeAsyncApiDocument(
    parseSpecification(`
asyncapi: 3.1.0
info:
  title: Orders events
  version: '1.0.0'
servers:
  gateway:
    host: ws.example.com
    protocol: ws
    security:
      - $ref: '#/components/securitySchemes/bearerAuth'
channels:
  created:
    address: orders.created
    servers:
      - $ref: '#/servers/gateway'
    messages:
      OrderCreated:
        payload:
          type: object
          properties:
            id:
              type: string
operations:
  publishOrderCreated:
    action: send
    channel:
      $ref: '#/channels/created'
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
`),
  );
}

/** The same channel, requiring the one form SPEC 14.7 says a browser can present. */
function presentableChannelDocument(): ReturnType<typeof normalizeAsyncApiDocument> {
  return normalizeAsyncApiDocument(
    parseSpecification(`
asyncapi: 3.1.0
info:
  title: Orders events
  version: '1.0.0'
servers:
  gateway:
    host: ws.example.com
    protocol: ws
    security:
      - $ref: '#/components/securitySchemes/queryKey'
channels:
  created:
    address: orders.created
    servers:
      - $ref: '#/servers/gateway'
    messages:
      OrderCreated:
        payload:
          type: object
          properties:
            id:
              type: string
operations:
  publishOrderCreated:
    action: send
    channel:
      $ref: '#/channels/created'
components:
  securitySchemes:
    queryKey:
      type: httpApiKey
      in: query
      name: token
`),
  );
}

async function channelPage(
  document: ReturnType<typeof normalizeAsyncApiDocument>,
): Promise<string> {
  const nodeId = [...document.nodes.keys()][0];
  if (nodeId === undefined) throw new Error('the fixture must carry a channel');

  const rendered = await renderPage(document, { markdown, theme: telltale, nodeId });

  return rendered.appHtml;
}

/** The words a reader sees, with the markup and the entities taken off. */
function text(markup: string): string {
  return markup
    .replace(/<[^>]*>/g, '')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

describe('the telltale channel page and the socket handshake limitation', () => {
  it('should name the scheme, the limitation and the route on a page this theme rendered', async () => {
    // Given a channel whose one requirement rides an Authorization header at the handshake
    const markup = await channelPage(blockedChannelDocument());

    // Then a reader of this theme meets all three, before any script has run
    expect(markup).toContain('oref-section-channel');
    expect(text(markup)).toContain('not from a browser');
    expect(text(markup)).toContain('bearerAuth');
    expect(text(markup)).toContain('cannot set one');
    expect(text(markup)).toContain('server bridge that opens the connection is the only route');
  });

  it('should say none of it for a channel whose scheme a browser can present', async () => {
    // Given the falsification pair: the same theme, the same section, a key in the query
    const blocked = await channelPage(blockedChannelDocument());
    const presentable = await channelPage(presentableChannelDocument());

    // Then the difference is the document's and not the theme's, with the requirement drawn on
    // both so the absence is the limitation's rather than the section's
    expect(text(blocked)).toContain('not from a browser');
    expect(presentable).toContain('oref-security-item');
    expect(text(presentable)).toContain('requires');
    expect(text(presentable)).not.toContain('not from a browser');
  });

  it('should owe this theme no rule it does not have, which is why the rows borrow the facts family', async () => {
    // Given the standing order on `theme-css-raw`, which had 40 bytes of headroom on 2026-08-30
    const markup = await channelPage(blockedChannelDocument());

    // Then the rows carry names this theme already styles and no name of their own
    expect(markup).toContain('<span class="oref-fact-label">not from a browser</span>');
    expect(markup).not.toContain('oref-handshake');
    expect(markup).not.toContain('oref-socket');
  });
});

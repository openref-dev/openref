import { describe, expect, it } from 'vitest';
import { normalizeOpenApiDocument } from '@openref/core';
import { frameHashOf, pageKeyOf, planPages, readdressPage, recoverPage } from '../../src/index';
import { APP_ROOT_ID, renderHtmlDocument, renderPage, STATE_ELEMENT_ID } from '@openref/render';
import { miniDocument } from '../mocks/documents';

describe('frameHashOf', () => {
  it('should be stable across two normalizations of one document', () => {
    // Given
    const document = { openapi: '3.1.0', info: { title: 'A', version: '1' }, paths: {} };

    // When
    const first = frameHashOf(normalizeOpenApiDocument(document));
    const second = frameHashOf(normalizeOpenApiDocument(document));

    // Then
    expect(first).toBe(second);
  });

  it('should move when the document title moves, because every page draws it', () => {
    // Given
    const a = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'A', version: '1' },
      paths: {},
    });
    const b = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'B', version: '1' },
      paths: {},
    });

    // When
    const result = frameHashOf(a) === frameHashOf(b);

    // Then
    expect(result).toBe(false);
  });
});

describe('pageKeyOf', () => {
  it('should give a node and its bench two different keys', () => {
    // Given
    const document = miniDocument();
    const frame = frameHashOf(document);
    const node = document.nodes.get('get-ping');

    // When
    const page = pageKeyOf(frame, 'node', node ?? null);
    const bench = pageKeyOf(frame, 'bench', node ?? null);

    // Then
    expect(node).toBeDefined();
    expect(page).not.toBe(bench);
  });

  it('should move for the changed node and stand still for its sibling', () => {
    // Given
    const before = planPages(miniDocument(), '');
    const after = planPages(miniDocument({ pongResponse: 'described differently' }), '');
    const keyOf = (pages: readonly { file: string; key: string }[], file: string): string =>
      pages.find((page) => page.file === file)?.key ?? '';

    // When
    const pongMoved = keyOf(before, 'get-pong/index.html') !== keyOf(after, 'get-pong/index.html');
    const pingMoved = keyOf(before, 'get-ping/index.html') !== keyOf(after, 'get-ping/index.html');

    // Then
    expect(pongMoved).toBe(true);
    expect(pingMoved).toBe(false);
  });
});

describe('recoverPage and readdressPage', () => {
  /** One page, assembled the way the build assembles it. */
  async function pageHtml(): Promise<{ html: string; hash: string }> {
    const document = miniDocument();
    const rendered = await renderPage(document, { nodeId: 'get-ping', basePath: '/api' });

    return {
      html: renderHtmlDocument(rendered, {
        assets: { stylesheets: ['/api/_assets/a.css'], modules: ['/api/_assets/b.js'] },
      }),
      hash: document.hash,
    };
  }

  it('should read back the three parts the shell assembled', async () => {
    // Given
    const { html } = await pageHtml();

    // When
    const recovered = recoverPage(html, APP_ROOT_ID);

    // Then
    expect(recovered).not.toBeNull();
    expect(recovered?.title).toBe('Ping - Mini');
    expect(recovered?.appHtml).toContain('oref-root');
    expect(JSON.parse(String(recovered?.stateJson).replace(/\\u003c/g, '<'))).toHaveProperty(
      'documentHash',
    );
  });

  it('should replace the hash in the markup as well as in the state block', async () => {
    // Given
    const { html, hash } = await pageHtml();
    const next = 'f'.repeat(64);
    expect(html).toContain(`data-oref-document="${hash}"`);

    // When
    const result = readdressPage(html, APP_ROOT_ID, next, 'get-ping', null);

    // Then: the markup carries the hash too, which the first version of this file missed.
    expect(result?.appHtml).toContain(`data-oref-document="${next}"`);
    expect(result?.appHtml).not.toContain(hash);
    const state = JSON.parse(String(result?.stateJson)) as { documentHash: string };
    expect(state.documentHash).toBe(next);
  });

  it('should refuse a file that is not one this build wrote', () => {
    // Given
    const cases = [
      '<!DOCTYPE html><html><body>hand written</body></html>',
      '<!DOCTYPE html><html><head><title>t</title></head><body><div id="other"></div></body></html>',
      '',
    ];

    // When
    const result = cases.map((html) => recoverPage(html, APP_ROOT_ID));

    // Then
    expect(result).toEqual([null, null, null]);
  });

  it('should refuse a page whose state block is not readable JSON', async () => {
    // Given
    const { html } = await pageHtml();
    const broken = html.replace(/(<script type="application\/json"[^>]*>)/, '$1{ not json ');

    // When
    const result = readdressPage(broken, APP_ROOT_ID, 'f'.repeat(64), 'get-ping', null);

    // Then
    expect(result).toBeNull();
  });

  it('should refuse the legacy state tag that carries a nonce, and accept the same page without it', async () => {
    // Given a page in the current shape beside the same page in the legacy one: before the
    // shell wrote the nonce attribute only when handed a nonce, a static page carried an
    // empty `nonce=""` on its state tag, and that is the one shape the lookahead refuses.
    // Both tags are asserted present so neither half can pass on a substitution that missed.
    const { html } = await pageHtml();
    const currentTag = `<script type="application/json" id="${STATE_ELEMENT_ID}">`;
    const legacyTag = `<script type="application/json" id="${STATE_ELEMENT_ID}" nonce="">`;
    const legacy = html.replace(currentTag, legacyTag);
    expect(html).toContain(currentTag);
    expect(legacy).toContain(legacyTag);

    // When
    const accepted = recoverPage(html, APP_ROOT_ID);
    const refused = recoverPage(legacy, APP_ROOT_ID);

    // Then the same content is accepted without the attribute and refused with it, so the
    // refusal is proven to be about the nonce rather than about the surrounding markup, and
    // a legacy file takes the full render exit instead of being carried
    expect(accepted).not.toBeNull();
    expect(refused).toBeNull();
  });
});

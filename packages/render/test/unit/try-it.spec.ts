import { describe, expect, it } from 'vitest';
import { buildPageModel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { renderPage } from '../../src/render/application/services/render.service';
import { smallDocument } from '../mocks/documents';

/**
 * What the server render of the console may and may not contain.
 *
 * The credential assertions are the ones T013 asks for by name, and they are asserted on the
 * rendered HTML rather than on a component's state, because the page is what gets cached by
 * document hash and served to every reader.
 */

const markdown = await createMarkdownRenderer();

// The console lives on the bench page since TX-FRAME, per SPEC 13.3, so the console suite
// renders the bench: same console, its own address.
async function renderBench(nodeId: string): Promise<string> {
  const page = await renderPage(smallDocument(), { page: 'bench', nodeId });

  return page.appHtml;
}

describe('the try-it console in the page model', () => {
  it('should carry the projection an operation is sent with', () => {
    // Given
    const document = smallDocument();

    // When
    const page = buildPageModel(document, { nodeId: 'get-orders', markdown });

    // Then
    expect(page.node?.run?.method).toBe('get');
    expect(page.node?.run?.servers).toEqual(['https://api.example.com']);
    expect(page.node?.run?.parameters.map((parameter) => parameter.name)).toEqual([
      'limit',
      'X-Trace',
    ]);
  });

  it('should carry no projection for a page that shows no operation', () => {
    // Given
    const document = smallDocument();

    // When
    const page = buildPageModel(document, { markdown });

    // Then
    expect(page.node).toBeNull();
  });
});

describe('the try-it console in the server render', () => {
  it('should render a field for every parameter and for the credential', async () => {
    // Given, the console is the thing that makes M0 a product rather than a viewer.
    const html = await renderBench('post-orders');

    // When
    const fields = [...html.matchAll(/class="oref-field-label"[^>]*>([^<]+)</g)].map(
      (match) => match[1],
    );

    // Then
    expect(fields).toContain('Server');
    expect(fields).toContain('X-Key (header)');
    expect(fields).toContain('Request body');
  });

  it('should carry no credential in the markup, on any page', async () => {
    // Given, a page is cached by document hash and served to every reader, so a credential in
    // the markup is a credential handed to somebody else.
    const pages = await Promise.all([
      renderBench('get-orders'),
      renderBench('post-orders'),
      renderPage(smallDocument()).then((page) => page.appHtml),
    ]);

    // When
    const values = pages.flatMap((html) =>
      [...html.matchAll(/type="password"[^>]*>/g)].map((match) => match[0]),
    );

    // Then
    expect(values.length).toBeGreaterThan(0);
    for (const field of values) expect(field).not.toMatch(/\bvalue="[^"]/);
  });

  it('should carry no credential in the serialized page state either', async () => {
    // Given, the state block is JSON in the document and is read back at hydration.
    const page = await renderPage(smallDocument(), { nodeId: 'post-orders' });

    // When
    const state = page.stateJson;

    // Then
    expect(state).toContain('"run"');
    expect(state).not.toContain('credential');
    expect(state).not.toContain('Authorization');
  });

  it('should serve the send button as a real enabled control with the load notice', async () => {
    // Given, and the same markup is what the first client render produces, so hydration
    // matches. Per the SPEC 11 rule rewritten 2026-08-14: a press on the deferred button does
    // exactly what the notice names, so declaring it disabled in any form hands the gesture to
    // whichever pipeline respects declared state, assistive technology, actionability checking
    // automation, or the engine itself on native `disabled`, and each one discards it.
    const html = await renderBench('get-orders');

    // When
    const button = /<button class="oref-send"[^>]*>/.exec(html)?.[0] ?? '';

    // Then it carries neither disabling form
    expect(button).not.toContain('aria-disabled');
    expect(/\sdisabled(\s|=|>)/.test(button)).toBe(false);

    // And what marks the state is the notice, associated through the attribute a screen
    // reader follows, saying the true sentence about a press.
    expect(button).toContain('aria-describedby="oref-tryit-notice"');
    expect(html).toContain('The console loads when you press Send.');
  });

  it('should say the document declares no server rather than render a form that cannot send', () => {
    // Given
    const document = smallDocument();
    const serverless = { ...document, servers: [] };

    // When
    const page = buildPageModel(serverless, { nodeId: 'get-orders', markdown });

    // Then
    expect(page.node?.run?.servers).toEqual([]);
  });

  it('should not render a console on a page that shows a schema rather than an operation', async () => {
    // Given
    const page = await renderPage(smallDocument(), { schemaId: 'Order' });

    // When
    const html = page.appHtml;

    // Then
    expect(html).not.toContain('oref-section-tryit');
  });

  it('should not render a console on the operation page, whose bench tab is the way there', async () => {
    // Given, the split TX-FRAME made: the sections on the operation page, the console on the
    // bench, and one page never says the same thing twice.
    const page = await renderPage(smallDocument(), { nodeId: 'get-orders' });

    // When
    const html = page.appHtml;

    // Then
    expect(html).not.toContain('oref-section-tryit');
    expect(html).toContain('href="/bench/get-orders"');
  });
});

describe('the direct mode warning of SPEC 16.2', () => {
  it('should render the warning on the bench when the model names a direct target', async () => {
    // Given
    const page = await renderPage(smallDocument(), {
      page: 'bench',
      nodeId: 'get-orders',
      directTarget: 'GitHub Pages',
    });

    // When
    const html = page.appHtml;

    // Then: the sentence stands in the console markup, visible before any gesture.
    expect(html).toContain('oref-tryit-notice');
    expect(html).toContain('published on GitHub Pages');
    expect(html).toContain('straight from your browser to the API');
  });

  it('should render no warning without the option, proven against the page that shows it', async () => {
    // Given: the warned page above is this suite's presence proof; this is the same page with
    // the option absent.
    const warned = await renderPage(smallDocument(), {
      page: 'bench',
      nodeId: 'get-orders',
      directTarget: 'GitHub Pages',
    });
    expect(warned.appHtml).toContain('published on GitHub Pages');

    // When
    const page = await renderPage(smallDocument(), { page: 'bench', nodeId: 'get-orders' });

    // Then
    expect(page.appHtml).not.toContain('published on GitHub Pages');
    expect(page.appHtml).not.toContain('cannot rewrite');
  });

  it('should carry the platform name in the model, so the client hydrates the same page', () => {
    // Given
    const document = smallDocument();

    // When
    const page = buildPageModel(document, {
      page: 'bench',
      nodeId: 'get-orders',
      markdown,
      directTarget: 'GitHub Pages',
    });
    const bare = buildPageModel(document, { page: 'bench', nodeId: 'get-orders', markdown });

    // Then
    expect(page.directTarget).toBe('GitHub Pages');
    expect(bare.directTarget).toBeUndefined();
  });
});

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

async function renderNode(nodeId: string): Promise<string> {
  const page = await renderPage(smallDocument(), { nodeId });

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
    const html = await renderNode('post-orders');

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
      renderNode('get-orders'),
      renderNode('post-orders'),
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

  it('should mark the send button disabled without disabling it, per F14', async () => {
    // Given, and the same markup is what the first client render produces, so hydration matches.
    const html = await renderNode('get-orders');

    // When
    const button = /<button class="oref-send"[^>]*>/.exec(html)?.[0] ?? '';

    // Then it says it is disabled, to a reader through the theme and to assistive technology
    // through the attribute.
    expect(button).toContain('aria-disabled="true"');

    // And it does not carry the attribute that would make it unusable as the trigger it is.
    // Chrome dispatches no mouse event at all on a form control with `disabled`, so a served
    // console whose send button carried it could be woken by pressing anywhere except the one
    // control the reader reaches for, which is what F14 measured in a real browser.
    expect(/\sdisabled(\s|=|>)/.test(button)).toBe(false);
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
});

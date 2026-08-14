import { describe, expect, it } from 'vitest';
import { buildPageModel } from '../../src/page/domain/page-model';
import { createMarkdownRenderer } from '../../src/markdown/domain/markdown';
import { renderPage } from '../../src/render/application/services/render.service';
import { authDocument } from '../mocks/documents';

/**
 * What the console says about a scheme before a reader has typed anything.
 *
 * ASSERTED ON THE SERVER RENDER, WHICH IS THE POINT. The console is deferred, so a reader who has
 * not reached for it sees the server's markup and nothing else; if the reason a scheme cannot be
 * used only appears after hydration, then for that reader the scheme is simply absent. SPEC 14.4
 * says `mutualTLS` is recognised and marked unsupported with an explanation rather than a silent
 * absence, and this is where the explanation has to be.
 */

const markdown = await createMarkdownRenderer();

async function orders(): Promise<string> {
  const page = await renderPage(authDocument(), { nodeId: 'get-orders' });

  return page.appHtml;
}

describe('the projection of a guarded operation', () => {
  it('should carry the flows an oauth2 scheme declares, in the order the console offers them', () => {
    // Given
    const page = buildPageModel(authDocument(), { nodeId: 'get-orders', markdown });

    // When
    const oauth = page.node?.run?.security.find((scheme) => scheme.id === 'oauth');

    // Then, the authorization code flow is first because it is the one PKCE is mandatory on.
    expect(oauth?.flows.map((flow) => flow.kind)).toEqual([
      'authorizationCode',
      'deviceAuthorization',
    ]);
    expect(oauth?.flows[0]?.tokenUrl).toBe('https://auth.example.com/token');
    expect(oauth?.flows[0]?.scopes).toEqual(['orders:read']);
  });

  it('should carry the discovery url of an openIdConnect scheme', () => {
    // Given
    const page = buildPageModel(authDocument(), { nodeId: 'get-orders', markdown });

    // When
    const oidc = page.node?.run?.security.find((scheme) => scheme.id === 'oidc');

    // Then
    expect(oidc?.openIdConnectUrl).toBe(
      'https://auth.example.com/.well-known/openid-configuration',
    );
    expect(oidc?.unsendableCause).toBeUndefined();
  });

  it('should carry the reason for each scheme a browser cannot send', () => {
    // Given
    const page = buildPageModel(authDocument(), { nodeId: 'get-orders', markdown });

    // When
    const schemes = page.node?.run?.security ?? [];

    // Then
    // A CAUSE AND NOT A SENTENCE. The words a reader reads belong to whatever draws them, and
    // carrying them here put three English sentences into the first chunk of every page.
    expect(schemes.find((scheme) => scheme.id === 'mtls')?.unsendableCause).toBe('mutual-tls');
    expect(schemes.find((scheme) => scheme.id === 'cookieKey')?.unsendableCause).toBe(
      'cookie-api-key',
    );
  });
});

describe('the server rendered console', () => {
  it('should say why mutualTLS cannot be exercised rather than draw nothing for it', async () => {
    // Given
    const html = await orders();

    // Then
    expect(html).toContain('mtls (mutualTLS)');
    expect(html).toContain('client certificate');
  });

  it('should offer a sign in for an oauth2 scheme, with the flow it will run named', async () => {
    // Given
    const html = await orders();

    // Then
    expect(html).toContain('oauth (oauth2)');
    expect(html).toContain('Sign in');
    expect(html).toContain('authorization code, with PKCE S256');
    expect(html).toContain('not signed in');
  });

  it('should ask for a client id rather than for a token an oauth2 reader does not have', async () => {
    // Given
    const html = await orders();

    // When
    const labels = [...html.matchAll(/class="oref-field-label"[^>]*>([^<]+)</g)].map(
      (match) => match[1],
    );

    // Then
    expect(labels).toContain('Client id');
    expect(labels).not.toContain('oauth');
  });

  it('should carry no credential and no token in the markup', async () => {
    // Given, a page is cached by document hash and served to every reader.
    const html = await orders();

    // Then
    expect(html).not.toContain('Bearer ');
    expect(html).toMatch(/type="password"[^>]*value=""|type="password"(?![^>]*value=")/);
  });
});

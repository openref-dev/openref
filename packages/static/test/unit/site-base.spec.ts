import { describe, expect, it } from 'vitest';
import { InvalidOptionsError, normalizeOpenApiDocument } from '@openref/core';
import { absoluteUrlOf, resolveSiteBase, sitemapXml, llmsTxt, planPages } from '../../src/index';
import { miniDocument } from '../mocks/documents';

describe('resolveSiteBase', () => {
  it('should read a path as a mount point with no origin', () => {
    // Given
    const base = '/docs/';

    // When
    const result = resolveSiteBase(base);

    // Then
    expect(result).toEqual({ basePath: '/docs', siteUrl: null });
  });

  it('should read nothing as the root with no origin', () => {
    // Given
    const cases = [undefined, '', '  ', '/'];

    // When
    const result = cases.map((base) => resolveSiteBase(base));

    // Then
    expect(result).toEqual([
      { basePath: '', siteUrl: null },
      { basePath: '', siteUrl: null },
      { basePath: '', siteUrl: null },
      { basePath: '', siteUrl: null },
    ]);
  });

  it('should read an absolute url as both a mount point and an origin', () => {
    // Given
    const base = 'https://docs.example.com/api/';

    // When
    const result = resolveSiteBase(base);

    // Then
    expect(result).toEqual({ basePath: '/api', siteUrl: 'https://docs.example.com/api' });
  });

  it('should refuse a scheme that is not a page', () => {
    // Given
    const base = 'file:///tmp/docs';

    // When
    const act = (): unknown => resolveSiteBase(base);

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });

  it('should refuse a value that is neither a path nor a url', () => {
    // Given
    const base = 'docs.example.com';

    // When
    const act = (): unknown => resolveSiteBase(base);

    // Then
    expect(act).toThrow(InvalidOptionsError);
  });
});

describe('absoluteUrlOf', () => {
  it('should answer null for every page when there is no origin', () => {
    // Given
    const base = resolveSiteBase('/api');

    // When
    const result = absoluteUrlOf(base, '/api/get-ping');

    // Then
    expect(result).toBeNull();
  });

  it('should join the origin to the address a link already carries', () => {
    // Given
    const base = resolveSiteBase('https://docs.example.com/api');

    // When
    const result = absoluteUrlOf(base, '/api/get-ping');

    // Then
    expect(result).toBe('https://docs.example.com/api/get-ping');
  });

  it('should keep the root address a slash when nothing is mounted under a prefix', () => {
    // Given
    const base = resolveSiteBase('https://docs.example.com');

    // When
    const result = absoluteUrlOf(base, '/');

    // Then
    expect(result).toBe('https://docs.example.com/');
  });
});

describe('sitemapXml', () => {
  it('should write one absolute loc per page', () => {
    // Given
    const document = miniDocument();
    const base = resolveSiteBase('https://docs.example.com/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = sitemapXml(pages, base);

    // Then
    expect(result).not.toBeNull();
    expect([...String(result).matchAll(/<loc>/g)]).toHaveLength(pages.length);
    expect(result).toContain('<loc>https://docs.example.com/api/get-ping</loc>');
    expect(result).toContain('http://www.sitemaps.org/schemas/sitemap/0.9');
  });

  it('should carry no timestamp, so two builds of one document agree', () => {
    // Given
    const document = miniDocument();
    const base = resolveSiteBase('https://docs.example.com/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = String(sitemapXml(pages, base));

    // Then
    expect(result).not.toContain('lastmod');
  });

  it('should write nothing at all without an origin, rather than a sitemap of paths', () => {
    // Given: the same call WITH an origin, so the null below is a proved absence.
    const document = miniDocument();
    const pages = planPages(document, '/api');
    expect(sitemapXml(pages, resolveSiteBase('https://docs.example.com/api'))).not.toBeNull();

    // When
    const result = sitemapXml(pages, resolveSiteBase('/api'));

    // Then
    expect(result).toBeNull();
  });
});

describe('llmsTxt', () => {
  it('should name the document and link every operation and schema', () => {
    // Given
    const document = miniDocument();
    const base = resolveSiteBase('/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = llmsTxt(document, pages, base);

    // Then
    expect(result).toContain('# Mini');
    expect(result).toContain('A small reference.');
    // The title is what `materializeNode` calls the operation, which is its summary when it
    // has one: one function decides what an operation is called, here and on its own page.
    expect(result).toContain('- [Ping](/api/get-ping)');
    expect(result).toContain('- [Pong](/api/schema/Pong)');
  });

  it('should link absolutely when there is an origin to be absolute about', () => {
    // Given
    const document = miniDocument();
    const base = resolveSiteBase('https://docs.example.com/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = llmsTxt(document, pages, base);

    // Then
    expect(result).toContain('](https://docs.example.com/api/get-ping)');
  });

  it('should print the summary once when it is also the title', () => {
    // Given
    const document = miniDocument({ pongSummary: 'Answers a ping' });
    const base = resolveSiteBase('/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = llmsTxt(document, pages, base);

    // Then: `materializeNode` titles by summary, so a note taken from the same summary said
    // the same words twice on every line of the common case.
    expect(result).toContain('- [Answers a ping](/api/get-pong)\n');
    expect(result).not.toContain('Answers a ping): Answers a ping');
  });

  it('should withhold a node marked audience internal, which is the audience SPEC 16.1 rules this file takes', () => {
    // Given a document that marks one of its two operations internal, per SPEC 13.4. The mounted
    // file of SPEC 18.1 has filtered this since `T058`; the static build did not, so one document
    // served both ways listed two different sets of operations.
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: 'Mini', version: '1.0.0' },
      paths: {
        '/ping': {
          get: { operationId: 'ping', summary: 'Ping', responses: { 200: { description: 'ok' } } },
        },
        '/admin/impersonate': {
          post: {
            operationId: 'impersonate',
            summary: 'Impersonate',
            'x-openref-audience': 'internal',
            responses: { 200: { description: 'ok' } },
          },
        },
      },
    });
    const base = resolveSiteBase('/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = llmsTxt(document, pages, base);

    // Then the subject was present: the build planned a page for it, and the public one is listed
    expect(pages.some((page) => page.nodeId?.includes('impersonate') === true)).toBe(true);
    expect(result).toContain('- [Ping]');
    expect(result).not.toContain('Impersonate');
    expect(result).not.toContain('impersonate');
  });

  it('should let no document value forge a line or a link in this file', () => {
    // Given the input `T059` measured against the mounted file and left open for this one: a
    // title and a schema name carrying a newline, a heading and link syntax.
    const forged = '\nInjected line\n## Operations\n\n- [Ghost](ghost)';
    const document = normalizeOpenApiDocument({
      openapi: '3.1.0',
      info: { title: `Mini${forged}`, version: `1.0.0${forged}` },
      paths: {
        '/ping': {
          get: {
            operationId: 'ping',
            summary: `Ping${forged}`,
            responses: { 200: { description: 'ok' } },
          },
        },
      },
      components: { schemas: { [`Pong${forged}`]: { type: 'object' } } },
    });
    const base = resolveSiteBase('/api');
    const pages = planPages(document, base.basePath);

    // When
    const result = llmsTxt(document, pages, base);

    // Then the subject was present in the document and produces no record of its own here: this
    // generator writes exactly two `##` headings, and no link to an address it never wrote.
    expect(document.info.title).toContain('## Operations');
    expect(result.split('\n').filter((line) => line.startsWith('## '))).toHaveLength(2);
    expect(result).not.toContain('](ghost)');
    expect(result).not.toContain('[Ghost]');

    // AND THE ONE PLACE THE FORGED TEXT STILL APPEARS IS AN ADDRESS THIS BUILD REALLY WROTE. The
    // schema's own page segment is derived from its name, so the escaped name is in the link
    // destination; that is the address of a page on disk, not a forged one, and the destination's
    // parentheses are balanced, so the row is one link to a real page rather than two.
    const schemaRow = result.split('\n').find((line) => line.includes('/api/schema/')) ?? '';
    expect(schemaRow).toContain('_u000a_');
    expect([...schemaRow.matchAll(/\]\(/g)]).toHaveLength(1);
  });
});

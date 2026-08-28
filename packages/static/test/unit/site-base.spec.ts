import { describe, expect, it } from 'vitest';
import { InvalidOptionsError } from '@openref/core';
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
});

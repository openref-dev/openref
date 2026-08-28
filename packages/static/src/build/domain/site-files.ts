/**
 * The two files that describe the whole site rather than one page: `sitemap.xml` and `llms.txt`.
 *
 * `sitemap.xml` NEEDS AN ORIGIN AND `llms.txt` DOES NOT, which is why one of them is optional
 * and the other is always written. The sitemap grammar's `<loc>` is defined as an absolute url,
 * so a sitemap of paths is not a sitemap; `llms.txt` is a list of links for a reader that
 * already knows where it fetched the file from, and relative links there are honest.
 *
 * NEITHER IS ORDERED BY ANYTHING BUT THE PLAN. The pages arrive in document order and stay in
 * it, so two builds of one document write the same bytes without anything being sorted here.
 */

import type { IRDocument } from '@openref/core';
import { materializeNode } from '@openref/render';
import { plainSummary } from './page-metadata';
import type { PlannedPage } from './page-plan';
import { absoluteUrlOf, type SiteBase } from './site-base';

/** Name of the sitemap, at the root of the output. */
export const SITEMAP_FILE = 'sitemap.xml';

/** Name of the machine readable index of SPEC 16.1. */
export const LLMS_FILE = 'llms.txt';

/** XML text escaping: the five characters that are markup inside an element. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * The sitemap, or null when there is no origin to write one with.
 *
 * NO `lastmod`, DELIBERATELY. The only timestamp available here is the moment of the build, and
 * a sitemap claiming every page changed at build time tells a crawler something false on every
 * unchanged page, which is worse than saying nothing. A build stamp would also make the file
 * differ between two builds of one document, which SPEC 16.3 forbids.
 *
 * @param pages - The planned pages
 * @param base - The build's base
 * @returns The file contents, or null when `--base` carried no origin
 */
export function sitemapXml(pages: readonly PlannedPage[], base: SiteBase): string | null {
  if (base.siteUrl === null) return null;

  const entries = pages
    .map((page) => absoluteUrlOf(base, page.href))
    .filter((url): url is string => url !== null)
    .map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`)
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    `${entries}\n` +
    '</urlset>\n'
  );
}

/**
 * `llms.txt`: what this reference is and where each page of it lives.
 *
 * @param document - The normalized document
 * @param pages - The planned pages
 * @param base - The build's base, for absolute links when there is an origin
 * @returns The file contents
 */
export function llmsTxt(
  document: IRDocument,
  pages: readonly PlannedPage[],
  base: SiteBase,
): string {
  const summary = plainSummary(document.info.description ?? '');
  const linkOf = (page: PlannedPage): string => absoluteUrlOf(base, page.href) ?? page.href;

  const operations = pages.filter((page) => page.kind === 'node');
  const schemas = pages.filter((page) => page.kind === 'schema');

  const lines = [
    `# ${document.info.title}`,
    '',
    `> ${summary === '' ? `API reference for ${document.info.title} ${document.info.version}.` : summary}`,
    '',
    `Version: ${document.info.version}`,
    '',
    '## Operations',
    '',
  ];

  for (const page of operations) {
    const node = page.nodeId === null ? undefined : document.nodes.get(page.nodeId);
    // THE TITLE COMES FROM THE ONE FUNCTION THE PAGE USES, so this file and the page it links
    // to cannot call the same operation two different things.
    const title = node === undefined ? (page.nodeId ?? '') : materializeNode(node, document).title;
    // THE NOTE IS DROPPED WHEN IT IS THE TITLE. `materializeNode` titles an operation by its
    // summary when it has one, so a note taken from the same summary printed the same words
    // twice on every line of the common case.
    const summary = plainSummary(node?.summary ?? '');
    const note = summary === title ? '' : summary;
    lines.push(`- [${title}](${linkOf(page)})${note === '' ? '' : `: ${note}`}`);
  }

  lines.push('', '## Schemas', '');

  for (const page of schemas) {
    const schema = page.schemaId === null ? undefined : document.schemas.get(page.schemaId);
    lines.push(`- [${schema?.name ?? page.schemaId ?? ''}](${linkOf(page)})`);
  }

  lines.push('');

  return lines.join('\n');
}

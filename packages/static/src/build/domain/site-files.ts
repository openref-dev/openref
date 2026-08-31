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

import { isInternalAudience, oneLine, plainArtefactText, type IRDocument } from '@openref/core';
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
 * IT TAKES THE SAME AUDIENCE THE MOUNTED FILE TAKES, per the SPEC 16.1 ruling of `T062`. A node
 * marked `x-openref-audience: internal` is not listed here, exactly as it is not listed in the file
 * SPEC 18.1 serves. The two generators are separate by construction, one building from a page plan
 * and the other from the IR, and that is not the divergence: what one document is said to hold is.
 * A machine crawlable file has one text for every reader, so it takes the conservative audience;
 * the operation's own page is written as before, which SPEC 18.1 records as the price.
 *
 * AND A DOCUMENT VALUE CREATES NO LINE AND NO LINK HERE EITHER. `oneLine` is `@openref/core`'s,
 * the same function the mounted file calls, and it is applied to every value the document wrote
 * that reaches a line of this file. `T059` measured and closed this on the agent side and left it
 * open here; the measurement is the same one, a title carrying `\nInjected line\n## Operations` and
 * `- [Ghost](ghost)`, and it produced headings this generator never writes and an anchor at an
 * address this build never wrote.
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
  const title = oneLine(document.info.title);
  const version = oneLine(document.info.version);

  const nodeOf = (page: PlannedPage): ReturnType<IRDocument['nodes']['get']> =>
    page.nodeId === null ? undefined : document.nodes.get(page.nodeId);

  const operations = pages.filter((page) => {
    if (page.kind !== 'node') return false;

    const node = nodeOf(page);

    return node === undefined || !isInternalAudience(node);
  });
  const schemas = pages.filter((page) => page.kind === 'schema');

  const lines = [
    `# ${title}`,
    '',
    `> ${summary === '' ? `API reference for ${title} ${version}.` : summary}`,
    '',
    `Version: ${version}`,
    '',
    '## Operations',
    '',
  ];

  for (const page of operations) {
    const node = nodeOf(page);
    // THE TITLE COMES FROM THE ONE FUNCTION THE PAGE USES, so this file and the page it links
    // to cannot call the same operation two different things.
    const heading = oneLine(
      node === undefined ? (page.nodeId ?? '') : materializeNode(node, document).title,
    );
    // THE NOTE IS DROPPED WHEN IT IS THE TITLE. `materializeNode` titles an operation by its
    // summary when it has one, so a note taken from the same summary printed the same words
    // twice on every line of the common case.
    const summary = oneLine(plainSummary(node?.summary ?? ''));
    const note = summary === heading ? '' : summary;
    lines.push(`- [${heading}](${linkOf(page)})${note === '' ? '' : `: ${note}`}`);
  }

  lines.push('', '## Schemas', '');

  for (const page of schemas) {
    const schema = page.schemaId === null ? undefined : document.schemas.get(page.schemaId);
    lines.push(`- [${oneLine(schema?.name ?? page.schemaId ?? '')}](${linkOf(page)})`);
  }

  lines.push('');

  // ONE CALL AT THE ARTEFACT BOUNDARY, per SPEC 19.1 as extended by `T043`. `T043` measured NUL,
  // C0 controls, ESC and U+202E reaching this file out of a specification's own strings. It has no
  // element to isolate on and no syntax to escape into, so it gets the property by removal.
  return plainArtefactText(lines.join('\n'));
}

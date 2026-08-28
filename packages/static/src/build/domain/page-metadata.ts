/**
 * What one page says about itself to something that is not a browser.
 *
 * SPEC 16.1 asks for canonical links, OG tags and JSON-LD. All three describe the same page and
 * are built here from one model, so the title a crawler reads, the title a share card shows and
 * the name in the structured data cannot drift apart.
 *
 * THE DESCRIPTION IS PLAIN TEXT AND IS DERIVED FROM THE DOCUMENT, NEVER FROM THE MARKUP. A
 * description built by stripping tags out of rendered HTML is a second, worse parser of the
 * markdown that was already parsed once, and it would carry whatever the sanitizer let through.
 * The IR's own summary and description are what the page was drawn from.
 *
 * NOTHING HERE INVENTS A FACT. A page with no description in the document gets the document's,
 * and a document with none gets a sentence naming what the page is, which is a description of
 * the page rather than a claim about the API.
 */

import type { IRDocument, IRNode } from '@openref/core';
import type { PageKind, ShellHead } from '@openref/render';
import { absoluteUrlOf, type SiteBase } from './site-base';

/** How long a description may be before it is cut at a word boundary. */
const DESCRIPTION_LIMIT = 300;

/** One page, as far as its metadata is concerned. */
export interface PageSubject {
  readonly kind: PageKind;
  readonly nodeId: string | null;
  readonly schemaId: string | null;
  readonly href: string;
  /** Title of the rendered page, which the shell already wrote into `<title>`. */
  readonly title: string;
}

/**
 * Plain text of a markdown description, cut to a length a card will show.
 *
 * A cheap reduction rather than a parser: the fenced blocks, the inline markers and the link
 * syntax that would otherwise read as punctuation in a card. Anything it does not know it
 * leaves alone, which is the honest failure for text nobody will render as markup.
 *
 * @param markdown - Description as the document wrote it
 * @returns One line of plain text, possibly empty
 */
export function plainSummary(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= DESCRIPTION_LIMIT) return text;

  const cut = text.slice(0, DESCRIPTION_LIMIT);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace === -1 ? cut : cut.slice(0, lastSpace)).trimEnd()}...`;
}

/** The description of one page: the node's, else the document's, else what the page is. */
function descriptionOf(document: IRDocument, subject: PageSubject, node: IRNode | null): string {
  const own = plainSummary(node?.summary ?? node?.description ?? '');
  if (own !== '') return own;

  const documentDescription = plainSummary(document.info.description ?? '');
  if (documentDescription !== '') return documentDescription;

  return `${subject.title}, part of the ${document.info.title} API reference.`;
}

/**
 * The JSON-LD of one page.
 *
 * `TechArticle` FOR EVERY PAGE, WITH `WebSite` ONLY ON THE OVERVIEW. Schema.org has no type for
 * an API operation, and the vocabulary's own `WebAPI` describes an API rather than a page about
 * one; claiming a richer type than the data supports is the same defect as claiming a runtime
 * fact nobody collected. What is stated is what is known: this is a documentation page, it is
 * part of this reference, and it is called this.
 *
 * @param document - The normalized document
 * @param subject - The page
 * @param description - The description already derived for the head
 * @param url - Absolute url, or null when there is no origin
 * @returns The serialized JSON-LD
 */
function jsonLdOf(
  document: IRDocument,
  subject: PageSubject,
  description: string,
  url: string | null,
): string {
  const base = {
    '@context': 'https://schema.org',
    '@type': subject.kind === 'overview' ? 'WebSite' : 'TechArticle',
    name: subject.title,
    description,
    ...(url === null ? {} : { url }),
    isPartOf: {
      '@type': 'WebSite',
      name: document.info.title,
      ...(document.info.version === '' ? {} : { version: document.info.version }),
    },
  };

  // Serialized as constructed rather than canonicalized, per SPEC 12's rule for a payload: the
  // key order here is the order a reader of the file would want, and two runs over one document
  // insert the same keys in the same order, which is where the determinism comes from.
  return JSON.stringify(base);
}

/**
 * The head of one page.
 *
 * @param document - The normalized document
 * @param subject - The page
 * @param base - The build's base, which decides whether an absolute url exists
 * @returns What the shell writes into the head
 */
export function headOf(document: IRDocument, subject: PageSubject, base: SiteBase): ShellHead {
  const node = subject.nodeId === null ? null : (document.nodes.get(subject.nodeId) ?? null);
  const description = descriptionOf(document, subject, node);
  const url = absoluteUrlOf(base, subject.href);

  const openGraph: { property: string; content: string }[] = [
    { property: 'og:type', content: subject.kind === 'overview' ? 'website' : 'article' },
    { property: 'og:title', content: subject.title },
    { property: 'og:description', content: description },
    { property: 'og:site_name', content: document.info.title },
  ];
  if (url !== null) openGraph.push({ property: 'og:url', content: url });

  return {
    ...(url === null ? {} : { canonicalUrl: url }),
    description,
    openGraph,
    jsonLd: jsonLdOf(document, subject, description, url),
  };
}

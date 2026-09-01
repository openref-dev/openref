import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { referenceRoutes, type ReferenceRouteId } from '@openref/nest';

/**
 * The documentation site, as a document the product renders.
 *
 * THERE IS NO SECOND RENDERER, AND THAT IS THE WHOLE DESIGN. `openref build` takes the object
 * this module composes and writes the site with the same code path a reader's own reference
 * uses: the same page model, the same markdown renderer, the same asset catalog, the same
 * strict policy. A documentation site for this product built with somebody else's static site
 * generator would be a page that says "no external requests" while asking a CDN for a font.
 *
 * WHAT THE PRODUCT CANNOT DO IS NAMED RATHER THAN WORKED AROUND. It renders operations,
 * channels and schemas, each with its own address, and it has no page kind for prose. So the
 * guide is the document's description, on the overview page, and the reference beside it is the
 * route table `OpenRefModule.setup` really registers. Adding a ninth page kind for a paragraph
 * would have been a change to a frozen contract made for the convenience of this file.
 *
 * THE ROUTE TABLE IS THE PRODUCT'S OWN, IMPORTED, AND THERE IS NO COPY OF IT HERE. It briefly
 * was a copy, on the ground that importing `@openref/nest` moved the peer resolution of
 * `@nestjs/common` for an unrelated example package. That measurement was taken before this
 * slice's four example applications existed, and it was attributing to this import a shift any
 * package depending on `@nestjs/common` causes. Re-measured with everything else held constant,
 * the dependency's whole cost in the lockfile is its own three line importer entry and no peer
 * moves at all. A duplicate kept for a reason that no longer holds is a second home for one
 * definition, so the copy is gone and the addresses come from `referenceRoutes`, the function
 * the module mounts with.
 *
 * WHAT IS STILL WRITTEN BY HAND IS THE PROSE, one entry per route id, and `route-table.spec.ts`
 * reconciles the two in both directions: a route the product gains with no prose fails, and
 * prose naming a route that no longer exists fails too. The key type below is
 * `ReferenceRouteId`, so the first direction also fails to compile.
 */

/** Where this file lives, so the repository root is derived rather than assumed. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Repository root.
 *
 * `src` and `dist` are both one directory under the package, so the same arithmetic answers
 * whether this module was loaded as TypeScript by vitest or as the built JavaScript by
 * `pnpm docs:build`.
 */
export const REPOSITORY_ROOT = resolve(HERE, '..', '..', '..');

/** The guide's chapters, in filename order. */
export const GUIDE_DIRECTORY = join(REPOSITORY_ROOT, 'docs', 'guide');

/** Mount point the documented route table is built for. */
export const DOCUMENTED_ROUTE = '/docs';

/** Every route id the module registers, as the module itself declares them. */
export type DocumentedRouteId = ReferenceRouteId;

/** One chapter of the guide. */
export interface GuideChapter {
  /** File name, which is also the ordering key. */
  readonly file: string;
  /** Its markdown, verbatim. */
  readonly markdown: string;
}

/** What one route of the reference is for, in a reader's words. */
export interface RouteProse {
  /** One line, which becomes the operation's summary and its navigation entry. */
  readonly summary: string;
  /** The paragraph under it. */
  readonly description: string;
  /** Navigation group. */
  readonly tag: string;
}

/** The navigation groups, in the order a reader meets them. */
export const ROUTE_GROUPS: readonly string[] = [
  'Pages a reader opens',
  'The specification itself',
  'Assets and search',
  'Sending a request',
  'Operating the mount',
  'Agents',
];

/**
 * Every route the module mounts, in a reader's words.
 *
 * THE KEY TYPE IS `ReferenceRouteId` AND THAT IS THE POINT: a route added to the product
 * without an entry here does not compile. The both-directions test then covers the other half,
 * which the type cannot see, namely an entry whose route has been removed.
 */
export const ROUTE_PROSE: Readonly<Record<DocumentedRouteId, RouteProse>> = {
  overview: {
    summary: 'The reference itself',
    description:
      'The landing page: the document description, the navigation, and the search. Server ' +
      'rendered, so it is readable with JavaScript switched off, and cached by document hash.',
    tag: 'Pages a reader opens',
  },
  node: {
    summary: 'One operation or one channel',
    description:
      'Everything about one endpoint: its parameters, its request body, its responses, and the ' +
      'runtime facts a collector read off the running application, each with the level it was ' +
      'read at and the name of the collector that produced it.',
    tag: 'Pages a reader opens',
  },
  schema: {
    summary: 'One named schema',
    description:
      'A named schema on its own address, so a type can be linked to. A reference to another ' +
      'named schema stays a reference rather than being expanded in place, which is what lets ' +
      'a self referential type render at all.',
    tag: 'Pages a reader opens',
  },
  bench: {
    summary: 'The request console for one operation',
    description:
      'Fill the parameters, press Send, read the response. The request goes through the same ' +
      'origin proxy rather than from the page to an arbitrary host, and the console and its ' +
      'runner arrive only when the region is reached for.',
    tag: 'Pages a reader opens',
  },
  health: {
    summary: 'The Documentation Health report',
    description:
      'What the specification and the application disagree about, as a page: every finding with ' +
      'its rule code, the endpoint it is about, and the change that closes it.',
    tag: 'Pages a reader opens',
  },
  shapes: {
    summary: 'The shapes of one schema',
    description:
      'Which combination of fields a schema actually admits, drawn branch by branch, for a ' +
      'schema whose conditions and unions make that hard to read from the keywords alone.',
    tag: 'Pages a reader opens',
  },
  states: {
    summary: 'Every state the interface can be in',
    description:
      'The empty, loading, refused and failed states of every region, on one page, so a theme ' +
      'author can style them without having to reproduce each one.',
    tag: 'Pages a reader opens',
  },
  service: {
    summary: 'One federated service',
    description:
      'The card for one service of a federation: what it brought to the merged document, what ' +
      'was renamed on the way in, and whether its specification is fresh, stale or failed. On a ' +
      'mount that is not a federation this answers by saying so, and names that fact rather ' +
      'than saying no such service.',
    tag: 'Pages a reader opens',
  },
  'openapi-json': {
    summary: 'The OpenAPI document, as JSON',
    description:
      'The specification the reference was built from, with canonical key order, so two builds ' +
      'of one document produce the same bytes. This is the file an SDK generator downloads.',
    tag: 'The specification itself',
  },
  'openapi-yaml': {
    summary: 'The OpenAPI document, as YAML',
    description: 'The same document, in the other serialization.',
    tag: 'The specification itself',
  },
  'asyncapi-json': {
    summary: 'The AsyncAPI document, as JSON',
    description:
      'The events document of a mount whose kind is events. On an HTTP mount this answers by ' +
      'saying that this reference describes HTTP and naming where its own source is, because a ' +
      'file whose name says one specification and whose bytes say another breaks every ' +
      'generator downstream.',
    tag: 'The specification itself',
  },
  'asyncapi-yaml': {
    summary: 'The AsyncAPI document, as YAML',
    description: 'The same events document, in the other serialization.',
    tag: 'The specification itself',
  },
  asset: {
    summary: 'The client bundle, the theme and its fonts',
    description:
      'Every asset the page needs, served by this application under a name carrying the digest ' +
      'of its own bytes. Nothing is fetched from any other origin, which is why the name has to ' +
      'carry the digest: it is what makes an immutable cache safe.',
    tag: 'Assets and search',
  },
  'search-index': {
    summary: 'The serialized search index',
    description:
      'The index the command palette searches, built at render time and served as one file. It ' +
      'arrives when the palette is opened rather than on first paint.',
    tag: 'Assets and search',
  },
  navigation: {
    summary: 'The navigation payload for one document hash',
    description:
      'A page ships the branch of the navigation it is in and a count for every other, so ' +
      'opening a closed group fetches the rest from here. Addressed by document hash, so a ' +
      'stale payload cannot be served for a document that has moved on.',
    tag: 'Assets and search',
  },
  proxy: {
    summary: 'The same origin proxy the console sends through',
    description:
      'A request the console sends arrives here and is forwarded only to a host the document ' +
      'own servers declare. Fail closed: an address that does not resolve to an allowed host is ' +
      'refused, and the body ceiling is checked before the body is read.',
    tag: 'Sending a request',
  },
  'oauth-callback': {
    summary: 'The return address of an authorization server',
    description:
      'Where an OAuth flow started from the console comes back to. It exists so that signing in ' +
      'is possible under a policy with no unsafe-inline and no third party origin.',
    tag: 'Sending a request',
  },
  bridge: {
    summary: 'The broker bridge',
    description:
      'A server sent event stream carrying messages from a broker channel, rate limited and ' +
      'bounded in both entries and bytes. Off unless configured, and what it drops it says it ' +
      'dropped, in the stream itself.',
    tag: 'Sending a request',
  },
  status: {
    summary: 'Whether this mount is alive',
    description:
      'What is mounted here and what it was built from. A machine answer on an underscore ' +
      'segment, separate from the health page, because a page and a JSON body at one address ' +
      'would be two different answers to one request.',
    tag: 'Operating the mount',
  },
  federation: {
    summary: 'A live snapshot of the remote services',
    description:
      'The status of every remote of a federation, with no document attached and no caching, so ' +
      'the navigation can mark a degraded service from any page. On a mount that is not a ' +
      'federation it answers by saying exactly that.',
    tag: 'Operating the mount',
  },
  llms: {
    summary: 'The reference as text for a language model',
    description:
      'A short, structured, plain text index of the document. Operations marked as internal are ' +
      'withheld here by the same function that withholds them from the page, so the two cannot ' +
      'disagree.',
    tag: 'Agents',
  },
  'llms-full': {
    summary: 'The whole reference as text',
    description: 'The same, with every operation expanded rather than listed.',
    tag: 'Agents',
  },
  mcp: {
    summary: 'A read only JSON-RPC endpoint',
    description:
      'Six methods, all of them reads. Off by default, and switching it on without a guard is ' +
      'refused at boot rather than at the first request. A tool that only reads says so, and ' +
      'carries that as data rather than as a sentence a caller has to parse.',
    tag: 'Agents',
  },
};

/**
 * The chapters of the guide, in filename order.
 *
 * @returns Each file with its markdown
 */
export function guideChapters(): readonly GuideChapter[] {
  return readdirSync(GUIDE_DIRECTORY)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => ({ file, markdown: readFileSync(join(GUIDE_DIRECTORY, file), 'utf8') }));
}

/**
 * The whole guide as one markdown document.
 *
 * @returns The chapters joined, in order, with one blank line between them
 */
export function guideMarkdown(): string {
  return guideChapters()
    .map((chapter) => chapter.markdown.trimEnd())
    .join('\n\n');
}

/** One route of the documented table, with its OpenAPI shaped path. */
export interface DocumentedRoute {
  /** Which route this is. */
  readonly id: DocumentedRouteId;
  /** The suffix under the mount, in OpenAPI's brace dialect. Empty for the mount itself. */
  readonly suffix: string;
  /** The method it answers on. */
  readonly method: 'get' | 'post';
}

/**
 * The route table, derived from the routes the module registers.
 *
 * TWO NORMALIZATIONS AGAINST THE ROUTER'S OWN LIST, BOTH DELIBERATE AND BOTH LOSSLESS. The
 * overview answers at the mount and at the mount with a trailing slash, which is two
 * registrations in a router and one path item in OpenAPI; the trailing slash form is dropped.
 * The agent endpoint answers on POST and on GET, which OpenAPI already expresses as two
 * operations of one path item, so both stay.
 *
 * @param basePath - Mount point the table is built for
 * @returns Every route, deduplicated by path and method, in registration order
 */
export function documentedRoutes(basePath: string = DOCUMENTED_ROUTE): readonly DocumentedRoute[] {
  const seen = new Set<string>();
  const routes: DocumentedRoute[] = [];

  for (const route of referenceRoutes(basePath)) {
    const braced = route.pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}');
    const path = braced === `${basePath}/` ? basePath : braced;
    const key = `${route.method} ${path}`;
    if (seen.has(key)) continue;

    seen.add(key);
    routes.push({ id: route.id, suffix: path.slice(basePath.length), method: route.method });
  }

  return routes;
}

/** A JSON value, as a specification on disk holds it. */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Path parameters, named by the segment they came from. */
function parametersOf(path: string): JsonValue[] {
  return [...path.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map(([, name]) => ({
    name: name ?? '',
    in: 'path',
    required: true,
    description: 'Read from the address.',
    schema: { type: 'string' },
  }));
}

/**
 * The documentation site's own specification.
 *
 * @param basePath - Mount point the documented routes are built for
 * @returns An OpenAPI 3.1 document: the guide as its description, the route table as its paths
 */
export function documentationSpecification(basePath: string = DOCUMENTED_ROUTE): JsonValue {
  const paths: Record<string, JsonValue> = {};

  for (const route of documentedRoutes(basePath)) {
    const prose = ROUTE_PROSE[route.id];
    const path = `${basePath}${route.suffix}`;
    const existing = paths[path];
    const item: Record<string, JsonValue> =
      typeof existing === 'object' && existing !== null && !Array.isArray(existing)
        ? existing
        : { parameters: parametersOf(path) };

    item[route.method] = {
      operationId: `${route.id}-${route.method}`,
      summary: prose.summary,
      description: prose.description,
      tags: [prose.tag],
      responses: {
        '200': { description: 'The answer described above.' },
      },
    };

    paths[path] = item;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'OPENREF',
      version: '0.0.0',
      summary: 'An API reference engine for NestJS, for HTTP, events and runtime contracts.',
      description: guideMarkdown(),
      license: { name: 'MIT', identifier: 'MIT' },
    },
    tags: ROUTE_GROUPS.map((name) => ({ name })),
    paths,
  };
}

/**
 * Every fenced TypeScript block in one markdown text.
 *
 * THE FENCE LANGUAGES ARE NAMED RATHER THAN GUESSED, so a `bash` or a `yaml` block is never
 * handed to a TypeScript compiler and never counted as a passing example either.
 *
 * @param markdown - The text to read
 * @returns The body of each ```ts block, in document order
 */
export function typescriptExamplesIn(markdown: string): readonly string[] {
  return [...markdown.matchAll(/```ts\n([\s\S]*?)```/g)].map(([, body]) => body ?? '');
}

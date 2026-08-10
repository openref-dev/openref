/**
 * The static files a page loads, named by their contents.
 *
 * Every asset is served under a name carrying the digest of its bytes, so the response can
 * carry `immutable` and a year of freshness without any deployment ever serving a stale file:
 * a changed file is a changed name and a different URL. The alternative, a stable name with a
 * short cache, pays for every page view and still gets it wrong when a proxy holds a copy.
 *
 * A STYLESHEET THAT NAMES A FILE HAS ITS NAMES REWRITTEN, and that is why this is a catalog
 * rather than a lookup. `fonts.css` refers to the woff2 files beside it by relative url, and
 * those files are served under hashed names, so the stylesheet as written would point at
 * paths that answer 404. The rewrite happens before the stylesheet itself is hashed, so its
 * own name covers the names it refers to.
 *
 * A REFERENCE THAT RESOLVES TO NOTHING IS AN ERROR, never a passthrough. A font that stopped
 * being shipped would otherwise leave a url in the stylesheet that quietly fails at request
 * time, and a missing face looks like a design choice rather than a broken build.
 */

import { createHash } from 'node:crypto';
import { ErrorCode, InvalidOptionsError } from '@openref/core';

/** Number of hexadecimal characters of the digest that appear in a served name. */
export const DIGEST_LENGTH = 16;

/** A file offered to the catalog. */
export interface AssetSource {
  /** File name as it exists on disk, such as `theme.css`. */
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** A file as it is served. */
export interface CatalogAsset {
  /** Name on disk, which is what a stylesheet refers to it by. */
  readonly name: string;
  /** Name in the url, carrying the digest. */
  readonly servedName: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
}

/** Every asset, addressable both ways. */
export interface AssetCatalog {
  readonly assets: readonly CatalogAsset[];
  /** Served name to asset, which is what a request resolves through. */
  readonly byServedName: ReadonlyMap<string, CatalogAsset>;
  /** Disk name to asset, which is what the shell builds its links through. */
  readonly byName: ReadonlyMap<string, CatalogAsset>;
}

/** Content types of everything this package serves as a file. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * Content type for a file name.
 *
 * An unknown extension is refused rather than served as `application/octet-stream`. This
 * catalog holds files this project chose to ship, so an unrecognised one is a mistake in the
 * asset list and not input from anywhere.
 *
 * @param name - File name
 * @returns The content type header value
 * @throws {InvalidOptionsError} When the extension is not one this package serves
 */
export function contentTypeFor(name: string): string {
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot).toLowerCase();
  const contentType = CONTENT_TYPES[extension];

  if (contentType === undefined) {
    throw new InvalidOptionsError(
      `no content type is declared for the asset "${name}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { name, extension },
    );
  }

  return contentType;
}

/**
 * Digest of one file, as it appears in a served name.
 *
 * @param bytes - File contents
 * @returns The leading {@link DIGEST_LENGTH} hexadecimal characters of its SHA-256
 */
export function digestOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, DIGEST_LENGTH);
}

/**
 * Name a file is served under.
 *
 * The digest goes before the extension rather than after the whole name, so the extension
 * still ends the name and every content type sniffer, proxy and browser sees what it expects.
 *
 * @param name - File name on disk
 * @param digest - Digest of its contents
 * @returns The served name
 */
export function hashedName(name: string, digest: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}.${digest}`;

  return `${name.slice(0, dot)}.${digest}${name.slice(dot)}`;
}

/** A relative url written inside a stylesheet, with the quoting it was written with. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Whether a url inside a stylesheet points at a file beside it.
 *
 * Anything absolute, protocol relative, `data:` or fragment only is left exactly as written.
 * Rewriting one would mean this catalog claiming to own a file it does not serve.
 *
 * @param reference - The url as written
 * @returns True when it names a sibling file
 */
function isSiblingReference(reference: string): boolean {
  if (reference.startsWith('./')) return true;

  return (
    !reference.includes(':') &&
    !reference.startsWith('/') &&
    !reference.startsWith('#') &&
    !reference.startsWith('..')
  );
}

/**
 * Rewrites relative `url()` references to the names the files are served under.
 *
 * @param css - Stylesheet source
 * @param servedNameOf - Served name for a sibling file name, or undefined when unknown
 * @returns The stylesheet with sibling references renamed
 * @throws {InvalidOptionsError} When a sibling reference names a file the catalog lacks
 */
export function rewriteCssUrls(
  css: string,
  servedNameOf: (name: string) => string | undefined,
): string {
  return css.replace(CSS_URL, (whole, quote: string, reference: string) => {
    if (!isSiblingReference(reference)) return whole;

    const name = reference.startsWith('./') ? reference.slice(2) : reference;
    const served = servedNameOf(name);

    if (served === undefined) {
      throw new InvalidOptionsError(
        `the stylesheet refers to "${reference}", which is not among the assets being served`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { reference },
      );
    }

    return `url(${quote}./${served}${quote})`;
  });
}

/** Whether a source is a stylesheet, and so may name other assets. */
function isStylesheet(name: string): boolean {
  return name.toLowerCase().endsWith('.css');
}

/** Whether a source is a script, and so may name chunks beside it. */
function isScript(name: string): boolean {
  return name.toLowerCase().endsWith('.js');
}

/**
 * A relative specifier written inside a module, static or dynamic.
 *
 * IT MATCHES THE STRING AND NOT THE SYNTAX AROUND IT, deliberately. A minified bundle writes
 * `from'./chunk-A.js'`, `import"./chunk-A.js"` and `import("./chunk-A.js")`, and a fourth form
 * arrives with every bundler release. What every form has in common is a quoted sibling path
 * ending in `.js`, and a quoted string of that shape that is not a specifier is a file this
 * catalog does not serve, which fails below rather than being rewritten to something wrong.
 */
const JS_SPECIFIER = /(['"])\.\/([A-Za-z0-9_.-]+\.js)\1/g;

/**
 * Rewrites sibling chunk specifiers to the names the chunks are served under.
 *
 * WITHOUT THIS THE SPLIT SHIPS A 404. Assets are served under a name carrying the digest of
 * their bytes, so `import("./chunk-A.js")` inside the entry points at a name nothing answers,
 * and a deferred feature would fail at the moment a reader reached for it. That failure is also
 * the quietest one available: the page is already rendered, so nothing looks wrong until the
 * click does nothing.
 *
 * @param source - Module source
 * @param servedNameOf - Served name for a sibling file name, or undefined when unknown
 * @returns The module with sibling specifiers renamed
 * @throws {InvalidOptionsError} When a specifier names a file the catalog lacks
 */
export function rewriteJsSpecifiers(
  source: string,
  servedNameOf: (name: string) => string | undefined,
): string {
  return source.replace(JS_SPECIFIER, (_whole, quote: string, name: string) => {
    const served = servedNameOf(name);

    if (served === undefined) {
      throw new InvalidOptionsError(
        `the module refers to "./${name}", which is not among the assets being served. A chunk ` +
          'that is not served is a feature that fails when a reader reaches for it',
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { reference: name },
      );
    }

    return `${quote}./${served}${quote}`;
  });
}

/**
 * The sibling assets one source refers to, by disk name.
 *
 * @param name - Disk name of the source
 * @param bytes - Its contents
 * @param decoder - Shared decoder
 * @returns Disk names it refers to, which have to be hashed before it is
 */
function referencesOf(
  name: string,
  bytes: Uint8Array,
  // `InstanceType<typeof TextDecoder>` RATHER THAN `TextDecoder`, and it is not a style choice.
  // Under `lib.dom` the name is an interface as well as a value; under `@types/node` alone it is
  // a `var` and nothing else, so writing the bare name typechecks in the two programs that carry
  // DOM and fails in the root one. Reading the instance type off the ambient value is the form
  // that means the same thing in all three.
  decoder: InstanceType<typeof TextDecoder>,
): readonly string[] {
  if (isStylesheet(name)) {
    const text = decoder.decode(bytes);
    const names: string[] = [];

    for (const match of text.matchAll(CSS_URL)) {
      const reference = match[2] ?? '';
      if (!isSiblingReference(reference)) continue;
      names.push(reference.startsWith('./') ? reference.slice(2) : reference);
    }

    return names;
  }

  if (!isScript(name)) return [];

  return [...decoder.decode(bytes).matchAll(JS_SPECIFIER)].map((match) => match[2] ?? '');
}

/**
 * Builds the catalog.
 *
 * Two passes, and the order is what makes the digests honest. Everything that cannot refer to
 * another asset is hashed first; stylesheets are rewritten against those names and hashed
 * afterwards, so a stylesheet's own digest covers the names it points at. One pass would give
 * a stylesheet a digest computed over text it does not serve.
 *
 * @param sources - Files to serve
 * @returns The catalog, addressable by disk name and by served name
 * @throws {InvalidOptionsError} On a duplicate name, an unknown extension, or a url that
 *         names a file the catalog does not hold
 */
export function buildAssetCatalog(sources: readonly AssetSource[]): AssetCatalog {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.name)) {
      throw new InvalidOptionsError(
        `the asset "${source.name}" is offered twice, so one copy would be unreachable`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { name: source.name },
      );
    }
    seen.add(source.name);
  }

  const assets: CatalogAsset[] = [];
  const byName = new Map<string, CatalogAsset>();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const add = (name: string, bytes: Uint8Array): void => {
    const asset: CatalogAsset = {
      name,
      servedName: hashedName(name, digestOf(bytes)),
      contentType: contentTypeFor(name),
      bytes,
    };
    assets.push(asset);
    byName.set(name, asset);
  };

  const servedNameOf = (name: string): string | undefined => byName.get(name)?.servedName;

  // A file is hashed only once everything it names has been, so its own digest covers the names
  // it points at. Two fixed passes were enough while only a stylesheet could name anything;
  // since T011-R a chunk names other chunks, and the depth of that graph is the bundler's
  // business rather than a number this file may assume.
  let pending = [...sources];
  while (pending.length > 0) {
    const ready = pending.filter((source) =>
      referencesOf(source.name, source.bytes, decoder).every(
        (reference) => servedNameOf(reference) !== undefined,
      ),
    );

    if (ready.length === 0) {
      throw new InvalidOptionsError(
        `these assets refer to each other in a cycle, so none of them can be named after its ` +
          `contents: ${pending.map((source) => source.name).join(', ')}`,
        ErrorCode.CONFIG_INVALID_OPTIONS,
        undefined,
        { names: pending.map((source) => source.name) },
      );
    }

    for (const source of ready) {
      if (isStylesheet(source.name)) {
        add(
          source.name,
          encoder.encode(rewriteCssUrls(decoder.decode(source.bytes), servedNameOf)),
        );
      } else if (isScript(source.name)) {
        add(
          source.name,
          encoder.encode(rewriteJsSpecifiers(decoder.decode(source.bytes), servedNameOf)),
        );
      } else {
        add(source.name, source.bytes);
      }
    }

    pending = pending.filter((source) => !ready.includes(source));
  }

  const byServedName = new Map(assets.map((asset) => [asset.servedName, asset]));

  return { assets, byServedName, byName };
}

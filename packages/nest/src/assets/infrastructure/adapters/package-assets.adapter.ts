/**
 * Where the files a page loads actually live.
 *
 * THE DEFAULT THEME IS RESOLVED AS FILES, NOT IMPORTED AS CODE, and the distinction is the
 * whole reason this file can exist. STANDARDS 3.5 gives `nest` no edge to `theme`, and the
 * rule is about code: a renderer that imported one theme's module would be coupled to that
 * theme's API and could never serve another. Reading `@openref/theme/theme.css` off disk
 * couples nothing, which is why the stylesheet list is an option with a default rather than
 * an import. A host that ships its own theme passes its own files and this module never
 * learns that the default one exists.
 *
 * `@openref/theme` is a runtime dependency of this package all the same, because SPEC 2 says
 * one install and one line, and a reference that renders unstyled until the reader finds a
 * second package to install has not kept that promise.
 *
 * THE CLIENT BUNDLE IS RESOLVED THROUGH THIS PACKAGE'S OWN EXPORTS MAP rather than by a path
 * relative to this file. The path from source to `dist/browser` and the path from the bundled
 * `dist/index.js` to it are different, so a relative path would be correct in exactly one of
 * the two layouts and nothing would say which.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { AssetSource } from '../../domain/asset-catalog';

/** Resolver used to find a file inside an installed package. */
const requireFrom = createRequire(import.meta.url);

/** Files of the default theme a page loads, in the order they must be linked. */
export const DEFAULT_THEME_STYLESHEETS: readonly string[] = [
  '@openref/theme/fonts.css',
  '@openref/theme/tokens.css',
  '@openref/theme/theme.css',
];

/** Specifier of the client bundle this package composes. */
export const CLIENT_BUNDLE_SPECIFIER = '@openref/nest/browser';

/** A relative url written inside a stylesheet. */
const CSS_URL = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;

/**
 * Reads one file, naming the specifier when it is missing.
 *
 * @param path - Absolute path
 * @param specifier - What was asked for, for the message
 * @returns The bytes
 * @throws {InvalidOptionsError} When the file cannot be read
 */
function readAsset(path: string, specifier: string): Uint8Array {
  try {
    return new Uint8Array(readFileSync(path));
  } catch (cause) {
    throw new InvalidOptionsError(
      `the asset "${specifier}" could not be read from ${path}`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      cause instanceof Error ? cause : undefined,
      { path, specifier },
    );
  }
}

/**
 * Resolves a package relative specifier to a path.
 *
 * @param specifier - Package specifier, such as `@openref/theme/theme.css`
 * @returns Absolute path
 * @throws {InvalidOptionsError} When the package or its export is not installed
 */
export function resolveAssetPath(specifier: string): string {
  try {
    return requireFrom.resolve(specifier);
  } catch (cause) {
    throw new InvalidOptionsError(
      `"${specifier}" could not be resolved; is the package installed?`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      cause instanceof Error ? cause : undefined,
      { specifier },
    );
  }
}

/**
 * Names of the sibling files a stylesheet points at.
 *
 * The stylesheet is the list. Reading the font manifest instead would let the two disagree,
 * and the disagreement that matters is a face that is declared and not shipped, which is
 * invisible until a reader meets a character in that range.
 *
 * @param css - Stylesheet source
 * @returns Sibling file names, each once, in the order they appear
 */
export function siblingReferences(css: string): readonly string[] {
  const names: string[] = [];

  for (const match of css.matchAll(CSS_URL)) {
    const reference = match[2] ?? '';
    if (reference === '' || reference.includes(':') || reference.startsWith('/')) continue;
    if (reference.startsWith('#') || reference.startsWith('..')) continue;

    const name = reference.startsWith('./') ? reference.slice(2) : reference;
    if (!names.includes(name)) names.push(name);
  }

  return names;
}

/** A relative specifier written inside a module, static or dynamic. See the catalog for why. */
const JS_SPECIFIER = /(['"])\.\/([A-Za-z0-9_.-]+\.js)\1/g;

/**
 * Names of the chunks a module points at.
 *
 * THE BUNDLE IS THE LIST, for the reason the stylesheet is: a directory listing would pick up
 * whatever a previous build left behind, and a hand written list would go stale on the first
 * change to the split. What is served is what the shipped bytes ask for.
 *
 * @param source - Module source
 * @returns Sibling chunk names, each once, in the order they appear
 */
export function chunkReferences(source: string): readonly string[] {
  const names: string[] = [];

  for (const match of source.matchAll(JS_SPECIFIER)) {
    const name = match[2] ?? '';
    if (name !== '' && !names.includes(name)) names.push(name);
  }

  return names;
}

/** How the default asset set is assembled. */
export interface DefaultAssetOptions {
  /** Stylesheets to serve, as package specifiers or absolute paths. */
  readonly stylesheets?: readonly string[];
  /** Client bundle, as a package specifier or an absolute path. */
  readonly clientBundle?: string;
}

/** The assets to serve, and which of them the shell links. */
export interface AssetPlan {
  readonly sources: readonly AssetSource[];
  /** Disk names of the stylesheets, in link order. */
  readonly stylesheetNames: readonly string[];
  /** Disk name of the client bundle. */
  readonly moduleName: string;
}

/**
 * Reads every file a page loads, plus everything those files refer to.
 *
 * @param options - Overrides for the stylesheet list and the client bundle
 * @returns The files, and which of them the shell links
 * @throws {InvalidOptionsError} When a file cannot be resolved or read
 */
export function loadDefaultAssets(options: DefaultAssetOptions = {}): AssetPlan {
  const stylesheets = options.stylesheets ?? DEFAULT_THEME_STYLESHEETS;
  const bundleSpecifier = options.clientBundle ?? CLIENT_BUNDLE_SPECIFIER;

  const sources: AssetSource[] = [];
  const stylesheetNames: string[] = [];
  const decoder = new TextDecoder();

  const bundlePath = bundleSpecifier.startsWith('/')
    ? bundleSpecifier
    : resolveAssetPath(bundleSpecifier);
  const moduleName = basenameOf(bundlePath);
  const bundleBytes = readAsset(bundlePath, bundleSpecifier);
  sources.push({ name: moduleName, bytes: bundleBytes });

  // TRANSITIVELY, because a chunk imports other chunks. A queue rather than one pass over the
  // entry: the runner arrives through the console's chunk and would be missed by a pass that
  // only read the file the shell links, and a missing chunk is a feature that 404s at the
  // moment a reader reaches for it rather than a build that fails.
  const bundleDirectory = dirname(bundlePath);
  const queue = [...chunkReferences(decoder.decode(bundleBytes))];
  while (queue.length > 0) {
    const name = queue.shift() ?? '';
    if (sources.some((source) => source.name === name)) continue;

    const bytes = readAsset(join(bundleDirectory, name), name);
    sources.push({ name, bytes });
    queue.push(...chunkReferences(decoder.decode(bytes)));
  }

  for (const specifier of stylesheets) {
    const path = specifier.startsWith('/') ? specifier : resolveAssetPath(specifier);
    const bytes = readAsset(path, specifier);
    const name = basenameOf(path);

    sources.push({ name, bytes });
    stylesheetNames.push(name);

    for (const sibling of siblingReferences(decoder.decode(bytes))) {
      if (sources.some((source) => source.name === sibling)) continue;

      const siblingPath = join(dirname(path), sibling);
      sources.push({ name: sibling, bytes: readAsset(siblingPath, sibling) });
    }
  }

  return { sources, stylesheetNames, moduleName };
}

/**
 * Last segment of a path, on either separator.
 *
 * @param path - Absolute path
 * @returns The file name
 */
function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

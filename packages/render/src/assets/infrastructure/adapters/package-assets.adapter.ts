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
 * THE CLIENT BUNDLE IS RESOLVED THROUGH AN EXPORTS MAP rather than by a path relative to this
 * file. The path from source to `dist/browser` and the path from the bundled `dist/index.js` to
 * it are different, so a relative path would be correct in exactly one of the two layouts and
 * nothing would say which.
 *
 * IT LIVES IN `@openref/render` SINCE T039, AND THE SPECIFIER IT DEFAULTS TO IS A STRING RATHER
 * THAN AN EDGE. `@openref/nest` and `@openref/static` both need exactly this resolution, and
 * neither may import the other, so one copy had to sit where both can see it. What that costs
 * is the appearance of this package naming a package downstream of it; what it does not cost is
 * a dependency, because `@openref/nest/browser` is resolved from a string at runtime, by
 * whichever anchor has it installed, the same move `nest-surface.ts` makes for the same reason.
 * A caller that names its own bundle never reaches the default at all.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { InvalidOptionsError } from '@openref/core';
import { chunkReferences, siblingReferences, type AssetSource } from '../../domain/asset-catalog';

/** Resolver used to find a file inside an installed package. */
const requireFrom = createRequire(import.meta.url);

/**
 * The same resolver, anchored at the host application instead of at this package.
 *
 * TWO ANCHORS BECAUSE THE SPECIFIERS COME FROM TWO PLACES. The defaults this package names,
 * `@openref/theme`'s files and its own client bundle, are its own dependencies and resolve
 * from here. What a host names, its `stylesheets` list and since T033 its `theme.bundle`, is
 * the HOST's dependency: under an isolating package layout it is not reachable from this
 * package's anchor at all, which the theme selection browser case found on its first boot.
 * The working directory is the conventional anchor for what the process's own application
 * installed.
 */
const requireFromHost = createRequire(join(process.cwd(), 'package.json'));

/** Files of the default theme a page loads, in the order they must be linked. */
export const DEFAULT_THEME_STYLESHEETS: readonly string[] = [
  '@openref/theme/fonts.css',
  '@openref/theme/tokens.css',
  '@openref/theme/theme.css',
];

/** Specifier of the client bundle this package composes. */
export const CLIENT_BUNDLE_SPECIFIER = '@openref/nest/browser';

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
      'CONFIG_INVALID_OPTIONS',
      cause instanceof Error ? cause : undefined,
      { path, specifier },
    );
  }
}

/**
 * Resolves a package relative specifier to a path.
 *
 * A THIRD ANCHOR SINCE T039, AND IT IS THE CALLER'S. `@openref/nest/browser` is the default
 * client bundle and it is not a dependency of this package, deliberately: the specifier here is
 * a string rather than an edge. So the package that DOES depend on it, `@openref/nest` itself
 * or the `openref` CLI, passes its own module url and the resolution happens from there. Tried
 * first, because a caller that named an anchor named it for a reason.
 *
 * @param specifier - Package specifier, such as `@openref/theme/theme.css`
 * @param resolveFrom - A module url or file path to resolve from first
 * @returns Absolute path
 * @throws {InvalidOptionsError} When the package or its export is not installed
 */
export function resolveAssetPath(specifier: string, resolveFrom?: string): string {
  const anchors = [
    ...(resolveFrom === undefined ? [] : [createRequire(resolveFrom)]),
    requireFrom,
    requireFromHost,
  ];

  let last: unknown;
  for (const anchor of anchors) {
    try {
      return anchor.resolve(specifier);
    } catch (cause) {
      last = cause;
    }
  }

  throw new InvalidOptionsError(
    `"${specifier}" could not be resolved from the caller, from this package or from the application; is the package installed?`,
    'CONFIG_INVALID_OPTIONS',
    last instanceof Error ? last : undefined,
    { specifier },
  );
}

/** How the default asset set is assembled. */
export interface DefaultAssetOptions {
  /** Stylesheets to serve, as package specifiers or absolute paths. */
  readonly stylesheets?: readonly string[];
  /** Client bundle, as a package specifier or an absolute path. */
  readonly clientBundle?: string;
  /**
   * A module url or file path every specifier is resolved from first.
   *
   * A caller outside this package's own dependency closure passes its own `import.meta.url`
   * here, which is how the `openref` CLI reaches `@openref/nest/browser`. See
   * {@link resolveAssetPath}.
   */
  readonly resolveFrom?: string;
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
    : resolveAssetPath(bundleSpecifier, options.resolveFrom);
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
    const path = specifier.startsWith('/')
      ? specifier
      : resolveAssetPath(specifier, options.resolveFrom);
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

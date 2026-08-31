/**
 * What a host may say in `nuxt.config`, and what each answer costs.
 *
 * FAIL CLOSED AT CONFIGURATION TIME, which for a build time module means the build stops with a
 * sentence rather than the deployment serving something nobody asked for. Every refusal below is
 * a fact about the deployment that cannot be recovered from later: an unmounted base collides
 * with the application's own pages, and a target nobody named would publish a standing gateway.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import { BUILD_TARGETS, isBuildTarget, resolveSiteBase, type BuildTarget } from '@openref/static';

/** How the reference is mounted inside a Nuxt application. */
export interface OpenRefNuxtOptions {
  /**
   * The OpenAPI or AsyncAPI document, as a path relative to the Nuxt project root.
   *
   * A PATH RATHER THAN AN OBJECT, because the module reads it once at build time and embeds the
   * text it read into the server build. A document handed in as an object would have to be
   * serialized to reach the server anyway, and the file is what `openref build` takes, which is
   * what makes the two builds comparable at all.
   */
  readonly spec: string;
  /**
   * Where the reference is mounted: `/docs`, or an absolute url when the site has an origin.
   *
   * NEVER THE SITE ROOT, and the refusal is in `resolveNuxtOptions`. A Nuxt application prerenders
   * its own `index.html` at the root, and so does the reference's overview; two writers of one
   * file means one of them silently wins, which is the class of defect SPEC 16.1 already refuses
   * for two page addresses that fold to one file.
   */
  readonly base: string;
  /**
   * The proxy target of SPEC 16.2. Absent generates nothing at all, which is the security posture.
   *
   * `nitro` IS THE ONE TARGET THAT BECOMES A ROUTE RATHER THAN A FILE. Its artefact is server
   * source, and server source inside the published directory is readable by anyone who asks for
   * it, so the module registers it as a Nitro route from the same generator instead of letting
   * the build write it into `public`.
   */
  readonly target?: BuildTarget;
  /** SPEC 16.2's `forwardCookies`. False unless explicitly turned on. */
  readonly forwardCookies?: boolean;
  /** Value of the `lang` attribute on every page. */
  readonly lang?: string;
  /** Forces a colour scheme instead of following the reader's system preference. */
  readonly colorScheme?: 'light' | 'dark';
  /**
   * Which half of SPEC 16.4 runs, and `auto` is the deployment's own answer.
   *
   * THE TWO HALVES NEVER BOTH WRITE, which is the reason this is one option rather than two. A
   * static deployment has no server, so the build writes every page; a server deployment renders
   * them, so writing them too would put a file in front of the route and the reference would be
   * served by the one nothing measures. `auto` reads Nitro's own `static` flag, which is true
   * under `nuxt generate` and absent under `nuxt build`. `true` and `false` say it outright, for
   * a preset whose answer is not the usual one.
   */
  readonly generate?: boolean | 'auto';
}

/** The options with every default settled, as the two halves of the module read them. */
export interface ResolvedNuxtOptions {
  readonly spec: string;
  readonly base: string;
  /** The mount path derived from `base`, with a leading slash and no trailing one. */
  readonly basePath: string;
  readonly target: BuildTarget | undefined;
  readonly forwardCookies: boolean;
  readonly lang: string | undefined;
  readonly colorScheme: 'light' | 'dark' | undefined;
  readonly generate: boolean | 'auto';
}

/**
 * Whether this build writes the site rather than serving it.
 *
 * @param generate - What the host asked for
 * @param nitroStatic - Nitro's own `static` flag, as it reaches `nitro:config`
 * @returns True when the static build runs and no route is registered
 */
export function generatesStatically(
  generate: boolean | 'auto',
  nitroStatic: boolean | undefined,
): boolean {
  return generate === 'auto' ? nitroStatic === true : generate;
}

/**
 * Reads what the host wrote.
 *
 * @param options - Inline options and `nuxt.options.openref`, already merged by the caller
 * @returns The resolved options
 * @throws {InvalidOptionsError} When a required option is missing or an answer cannot be served
 */
export function resolveNuxtOptions(options: Partial<OpenRefNuxtOptions>): ResolvedNuxtOptions {
  const spec = typeof options.spec === 'string' ? options.spec.trim() : '';
  if (spec === '') {
    throw new InvalidOptionsError(
      'openref: the Nuxt module needs "spec", the path of the OpenAPI or AsyncAPI document to build the reference from',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { spec: options.spec },
    );
  }

  const base = typeof options.base === 'string' ? options.base.trim() : '';
  if (base === '') {
    throw new InvalidOptionsError(
      'openref: the Nuxt module needs "base", the path the reference is mounted at, such as /docs',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base: options.base },
    );
  }

  const { basePath } = resolveSiteBase(base);
  if (basePath === '') {
    throw new InvalidOptionsError(
      `openref: "base" must mount the reference under a path of its own, and "${base}" is the site root. A Nuxt application writes its own index.html there and the reference writes the overview, so one of the two would silently win. Mount it at /docs or any other path`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { base },
    );
  }

  if (options.target !== undefined && !isBuildTarget(options.target)) {
    throw new InvalidOptionsError(
      `openref: "target" must be one of ${BUILD_TARGETS.join(', ')}, received "${String(options.target)}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { target: options.target },
    );
  }

  // READ AS `unknown` BECAUSE THAT IS WHAT IT IS. These values come out of `nuxt.config`, which is
  // a file a host wrote, so the declared type describes what is meant rather than what arrives; a
  // check narrowed by the declaration would be a check the compiler deletes.
  const generate: unknown = options.generate;
  const colorScheme: unknown = options.colorScheme;

  if (generate !== undefined && generate !== true && generate !== false && generate !== 'auto') {
    throw new InvalidOptionsError(
      `openref: "generate" is true, false or "auto", received "${String(options.generate)}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { generate: options.generate },
    );
  }

  if (colorScheme !== undefined && colorScheme !== 'light' && colorScheme !== 'dark') {
    throw new InvalidOptionsError(
      `openref: "colorScheme" is light or dark, received "${String(options.colorScheme)}"`,
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { colorScheme: options.colorScheme },
    );
  }

  return {
    spec,
    base,
    basePath,
    target: options.target,
    forwardCookies: options.forwardCookies === true,
    lang: options.lang,
    colorScheme: options.colorScheme,
    generate: options.generate ?? 'auto',
  };
}

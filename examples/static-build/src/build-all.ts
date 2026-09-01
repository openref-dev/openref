import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * One static build per hosting platform, from one specification.
 *
 * THE INTERESTING PART IS THE PROXY, NOT THE PAGES. Every target writes the same pages: one
 * directory per page with its own `index.html`, the search index, the navigation payload,
 * `llms.txt` and digest named assets. What differs is whether the console can send a request
 * once the site is deployed, and that is what `--target` answers.
 *
 * A static page cannot reach your API across origins unless your API allows it, so the build
 * generates the rewrite the host understands. Three of the targets cannot rewrite at all, and
 * on those the pages carry a warning saying the console sends directly rather than pretending
 * a proxy exists.
 */

/** This file's directory, so paths do not depend on where the command was run from. */
const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository root: `src` and `dist` are both one level under this package. */
const REPOSITORY_ROOT = resolve(HERE, '..', '..', '..');

/** The CLI, as a deployment would invoke it. */
const BINARY = join(REPOSITORY_ROOT, 'packages', 'cli', 'dist', 'bin.js');

/** The document to build, borrowed from the Nuxt example so nothing is duplicated. */
export const SPECIFICATION = join(REPOSITORY_ROOT, 'examples', 'nuxt-reference', 'openapi.yaml');

/**
 * Where the builds land. One directory per target.
 *
 * UNDER `dist` RATHER THAN BESIDE IT, because `dist` is what every tool in this repository
 * already knows is build output: eslint ignores it, git ignores it, and a generated Nitro route
 * sitting anywhere else is a parse error in somebody's lint run.
 */
export const OUTPUT_ROOT = join(REPOSITORY_ROOT, 'examples', 'static-build', 'dist', 'sites');

/**
 * Every target, with what it can do about a cross origin request.
 *
 * THE THREE THAT GENERATE NOTHING ARE LISTED RATHER THAN OMITTED. A reader deploying to GitHub
 * Pages needs to know that the console will send straight to the API and that the API therefore
 * has to allow it, and a list that quietly held only the seven working targets would be the
 * page telling them the opposite by omission.
 */
export const TARGETS: readonly { readonly name: string; readonly rewrites: boolean }[] = [
  { name: 'nginx', rewrites: true },
  { name: 'caddy', rewrites: true },
  { name: 'nitro', rewrites: true },
  { name: 'netlify', rewrites: true },
  { name: 'vercel', rewrites: true },
  { name: 'cloudflare-pages', rewrites: true },
  { name: 's3-cloudfront', rewrites: true },
  { name: 'github-pages', rewrites: false },
  { name: 'gitlab-pages', rewrites: false },
  { name: 's3', rewrites: false },
];

/**
 * Builds the site once per target.
 *
 * @returns The exit code of the first build that failed, or 0
 */
export function buildEveryTarget(): number {
  mkdirSync(OUTPUT_ROOT, { recursive: true });

  for (const target of TARGETS) {
    const out = join(OUTPUT_ROOT, target.name);

    const result = spawnSync(
      process.execPath,
      [
        BINARY,
        'build',
        '--spec',
        SPECIFICATION,
        '--out',
        out,
        '--base',
        'https://docs.example.com',
        '--target',
        target.name,
      ],
      { stdio: 'inherit' },
    );

    if (result.status !== 0) return result.status ?? 1;
  }

  return 0;
}

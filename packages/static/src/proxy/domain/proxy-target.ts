/**
 * The deployment targets of SPEC 16.2, and what each one can do.
 *
 * THREE KINDS AND THE KIND IS THE CAPABILITY. A config target can rewrite a route, so it gets a
 * generated proxy configuration; a direct target cannot, so its pages carry the SPEC 16.2
 * warning instead; `none` is the explicit nothing. The classification is data here rather than
 * a branch in the generator, because the CLI, the build and the report all speak it and a
 * vocabulary spoken by more than one surface lives in one exported constant.
 */

/** Targets a proxy configuration is generated for, in SPEC 16.2's table order. */
export const PROXY_CONFIG_TARGETS = [
  'nitro',
  'nginx',
  'caddy',
  'netlify',
  'vercel',
  'cloudflare-pages',
  's3-cloudfront',
] as const;

/** A target with rewrite capability. */
export type ProxyConfigTarget = (typeof PROXY_CONFIG_TARGETS)[number];

/** Targets with no rewrite capability, which degrade to direct mode with the UI warning. */
export const DIRECT_TARGETS = ['github-pages', 'gitlab-pages', 's3'] as const;

/** A target that cannot rewrite routes. */
export type DirectTarget = (typeof DIRECT_TARGETS)[number];

/** Everything `--target` accepts once detection has resolved, `none` being the explicit nothing. */
export type BuildTarget = ProxyConfigTarget | DirectTarget | 'none';

/** Every accepted resolved value, for the CLI's usage message. */
export const BUILD_TARGETS: readonly BuildTarget[] = [
  ...PROXY_CONFIG_TARGETS,
  ...DIRECT_TARGETS,
  'none',
];

/** Whether a string names a target. */
export function isBuildTarget(value: string): value is BuildTarget {
  return (BUILD_TARGETS as readonly string[]).includes(value);
}

/** Whether a target gets a generated configuration. */
export function isProxyConfigTarget(target: BuildTarget): target is ProxyConfigTarget {
  return (PROXY_CONFIG_TARGETS as readonly string[]).includes(target);
}

/** Whether a target cannot rewrite and falls back to direct mode. */
export function isDirectTarget(target: BuildTarget): target is DirectTarget {
  return (DIRECT_TARGETS as readonly string[]).includes(target);
}

/** How each target is named to a reader, in the platform's own spelling. */
const TARGET_LABELS: Readonly<Record<BuildTarget, string>> = {
  nitro: 'Nitro',
  nginx: 'nginx',
  caddy: 'Caddy',
  netlify: 'Netlify',
  vercel: 'Vercel',
  'cloudflare-pages': 'Cloudflare Pages',
  's3-cloudfront': 'S3 with CloudFront',
  'github-pages': 'GitHub Pages',
  'gitlab-pages': 'GitLab Pages',
  s3: 'S3',
  none: 'none',
};

/**
 * The reader facing name of a target.
 *
 * @param target - The target
 * @returns Its display name
 */
export function targetLabel(target: BuildTarget): string {
  return TARGET_LABELS[target];
}

/**
 * The environment variables SPEC 16.2 names, each beside the platform that sets it.
 *
 * EXACTLY THESE THREE AND NOT THE CI VARIABLES. `GITHUB_ACTIONS` and `GITLAB_CI` say where the
 * build runs, not where the site is deployed: a Netlify site is routinely built on GitHub
 * Actions, so reading those as GitHub Pages would detect the wrong platform confidently.
 */
const DETECTION_VARIABLES: readonly (readonly [string, ProxyConfigTarget])[] = [
  ['NETLIFY', 'netlify'],
  ['VERCEL', 'vercel'],
  ['CF_PAGES', 'cloudflare-pages'],
];

/** What `--target auto` resolved to, and the warning when it fell back. */
export interface TargetDetection {
  readonly target: BuildTarget;
  /** The `none` fallback warning of SPEC 16.2, absent when exactly one platform was seen. */
  readonly warning?: string;
}

/**
 * Resolves `--target auto` from the platform environment variables of SPEC 16.2.
 *
 * FALLS BACK TO `none` WITH A WARNING IN BOTH FAILURE DIRECTIONS, per the standing rule that a
 * check that cannot determine a fact says so and never defaults to the answer meaning success.
 * No variable set means no platform was seen; two set means the machine claims two platforms
 * and which one deploys this output is not this function's to guess. Both warnings name what
 * was actually seen.
 *
 * @param env - The process environment, or a fake in a test
 * @returns The detected target, or `none` with the reason
 */
export function detectTarget(env: Readonly<Record<string, string | undefined>>): TargetDetection {
  const seen = DETECTION_VARIABLES.filter(([name]) => {
    const value = env[name];
    return value !== undefined && value !== '';
  });

  if (seen.length === 1 && seen[0] !== undefined) {
    return { target: seen[0][1] };
  }

  if (seen.length === 0) {
    return {
      target: 'none',
      warning:
        '--target auto found none of NETLIFY, VERCEL or CF_PAGES in the environment, so no ' +
        'platform was detected and no proxy configuration is generated. Name a --target ' +
        'explicitly to generate one',
    };
  }

  return {
    target: 'none',
    warning:
      `--target auto found more than one platform variable set (${seen
        .map(([name]) => name)
        .join(', ')}), so which platform deploys this output cannot be determined and no ` +
      'proxy configuration is generated. Name a --target explicitly to generate one',
  };
}

/**
 * One target, one document, one answer: which files, which warnings, which pages warn.
 *
 * THE DECISION LIVES HERE AND THE PAGES ONLY OBEY IT. Whether a build warns the reader, writes
 * a configuration or writes nothing is decided once, from the target's capability and the
 * planned upstreams, so the console never re-derives a deployment fact it cannot know.
 */

import type { IRServer } from '@openref/core';
import { generateProxyFiles, VERCEL_FILE_NOTICE, type GeneratedProxyFile } from './proxy-files';
import { isDirectTarget, isProxyConfigTarget, targetLabel, type BuildTarget } from './proxy-target';
import { planUpstreams } from './proxy-upstreams';

/** What the build asks for. */
export interface ProxyPlanOptions {
  /** The resolved target, detection already done. */
  readonly target: BuildTarget;
  /** `IRDocument.servers`. */
  readonly servers: readonly IRServer[];
  /** The build's base path, `''` or `/docs`. */
  readonly basePath: string;
  /** SPEC 16.2's `forwardCookies`. False unless explicitly turned on. */
  readonly forwardCookies?: boolean;
}

/** What one target does to one build. */
export interface ProxyPlan {
  readonly target: BuildTarget;
  /** The pinned upstreams, in `u<N>` order. Empty for `none` and for a document with none. */
  readonly upstreams: readonly string[];
  /** The files to write, empty when there is nothing to generate. */
  readonly files: readonly GeneratedProxyFile[];
  /** Everything a deployer should read: skipped servers, platform boundaries, degradations. */
  readonly warnings: readonly string[];
  /**
   * Display name of the platform for the page warning of SPEC 16.2, or null.
   *
   * Non null exactly when the target cannot rewrite routes and at least one upstream exists:
   * a direct request to the page's own origin is not a degradation to warn about.
   */
  readonly directTarget: string | null;
}

/** The empty plan of `--target none` and of a build with no target at all. */
const NONE_PLAN: ProxyPlan = {
  target: 'none',
  upstreams: [],
  files: [],
  warnings: [],
  directTarget: null,
};

/**
 * Plans the proxy half of one build.
 *
 * @param options - Target, servers, base and the cookie switch
 * @returns The plan
 */
export function planProxy(options: ProxyPlanOptions): ProxyPlan {
  const { target } = options;
  if (target === 'none') return NONE_PLAN;

  const plan = planUpstreams(options.servers);
  const warnings = [...plan.warnings];
  const label = targetLabel(target);

  if (plan.upstreams.length === 0) {
    warnings.push(
      `--target ${target}: the document declares no absolute http(s) server, so there is no ` +
        `upstream to proxy and ${
          isDirectTarget(target)
            ? 'direct mode reaches only this origin, so pages carry no warning'
            : 'no proxy configuration was written'
        }`,
    );

    return { target, upstreams: [], files: [], warnings, directTarget: null };
  }

  if (isProxyConfigTarget(target)) {
    const files = generateProxyFiles(target, {
      upstreams: plan.upstreams,
      basePath: options.basePath,
      forwardCookies: options.forwardCookies ?? false,
    });

    if (target === 'vercel') warnings.push(VERCEL_FILE_NOTICE);

    return { target, upstreams: plan.upstreams, files, warnings, directTarget: null };
  }

  warnings.push(
    `--target ${target}: ${label} cannot rewrite routes, so there is no proxy. Pages carry ` +
      'the direct mode warning: requests go straight from the reader to the API',
  );

  return { target, upstreams: plan.upstreams, files: [], warnings, directTarget: label };
}

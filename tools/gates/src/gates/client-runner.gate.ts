import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHIPPED_CLIENT_BUNDLES } from '../config.js';
import { findForeignOrigins } from '../lib/bundle-origins.js';
import { auditRunnerBinding } from '../lib/runner-binding.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Two claims about the bundle a page loads: the request runner is in it, and nothing in it
 * knows an address outside the reader's own origin.
 *
 * A MISSING FILE IS AN ERROR AND NEVER A SKIP, per T001. This gate exists because a disabled
 * console looked like a passing build for the length of one task, and a gate that skips when
 * the artifact is absent would reproduce exactly that: nothing to read, nothing to report,
 * green. Run `pnpm build` before `pnpm gates`.
 *
 * THE SECOND CLAIM IS SPEC 19.5, and it is here rather than in a gate of its own because it
 * asks a question about the same file. The browser proof watches one page load and sees no
 * request leave the origin; this reads the file for the addresses such a request would need,
 * which is what covers a call made on a condition no navigation arranged.
 */
export const clientRunnerGate: Gate = {
  id: 'client-runner',
  title: 'The shipped client bundle binds a request runner and calls nobody',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let failed = false;

    for (const bundle of SHIPPED_CLIENT_BUNDLES) {
      const path = join(context.repoRoot, bundle.file);

      if (!existsSync(path)) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: ${bundle.file} is not built, so nothing was checked. Run pnpm build`,
        });
        continue;
      }

      const { missing } = auditRunnerBinding(readFileSync(path, 'utf8'));

      for (const marker of missing) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: "${marker.literal}" is absent, so it is missing ${marker.carriedBy}`,
        });
      }

      if (missing.length === 0) {
        findings.push({
          level: 'info',
          message: `${bundle.label}: hydration and runner both present in ${bundle.file}`,
        });
      }

      const foreign = findForeignOrigins(readFileSync(path, 'utf8'));

      for (const origin of foreign) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: the bundle carries the address ${origin.origin}, which is not the reader's origin and not an XML namespace: ${origin.excerpt}`,
        });
      }

      if (foreign.length === 0) {
        findings.push({
          level: 'info',
          message: `${bundle.label}: no address outside the reader's own origin`,
        });
      }
    }

    return Promise.resolve({
      id: clientRunnerGate.id,
      title: clientRunnerGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};

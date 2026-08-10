import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHIPPED_CLIENT_BUNDLES } from '../config.js';
import { auditRunnerBinding } from '../lib/runner-binding.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * The bundle a page loads has the request runner in it.
 *
 * A MISSING FILE IS AN ERROR AND NEVER A SKIP, per T001. This gate exists because a disabled
 * console looked like a passing build for the length of one task, and a gate that skips when
 * the artifact is absent would reproduce exactly that: nothing to read, nothing to report,
 * green. Run `pnpm build` before `pnpm gates`.
 */
export const clientRunnerGate: Gate = {
  id: 'client-runner',
  title: 'The shipped client bundle binds a request runner',

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
    }

    return Promise.resolve({
      id: clientRunnerGate.id,
      title: clientRunnerGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};

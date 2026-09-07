import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSP_SCAN_EXTENSIONS } from '../config.js';
import { scanForCspViolations } from '../lib/csp.js';
import { cspScanRoots } from '../lib/package-dirs.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Scans built output for constructs a strict Content Security Policy cannot authorize.
 *
 * Working under `style-src 'self' 'nonce-...'` with no `unsafe-inline` is a declared
 * advantage of this project, so an inline style attribute in built output is fatal.
 *
 * THE ROOTS HOLD NO RENDERED PAGE, AND WIDENING THEM IS A SCOPE DECISION
 * (DEFER POST-1.0, `TX-CSP-ROOTS`). `cspScanRoots` walks `packages/<name>/dist` and `.html` is in
 * `CSP_SCAN_EXTENSIONS`, so the rule for a rendered page exists and has never been applied to one:
 * every page this product produces is written by a host, by `openref build` or by the Nuxt module,
 * and none of those writes into a package's `dist`. Measured on the first rendered page the scan
 * ever met, `docs/dist/index.html`: three violations before `isViolation` learned to read a
 * script's `type` and one after, against zero from a real browser under
 * `default-src 'none'; script-src 'self'; style-src 'self'`. The one that remains is a
 * documentation chapter teaching the rule by quoting the construct it forbids, which a scan over
 * text cannot tell from an attribute; SPEC 19 records which instrument is authoritative for which
 * subject, and the entry the marker names carries the recommendation as a yes or a no.
 */
export const cspGate: Gate = {
  id: 'csp',
  title: 'Strict CSP scan of built output',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const roots = cspScanRoots(context.repoRoot);
    let scanned = 0;
    let failed = false;

    for (const root of roots) {
      for (const relativePath of collectFiles(
        join(context.repoRoot, root),
        CSP_SCAN_EXTENSIONS,
        context.repoRoot,
      )) {
        scanned += 1;
        const content = readFileSync(join(context.repoRoot, relativePath), 'utf8');

        for (const violation of scanForCspViolations(content)) {
          failed = true;
          findings.push({
            level: 'error',
            message: `${relativePath} [${violation.rule}] ${violation.reason}: ${violation.excerpt}`,
          });
        }
      }
    }

    if (scanned === 0) {
      findings.push({
        level: 'info',
        message: `SKIP no built output under ${roots.join(', ')}; run pnpm build first`,
      });

      return Promise.resolve({
        id: cspGate.id,
        title: cspGate.title,
        status: 'skip',
        skipReason: 'artifact-absent',
        findings,
      });
    }

    if (!failed) {
      findings.push({
        level: 'info',
        message: `no violations in ${String(scanned)} built file(s)`,
      });
    }

    return Promise.resolve({
      id: cspGate.id,
      title: cspGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};

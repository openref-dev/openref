import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CSP_SCAN_EXTENSIONS, CSP_SCAN_ROOTS } from '../config.js';
import { scanForCspViolations } from '../lib/csp.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * Scans built output for constructs a strict Content Security Policy cannot authorize.
 *
 * Working under `style-src 'self' 'nonce-...'` with no `unsafe-inline` is a declared
 * advantage of this project, so an inline style attribute in built output is fatal.
 */
export const cspGate: Gate = {
  id: 'csp',
  title: 'Strict CSP scan of built output',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    let scanned = 0;
    let failed = false;

    for (const root of CSP_SCAN_ROOTS) {
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
        message: `SKIP no built output under ${CSP_SCAN_ROOTS.join(', ')}; run pnpm build first`,
      });

      return Promise.resolve({
        id: cspGate.id,
        title: cspGate.title,
        status: 'skip',
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

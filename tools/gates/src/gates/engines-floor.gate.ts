import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../lib/exec.js';
import {
  auditEngineRange,
  describeConstraints,
  findDivergentManifests,
  type DeclaredEngine,
} from '../lib/engines.js';
import { flattenLicenseReport, type PnpmLicenseReport } from '../lib/licenses.js';
import { readWorkspaceManifests, resolveShippedPackages } from '../lib/workspace.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * The declared Node range is a subset of every range in the published closure.
 *
 * SPEC 23 states the range, and this is what keeps it true. It reuses the closure the licence
 * gate computes, from `pnpm licenses list --prod` over the shipped packages, because that
 * command already answers "what actually reaches a consumer" and answering it twice, differently,
 * is how two gates come to disagree about the same set.
 *
 * A DEPENDENCY THAT RAISES ITS FLOOR FAILS THE BUILD, which is the whole point. The alternative
 * is what happened before: a range typed once, a dependency that moved underneath it, and a
 * package that did not load on a runtime the manifest still advertised.
 */
export const enginesFloorGate: Gate = {
  id: 'engines-floor',
  title: 'The declared Node range is a subset of the closure it depends on',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const fail = (message: string): Promise<GateResult> => {
      findings.push({ level: 'error', message });
      return Promise.resolve({
        id: enginesFloorGate.id,
        title: enginesFloorGate.title,
        status: 'fail',
        findings,
      });
    };

    const declared = declaredRange(context.repoRoot, 'package.json');
    if (declared === undefined) {
      return fail('the root package.json declares no engines.node, so nothing is promised');
    }

    const workspace = readWorkspaceManifests(context.repoRoot).map((manifest) => ({
      name: manifest.name,
      range: declaredRange(context.repoRoot, join(manifest.directory, 'package.json')),
    }));

    for (const divergence of findDivergentManifests(declared, workspace)) {
      findings.push({
        level: 'error',
        message: `workspace: ${divergence}, while the root declares "${declared}"`,
      });
    }

    const { shipped } = resolveShippedPackages(readWorkspaceManifests(context.repoRoot));
    const report = runCommand(
      'pnpm',
      ['licenses', 'list', '--json', '--prod', ...shipped.flatMap((name) => ['--filter', name])],
      context.repoRoot,
    );
    if (!report.ok) {
      return fail(`pnpm licenses list for the published closure failed: ${report.stderr.trim()}`);
    }

    const trimmed = report.stdout.trim();
    const parsed = trimmed.startsWith('{') ? (JSON.parse(trimmed) as PnpmLicenseReport) : {};
    const dependencies: DeclaredEngine[] = [];

    for (const entry of flattenLicenseReport(parsed)) {
      for (const path of entry.paths) {
        const range = declaredRange(context.repoRoot, join(path, 'package.json'));
        if (range === undefined) continue;

        dependencies.push({ package: `${entry.name}@${entry.versions.join(',')}`, range });
        break;
      }
    }

    const conflicts = auditEngineRange(declared, dependencies);

    for (const conflict of conflicts) {
      findings.push({
        level: 'error',
        message: `${conflict.package}: declares "${conflict.range}" and ${conflict.reason}`,
      });
    }

    if (conflicts.length > 0) {
      findings.push({
        level: 'error',
        message: `SPEC 23 and every manifest promise "${declared}". Narrow it to satisfy: ${describeConstraints(conflicts)}`,
      });
    }

    findings.push({
      level: 'info',
      message: `"${declared}" is a subset of the ${String(dependencies.length)} declared range(s) among ${String(flattenLicenseReport(parsed).length)} package(s) in the published closure`,
    });

    const failed = findings.some((finding) => finding.level === 'error');

    return Promise.resolve({
      id: enginesFloorGate.id,
      title: enginesFloorGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};

/**
 * Reads `engines.node` out of one manifest.
 *
 * @param repoRoot - Absolute repository root, for a relative path
 * @param path - Manifest path, absolute or relative to the root
 * @returns The declared range, or undefined when it declares none or cannot be read
 */
function declaredRange(repoRoot: string, path: string): string | undefined {
  const absolute = path.startsWith('/') ? path : join(repoRoot, path);

  try {
    const manifest = JSON.parse(readFileSync(absolute, 'utf8')) as {
      readonly engines?: { readonly node?: unknown };
    };
    const range = manifest.engines?.node;

    return typeof range === 'string' ? range : undefined;
  } catch {
    return undefined;
  }
}

/** Exported for the tests, which walk a fixture tree rather than the real one. */
export const readDeclaredRange = declaredRange;

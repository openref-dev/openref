import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHIPPED_CLIENT_BUNDLES } from '../config.js';
import { findForeignOrigins } from '../lib/bundle-origins.js';
import { chunkName, partitionModuleGraph } from '../lib/module-graph.js';
import { auditRunnerBinding } from '../lib/runner-binding.js';
import { collectFiles } from '../lib/walk.js';
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

      const present = bundle.roots.flatMap((root) =>
        collectFiles(join(context.repoRoot, root), ['.js', '.mjs'], context.repoRoot),
      );

      let split;
      try {
        split = partitionModuleGraph(context.repoRoot, bundle.file, present);
      } catch (cause) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
        continue;
      }

      if (split.unaccounted.length > 0) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: ${split.unaccounted.map(chunkName).join(', ')} sit beside the bundle and nothing in it reaches them, so a marker found in one of them would prove nothing`,
        });
        continue;
      }

      const sourceOf = (files: readonly string[]): string =>
        files.map((file) => readFileSync(join(context.repoRoot, file), 'utf8')).join('\n');

      const initialSource = sourceOf(split.initial);
      const deferredSource = sourceOf(split.deferred);
      const { missing, eager } = auditRunnerBinding({
        initial: initialSource,
        deferred: deferredSource,
      });

      for (const marker of missing) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: "${marker.literal}" is absent, so it is missing ${marker.carriedBy}`,
        });
      }

      // THE RUNNER BEING PRESENT IS HALF THE CLAIM SINCE T011-R, and being absent from the first
      // paint is the other half. Both are failures and they are opposite ones, which is why they
      // are two messages rather than one: absent means the console is dead, and eager means the
      // deferral this task exists for has been undone.
      for (const marker of eager) {
        failed = true;
        findings.push({
          level: 'error',
          message: `${bundle.label}: "${marker.literal}" is in what the first paint loads, so ${marker.carriedBy} is compiled before any reader has opened a console. T011-R put it behind a dynamic import`,
        });
      }

      if (missing.length === 0 && eager.length === 0) {
        findings.push({
          level: 'info',
          message: `${bundle.label}: hydration in the ${String(split.initial.length)} file(s) the first paint loads, the runner in the ${String(split.deferred.length)} behind a dynamic import`,
        });
      }

      const foreign = findForeignOrigins(`${initialSource}\n${deferredSource}`);

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
          message: `${bundle.label}: no address outside the reader's own origin, over all ${String(split.initial.length + split.deferred.length)} file(s) of the graph`,
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

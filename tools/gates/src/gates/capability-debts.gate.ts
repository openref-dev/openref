import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_MODULE_EXTENSIONS,
  BUILD_AMENDMENTS_FILE,
  BUILD_FILE,
  CAPABILITY_DEBTS,
} from '../config.js';
import { aiDocsAbsentMessage, aiDocsPresent } from '../lib/ai-docs.js';
import { parseMilestones, planTaskIds, splitLines } from '../lib/build-manifest.js';
import { checkCapabilityDebts, describeCapabilityDebt } from '../lib/capability-debts.js';
import type { CapabilityDebt } from '../lib/capability-debts.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * The capabilities this repository has built and cannot deliver, each with a name on it.
 *
 * WHAT MAKES THIS DIFFERENT FROM A TODO IS THE MILESTONE. A note saying the proxy is not wired
 * is a note; this fails the build the moment the last task of the milestone it was promised by
 * is ticked, which is the only point at which nobody would otherwise be looking. It is the same
 * mechanism `budget-exceptions` uses over a number that is too big, applied to a feature that is
 * not there, and the two are separate gates because they read different evidence.
 *
 * A MISSING BUILD IS AN ERROR AND NEVER A SKIP, for the reason `client-runner` gives: the state
 * this gate exists to detect looks exactly like a green run from the outside, so a run with
 * nothing to read must not be one of them. Run `pnpm build` before `pnpm gates`.
 */
export const capabilityDebtsGate: Gate = {
  id: 'capability-debts',
  title: 'Every capability that ships unreachable has an owner and a milestone',

  run(context): Promise<GateResult> {
    const findings: GateFinding[] = [];
    const markerFound = new Map<string, boolean>();
    let unreadable = false;

    // THE ARTEFACT HALF RUNS WHETHER OR NOT THE PLAN IS HERE, because it needs nothing from
    // `ai-docs/`. A checkout with no private documents can still be told that the marker of a
    // live entry has appeared, which is the half that says the record has rotted.
    for (const entry of CAPABILITY_DEBTS) {
      const files = entry.roots.flatMap((root) =>
        collectFiles(join(context.repoRoot, root), BROWSER_MODULE_EXTENSIONS, context.repoRoot),
      );

      if (files.length === 0) {
        unreadable = true;
        findings.push({
          level: 'error',
          message: `${entry.id}: ${entry.roots.join(', ')} holds no built module, so nothing was looked at. Run pnpm build`,
        });
        continue;
      }

      const found = files.some((file) =>
        readFileSync(join(context.repoRoot, file), 'utf8').includes(entry.marker),
      );

      markerFound.set(entry.id, found);
    }

    if (!aiDocsPresent(context.repoRoot)) {
      const issues = checkCapabilityDebts(CAPABILITY_DEBTS, {
        taskIds: [],
        milestones: [],
        markerFound,
      }).filter((issue) => issue.rule === 'stale');

      return Promise.resolve({
        id: capabilityDebtsGate.id,
        title: capabilityDebtsGate.title,
        ...(issues.length === 0 && !unreadable
          ? { status: 'skip' as const, skipReason: 'ai-docs-absent' as const }
          : { status: 'fail' as const }),
        findings: [
          ...findings,
          ...issues.map((issue) => ({
            level: 'error' as const,
            message: `[${issue.rule}] ${issue.message}`,
          })),
          {
            level: 'warning',
            message: aiDocsAbsentMessage(capabilityDebtsGate.title, [
              BUILD_FILE,
              BUILD_AMENDMENTS_FILE,
            ]),
          },
          ...CAPABILITY_DEBTS.map((entry: CapabilityDebt) => ({
            level: 'warning' as const,
            message: `UNVALIDATED ${describeCapabilityDebt(entry)}`,
          })),
        ],
      });
    }

    const build = readFileSync(join(context.repoRoot, BUILD_FILE), 'utf8');
    const amendmentsPath = join(context.repoRoot, BUILD_AMENDMENTS_FILE);
    const amendments = existsSync(amendmentsPath) ? readFileSync(amendmentsPath, 'utf8') : '';

    const issues = checkCapabilityDebts(CAPABILITY_DEBTS, {
      taskIds: planTaskIds(build, amendments),
      milestones: parseMilestones(splitLines(build)),
      markerFound,
    });

    for (const issue of issues) {
      findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
    }

    for (const entry of CAPABILITY_DEBTS) {
      findings.push({ level: 'warning', message: `UNREACHABLE ${describeCapabilityDebt(entry)}` });
    }

    if (CAPABILITY_DEBTS.length === 0) {
      findings.push({
        level: 'info',
        message: 'nothing is recorded as built and unreachable from the page this module serves',
      });
    }

    return Promise.resolve({
      id: capabilityDebtsGate.id,
      title: capabilityDebtsGate.title,
      status: issues.length === 0 && !unreadable ? 'pass' : 'fail',
      findings,
    });
  },
};

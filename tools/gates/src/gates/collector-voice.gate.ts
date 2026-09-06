import { COLLECTOR_REASON_LIMIT } from '../config.js';
import { scanCollectors } from '../lib/collector-voice.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

export {
  collectorPackages,
  scanCollector,
  scanCollectors,
  COLLECTOR_PREFIX,
} from '../lib/collector-voice.js';

/**
 * Every ecosystem collector's reader text, held to the voice of SPEC 7.1.
 *
 * THIS IS THE HOLE `discovery-voice.spec.ts` NAMED IN ITS OWN HEADER. That sweep holds the
 * collectors inside `packages/nest` to a bounded reason with an action beside it, and said plainly
 * that the ecosystem collectors are in their own packages, cannot be reached from there, and are
 * covered only by each one's own unit suite, which is the weaker instrument: a fifth ecosystem
 * package could be written in the old voice and nothing would say so. A gate reads across packages
 * and derives the set from the disk, so the fifth one was swept before it had a test of its own.
 *
 * WHAT IT MEASURES AND WHAT IT DOES NOT. The bound is a character count. It cannot see whether the
 * clause says anything useful, which is what each collector's own suite is for; what it sees is the
 * shape a reader is shown first, and the shape is where the defect was. `detail` is unbounded on
 * purpose, here as there: the reasoning did not have to be deleted to make the first line short.
 *
 * A BLIND WALK IS AN ERROR AND NOT A PASS. A collector whose source calls `problems.push` and out
 * of which this reads no reason at all has defeated the walk, which is exactly the state in which
 * every bound below is vacuously satisfied. It says so rather than reporting a clean sweep.
 */
export function runCollectorVoiceGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const errors: string[] = [];

  const scans = scanCollectors(context.repoRoot);

  // THE SET IS ASSERTED PRESENT BEFORE ANYTHING IS ASSERTED ABOUT IT. A derivation that found no
  // collector package would satisfy every rule below over nothing, and read in the summary exactly
  // like a repository whose collectors are all in good voice.
  if (scans.length === 0) {
    errors.push(
      `[collectors-unread] no package under packages/ is named as an ecosystem collector, so the ` +
        `voice of SPEC 7.1 was checked over nothing at all`,
    );
  }

  for (const scan of scans) {
    if (scan.pushes > 0 && scan.reasons.length === 0) {
      errors.push(
        `[reasons-unread] packages/${scan.packageDir} pushes ${String(scan.pushes)} discovery ` +
          `problem(s) and this sweep read no reason out of it, so its reader text is measured by ` +
          `nothing`,
      );
    }

    for (const found of scan.reasons) {
      if (found.reason.length > COLLECTOR_REASON_LIMIT) {
        errors.push(
          `[reason-too-long] ${found.file} writes a reason of ${String(found.reason.length)} ` +
            `characters against a bound of ${String(COLLECTOR_REASON_LIMIT)}: "${found.reason}"`,
        );
      }

      if (!found.hasAction) {
        errors.push(
          `[action-missing] ${found.file} writes a reason with no action beside it. openref doctor ` +
            `draws the subject and the action and never the reason, so a finding with one string ` +
            `in both slots prints the wrong half there`,
        );
      }
    }
  }

  const reasons = scans.reduce((total, scan) => total + scan.reasons.length, 0);
  findings.push({
    level: 'info',
    message:
      `${String(reasons)} reason(s) read across ${String(scans.length)} ecosystem collector ` +
      `package(s) derived from the disk: ${scans.map((scan) => scan.packageDir).join(', ')}`,
  });

  for (const message of errors) findings.push({ level: 'error', message });

  return {
    id: collectorVoiceGate.id,
    title: collectorVoiceGate.title,
    status: errors.length > 0 ? 'fail' : 'pass',
    findings,
  };
}

export const collectorVoiceGate: Gate = {
  id: 'collector-voice',
  title: 'Every ecosystem collector states its reason in the voice of SPEC 7.1, with an action',

  run(context): Promise<GateResult> {
    return Promise.resolve(runCollectorVoiceGate(context));
  },
};

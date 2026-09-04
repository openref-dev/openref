import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BROWSER_MODULE_EXTENSIONS,
  BUILD_FILE,
  CAPABILITY_DEBTS,
  SHIPPED_CLIENT_BUNDLES,
} from '../config.js';
import { parseMilestones, planTaskIds, splitLines } from '../lib/build-manifest.js';
import { PROJECTION_FILE, readProjection } from '../lib/projection.js';
import { checkCapabilityDebts, describeCapabilityDebt } from '../lib/capability-debts.js';
import type { CapabilityDebt } from '../lib/capability-debts.js';
import {
  describeReading,
  emptyReadingMessage,
  readingIsEmpty,
  type ArtifactReading,
} from '../lib/debt-artifacts.js';
import { collectFiles } from '../lib/walk.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

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
 *
 * AND THAT PROMISE WAS KEPT PER ENTRY ONLY UNTIL T042, which T035 filed. The walk ran inside the
 * loop over the entries, so a list with nothing in it opened no file and passed unconditionally,
 * on the one day the gate matters most: the day the last debt clears is the day nobody is
 * watching, and a gate that goes quiet then has gone quiet for good. The reading below runs
 * whatever the list holds, is printed on every run, and is a failure when it reaches nothing.
 */
export function runCapabilityDebtsGate(
  context: GateContext,
  debts: readonly CapabilityDebt[],
): GateResult {
  const findings: GateFinding[] = [];
  const markerFound = new Map<string, boolean>();
  let unreadable = false;

  // THE MATERIAL IS THE SHIPPED BROWSER BUNDLE, AND IT IS READ BEFORE ANY ENTRY IS CONSIDERED.
  // The roots are the ones the bundle registry declares, which is the one place that knows a
  // browser artefact exists and is the same declaration `browser-resolution` reconciles its walk
  // against, plus whatever roots the entries themselves name.
  const roots = [
    ...new Set([
      ...SHIPPED_CLIENT_BUNDLES.flatMap((bundle) => bundle.roots),
      ...debts.flatMap((entry) => entry.roots),
    ]),
  ];
  const files = roots.flatMap((root) =>
    collectFiles(join(context.repoRoot, root), BROWSER_MODULE_EXTENSIONS, context.repoRoot),
  );

  const reading: ArtifactReading = {
    unit: 'built browser module',
    where: roots.join(', '),
    count: files.length,
    remedy: 'Run pnpm build before pnpm gates',
  };

  findings.push({ level: 'info', message: describeReading(reading) });

  if (readingIsEmpty(reading)) {
    unreadable = true;
    findings.push({ level: 'error', message: emptyReadingMessage(reading) });
  }

  // THE ARTEFACT HALF READS THE BUILT BUNDLE AND THE PLAN HALF READS THE COMMITTED PROJECTION.
  // Neither needs `ai-docs/` any more: a debt's owner is a task id and its expiry is a milestone
  // with a box beside each of its tasks, which is data, so both ship. Until the projection this
  // gate skipped on every clone with only the marker half answered.
  const sources = new Map<string, string>();
  for (const file of files) {
    sources.set(file, readFileSync(join(context.repoRoot, file), 'utf8'));
  }

  // THE PER ENTRY READING STAYS BESIDE THE LIST LEVEL ONE AND IS NOT REPLACED BY IT. An entry
  // names its own roots, and those roots being empty while some other bundle was built is the
  // same "nothing was looked at" for that entry, which a union count cannot see.
  for (const entry of debts) {
    const mine = [...sources].filter(([file]) =>
      entry.roots.some((root) => file === root || file.startsWith(`${root}/`)),
    );

    if (mine.length === 0) {
      unreadable = true;
      findings.push({
        level: 'error',
        message: `${entry.id}: ${entry.roots.join(', ')} holds no built module, so nothing was looked at. Run pnpm build`,
      });
      continue;
    }

    markerFound.set(
      entry.id,
      mine.some(([, source]) => source.includes(entry.marker)),
    );
  }

  const read = readProjection(context.repoRoot);

  if (!read.ok) {
    return {
      id: capabilityDebtsGate.id,
      title: capabilityDebtsGate.title,
      status: 'fail',
      findings: [
        ...findings,
        { level: 'error', message: `[projection-unreadable] ${read.reason}` },
        ...debts.map((entry: CapabilityDebt) => ({
          level: 'warning' as const,
          message: `UNVALIDATED ${describeCapabilityDebt(entry)}`,
        })),
      ],
    };
  }

  const build = read.projection.data.build;
  const amendments = read.projection.data.amendments ?? '';

  if (build === null) {
    return {
      id: capabilityDebtsGate.id,
      title: capabilityDebtsGate.title,
      status: 'fail',
      findings: [
        ...findings,
        {
          level: 'error',
          message: `${BUILD_FILE} was not readable when ${PROJECTION_FILE} was generated, so no debt can be told from a stale one`,
        },
        ...debts.map((entry: CapabilityDebt) => ({
          level: 'warning' as const,
          message: `UNVALIDATED ${describeCapabilityDebt(entry)}`,
        })),
      ],
    };
  }

  const issues = checkCapabilityDebts(debts, {
    taskIds: planTaskIds(build, amendments),
    milestones: parseMilestones(splitLines(build)),
    markerFound,
  });

  for (const issue of issues) {
    findings.push({ level: 'error', message: `[${issue.rule}] ${issue.message}` });
  }

  for (const entry of debts) {
    findings.push({ level: 'warning', message: `UNREACHABLE ${describeCapabilityDebt(entry)}` });
  }

  if (debts.length === 0) {
    // THE SENTENCE SAYS WHAT WAS READ, AND IT SAID OTHERWISE UNTIL THE LAST ROUND OF T042. It read
    // "the bundle that would carry a marker was read anyway" on every run of an empty list,
    // including the run where the reading above found nothing, which is precisely the state this
    // gate exists to catch. The verdict was already FAIL there, so nothing passed that should not
    // have; what was wrong is that the gate reported a fact it had not established, which is the
    // class this repository keeps finding in its own machinery and does not get to keep because
    // the verdict beside it happened to be right.
    findings.push({
      level: 'info',
      message: readingIsEmpty(reading)
        ? 'nothing is recorded as built and unreachable from the page this module serves, and ' +
          'no built browser module was read to check that against, so this run says nothing ' +
          'about the bundle: the error above is the finding, not the empty list'
        : 'nothing is recorded as built and unreachable from the page this module serves, and ' +
          `the ${String(reading.count)} built browser module(s) that would carry a marker were ` +
          'read anyway',
    });
  }

  return {
    id: capabilityDebtsGate.id,
    title: capabilityDebtsGate.title,
    status: issues.length === 0 && !unreadable ? 'pass' : 'fail',
    findings,
  };
}

export const capabilityDebtsGate: Gate = {
  id: 'capability-debts',
  title: 'Every capability that ships unreachable has an owner and a milestone',

  run(context): Promise<GateResult> {
    return Promise.resolve(runCapabilityDebtsGate(context, CAPABILITY_DEBTS));
  },
};

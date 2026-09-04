import { PROJECTION_ARTEFACT_BUDGET, PROJECTION_LEAF_FLOOR } from '../config.js';
import { PROJECTION_COMMAND, PROJECTION_FILE, readProjection } from '../lib/projection.js';
import {
  DIGESTS_IN_THE_ARTEFACT,
  PROJECTION_LEAF_PATHS,
  scanProjectionProse,
  type ProseScan,
} from '../lib/projection-prose.js';
import type { Gate, GateContext, GateFinding, GateResult } from '../types.js';

/**
 * The position holding the most, in words, so the volume reading is printed and not only enforced.
 *
 * @param scan - What the walk found
 * @returns One phrase naming the fullest position
 */
function largestVolume(scan: ProseScan): string {
  const entries = Object.entries(scan.volume);
  const byLeaves = entries.reduce<[string, number]>(
    (most, [path, seen]) => (seen.leaves > most[1] ? [path, seen.leaves] : most),
    ['', 0],
  );
  const byLines = entries.reduce<[string, number]>(
    (most, [path, seen]) => (seen.lines > most[1] ? [path, seen.lines] : most),
    ['', 0],
  );

  return (
    `fullest by count is ${byLeaves[0]} with ${String(byLeaves[1])} leaf/leaves, fullest by lines ` +
    `is ${byLines[0]} with ${String(byLines[1])}`
  );
}

/**
 * Every leaf of the committed reading of `ai-docs/` is one its position admits, checked where gates
 * run.
 *
 * WHAT THIS GATE IS AND IS NOT, in the same words `lib/projection-prose.ts` uses, because a gate
 * title is where a reader forms the belief. THE GENERATOR IS THE GUARANTEE AND THIS IS A BACKSTOP.
 * `lib/projection.ts` reads named fields and writes those, so content travels only if somebody
 * changes it; what this gate catches is a mistake in that change, and the VOLUME of anything that
 * does travel. It is not a defence against an author who deliberately spells a sentence like an
 * identifier, and it never was: a four word hyphenated leak and a four word hyphenated identifier
 * are the same shape.
 *
 * WHY IT IS A GATE AND NOT ONLY A UNIT CASE, which it was until this pass. CI runs `pnpm test` and
 * `pnpm gates` both, so CI was covered. `pnpm gates` is the command CLAUDE.md tells every session
 * to run before declaring a slice done, and until this gate existed that command proved nothing
 * whatever about the artefact's contents. A guarantee that holds only under the command nobody was
 * told to run is the shape of an absence reading as coverage.
 *
 * IT REUSES `scanProjectionProse` AND CARRIES NO RULE OF ITS OWN. A second copy of the grammar
 * would be a second thing to keep in step with the artefact, and the first to go stale; what this
 * adds is the three questions a gate has to ask that a scan does not: whether the file was there
 * to read, whether it walked enough of it to mean anything, and whether the rule table and the file
 * still name the same positions in both directions.
 *
 * IT NEEDS NO DOCUMENTS AND NEVER SKIPS. The artefact is committed, so a checkout without it is a
 * defect in the tree rather than a property of the machine, which is the same verdict every other
 * reader of the file gives.
 *
 * @param context - The run
 * @returns The result
 */
export function runProjectionPrivacyGate(context: GateContext): GateResult {
  const findings: GateFinding[] = [];
  const errors: string[] = [];

  const read = readProjection(context.repoRoot);

  if (!read.ok) {
    errors.push(`[projection-unreadable] ${read.reason}`);

    for (const message of errors) findings.push({ level: 'error', message });

    return {
      id: projectionPrivacyGate.id,
      title: projectionPrivacyGate.title,
      status: 'fail',
      findings,
    };
  }

  // THE FILE'S OWN WEIGHT AND NOT A RE-SERIALIZATION OF IT. The budget is about the artefact that
  // ships, and `gates:projection` runs prettier over what the writer produces, so the two differ by
  // 560 bytes on the committed file. Where a gate has the file, it measures the file.
  const scan = scanProjectionProse(read.projection, read.bytes);

  for (const finding of scan.findings) {
    errors.push(
      finding.rule === 'volume-exceeded'
        ? `[volume-exceeded] ${PROJECTION_FILE} at ${finding.path} ${finding.reason}. ` +
            `The reading is ${JSON.stringify(finding.value)}`
        : `[leaf-refused] ${PROJECTION_FILE} carries a value at ${finding.path} that ${finding.reason}. ` +
            `The value is ${JSON.stringify(finding.value)}`,
    );
  }

  if (scan.leaves < PROJECTION_LEAF_FLOOR) {
    errors.push(
      `[scan-too-small] the scan read ${String(scan.leaves)} leaf/leaves out of ${PROJECTION_FILE}, ` +
        `under the floor of ${String(PROJECTION_LEAF_FLOOR)}. A scan that walked almost nothing ` +
        `reports the same empty list as a scan that walked a clean artefact, so this reports the ` +
        `emptiness instead. THIS FLOOR IS ONE END OF A CORRIDOR AND ` +
        `${String(PROJECTION_ARTEFACT_BUDGET.leaves)} IS THE OTHER: the floor asks whether there ` +
        `is an artefact here at all, the budget asks whether there is too much of one, and the ` +
        `committed reading sits between them. Neither is the other's margin, so do not move this ` +
        `number to fit a reading. Run ${PROJECTION_COMMAND} on a tree that has the documents`,
    );
  }

  const named = new Set(PROJECTION_LEAF_PATHS);
  const reached = new Set(scan.paths);

  for (const path of scan.paths) {
    if (named.has(path)) continue;
    errors.push(
      `[position-ungoverned] ${PROJECTION_FILE} holds a leaf at ${path} and ` +
        `lib/projection-prose.ts gives that position no grammar, so nothing decides what may sit there`,
    );
  }

  for (const path of PROJECTION_LEAF_PATHS) {
    if (reached.has(path)) continue;
    errors.push(
      `[position-unreached] lib/projection-prose.ts gives ${path} a grammar and ${PROJECTION_FILE} ` +
        `has no leaf there, so that rule checks nothing and would not be noticed going wrong`,
    );
  }

  findings.push({
    level: 'info',
    message:
      `${String(scan.leaves)} leaf/leaves read across ${String(scan.paths.length)} position(s), ` +
      `each one of: ${scan.kinds.join(', ')}`,
  });

  // THE VOLUME IS PRINTED WHETHER OR NOT IT IS OVER, because it is the half no per value rule can
  // see and a reader who never sees the number has no way to notice it climbing. The digest total
  // is the one count no single position can bound: eight unreadable bytes each, and their number is
  // the size of what a changed generator could put through them.
  findings.push({
    level: 'info',
    message:
      `${largestVolume(scan)}, and ${String(scan.digests)} digests in all against a bound ` +
      `of ${String(DIGESTS_IN_THE_ARTEFACT)}. The generator is what keeps content out of this ` +
      `file; these bounds are what keep a mistake in it finite`,
  });

  // AND THE ONE NUMBER THAT IS ABOUT THE FILE IS PRINTED BESIDE ITS BUDGET, because the line above
  // it is per position and per position bounds multiply: filled to their own limits they weigh
  // 4.72 MB with nothing over. This is the reading a person can hold in their head.
  //
  // THE LEAF COUNT IS PRINTED WITH BOTH ENDS OF ITS CORRIDOR AND NOT ONLY THE BUDGET, because a
  // reader who only ever meets the floor in a red gate and the budget in a different red gate has
  // no way to see that the reading sits between two answers to two different questions.
  findings.push({
    level: 'info',
    message:
      `${String(scan.bytes)} bytes of ${String(PROJECTION_ARTEFACT_BUDGET.limitBytes)} and ` +
      `${String(scan.leaves)} leaves between a floor of ${String(PROJECTION_LEAF_FLOOR)}, under ` +
      `which the file is an absence rather than a reading, and a budget of ` +
      `${String(PROJECTION_ARTEFACT_BUDGET.leaves)}, over which it holds more than a reading can, ` +
      `over the whole artefact`,
  });

  if (scan.absences.length > 0) {
    findings.push({
      level: 'info',
      message: `held nothing, at a position declared that way: ${scan.absences.join('; ')}`,
    });
  }

  for (const message of errors) findings.push({ level: 'error', message });

  return {
    id: projectionPrivacyGate.id,
    title: projectionPrivacyGate.title,
    status: errors.length > 0 ? 'fail' : 'pass',
    findings,
  };
}

export const projectionPrivacyGate: Gate = {
  id: 'projection-privacy',
  title: 'Every leaf of the committed reading of ai-docs/ is one its position admits',

  run(context): Promise<GateResult> {
    return Promise.resolve(runProjectionPrivacyGate(context));
  },
};

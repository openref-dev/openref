/**
 * The one rule under both debt lists: a gate whose list is empty still reads its artefact.
 *
 * THE HOLE T035 FOUND, IN BOTH GATES AT ONCE. `capability-debts` walked the built bundle once per
 * entry, so with no entries it opened no file and passed. `budget-exceptions` returned before
 * `collectBudgetOutcomes` ran, so with no entries nothing was weighed and it passed. Both gates say
 * in their own headers that a missing build is an error and never a skip, and both kept that
 * promise per entry only: the day the last entry cleared, each of them became an unconditional pass
 * over material it had stopped looking at.
 *
 * THE TWO WAYS THAT MATTERS ARE DIFFERENT AND BOTH ARE REAL. The list clearing is the good day, and
 * it is exactly the day nobody is watching, so a gate that goes quiet then has gone quiet forever.
 * And a run with nothing built produces an empty list of problems from either gate whether the
 * repository is clean or the artefact is absent, which is the absence rule of SPEC 0 restated: a
 * proof that nothing is wrong passes trivially when nothing was looked at.
 *
 * SO THE READING IS A VALUE AND NOT A BRANCH. A gate builds one of these whatever its list holds,
 * prints it on every run, and fails when the count is zero. The words are the gate's own, because
 * what was read differs, and the shape is shared, because the rule does not.
 */

/** What one debt gate read this run, whether or not it had an entry to check. */
export interface ArtifactReading {
  /** What was read, in the words a finding prints, such as `built browser module`. */
  readonly unit: string;
  /** Where it was looked for, printed so a stale root is visible rather than inferred. */
  readonly where: string;
  /** How many units were read. Zero is a failure and never a pass. */
  readonly count: number;
  /** What a reader does about a count of zero, in one sentence. */
  readonly remedy: string;
}

/**
 * The line a gate prints on every run, empty list or not.
 *
 * @param reading - What was read
 * @returns One line naming the count, the unit and where it was looked for
 */
export function describeReading(reading: ArtifactReading): string {
  return `read ${String(reading.count)} ${reading.unit}(s) under ${reading.where}`;
}

/**
 * The finding for a reading that reached nothing.
 *
 * @param reading - What was read, whose count is zero
 * @returns One line saying the run checked nothing rather than finding nothing wrong
 */
export function emptyReadingMessage(reading: ArtifactReading): string {
  return (
    `no ${reading.unit} was read under ${reading.where}, so this run looked at nothing rather ` +
    `than finding nothing wrong. ${reading.remedy}`
  );
}

/**
 * Whether a reading reached its material.
 *
 * @param reading - What was read
 * @returns True when nothing was read, which is a failure in both debt gates
 */
export function readingIsEmpty(reading: ArtifactReading): boolean {
  return reading.count <= 0;
}

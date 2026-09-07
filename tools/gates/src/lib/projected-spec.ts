/**
 * The specification half of the five suite gates, read out of the committed projection.
 *
 * ONE READER FOR FIVE GATES, because they ask one question of one artefact and five copies of that
 * question is how one of them would come to accept what the others reject. `static-suites`,
 * `federation-suites`, `events-suites`, `m6-suites` and `m7-suites` each reconcile one or more
 * SPEC 21 rows and one SPEC 22 definition of done with their own wiring; what differs between them
 * is which row and which milestone, and that is all this takes as an argument.
 *
 * WHAT IT DOES WITH A DIGEST. The artefact records a coverage name and a done-when clause as a
 * digest, because those are sentences and no sentence of the private documents ships. Each gate
 * already spells the same words in its own configuration, so a digest that matches one of them is
 * turned back into it and the reconciliation runs on strings exactly as it did when it read the
 * document. A digest that matches none is a coverage the wiring does not answer, which is the
 * failure being reported: it comes back as the digest with the row it was stated in beside it, and
 * the comparison it loses is one it was going to lose anyway.
 *
 * THREE ANSWERS AND NOT TWO. A row can be stated, which is a list; absent from the document, which
 * is null and the `spec-row-missing` failure the gates already had; or absent from the ARTEFACT,
 * which is new and is neither. The third means the configuration asks for a row the last
 * generation did not project, so the artefact predates the question, and that is an error about
 * the artefact rather than a verdict about the specification.
 */

import {
  namesFromDigests,
  PROJECTION_COMMAND,
  PROJECTION_FILE,
  readProjection,
} from './projection.js';

/** What one suite gate needs read out of the artefact. */
export interface SpecHalfRequest {
  /** SPEC 21 row labels this gate reconciles, in the order its findings print them. */
  readonly rows: readonly string[];
  /** The milestone whose SPEC 22 definition of done this gate reconciles. */
  readonly milestone: string;
  /** The coverage names this gate's wiring spells, used to print a digest as its words. */
  readonly coverageNames: readonly string[];
  /** The clause texts this gate's wiring spells, used for the same. */
  readonly clauseNames: readonly string[];
}

/** What the artefact answered. */
export interface SpecHalf {
  /**
   * Whether the artefact answered everything asked of it.
   *
   * False means the document half was not compared with anything, which is a failure here rather
   * than a skip: the artefact is committed, so a checkout without a usable one is a defect in the
   * tree and not a property of the machine.
   */
  readonly read: boolean;
  /** Coverage names per row, null where the document states no such row. */
  readonly rows: ReadonlyMap<string, readonly string[] | null>;
  /** The milestone's clauses, null where the document states no definition of done for it. */
  readonly clauses: readonly string[] | null;
  /** What is wrong with the artefact itself, empty when it answered. */
  readonly errors: readonly string[];
}

/**
 * Reads the SPEC 21 rows and the SPEC 22 clauses one gate reconciles.
 *
 * @param repoRoot - Absolute repository root
 * @param request - Which rows, which milestone, and the words the gate already spells
 * @returns The reading, with any complaint about the artefact separated from it
 */
export function readSpecHalf(repoRoot: string, request: SpecHalfRequest): SpecHalf {
  const read = readProjection(repoRoot);
  const rows = new Map<string, readonly string[] | null>();
  const errors: string[] = [];

  if (!read.ok) {
    return { read: false, rows, clauses: null, errors: [`[projection-unreadable] ${read.reason}`] };
  }

  const spec = read.projection.data.spec;
  let complete = true;

  for (const row of request.rows) {
    const digests = spec.suiteRows[row];

    if (digests === undefined) {
      complete = false;
      errors.push(
        `[row-unprojected] ${PROJECTION_FILE} carries no reading of the SPEC 21 "${row}" row, so ` +
          `this gate's subject was not compared with anything. The artefact predates the row this ` +
          `gate reads; run ${PROJECTION_COMMAND} on a tree that has ai-docs/ and commit the result`,
      );
      continue;
    }

    rows.set(row, namesFromDigests(digests, request.coverageNames, `the SPEC 21 "${row}" row`));
  }

  const clauseDigests = spec.milestoneClauses[request.milestone];

  if (clauseDigests === undefined) {
    complete = false;
    errors.push(
      `[milestone-unprojected] ${PROJECTION_FILE} carries no reading of the SPEC 22 definition of ` +
        `done for ${request.milestone}, so the milestone was not compared with anything. Run ` +
        `${PROJECTION_COMMAND} on a tree that has ai-docs/ and commit the result`,
    );
  }

  return {
    read: complete,
    rows,
    clauses:
      clauseDigests === undefined
        ? null
        : namesFromDigests(
            clauseDigests,
            request.clauseNames,
            `the SPEC 22 ${request.milestone} definition of done`,
          ),
    errors,
  };
}

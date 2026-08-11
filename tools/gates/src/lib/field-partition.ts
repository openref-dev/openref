/**
 * A recorded field is checked, or it is listed as unchecked. There is no third state.
 *
 * `measured but never asserted`, SPEC 0: a field sits in a committed record, a separate check
 * consumes the record, nothing consumes that field, and the field's presence reads as coverage.
 * It has been found twice in this repository, in `BrowserBaseline.cspViolations` and in the
 * `bytes` of both fixture manifests, AND THE SECOND TIME IT CONTRADICTED AN AUDIT FROM THE
 * SESSION BEFORE THAT HAD REPORTED THE SAME FIELD AS READ. An audit is a sample of one reader's
 * attention; a partition is a fact about the file.
 *
 * The defence is a partition of the record's fields into two named maps, plus a walk of the
 * committed file that fails on a field in neither. A new field is then a decision rather than an
 * omission: whoever adds it has to say what reads it, or say that nothing does and why.
 *
 * THIS IS THE MECHANISM `browser-baseline.ts` ALREADY CARRIED, LIFTED SO THAT THE THREE RECORDS
 * SHARE ONE. A second implementation of the same idea is the next thing to drift.
 *
 * What it deliberately does not do is decide whether a reader is good enough. `unicodeRange` is
 * asserted by a test in `packages/theme` rather than by a gate, and that counts: the question is
 * whether a committed check would go red if the field were wrong, not which directory it lives
 * in.
 */

/** What a record's fields are split into, and where the record is. */
export interface FieldPartition {
  /** Repository relative path of the committed record, for the failure message. */
  readonly record: string;

  /** Every field a committed check reads, mapped to what reads it. */
  readonly asserted: Readonly<Record<string, string>>;

  /**
   * Every field no check reads, mapped to the reason nothing does.
   *
   * A reason is required and is held to a length. "Nobody got round to it" is the state this
   * map exists to make visible, and writing it down is what turns an absence into a decision.
   */
  readonly recordedNotAsserted: Readonly<Record<string, string>>;
}

/** One way a record and its partition disagree. */
export interface PartitionIssue {
  readonly rule: 'unaccounted' | 'both-lists' | 'stale' | 'reason-too-short';
  readonly field: string;
  readonly message: string;
}

/** The shortest reason that says anything. Below this it is a placeholder. */
const MIN_REASON_LENGTH = 20;

/**
 * The union of the field names of every entry of a record.
 *
 * A union rather than the first entry's keys, because an optional field present on one entry of
 * seventeen is exactly the field a sample misses.
 *
 * @param entries - Entries read from the committed file
 * @returns Field names, sorted, with no duplicates
 */
export function unionOfFields(entries: readonly Readonly<Record<string, unknown>>[]): string[] {
  const fields = new Set<string>();
  for (const entry of entries) for (const field of Object.keys(entry)) fields.add(field);
  return [...fields].sort((a, b) => a.localeCompare(b));
}

/**
 * Holds a record to its partition.
 *
 * @param fields - Field names the committed record actually carries
 * @param partition - What the record is declared to assert and to merely carry
 * @returns Everything wrong, empty when the record and the partition agree
 */
export function checkFieldPartition(
  fields: readonly string[],
  partition: FieldPartition,
): PartitionIssue[] {
  const issues: PartitionIssue[] = [];
  const { asserted, recordedNotAsserted, record } = partition;

  for (const field of fields) {
    const isAsserted = asserted[field] !== undefined;
    const isCarried = recordedNotAsserted[field] !== undefined;

    if (isAsserted && isCarried) {
      issues.push({
        rule: 'both-lists',
        field,
        message: `${record}: ${field} is listed as both checked and unchecked`,
      });
      continue;
    }

    if (!isAsserted && !isCarried) {
      issues.push({
        rule: 'unaccounted',
        field,
        message:
          `${record}: ${field} is in the record and in neither list. Name what reads it, or ` +
          `name the reason nothing does. A field beside a checked one reads as checked`,
      });
    }
  }

  // A LIST ENTRY FOR A FIELD THAT IS GONE IS A CHECK THAT CANNOT FAIL, and it should be removed
  // rather than left to look like coverage. Same rule the never-shipped list applies to itself.
  const present = new Set(fields);
  for (const field of [...Object.keys(asserted), ...Object.keys(recordedNotAsserted)]) {
    if (present.has(field)) continue;
    issues.push({
      rule: 'stale',
      field,
      message: `${record}: ${field} is partitioned and the record no longer carries it`,
    });
  }

  for (const [field, reason] of Object.entries(recordedNotAsserted)) {
    if (reason.trim().length >= MIN_REASON_LENGTH) continue;
    issues.push({
      rule: 'reason-too-short',
      field,
      message: `${record}: ${field} is listed as unchecked with no reason worth the name`,
    });
  }

  return issues;
}

/**
 * The display codes of SPEC 7.1, one per rule, decided 2026-08-14.
 *
 * A RULE HAS TWO NAMES WITH TWO JOBS. The kebab id is the identifier: it sits in the IR, it is
 * hashed, and it never changes. The display code is what the interface prints and a person
 * cites: the FixBar on an operation page closes with a rule code, and a code that lives only in
 * source is a code nobody can name. This table is the one place the two are joined; everything
 * that prints a code reads it from here, and SPEC 7.1 carries the same table beside the rules.
 *
 * FOUR GROUPS, NUMBERED IN CATALOGUE ORDER WITH GAPS OF TEN. `RT` is the runtime doing what the
 * specification is silent about or contradicts, `SP` is the specification asserting what the
 * runtime does not do, `SC` is the actual body against its schema, `DX` is the quality of the
 * documentation itself. The gap of ten is so a later rule related to an existing one lands in
 * its decade rather than at the end of the list. The SP group got its first three rules in
 * `TX-COLLECTORS`, the task that built the collectors behind them, appended after the RT block
 * so no existing code moved. `SC` is empty today on purpose: the prototypes name `SC030` for a
 * rule that does not exist, and a code without a rule is not assigned.
 */

import type { IRDriftRule } from '../../ir/domain/runtime.types';

/** Display code per rule, exactly the table of SPEC 7.1. */
export const DRIFT_RULE_CODES: Readonly<Record<IRDriftRule, string>> = {
  'security-drift': 'RT010',
  'scope-drift': 'RT020',
  'ratelimit-undocumented': 'RT030',
  'stream-unspecified': 'RT040',
  'error-undocumented': 'RT050',
  'orphan-operation': 'RT060',
  'discovery-incomplete': 'RT070',
  'parameter-unread': 'SP010',
  'header-requiredness-drift': 'SP011',
  'status-drift': 'SP012',
  'missing-description': 'DX010',
  'missing-example': 'DX020',
  'missing-operation-id': 'DX030',
  'dto-field-undescribed': 'DX040',
  'operation-key-unread': 'DX050',
};

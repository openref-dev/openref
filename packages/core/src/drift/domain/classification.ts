/**
 * The bucket of SPEC 7.4, computed per finding from the state of the thing it is about.
 *
 * THERE IS NO TABLE FROM RULE ID TO BUCKET HERE OR ANYWHERE ELSE, AND ITS ABSENCE IS THE POINT OF
 * THIS FILE. `ai-docs/REMEDIATION.md` section 2 records the correction: the rule name selects
 * which check runs, and the state of the node decides which bucket the finding lands in, so one
 * rule produces silence findings and contradiction findings in the same run. Classifying by rule
 * name looks like it works until the first node where the specification already asserts something,
 * and on that node it hands a conflicting assertion to a fix mode as though it were a silence.
 *
 * SO THE ONLY TWO INPUTS ARE THE SHAPE OF THE EDIT AND THE PROVENANCE OF THE FACT, and neither of
 * them can be read off a rule id. A rule reports what it saw; this function decides what that
 * means. Nothing else in the package is allowed to write a classification, which is what keeps the
 * two from drifting apart.
 *
 * ORDER MATTERS IN ONE PLACE AND IT IS NOT AN IMPLEMENTATION DETAIL. A contradiction is judged
 * before confidence is looked at, because SPEC 7.4 says a contradiction is never auto-fixable at
 * any confidence level, ever. Judging confidence first would file a contradiction resting on an
 * `inferred` fact as confidence starvation, which is the bucket a better collector is allowed to
 * empty, and a better collector must never make a contradiction fixable.
 */

import type {
  IRDriftBasis,
  IRDriftClassification,
  IRDriftEdit,
} from '../../ir/domain/runtime.types';

/**
 * Decides which bucket of SPEC 7.4 a finding belongs to.
 *
 * @param edit - What writing the runtime fact into the source would require
 * @param basis - The runtime fact behind the finding, or the statement that there is none
 * @returns The bucket, with the reason when a person has to look at it
 */
export function classifyDrift(edit: IRDriftEdit, basis: IRDriftBasis): IRDriftClassification {
  if (edit === 'conflicting-assertion' || edit === 'deleted-assertion') {
    return { bucket: 'contradiction' };
  }

  // `unscoped-assertion` JOINS THESE TWO AND NOT THE `nothing-to-write` LINE BELOW. There is an
  // observed fact behind it, so calling it `no-observed-fact` would be false; what is ambiguous is
  // whether the fact reaches this subject, and that is a structure a person reads and no collector
  // can. It must never become fixable by a better collector, which is what would happen if it were
  // filed as confidence starvation.
  if (
    edit === 'narrowed-assertion' ||
    edit === 'already-asserted' ||
    edit === 'unscoped-assertion'
  ) {
    return { bucket: 'manual', reason: 'structural-ambiguity' };
  }

  if (edit === 'nothing-to-write' || basis.kind === 'unobserved') {
    return { bucket: 'manual', reason: 'no-observed-fact' };
  }

  if (basis.confidence === 'inferred') {
    return { bucket: 'manual', reason: 'confidence-starvation' };
  }

  return { bucket: 'silence' };
}

/**
 * Reports whether a finding is of the class a fix mode may apply without a person deciding.
 *
 * IT IS A FUNCTION AND NOT A FIELD ON THE FINDING, deliberately. A field would be an answer this
 * task froze into the report, and the report is read by `--fix`, by `doctor`, by the health panel
 * and by a third party agent, none of which exist yet. The rule of SPEC 7.4 lives here in one
 * place, so a consumer that wants it asks rather than recomputes, and a finding never carries a
 * field that presumes an edit was made.
 *
 * @param classification - The bucket the finding landed in
 * @param basis - The runtime fact behind it
 * @returns True only for a silence resting on a fact at `derived` confidence or above
 */
export function isMechanicallyFixable(
  classification: IRDriftClassification,
  basis: IRDriftBasis,
): boolean {
  if (classification.bucket !== 'silence') return false;

  return basis.kind === 'collected' && basis.confidence !== 'inferred';
}

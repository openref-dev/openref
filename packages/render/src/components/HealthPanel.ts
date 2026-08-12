/**
 * Documentation Health, per SPEC 7.2 and 7.3: what the document scores, what was asked of it,
 * and every disagreement with the running application.
 *
 * IT IS BUILT FOR FOUR HUNDRED FINDINGS AND FOR TWO. Four hundred findings are still at most ten
 * rules, so the panel lists rules and a rule opens to its findings. A flat list of four hundred
 * rows is a panel a reader closes once and does not open again, and the panel exists to be
 * opened.
 *
 * THE DISCLOSURE IS `details` AND `summary` AND NOT A SCRIPT. It is keyboard reachable, it is
 * announced as expandable, it survives a page whose JavaScript never arrives, and it costs the
 * strict CSP of SPEC 19 nothing, because there is no handler to authorize. A filter written in
 * script would have been the same feature at the price of bytes in the first paint.
 *
 * NO GROUP IS TRUNCATED, AND A CLOSED ONE SAYS ITS FULL COUNT. A panel that quietly showed the
 * first twenty of a rule's findings would read as coverage while hiding the tail, which is the
 * defect class this repository keeps removing.
 *
 * A FAILED COLLECTOR IS A CHECK AND NEVER A FINDING, per SPEC 7. It arrives in the check list as
 * `runtime-collectors`. The two are easiest to confuse in exactly this panel, because a broken
 * tool and a disagreement between two documents draw as neighbouring rows; a drift row sends a
 * reader to edit their own code, and a defect in this package is not something they can fix
 * there.
 */

import { h, type VNode } from 'vue';
import { driftRow } from './RuntimePanel';
import type { HealthCheckModel, HealthModel, HealthRuleModel } from '../page/domain/page-model';

/**
 * One check: how many subjects passed it, out of how many it applied to.
 *
 * A CHECK WITH NOTHING TO COUNT IS STILL SHOWN AND IS NOT SCORED, per SPEC 7.2. A document with
 * no streaming endpoint is asked nine questions rather than given the tenth for free, and the
 * row saying so is how a reader knows the question was not skipped by accident.
 *
 * THE COUNT CARRIES THE VERDICT AND NO SEVERITY COLOUR DOES. `124 / 127` says which checks are
 * short of the mark without a second channel repeating it, and the design has no glyph to spare:
 * the marks a report usually prints, a tick and a warning triangle, are outside the latin and
 * latin-ext subsets this theme ships, so they would arrive in whatever font the reader happens
 * to have.
 *
 * @param check - The check
 * @returns The row
 */
const checkRow = (check: HealthCheckModel): VNode =>
  h('li', { class: 'oref-check' }, [
    h('span', { class: 'oref-check-count' }, check.count),
    check.label,
  ]);

/**
 * One rule, closed, with its count on the line a reader scans.
 *
 * @param rule - The rule and its findings
 * @returns The disclosure
 */
const ruleGroup = (rule: HealthRuleModel): VNode =>
  h('details', { class: 'oref-rule' }, [
    h('summary', { class: 'oref-rule-head' }, [
      h('span', { class: 'oref-drift-rule' }, rule.rule),
      h('span', { class: 'oref-rule-count' }, rule.count),
    ]),
    h('ul', { class: 'oref-drift-list' }, rule.findings.map(driftRow)),
  ]);

/**
 * Renders the Health panel of one document.
 *
 * A FUNCTION AND NOT `defineComponent`, WHICH IS THE ONE PLACE IN THIS PACKAGE THAT IS TRUE. It
 * has no state, no lifecycle and no attribute fallthrough to arrange, so the options object
 * around it would be seventy bytes of chunk buying a name in the devtools. This is the component
 * whose chunk is measured against the tightest cap in SPEC 20, and seventy bytes is a real
 * fraction of what that cap has left.
 *
 * @param props - The report, already reduced to what is drawn
 * @returns The panel
 */
export function HealthPanel(props: { readonly health: HealthModel }): VNode {
  const health = props.health;

  // ONE CLASS AND NOT `oref-section` BESIDE IT: the theme says that a health section is a
  // section, in the selector list of the rule that draws one, rather than the markup saying it
  // on the page of every document. Thirteen bytes of a chunk SPEC 20 measures to the byte.
  return h('section', { class: 'oref-section-health' }, [
    h('h2', { class: 'oref-section-title' }, health.title),
    h('p', { class: 'oref-health-score' }, health.score),
    h('ul', { class: 'oref-check-list' }, health.checks.map(checkRow)),
    ...health.rules.map(ruleGroup),
  ]);
}

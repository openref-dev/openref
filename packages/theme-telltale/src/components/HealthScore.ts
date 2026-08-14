import { h, type VNode } from 'vue';
import DriftCard from './DriftCard';
import type { HealthModel } from '@openref/vue';

/**
 * Documentation Health, per SPEC 7.2, and the one position of the registry that runs on the server.
 *
 * IT MUST RENDER WITH NO CLIENT STATE, and everything about how it is written follows from that.
 * Whatever this draws is what the reader receives: the report does not travel, so the browser
 * fills this position with an element that adopts the markup already under it rather than one that
 * draws it again. A component with a `ref` in it would get nothing here, and would fail in the one
 * way nothing reports, by working in every test that renders it directly.
 *
 * SO THE FILTER IS `details` AND `summary`, WHICH THE USER AGENT OPENS. `RuleFilter` was in the
 * registry until `TX-SLOTWIRE` and was removed for exactly this reason: a scripted filter here
 * costs the first paint and needs a policy that allows the script, and the element the language
 * already has does the job with neither.
 *
 * A findings row is the `DriftCard` position, rendered directly rather than through the registry,
 * because a registry lookup is a `setup` call and this is a function component drawn on the server.
 *
 * THE ROOT ELEMENT IS `section.oref-section-health` AND IT CARRIES NOTHING ELSE, WHICH IS A RULE
 * THIS THEME DID NOT WRITE. The browser fills this position with `h('section', { class:
 * 'oref-section-health' })` and nothing more, so the class list is compared against exactly that
 * one name: a root that also carried `tt-health` would have it patched away on hydration, silently,
 * and only in a browser. So this theme's own class goes on the element inside, and a theme is
 * required to write a class from the reference's namespace to fill a position of its own. That is
 * a finding rather than an inconvenience and it is in `THEME-BOUNDARY.md`.
 */
export default function HealthScore(props: { readonly health: HealthModel }): VNode {
  const health = props.health;

  return h('section', { class: 'oref-section-health' }, [
    h('div', { class: 'tt-health' }, [
      h('div', { class: 'tt-health-line' }, [
        h('h2', { class: 'tt-strip-head' }, 'HEALTH'),
        h('span', { class: 'tt-health-score' }, health.score),
        h('span', { class: 'tt-health-title' }, health.title),
      ]),
      h(
        'ul',
        { class: 'tt-health-checks' },
        health.checks.map((check) =>
          h('li', { class: 'tt-health-check', key: check.label }, [
            h('span', { class: 'tt-health-check-label' }, check.label),
            h('span', { class: 'tt-health-check-count' }, check.count),
          ]),
        ),
      ),
      h(
        'div',
        { class: 'tt-health-rules' },
        health.rules.map((rule) =>
          h('details', { class: 'tt-health-rule', key: rule.rule }, [
            h('summary', { class: 'tt-health-rule-head' }, [
              h('span', { class: 'tt-health-rule-name' }, rule.rule),
              h('span', { class: 'tt-health-rule-count' }, rule.count),
            ]),
            h(
              'ul',
              { class: 'tt-health-findings' },
              rule.findings.map((issue, index) => h(DriftCard, { issue, key: index })),
            ),
          ]),
        ),
      ),
    ]),
  ]);
}

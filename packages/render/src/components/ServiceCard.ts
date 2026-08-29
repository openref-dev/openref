/**
 * The federated service card, per SPEC 15.3: what one service said about itself.
 *
 * IT RUNS ON THE SERVER AND NOWHERE ELSE, the Health panel's rule and for the Health panel's
 * reason: nothing here is reactive, so the browser adopts the markup instead of redrawing it,
 * and neither this component nor the service's findings ride any client chunk. The one live
 * fact on the page, the remote's current status, is not drawn here at all: the page is cached
 * by document hash and a degrading remote does not change the hash, so the status arrives in
 * the browser from `<mount>/_federation` and lands on the `data-oref-service` elements this
 * card renders empty. A server drawn status would be right at render time and wrong exactly
 * when it matters.
 *
 * THE HEALTH HALF IS THE HEALTH PAGE'S OWN PANEL, resolved through the same `HealthScore`
 * slot, because a service's report is a report: same score arithmetic, same rule rows, same
 * finding cards, and the findings already address merged names per SPEC 15.1, so every row
 * links to a node this document really has. A theme that overrides the panel overrides it
 * here too, which is one vocabulary rather than two.
 */

import { useSlot } from '@openref/vue';
import { h, type VNode } from 'vue';
import { HealthPanel } from './HealthPanel';
import { MarkdownBlock } from './MarkdownBlock';
import { StateNotice } from './StateNotice';
import type { ServicePageModel } from '@openref/vue';

/** One labelled fact row of the card's meta list. */
const fact = (label: string, value: VNode | string): VNode =>
  h('div', { class: 'oref-service-fact' }, [
    h('span', { class: 'oref-service-fact-label' }, label),
    typeof value === 'string' ? h('span', { class: 'oref-service-fact-value' }, value) : value,
  ]);

/**
 * Renders one service's card.
 *
 * A function and not `defineComponent`, the Health panel's economy: no state, no lifecycle,
 * no fallthrough to arrange.
 *
 * @param props - The service, already reduced to what is drawn
 * @returns The card
 */
export function ServiceCard(props: { readonly service: ServicePageModel }): VNode {
  const service = props.service;
  const health = useSlot('HealthScore', HealthPanel);
  const notice = useSlot('StateNotice', StateNotice);

  // THE ROOT CARRIES THE CLASS AND NOTHING ELSE, because the browser's filling is a childless
  // element with exactly this tag and class, and an extra attribute here would be a hydration
  // difference on the one element the two sides compare.
  return h('article', { class: 'oref-service-page' }, [
    h('header', { class: 'oref-operation-header' }, [
      h('p', { class: 'oref-section-title oref-service-kicker' }, 'Service'),
      h('h1', { class: 'oref-title' }, service.title),
      h('p', { class: 'oref-service-meta' }, [
        h('span', { class: 'oref-service-id' }, service.id),
        h('span', {}, `v${service.version}`),
        h('span', {}, service.kind),
        // The live half: empty here, filled by the browser from the federation snapshot. A
        // service with no remote entry is local, per SPEC 15.3, and keeps the neutral mark.
        h('span', { class: 'oref-service-status', 'data-oref-service': service.id }),
      ]),
    ]),
    h(MarkdownBlock, { html: service.descriptionHtml }),
    h('section', { class: 'oref-section oref-section-service' }, [
      h('h2', { class: 'oref-section-title' }, 'What the service declares'),
      fact('mounted under', service.prefix === '' ? 'no prefix' : service.prefix),
      fact('operations', String(service.operations)),
      fact('source document', `${service.documentId} (${service.documentHash.slice(0, 12)})`),
      fact(
        'servers',
        service.servers.length === 0
          ? 'none declared'
          : h(
              'ul',
              { class: 'oref-service-servers' },
              service.servers.map((server) => h('li', { class: 'oref-server' }, server)),
            ),
      ),
      // The runtime meta is the collectors that ran, per SPEC 6: a service fetched as a
      // specification ran none, and saying so is the honest sentence rather than an empty list
      // pretending to be a measurement.
      fact(
        'runtime collectors',
        service.collectors.length === 0
          ? 'none ran on this document'
          : service.collectors.join(', '),
      ),
    ]),
    service.health !== null
      ? h(health.value, { health: service.health })
      : h(notice.value, {
          kind: 'health-missing',
          message:
            'No health report exists for this service. Nothing has measured it, which is a ' +
            'different statement from a score of zero.',
        }),
  ]);
}

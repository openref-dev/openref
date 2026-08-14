/**
 * The head of a node page: what the operation is, and where it lives.
 *
 * ONE POSITION, ONE LABEL, which is findings F15 and F19. An operation with no title of its own
 * takes one from its summary, so on most documents the two are the same string and the header
 * printed it as a heading and again as a subtitle. The subtitle survives only where it says
 * something the heading does not.
 *
 * THE METHOD AND THE PATH ARE THE HEADING, since `TX-PARITY-UI` adopted the layout's order and
 * emphasis: the badge and the path stand large with the drift box beside them, and the summary
 * moves to the meta line with the bench link. A channel keeps its address as the heading, and a
 * node with neither, which the IR does not produce, keeps its title. The badge says `SSE` for
 * an operation whose declared responses carry `text/event-stream`, per the same task: the
 * method stays a fact on the model, and the badge is the design's identity mark.
 *
 * IT DRAWS THE COUNT OF THE FINDINGS AND NONE OF THEIR CONTENT, since `TX-MARKUP`. The header
 * held to a draws-no-drift decision while the findings lived beside the runtime facts; the
 * layout directory, authoritative since the session 54 contract amendment, puts the count box in
 * the head, and the amendment overrules the old decision for layout. What did not change is
 * where a reader acts: the FixBar under the drifted row carries the finding, and the box is the
 * design's number, drawn above zero only, per the `driftCount` rule.
 *
 * THE KICKER QUOTES THE DOCUMENT: the first tag, then the public operation id of SPEC 5.4, each
 * segment only when the document has it. The source link is NOT here, although the layout draws
 * one: the parity scale's source row owns it, and one page saying one thing twice is the F15
 * class this header already answered once.
 *
 * THE BENCH BUTTON EXISTS EXACTLY WHEN THE BENCH TAB DOES: `benchHref` arrives empty otherwise,
 * so the header can never offer a console the frame does not have, which would be the F14 class
 * of dead control.
 */

import { h, type VNode } from 'vue';
import { methodBadge } from './method-badge';
import type { DriftModel, NodeHeaderModel } from '@openref/vue';

/**
 * Renders the header of one operation or channel.
 *
 * @param props - The node, the findings against it, and where its bench is
 * @returns The header
 */
export function OperationHeader(props: {
  readonly node: NodeHeaderModel;
  readonly drift: readonly DriftModel[];
  readonly benchHref: string;
}): VNode {
  const node = props.node;
  const badge = node.method === null ? null : methodBadge(node.method, node.sse);

  // The heading is the address: badge and path for an operation, the address for a channel,
  // and the title only where the model carries neither, which the IR does not produce.
  const heading =
    badge !== null
      ? h('h1', { class: 'oref-operation-title oref-title oref-endpoint' }, [
          h('span', { class: `oref-badge ${badge.className}` }, badge.text),
          h('code', { class: 'oref-path' }, node.path ?? ''),
        ])
      : node.address !== null
        ? h('h1', { class: 'oref-operation-title oref-title' }, [
            h('code', { class: 'oref-address' }, node.address),
          ])
        : h('h1', { class: 'oref-operation-title oref-title' }, node.title);

  const group = node.tags[0] ?? '';
  const kicker =
    group === '' && node.operationId === ''
      ? null
      : h('div', { class: 'oref-kicker' }, [
          group === '' ? null : h('span', { class: 'oref-kicker-group' }, group),
          group === '' || node.operationId === ''
            ? null
            : h('span', { 'aria-hidden': 'true' }, '/'),
          node.operationId === '' ? null : h('code', { class: 'oref-kicker-id' }, node.operationId),
        ]);

  // THE META LINE, per the layout: the summary, then the bench link. The summary survives
  // only where it says something the heading does not, the F15 rule: against a heading that
  // is the address it always does, and only a heading that fell back to the title can
  // coincide with it.
  const headingIsTitle = badge === null && node.address === null;
  const summary =
    node.summary === '' || (headingIsTitle && node.summary === node.title)
      ? null
      : h('p', { class: 'oref-subtitle' }, node.summary);
  const bench =
    props.benchHref === ''
      ? null
      : h('a', { class: 'oref-bench-link', href: props.benchHref }, 'Request bench');
  const meta =
    summary === null && bench === null
      ? null
      : h('div', { class: 'oref-operation-meta' }, [summary, bench]);

  return h('header', { class: 'oref-operation-header' }, [
    kicker,
    h('div', { class: 'oref-operation-head-row' }, [
      heading,
      // ZERO DRAWS NO BOX, per the driftCount rule: the box is a warning figure, so its
      // absence asserts nothing, and a document nothing measured shows none.
      props.drift.length === 0
        ? null
        : h('div', { class: 'oref-driftbox' }, [
            h('span', { class: 'oref-driftbox-count' }, String(props.drift.length)),
            h('span', { class: 'oref-driftbox-label' }, 'drift'),
          ]),
    ]),
    node.deprecated ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated') : null,
    meta,
  ]);
}

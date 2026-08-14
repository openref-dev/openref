/**
 * The head of a node page: what the operation is, and where it lives.
 *
 * ONE POSITION, ONE LABEL, which is findings F15 and F19. An operation with no title of its own
 * takes one from its summary, so on most documents the two are the same string and the header
 * printed it as a heading and again as a subtitle. The subtitle survives only where it says
 * something the heading does not.
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
import type { DriftModel, NodeHeaderModel } from '@openref/vue';

function methodClass(method: string): string {
  const known = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return known.includes(method) ? `oref-method-${method.toLowerCase()}` : 'oref-method-other';
}

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

  const address =
    node.method === null
      ? node.address === null
        ? null
        : h('code', { class: 'oref-address' }, node.address)
      : h('span', { class: 'oref-endpoint' }, [
          h('span', { class: `oref-badge ${methodClass(node.method)}` }, node.method),
          h('code', { class: 'oref-path' }, node.path ?? ''),
        ]);

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

  return h('header', { class: 'oref-operation-header' }, [
    kicker,
    h('div', { class: 'oref-operation-head-row' }, [
      h('h1', { class: 'oref-operation-title oref-title' }, node.title),
      // ZERO DRAWS NO BOX, per the driftCount rule: the box is a warning figure, so its
      // absence asserts nothing, and a document nothing measured shows none.
      props.drift.length === 0
        ? null
        : h('div', { class: 'oref-driftbox' }, [
            h('span', { class: 'oref-driftbox-count' }, String(props.drift.length)),
            h('span', { class: 'oref-driftbox-label' }, 'drift'),
          ]),
    ]),
    address,
    node.deprecated ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated') : null,
    node.summary === '' || node.summary === node.title
      ? null
      : h('p', { class: 'oref-subtitle' }, node.summary),
    props.benchHref === ''
      ? null
      : h('a', { class: 'oref-bench-link', href: props.benchHref }, 'Request bench'),
  ]);
}

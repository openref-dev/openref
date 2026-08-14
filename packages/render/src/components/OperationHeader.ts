/**
 * The head of a node page: what the operation is, and where it lives.
 *
 * ONE POSITION, ONE LABEL, which is findings F15 and F19. An operation with no title of its own
 * takes one from its summary, so on most documents the two are the same string and the header
 * printed it as a heading and again as a subtitle. The subtitle survives only where it says
 * something the heading does not.
 *
 * IT IS HANDED THE FINDINGS AND DRAWS NONE OF THEM, and that is a decision rather than an unused
 * prop. The reference draws a finding beside the runtime fact it contradicts, in the runtime
 * column, because that is where a reader can act on it; a count in the header would be a second
 * place saying the same thing. A theme whose layout has no runtime column, which is what telltale
 * and forge are, needs the findings here, and it has them.
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
 * @param props - The node, and the findings against it
 * @returns The header
 */
export function OperationHeader(props: {
  readonly node: NodeHeaderModel;
  readonly drift: readonly DriftModel[];
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

  return h('header', { class: 'oref-operation-header' }, [
    h('h1', { class: 'oref-operation-title oref-title' }, node.title),
    address,
    node.deprecated ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated') : null,
    node.summary === '' || node.summary === node.title
      ? null
      : h('p', { class: 'oref-subtitle' }, node.summary),
  ]);
}

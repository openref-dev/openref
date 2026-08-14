import { h, type VNode } from 'vue';
import type { DriftModel, NodeHeaderModel } from '@openref/vue';

/**
 * The head of a node page: the method, the path, and every finding against the operation.
 *
 * THIS THEME DRAWS THE FINDINGS HERE AND THE REFERENCE DOES NOT, which is the difference the prop
 * exists for. vernier puts a finding beside the runtime fact it contradicts, in a runtime column;
 * this theme has no runtime column, so a finding that was only ever drawn there would be a finding
 * this layout never shows. The count is in the header and the findings themselves are `DriftCard`
 * positions further down the page.
 *
 * The method colour comes from `--oref-color-method-*` through a class, never from an inline
 * style: an inline `style` attribute cannot be authorized by a CSP nonce, per SPEC 19.
 */
const KNOWN_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function OperationHeader(props: {
  readonly node: NodeHeaderModel;
  readonly drift: readonly DriftModel[];
}): VNode {
  const node = props.node;
  const method = node.method;
  const methodClass =
    method === null
      ? null
      : KNOWN_METHODS.includes(method)
        ? `tt-method-${method.toLowerCase()}`
        : 'tt-method-other';

  return h('header', { class: 'tt-op-head' }, [
    h('div', { class: 'tt-op-line' }, [
      method === null
        ? h('span', { class: 'tt-op-kind' }, node.kind.slice(0, 3).toUpperCase())
        : h('span', { class: ['tt-method', methodClass] }, method),
      h('code', { class: 'tt-op-path' }, node.path ?? node.address ?? ''),
      node.deprecated ? h('span', { class: 'tt-flag tt-flag-deprecated' }, 'DEPRECATED') : null,
      props.drift.length === 0
        ? h('span', { class: 'tt-op-clean' }, 'NO FINDINGS')
        : h('span', { class: 'tt-op-drift' }, `${String(props.drift.length)} FINDINGS`),
    ]),
    h('h1', { class: 'tt-op-title' }, node.title),
    node.summary === '' || node.summary === node.title
      ? null
      : h('p', { class: 'tt-op-summary' }, node.summary),
  ]);
}

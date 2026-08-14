/**
 * Parameters of an operation, in one table.
 *
 * ONE ORDER ON BOTH SURFACES, per SPEC 11: `PARAMETER_LOCATIONS` and `orderedParameters` in
 * `@openref/vue` decide it, and the try-it console reads the same two. The table printed
 * document order and the form printed grouped order until 2026-08-12, so a reader filling the
 * form after reading the table looked for every field twice.
 *
 * THE RUNTIME COLUMNS ARE THE LAYOUT'S, since `TX-PARITY-UI`: requiredness as its own column,
 * the provenance chip and the note on rows a fact touches, and the highlight on a row SP010
 * names. A spec-declared row with no fact carries no chip, the responses precedent, because
 * SPEC 6.1's vocabulary is about runtime facts; and the two runtime columns draw only when
 * some row has a fact, per SPEC 6.3's absent-rather-than-empty.
 *
 * THE DESCRIPTION IS HTML THE SERVER RENDERED AND SANITIZED, per SPEC 12, which is what makes
 * this position a slot at all: `IRParameter` carries markdown source, and a theme handed the
 * source would have to render markdown in the browser.
 */

import { h, type VNode } from 'vue';
import { useSlot } from '@openref/vue';
import { MarkdownBlock } from './MarkdownBlock';
import { ProvenanceTag } from './ProvenanceTag';
import type { ParameterModel } from '@openref/vue';
import type { Component } from 'vue';

function parameterRow(parameter: ParameterModel, withRuntime: boolean, tag: Component): VNode {
  const flags: VNode[] = [];
  if (parameter.deprecated) {
    flags.push(h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated'));
  }

  return h(
    'tr',
    {
      class: ['oref-param-row', parameter.unread ? 'oref-param-drift' : ''],
      key: `${parameter.location}:${parameter.name}`,
    },
    [
      h('td', { class: 'oref-param-name' }, [h('code', {}, parameter.name), ...flags]),
      h('td', { class: 'oref-param-in' }, parameter.location),
      h('td', { class: 'oref-param-type' }, parameter.typeLabel),
      h(
        'td',
        { class: 'oref-param-req' },
        parameter.required ? h('span', { class: 'oref-required' }, 'required') : '',
      ),
      ...(withRuntime
        ? [
            h(
              'td',
              { class: 'oref-param-prov' },
              parameter.confidence === null
                ? ''
                : [h(tag, { confidence: parameter.confidence, collector: parameter.collector })],
            ),
            h('td', { class: 'oref-param-note' }, parameter.runtimeNote),
          ]
        : []),
      h('td', { class: 'oref-param-doc' }, [h(MarkdownBlock, { html: parameter.descriptionHtml })]),
    ],
  );
}

/**
 * Renders the parameters block.
 *
 * @param props - The parameters, in the order both surfaces print them
 * @returns The section
 */
export function ParamTable(props: { readonly parameters: readonly ParameterModel[] }): VNode {
  const tag = useSlot('ProvenanceTag', ProvenanceTag).value;
  const withRuntime = props.parameters.some((parameter) => parameter.confidence !== null);

  return h('section', { class: 'oref-section oref-section-parameters' }, [
    h('h2', { class: 'oref-section-title' }, [
      'Parameters ',
      h('span', { class: 'oref-section-count' }, String(props.parameters.length)),
    ]),
    h('table', { class: 'oref-table' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { scope: 'col' }, 'Name'),
          h('th', { scope: 'col' }, 'In'),
          h('th', { scope: 'col' }, 'Type'),
          h('th', { scope: 'col' }, 'Required'),
          ...(withRuntime
            ? [h('th', { scope: 'col' }, 'Provenance'), h('th', { scope: 'col' }, 'Runtime note')]
            : []),
          h('th', { scope: 'col' }, 'Description'),
        ]),
      ]),
      h(
        'tbody',
        {},
        props.parameters.map((parameter) => parameterRow(parameter, withRuntime, tag)),
      ),
    ]),
  ]);
}

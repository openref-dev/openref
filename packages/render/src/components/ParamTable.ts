/**
 * Parameters of an operation, in one table.
 *
 * ONE ORDER ON BOTH SURFACES, per SPEC 11: `PARAMETER_LOCATIONS` and `orderedParameters` in
 * `@openref/vue` decide it, and the try-it console reads the same two. The table printed
 * document order and the form printed grouped order until 2026-08-12, so a reader filling the
 * form after reading the table looked for every field twice.
 *
 * THE DESCRIPTION IS HTML THE SERVER RENDERED AND SANITIZED, per SPEC 12, which is what makes
 * this position a slot at all: `IRParameter` carries markdown source, and a theme handed the
 * source would have to render markdown in the browser.
 */

import { h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import type { ParameterModel } from '@openref/vue';

function parameterRow(parameter: ParameterModel): VNode {
  const flags: VNode[] = [];
  if (parameter.required) flags.push(h('span', { class: 'oref-required' }, 'required'));
  if (parameter.deprecated) {
    flags.push(h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated'));
  }

  return h('tr', { class: 'oref-param-row', key: `${parameter.location}:${parameter.name}` }, [
    h('td', { class: 'oref-param-name' }, [h('code', {}, parameter.name), ...flags]),
    h('td', { class: 'oref-param-in' }, parameter.location),
    h('td', { class: 'oref-param-type' }, parameter.typeLabel),
    h('td', { class: 'oref-param-doc' }, [h(MarkdownBlock, { html: parameter.descriptionHtml })]),
  ]);
}

/**
 * Renders the parameters block.
 *
 * @param props - The parameters, in the order both surfaces print them
 * @returns The section
 */
export function ParamTable(props: { readonly parameters: readonly ParameterModel[] }): VNode {
  return h('section', { class: 'oref-section oref-section-parameters' }, [
    h('h2', { class: 'oref-section-title' }, 'Parameters'),
    h('table', { class: 'oref-table' }, [
      h('thead', {}, [
        h('tr', {}, [
          h('th', { scope: 'col' }, 'Name'),
          h('th', { scope: 'col' }, 'In'),
          h('th', { scope: 'col' }, 'Type'),
          h('th', { scope: 'col' }, 'Description'),
        ]),
      ]),
      h('tbody', {}, props.parameters.map(parameterRow)),
    ]),
  ]);
}

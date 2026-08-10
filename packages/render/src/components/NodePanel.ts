/**
 * The current node: what a reference page is actually about.
 *
 * It renders the model and computes nothing. Markdown is already HTML, examples are
 * already highlighted, types are already labelled. That is what lets the same component
 * render on the server and hydrate in the browser without either `marked` or `shiki`
 * crossing into the client bundle.
 */

import { defineComponent, h, type PropType, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import type { MediaTypeModel, NodeModel, ParameterModel } from '../page/domain/page-model';

function methodClass(method: string): string {
  const known = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return known.includes(method) ? `oref-method-${method.toLowerCase()}` : 'oref-method-other';
}

function statusClass(statusCode: string): string {
  const first = statusCode.slice(0, 1);
  return /^[1-5]$/.test(first) ? `oref-status-${first}xx` : 'oref-status-default';
}

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

function mediaTypeBlock(media: MediaTypeModel, key: string): VNode {
  return h('div', { class: 'oref-media', key }, [
    h('div', { class: 'oref-media-head' }, [
      h('code', { class: 'oref-media-type' }, media.mediaType),
      media.typeLabel === '' ? null : h('span', { class: 'oref-media-schema' }, media.typeLabel),
    ]),
    h(MarkdownBlock, { html: media.exampleHtml, className: 'oref-example' }),
  ]);
}

function section(title: string, className: string, body: readonly VNode[]): VNode {
  return h('section', { class: `oref-section ${className}` }, [
    h('h2', { class: 'oref-section-title' }, title),
    ...body,
  ]);
}

/** Renders one operation or channel. */
export const NodePanel = defineComponent({
  name: 'OrefNodePanel',

  props: {
    node: { type: Object as PropType<NodeModel>, required: true },
  },

  setup(props) {
    return (): VNode => {
      const node = props.node;
      const parts: (VNode | null)[] = [];

      const address =
        node.method === null
          ? node.address === null
            ? null
            : h('code', { class: 'oref-address' }, node.address)
          : h('span', { class: 'oref-endpoint' }, [
              h('span', { class: `oref-badge ${methodClass(node.method)}` }, node.method),
              h('code', { class: 'oref-path' }, node.path ?? ''),
            ]);

      parts.push(
        h('header', { class: 'oref-operation-header' }, [
          h('h1', { class: 'oref-operation-title oref-title' }, node.title),
          address,
          node.deprecated ? h('span', { class: 'oref-badge oref-deprecated' }, 'deprecated') : null,
          node.summary === '' ? null : h('p', { class: 'oref-subtitle' }, node.summary),
        ]),
      );

      parts.push(h(MarkdownBlock, { html: node.descriptionHtml }));

      if (node.security.length > 0) {
        parts.push(
          section('Security', 'oref-section-security', [
            h(
              'ul',
              { class: 'oref-security-list' },
              node.security.map((requirement) =>
                h('li', { class: 'oref-security-item', key: requirement.schemeId }, [
                  h('code', {}, requirement.schemeId),
                  h('span', { class: 'oref-security-type' }, requirement.type),
                  requirement.scopes.length === 0
                    ? null
                    : h('span', { class: 'oref-security-scopes' }, requirement.scopes.join(', ')),
                ]),
              ),
            ),
          ]),
        );
      }

      if (node.parameters.length > 0) {
        parts.push(
          section('Parameters', 'oref-section-parameters', [
            h('table', { class: 'oref-table' }, [
              h('thead', {}, [
                h('tr', {}, [
                  h('th', { scope: 'col' }, 'Name'),
                  h('th', { scope: 'col' }, 'In'),
                  h('th', { scope: 'col' }, 'Type'),
                  h('th', { scope: 'col' }, 'Description'),
                ]),
              ]),
              h('tbody', {}, node.parameters.map(parameterRow)),
            ]),
          ]),
        );
      }

      if (node.requestBody.length > 0) {
        parts.push(
          section(
            'Request body',
            'oref-section-request',
            node.requestBody.map((media) => mediaTypeBlock(media, `request:${media.mediaType}`)),
          ),
        );
      }

      if (node.responses.length > 0) {
        parts.push(
          section(
            'Responses',
            'oref-section-responses',
            node.responses.map((response) =>
              h('div', { class: 'oref-response', key: response.statusCode }, [
                h('div', { class: 'oref-response-head' }, [
                  h(
                    'span',
                    { class: `oref-status ${statusClass(response.statusCode)}` },
                    response.statusCode,
                  ),
                  h(MarkdownBlock, {
                    html: response.descriptionHtml,
                    tag: 'span',
                    className: 'oref-response-doc',
                  }),
                ]),
                ...response.content.map((media) =>
                  mediaTypeBlock(media, `${response.statusCode}:${media.mediaType}`),
                ),
              ]),
            ),
          ),
        );
      }

      return h('article', { class: 'oref-operation', 'data-oref-node': node.id }, parts);
    };
  },
});

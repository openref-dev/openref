/**
 * The current node: what a reference page is actually about.
 *
 * It renders the model and computes nothing. Markdown is already HTML, examples are
 * already highlighted, types are already labelled. That is what lets the same component
 * render on the server and hydrate in the browser without either `marked` or `shiki`
 * crossing into the client bundle.
 */

import type { IRSchema } from '@openref/core';
import { defineComponent, h, type Component, type PropType, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { RuntimePanel } from './RuntimePanel';
import { useDeferrable } from './deferrable';
import { statusClass } from '../shared/status';
import type { MediaTypeModel, NodeModel, ParameterModel } from '../page/domain/page-model';

/** What every media type block needs to put a schema viewer under itself. */
interface SchemaContext {
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly truncated: readonly string[];
  readonly basePath: string;
  /**
   * The schema viewer, resolved rather than imported.
   *
   * It travels in the context for the same reason the schemas do: this is a module function and
   * the registry can only be read inside `setup`. See `deferrable.ts` for why it is not imported.
   */
  readonly schemaView: Component;
}

function methodClass(method: string): string {
  const known = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
  return known.includes(method) ? `oref-method-${method.toLowerCase()}` : 'oref-method-other';
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

/**
 * One request or response body: what it is written in, what shape it has, an example.
 *
 * THE HEAD NAMES THE MEDIA TYPE AND THE TREE NAMES THE SCHEMA, which is finding F15 and is a
 * rule rather than a tidy-up. `typeLabel` here and the type on the root row of the tree are the
 * same computation over the same slot, so a block that showed both printed one fact twice, the
 * second line nested inside the first. The label therefore stays only where there is no tree
 * under it to carry it.
 */
function mediaTypeBlock(media: MediaTypeModel, key: string, context: SchemaContext): VNode {
  return h('div', { class: 'oref-media', key }, [
    h('div', { class: 'oref-media-head' }, [
      h('code', { class: 'oref-media-type' }, media.mediaType),
      media.typeLabel === '' || media.schema !== null
        ? null
        : h('span', { class: 'oref-media-schema' }, media.typeLabel),
    ]),
    media.schema === null
      ? null
      : h(context.schemaView, {
          slot: media.schema,
          label: media.mediaType,
          view: media.view,
          schemas: context.schemas,
          truncated: context.truncated,
          basePath: context.basePath,
        }),
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
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, default: () => ({}) },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const deferrable = useDeferrable();

    return (): VNode => {
      const node = props.node;
      const context: SchemaContext = {
        schemas: props.schemas,
        truncated: props.truncated,
        basePath: props.basePath,
        schemaView: deferrable.schemaView,
      };
      const parts: (VNode | null)[] = [];
      // What the specification says, which is everything between the header and the console.
      // It is collected separately from the header so that it can be put in a column of its own
      // when there is a runtime column to stand beside.
      const spec: (VNode | null)[] = [];

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
          // F15's shape one layer up, and finding F19. An operation with no title of its own
          // takes one from its summary, so on most documents these two are the same string and
          // the header printed it as a heading and again as a subtitle. The subtitle survives
          // only where it says something the heading does not.
          node.summary === '' || node.summary === node.title
            ? null
            : h('p', { class: 'oref-subtitle' }, node.summary),
        ]),
      );

      parts.push(h(MarkdownBlock, { html: node.descriptionHtml }));

      if (node.security.length > 0) {
        spec.push(
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
        spec.push(
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
        spec.push(
          section(
            'Request body',
            'oref-section-request',
            node.requestBody.map((media) =>
              mediaTypeBlock(media, `request:${media.mediaType}`, context),
            ),
          ),
        );
      }

      if (node.responses.length > 0) {
        spec.push(
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
                  mediaTypeBlock(media, `${response.statusCode}:${media.mediaType}`, context),
                ),
              ]),
            ),
          ),
        );
      }

      // THE TWO COLUMNS ARE THE THESIS OF THIS DESIGN AND NOT AN ARRANGEMENT OF IT: what is
      // declared and what is observed stand side by side at equal width, with the ruler gutter
      // between them, and vernier's component inventory names that as the one thing this
      // direction does that the other two do not.
      //
      // A NODE WITH NO RUNTIME FACTS GETS NO COLUMNS AT ALL, rather than an empty second one.
      // That is SPEC 6.3 applied to the frame instead of to the block: half a page of blank
      // surface beside the specification says the reference is broken, and it is the state
      // every reader who has registered no collector would be in.
      if (node.runtime === null) parts.push(...spec);
      else {
        parts.push(
          h('div', { class: 'oref-node-columns' }, [
            h('div', { class: 'oref-column-spec' }, spec),
            h('div', { class: 'oref-column-runtime' }, [
              h(RuntimePanel, { runtime: node.runtime }),
            ]),
          ]),
        );
      }

      // Last, after the documented responses rather than before them. A reader reads what the
      // operation does and then tries it, and the response the console shows then sits beside
      // the responses the specification promised, which is where the comparison happens.
      parts.push(h(deferrable.tryIt, { run: node.run }));

      return h('article', { class: 'oref-operation', 'data-oref-node': node.id }, parts);
    };
  },
});

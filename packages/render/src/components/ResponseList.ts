/**
 * Response codes of an operation, with what each one carries.
 *
 * THE SCHEMA PAYLOAD IS A PROP AND THAT IS NOT AN IR PROP. A response body draws a schema tree
 * under it, the tree expands from the bounded slice of schemas the page ships with, per
 * `schema-payload.ts`, and without that slice this position can draw a status code and a
 * sentence and nothing else. The slice is on the wire already; the document is not, and the
 * difference is the whole rule the registry was restated against.
 *
 * THE VIEWER IS RESOLVED AND NOT IMPORTED, per `deferrable.ts`: importing it here would put the
 * schema tree in the first chunk of every page. A theme that overrides this position and wants
 * trees draws them from `schemaTreeRoot` and `expandSchemaNode` in `@openref/vue`, with the
 * `schemas` prop it was handed.
 */

import { h, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { mediaTypeBlock } from './MediaTypeBlock';
import { useDeferrable } from './deferrable';
import { statusClass } from '../shared/status';
import type { IRSchema } from '@openref/core';
import type { ResponseModel } from '@openref/vue';

/**
 * Renders the responses block.
 *
 * @param props - The responses, and the schema slice their bodies expand from
 * @returns The section
 */
export function ResponseList(props: {
  readonly responses: readonly ResponseModel[];
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly truncated: readonly string[];
  readonly basePath: string;
}): VNode {
  const context = {
    schemas: props.schemas,
    truncated: props.truncated,
    basePath: props.basePath,
    schemaView: useDeferrable().schemaView,
  };

  return h('section', { class: 'oref-section oref-section-responses' }, [
    h('h2', { class: 'oref-section-title' }, 'Responses'),
    ...props.responses.map((response) =>
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
  ]);
}

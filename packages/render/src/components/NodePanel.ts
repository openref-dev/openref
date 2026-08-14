/**
 * The current node: what a reference page is actually about.
 *
 * It renders the model and computes nothing. Markdown is already HTML, examples are
 * already highlighted, types are already labelled. That is what lets the same component
 * render on the server and hydrate in the browser without either `marked` or `shiki`
 * crossing into the client bundle.
 *
 * IT IS A COMPOSITION OF SLOTS AND NOT A SLOT. A reader opens three kinds of page, and two of
 * them are one position each; this one is six, because a theme varies a node page by moving its
 * parts rather than by replacing the page. What is not a slot here is the frame around the parts:
 * the security list, the request body block and the block order, which are the shell's business.
 * The page-level columns the frame used to draw died with `TX-GUTTER`: the spec and runtime pair
 * exists only inside a parity row, and everything else is one column at full width.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import { CodeSample } from './CodeSample';
import { MarkdownBlock } from './MarkdownBlock';
import { OperationHeader } from './OperationHeader';
import { ParamTable } from './ParamTable';
import { ResponseList } from './ResponseList';
import { RuntimePanel } from './RuntimePanel';
import { mediaTypeBlock, type SchemaContext } from './MediaTypeBlock';
import { useDeferrable } from './deferrable';
import type { IRSchema } from '@openref/core';
import type { NodeModel } from '@openref/vue';

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
    const header = useSlot('OperationHeader', OperationHeader);
    const params = useSlot('ParamTable', ParamTable);
    const responses = useSlot('ResponseList', ResponseList);
    const samples = useSlot('CodeSample', CodeSample);
    const runtime = useSlot('RuntimePanel', RuntimePanel);

    // Which call sample is showing. The first on both sides, so the server render and the first
    // client render agree without anything being carried between them.
    const activeLang = ref('');

    return (): VNode => {
      const node = props.node;
      const context: SchemaContext = {
        schemas: props.schemas,
        truncated: props.truncated,
        basePath: props.basePath,
        schemaView: deferrable.schemaView,
      };
      const parts: (VNode | null)[] = [];
      // What the specification says, which is everything between the header and the console,
      // in one column at full width: the page-level columns died with `TX-GUTTER`, and the
      // spec and runtime pair exists only inside a parity row.
      const spec: (VNode | null)[] = [];

      parts.push(h(header.value, { node, drift: node.runtime?.drift ?? [] }));

      // THE SCALE STANDS DIRECTLY UNDER THE HEADER, per the design's own order, and the
      // description follows it: a reader meets the comparison first and the prose second.
      // A node with no runtime facts gets no scale at all rather than an empty half, which is
      // SPEC 6.3 applied to the frame, and the state every reader with no collectors is in.
      if (node.runtime !== null) {
        parts.push(h(runtime.value, { nodeId: node.id, runtime: node.runtime }));
      }

      parts.push(h(MarkdownBlock, { html: node.descriptionHtml }));

      // The security list draws only when there is no parity scale carrying the same
      // assertion: the authentication and scopes rows are where the requirement stands when
      // runtime exists, and one page saying one thing twice was the layout this task removed.
      if (node.security.length > 0 && node.runtime === null) {
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
        spec.push(h(params.value, { parameters: node.parameters }));
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
          h(responses.value, {
            responses: node.responses,
            schemas: props.schemas,
            truncated: props.truncated,
            basePath: props.basePath,
          }),
        );
      }

      if (node.codeSamples.length > 0) {
        spec.push(
          h(samples.value, {
            samples: node.codeSamples,
            activeLang: activeLang.value,
            onSelect: (lang: string): void => {
              activeLang.value = lang;
            },
          }),
        );
      }

      parts.push(...spec);

      // THE CONSOLE IS NOT HERE, since `TX-FRAME`: the bench is a page of its own, per SPEC
      // 13.3, and the bench tab in the frame is how a reader reaches it from every page of
      // the operation.
      return h('article', { class: 'oref-operation', 'data-oref-node': node.id }, parts);
    };
  },
});

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
 * the security list, the request body block and the two columns, which are the shell's business
 * in the same way block order is.
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
      // What the specification says, which is everything between the header and the console.
      // It is collected separately from the header so that it can be put in a column of its own
      // when there is a runtime column to stand beside.
      const spec: (VNode | null)[] = [];

      parts.push(
        h(header.value, { node, drift: node.runtime?.drift ?? [] }),
        h(MarkdownBlock, { html: node.descriptionHtml }),
      );

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
              h(runtime.value, { nodeId: node.id, runtime: node.runtime }),
            ]),
          ]),
        );
      }

      // Last, after the documented responses rather than before them. A reader reads what the
      // operation does and then tries it, and the response the console shows then sits beside
      // the responses the specification promised, which is where the comparison happens.
      // THE MOUNT POINT TRAVELS INTO THE CONSOLE because the OAuth2 callback route lives under it:
      // a reference mounted at `/docs` registers `/docs/_oauth/callback`, and a console that
      // assumed the root would register a redirect uri no route answers.
      parts.push(h(deferrable.tryIt, { run: node.run, basePath: props.basePath }));

      return h('article', { class: 'oref-operation', 'data-oref-node': node.id }, parts);
    };
  },
});

/**
 * The current node: what a reference page is actually about.
 *
 * It renders the model and computes nothing. Markdown is already HTML, examples are
 * already highlighted, types are already labelled. That is what lets the same component
 * render on the server and hydrate in the browser without either `marked` or `shiki`
 * crossing into the client bundle.
 *
 * IT WALKS `NodeModel.drawn` AND HOLDS NO CONDITIONS OF ITS OWN, since `TX-ADOPT`. The model
 * builder computes which sections exist, once, and both sides of hydration walk that list:
 * the client's state block empties the fields the old conditions read, so a composition that
 * recomputed `parameters.length > 0` here would draw one tree on the server and another in
 * the browser, silently. The static sections resolve through the deferrable registry, which
 * the server fills with the components that draw them and the browser fills with childless
 * elements that adopt what the server drew, the Health panel's mechanism applied to the rest
 * of the page.
 *
 * WHAT STAYS LIVE IN THIS FILE, each with the question it fails from SPEC 12: the request
 * body section hosts the schema tree islands, and the call samples block holds the language
 * tab, which is client state with a handler.
 */

import { useSlot } from '@openref/vue';
import { defineComponent, Fragment, h, ref, type PropType, type VNode } from 'vue';
import { CodeSample } from './CodeSample';
import { mediaTypeBlock, type SchemaContext } from './MediaTypeBlock';
import { useDeferrable } from './deferrable';
import { benchHref } from '../page/domain/links';
import type { IRSchema } from '@openref/core';
import type { NodeModel } from '@openref/vue';

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
    const samples = useSlot('CodeSample', CodeSample);

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

      // ONE PART PER DRAWN MARK, in the order the server drew them. The props travel to every
      // filling; the server's components read them and the browser's childless elements ignore
      // them, which is what lets the state block arrive redacted.
      const parts = node.drawn.map((mark): VNode => {
        switch (mark) {
          case 'header':
            // The bench href mirrors the frame's own rule: a bench exists exactly when `run`
            // does. On the client `run` arrives redacted to null and the stub ignores the prop.
            return h(deferrable.operationHeader, {
              node,
              drift: node.runtime?.drift ?? [],
              benchHref: node.run === null ? '' : benchHref(node.id, props.basePath),
            });
          case 'runtime':
            // THE SCALE STANDS DIRECTLY UNDER THE HEADER, per the design's own order. A node
            // with no runtime facts gets no scale at all rather than an empty half, which is
            // SPEC 6.3 applied by `drawnOf` rather than here.
            return h(deferrable.runtimePanel, { nodeId: node.id, runtime: node.runtime });
          case 'description':
            return h(deferrable.nodeDescription, { html: node.descriptionHtml });
          case 'security':
            return h(deferrable.nodeSecurity, { security: node.security });
          case 'params':
            return h(deferrable.paramTable, { parameters: node.parameters });
          case 'request':
            // LIVE, because the schema tree islands inside it hydrate in place when a reader
            // reaches for them; the example block inside each media type is adopted by
            // `mediaTypeBlock` itself, per `MediaTypeModel.hasExample`.
            return h('section', { class: 'oref-section oref-section-request' }, [
              h('h2', { class: 'oref-section-title' }, 'Request body'),
              ...node.requestBody.map((media) =>
                mediaTypeBlock(media, `request:${media.mediaType}`, context),
              ),
            ]);
          case 'responses':
            return h(deferrable.responseList, {
              responses: node.responses,
              schemas: props.schemas,
              truncated: props.truncated,
              basePath: props.basePath,
              marks: node.runtime?.responseMarks ?? [],
              contracts: node.runtime?.contracts ?? [],
            });
          case 'samples':
            // LIVE: the language tab is client state with a handler, the one section of the
            // article that fails the adoption question, named in SPEC 12.
            //
            // THE NOTICE IS DRAWN HERE AND NOT INSIDE THE SLOT, AND THAT IS THE DESIGN. SPEC 18's
            // fifteen languages reach a page as twelve, and the three the page does not carry are
            // named rather than dropped, so a reader can tell a language this reference does not
            // have from one it can produce. `SlotProps<'CodeSample'>` is frozen at three members,
            // so a fourth prop is a major version; but the statement should not have been a slot's
            // to make in the first place. A theme replacing `CodeSample` replaces how a sample
            // looks, and a theme that could drop this sentence could drop the difference between
            // "no Ruby here" and "no Ruby at all", which is a product guarantee and not a style.
            return h(Fragment, [
              h(samples.value, {
                samples: node.codeSamples,
                activeLang: activeLang.value,
                onSelect: (lang: string): void => {
                  activeLang.value = lang;
                },
              }),
              node.codeSamplesElsewhere.length === 0
                ? null
                : h(
                    'p',
                    { class: 'oref-description' },
                    'Generated for this operation and not drawn here: ' +
                      node.codeSamplesElsewhere.map((language) => language.label).join(', ') +
                      '. A build that asks for them draws them.',
                  ),
            ]);
          // THE THREE CHANNEL SECTIONS OF `T050`, adopted for the same reason the rest are, and
          // for one more: a schema tree inside an adopted position would be a row of buttons
          // nothing hydrates, so the payload is read rather than expanded. See `ChannelSections`.
          case 'channel':
            // TWO POSITIONS UNDER ONE MARK, per `TX-SOCKET-CONSOLE`, and the mark does not grow.
            // `NodeSectionMark` is frozen by `ai-docs/design/CONTRACT.md` and a twelfth member
            // would be a breaking change to say what this one already says: this node is a
            // channel and the server drew its channel section. The facts are adopted and the
            // console is deferred, which is the whole difference between them.
            return h(Fragment, [
              h(deferrable.channelFacts, { channel: node.channel }),
              h(deferrable.socketConsole, {
                channel: node.channel,
                address: node.address ?? '',
              }),
            ]);
          case 'channel-operations':
            return h(deferrable.channelOperations, { channel: node.channel });
          case 'messages':
            return h(deferrable.messageList, {
              channel: node.channel,
              schemas: props.schemas,
              basePath: props.basePath,
            });
        }
      });

      // THE CONSOLE IS NOT HERE, since `TX-FRAME`: the bench is a page of its own, per SPEC
      // 13.3, and the bench tab in the frame is how a reader reaches it from every page of
      // the operation.
      return h('article', { class: 'oref-operation', 'data-oref-node': node.id }, parts);
    };
  },
});

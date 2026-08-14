import { useSlot, type ResponseModel } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import SchemaTree from './SchemaTree';
import StateNotice from './StateNotice';
import { mediaBlock } from './media';
import type { IRSchema } from '@openref/core';

/**
 * Responses, one strip per status code, on the same grid as everything else.
 *
 * IT RESOLVES THE TREE THROUGH THE REGISTRY RATHER THAN IMPORTING IT. `useSlot('SchemaTree', ...)`
 * is what lets somebody run this theme and still replace one position inside it, which is the L1
 * level of SPEC 10.1 applied on top of an L2 theme. Importing the component directly would have
 * worked and would have made this theme the end of the line.
 *
 * `truncated` IS DRAWN AND NOT DROPPED. An id referenced from this page and left behind by the
 * payload bound is a schema the reader can still reach, on a page of its own, and a list that
 * quietly omitted it would read as a document that does not mention it.
 */
export default defineComponent({
  name: 'TelltaleResponseList',

  props: {
    responses: { type: Array as PropType<readonly ResponseModel[]>, required: true },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, default: () => ({}) },
    truncated: { type: Array as PropType<readonly string[]>, default: () => [] },
    basePath: { type: String, default: '' },
  },

  setup(props) {
    const tree = useSlot('SchemaTree', SchemaTree);
    const notice = useSlot('StateNotice', StateNotice);

    return (): VNode =>
      h('section', { class: 'tt-responses' }, [
        h('h2', { class: 'tt-strip-head' }, 'RESPONSES'),
        h(
          'ul',
          { class: 'tt-response-list' },
          props.responses.map((response) =>
            h('li', { class: 'tt-response', key: response.statusCode }, [
              h('div', { class: 'tt-response-line' }, [
                h(
                  'span',
                  { class: ['tt-status', `tt-status-${statusClass(response.statusCode)}`] },
                  response.statusCode,
                ),
                response.descriptionHtml === ''
                  ? null
                  : h('div', {
                      class: 'tt-response-prose tt-prose',
                      innerHTML: response.descriptionHtml,
                    }),
              ]),
              ...response.content.map((media) =>
                mediaBlock(media, `${response.statusCode}:${media.mediaType}`, {
                  schemas: props.schemas,
                  truncated: props.truncated,
                  basePath: props.basePath,
                  tree: tree.value,
                  notice: notice.value,
                }),
              ),
            ]),
          ),
        ),
      ]);
  },
});

/**
 * Which class of response a status code is in, for the colour and for nothing else.
 *
 * `ResponseModel` carries no class of its own, unlike a runtime value, which carries
 * `statusClass` beside the code. The two are the same question asked in two positions and one of
 * them is answered by the model; this is the other one, answered here.
 */
function statusClass(statusCode: string): string {
  if (statusCode === 'default') return 'muted';
  const first = statusCode.charAt(0);
  if (first === '2') return 'ok';
  if (first === '3') return 'info';
  if (first === '4') return 'warn';
  if (first === '5') return 'crit';
  return 'muted';
}

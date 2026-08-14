/**
 * Response codes of an operation, with what each one carries, and the error contracts under
 * them.
 *
 * THE LIST IS ONE AND MERGED, since `TX-MARKUP`: a documented row that a runtime error contract
 * backs carries that contract's provenance chip, and a code the runtime knows that the
 * specification does not carry is a full row in code point order, flagged undocumented, with
 * the phrase naming the absence. A spec-only row carries no chip, because the section is the
 * specification's own statement and SPEC 6.1's vocabulary is about runtime facts.
 *
 * THE GRID LIVES HERE AND NOT IN THE PAGE COMPOSITION, deliberately: a theme that owns this
 * position owns everything the page says about responses, and the markup a complete L2 theme
 * cannot replace does not grow. `theme-boundary.spec.ts` in the second theme is the pin that
 * would have read the other choice.
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

import { h, type Component, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import { mediaTypeBlock } from './MediaTypeBlock';
import { ProvenanceTag } from './ProvenanceTag';
import { useDeferrable } from './deferrable';
import { useSlot } from '@openref/vue';
import { statusClass } from '../shared/status';
import type { IRSchema } from '@openref/core';
import type { ErrorContractGroupModel, ResponseMarkModel, ResponseModel } from '@openref/vue';

/** The design's phrase on a row the specification does not carry. */
const UNDOCUMENTED = 'not in the specification';

/** One documented response, with the runtime's chip when a contract backs the code. */
function responseRow(
  response: ResponseModel,
  mark: ResponseMarkModel | undefined,
  tag: Component,
  context: Parameters<typeof mediaTypeBlock>[2],
): VNode {
  return h('div', { class: 'oref-response', key: response.statusCode }, [
    h('div', { class: 'oref-response-head' }, [
      h('span', { class: `oref-status ${statusClass(response.statusCode)}` }, response.statusCode),
      h(MarkdownBlock, {
        html: response.descriptionHtml,
        tag: 'span',
        className: 'oref-response-doc',
      }),
      mark === undefined
        ? null
        : h(tag, { confidence: mark.confidence, collector: mark.collector }),
    ]),
    ...response.content.map((media) =>
      mediaTypeBlock(media, `${response.statusCode}:${media.mediaType}`, context),
    ),
  ]);
}

/** One code only the runtime knows: a full row, flagged, with the reason phrase. */
function undocumentedRow(mark: ResponseMarkModel, tag: Component): VNode {
  return h('div', { class: 'oref-response oref-response-undocumented', key: mark.statusCode }, [
    h('div', { class: 'oref-response-head' }, [
      h('span', { class: mark.statusClass }, mark.statusCode),
      h('span', { class: 'oref-response-doc' }, mark.title),
      h(tag, { confidence: mark.confidence, collector: mark.collector }),
      h('span', { class: 'oref-response-note' }, UNDOCUMENTED),
    ]),
  ]);
}

/**
 * The class of each group, written out rather than interpolated, so the two way sweep between
 * this package's markup and the theme's stylesheet sees the names that ship.
 */
const GROUP_CLASSES: Readonly<Record<string, string>> = {
  'errors-declared': 'oref-errgroup-errors-declared',
  'errors-runtime-derived': 'oref-errgroup-errors-runtime-derived',
  'errors-global': 'oref-errgroup-errors-global',
};

/** One group of the error contracts grid, per SPEC 6.4. */
function contractGroup(group: ErrorContractGroupModel, tag: Component): VNode {
  return h('section', { class: ['oref-errgroup', GROUP_CLASSES[group.kind] ?? ''] }, [
    h('h3', { class: 'oref-errgroup-head' }, group.label),
    h('p', { class: 'oref-errgroup-sub' }, group.sub),
    group.empty === '' ? null : h('p', { class: 'oref-errgroup-empty' }, group.empty),
    ...group.items.map((item) =>
      h('div', { class: 'oref-erritem', key: item.status }, [
        h('div', { class: 'oref-erritem-row' }, [
          h('span', { class: item.statusClass }, item.status),
          h('span', { class: 'oref-erritem-title' }, item.title),
          item.schemaHref === ''
            ? null
            : h('a', { class: 'oref-erritem-schema', href: item.schemaHref }, item.schemaLabel),
          h(tag, { confidence: item.confidence, collector: item.collector }),
        ]),
        item.typeUri === ''
          ? null
          : h('div', { class: 'oref-erritem-type' }, [h('code', {}, item.typeUri)]),
        item.detail === '' ? null : h('div', { class: 'oref-erritem-detail' }, item.detail),
      ]),
    ),
  ]);
}

/**
 * Renders the responses block, and the error contracts grid when any collector produced one.
 *
 * @param props - The responses, the runtime's marks and contracts, and the schema slice
 * @returns The sections
 */
export function ResponseList(props: {
  readonly responses: readonly ResponseModel[];
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly truncated: readonly string[];
  readonly basePath: string;
  readonly marks: readonly ResponseMarkModel[];
  readonly contracts: readonly ErrorContractGroupModel[];
}): VNode[] {
  const tag = useSlot('ProvenanceTag', ProvenanceTag).value;
  const context = {
    schemas: props.schemas,
    truncated: props.truncated,
    basePath: props.basePath,
    schemaView: useDeferrable().schemaView,
  };

  const byCode = new Map(props.marks.map((mark) => [mark.statusCode, mark]));

  // The merged order: documented rows as served, each undocumented code slotted in by code
  // point against the documented codes around it, so 429 stands after 422 the way the design
  // draws it and `default` keeps its place after the digits.
  const rows: VNode[] = [];
  const extras = props.marks.filter((mark) => mark.undocumented);
  let next = 0;

  for (const response of props.responses) {
    while (next < extras.length) {
      const extra = extras[next];
      if (extra === undefined || extra.statusCode >= response.statusCode) break;
      rows.push(undocumentedRow(extra, tag));
      next += 1;
    }
    rows.push(responseRow(response, byCode.get(response.statusCode), tag, context));
  }
  for (const extra of extras.slice(next)) rows.push(undocumentedRow(extra, tag));

  const documented = props.responses.length;

  const sections = [
    h('section', { class: 'oref-section oref-section-responses' }, [
      h('h2', { class: 'oref-section-title' }, [
        'Responses ',
        h('span', { class: 'oref-section-count' }, `${String(documented)} documented`),
      ]),
      ...rows,
    ]),
  ];

  if (props.contracts.length > 0) {
    sections.push(
      h('section', { class: 'oref-section oref-section-errors' }, [
        h('h2', { class: 'oref-section-title' }, 'Error contracts'),
        h(
          'div',
          { class: 'oref-errgrid' },
          props.contracts.map((group) => contractGroup(group, tag)),
        ),
      ]),
    );
  }

  return sections;
}

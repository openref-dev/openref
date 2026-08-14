/**
 * One request or response body: what it is written in, what shape it has, an example.
 *
 * THE HEAD NAMES THE MEDIA TYPE AND THE TREE NAMES THE SCHEMA, which is finding F15 and is a
 * rule rather than a tidy-up. `typeLabel` here and the type on the root row of the tree are the
 * same computation over the same slot, so a block that showed both printed one fact twice, the
 * second line nested inside the first. The label therefore stays only where there is no tree
 * under it to carry it.
 *
 * IT IS NOT A SLOT AND IT IS SHARED BY TWO THAT ARE. The request body block belongs to the node
 * page and the response bodies belong to `ResponseList`, and both draw this. Naming it in the
 * registry would have been a third name for a shape neither theme asked to vary on its own.
 */

import { h, type Component, type VNode } from 'vue';
import { MarkdownBlock } from './MarkdownBlock';
import type { IRSchema } from '@openref/core';
import type { MediaTypeModel } from '@openref/vue';

/** What every media type block needs to put a schema viewer under itself. */
export interface SchemaContext {
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

/**
 * Renders one media type of a body or a response.
 *
 * @param media - The media type, with its example already highlighted
 * @param key - Key for the list this block sits in
 * @param context - The schema payload and the viewer to draw it with
 * @returns The block
 */
export function mediaTypeBlock(media: MediaTypeModel, key: string, context: SchemaContext): VNode {
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

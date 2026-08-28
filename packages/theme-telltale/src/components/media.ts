import {
  expandSchemaNode,
  inlineSchemaTreeRoot,
  schemaTreeRoot,
  type MediaTypeModel,
  type SchemaTreeNode,
} from '@openref/vue';
import { h, type Component, type VNode } from 'vue';
import type { IRSchema } from '@openref/vue';

/**
 * One request or response body, drawn the same way wherever it appears.
 *
 * IT IS THIS THEME'S OWN COMPOSITION AND NOT A SLOT, exactly as the reference's own media block
 * is. Two positions of the registry draw a body, `ResponseList` and `ShapeForm`'s read only twin,
 * and a third name in the registry for the shape they share would be a name the other two themes
 * had to implement without having asked for it.
 *
 * THE SCHEMA MAP ARRIVES AS A RECORD AND THE EXPANDER WANTS A MAP, and the conversion is here so
 * it happens once per block rather than once per position. `SchemaPayloadMap` is a
 * `Readonly<Record<string, IRSchema>>` because it travels as JSON; `SchemaExpansionOptions.schemas`
 * is a `ReadonlyMap` because that is what the expander reads. A theme meets both.
 *
 * WHAT IS HANDED ON IS A ROOT AND A FUNCTION, never the map. That is what keeps expansion lazy,
 * one level per opened position, and what keeps a slice of the document out of the slot contract.
 */

/** What a media block needs besides the media type itself. */
export interface MediaContext {
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly truncated: readonly string[];
  readonly basePath: string;
  /** The `SchemaTree` position, already resolved through the registry by the caller. */
  readonly tree: Component;
  /** The `StateNotice` position, for a media type that declares no schema. */
  readonly notice: Component;
}

export function mediaBlock(media: MediaTypeModel, key: string, context: MediaContext): VNode {
  const options = {
    schemas: new Map(Object.entries(context.schemas)),
    view: media.view,
  };

  let root: SchemaTreeNode | undefined;
  if (media.schema !== null) {
    if (media.schema.kind === 'named') root = schemaTreeRoot(media.schema.schemaId, options);
    else {
      const body = media.schema.schema.normalized;
      root = body === undefined ? undefined : inlineSchemaTreeRoot(body, media.mediaType, options);
    }
  }

  return h('div', { class: 'tt-media', key }, [
    h('div', { class: 'tt-media-head' }, [
      h('code', { class: 'tt-media-type' }, media.mediaType),
      media.typeLabel === '' || media.schema !== null
        ? null
        : h('span', { class: 'tt-media-schema' }, media.typeLabel),
    ]),
    media.schema === null
      ? null
      : root === undefined
        ? h(context.notice, { kind: 'no-schema', message: 'No schema declared' })
        : h(context.tree, {
            root,
            view: media.view,
            expand: (node: SchemaTreeNode): readonly SchemaTreeNode[] =>
              expandSchemaNode(node, options),
            truncated: context.truncated,
            basePath: context.basePath,
            label: media.mediaType,
            borrowedLabel: media.schema.kind === 'inline',
          }),
    media.exampleHtml === ''
      ? null
      : h('div', { class: 'tt-example', innerHTML: media.exampleHtml }),
  ]);
}

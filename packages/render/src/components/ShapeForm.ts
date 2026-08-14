/**
 * Filling a request body whose shape depends on what the document declared.
 *
 * THE EDITOR IS DECIDED BY THE SCHEMA AND NOT BY A LIST OF MEDIA TYPES.
 * `RunnerBodyMediaTypeView.editor` carries the answer, per SPEC 14.3: a form gets one control per
 * declared property, with a file picker for a property the schema says is binary; a binary body
 * gets a file picker on its own; and everything else gets the text area, which is what JSON,
 * ndjson and plain text share. Nothing here knows the six media types by name, so a vendor type
 * whose schema is readable is drawn correctly without this file changing.
 *
 * NOTHING IS SENT FOR AN EDITOR NOBODY TOUCHED, which is why the values arrive as a map rather
 * than as a filled object: a field the reader never opened is absent and a field they cleared is
 * empty, and `name=` and no `name` are two different form submissions.
 *
 * READ ON CHOOSING RATHER THAN ON SENDING. A file arrives here as bytes already read, because
 * reading is asynchronous and the press on Send is not: a body assembled inside the click handler
 * would have to await a read there, and a reader who pressed Send twice would race two of them.
 */

import { useSlot, type RunnerBodyMediaTypeView, type RunnerFile } from '@openref/vue';
import { defineComponent, h, type PropType, type VNode } from 'vue';
import { StateNotice } from './StateNotice';
import { field, fieldId } from './field';
import {
  eventFile,
  eventValue,
  type FileEvent,
  type PickedFile,
  type ValueEvent,
} from '../shared/dom';

/** Rows of the body editor, fixed so the control reserves the same height on both sides. */
const BODY_ROWS = 8;

/**
 * Key the whole body is held under when it is one file rather than a set of fields.
 *
 * A name a form field cannot collide with, because a property called `body` is ordinary and this
 * is not a property at all: it is the body itself, and the two live in the same map so that one
 * function reads a file back whichever editor put it there.
 */
export const BINARY_FIELD = '\u0000body';

/** Renders the editor one declared body asks for. */
export const ShapeForm = defineComponent({
  name: 'OrefShapeForm',

  props: {
    media: { type: Object as PropType<RunnerBodyMediaTypeView>, required: true },
    values: { type: Object as PropType<Readonly<Record<string, string>>>, default: () => ({}) },
    files: { type: Object as PropType<Readonly<Record<string, RunnerFile>>>, default: () => ({}) },
    text: { type: String, default: '' },
    onField: { type: Function as PropType<(name: string, value: string) => void>, required: true },
    onFile: {
      type: Function as PropType<(name: string, file: RunnerFile | undefined) => void>,
      required: true,
    },
    onText: { type: Function as PropType<(text: string) => void>, required: true },
  },

  setup(props) {
    const notice = useSlot('StateNotice', StateNotice);

    /** Reads a chosen file into the bytes a part is built from. */
    async function takeFile(name: string, picked: PickedFile | null): Promise<void> {
      if (picked === null) {
        props.onFile(name, undefined);
        return;
      }

      const bytes = new Uint8Array(await picked.arrayBuffer());

      props.onFile(name, {
        fileName: picked.name,
        // A BROWSER LEAVES `type` EMPTY FOR AN EXTENSION IT DOES NOT KNOW, and a part with no
        // content type is a part a server cannot route. Octet stream is what a file of unknown
        // type is, which is the same answer the specification's own default rule gives.
        mediaType: picked.type === '' ? 'application/octet-stream' : picked.type,
        bytes,
      });
    }

    function fileControl(id: string, name: string, accept?: string): VNode {
      return h('input', {
        class: 'oref-field-control oref-field-file',
        id,
        type: 'file',
        ...(accept === undefined ? {} : { accept }),
        onChange: (event: FileEvent) => {
          void takeFile(name, eventFile(event));
        },
      });
    }

    /** What a chosen file says about itself, so the reader can see what will be sent. */
    function fileNote(name: string, fallback: string): string {
      const file = props.files[name];
      if (file === undefined) return fallback;

      return `${file.fileName}, ${String(file.bytes.length)} bytes, ${file.mediaType}`;
    }

    return (): VNode[] => {
      const media = props.media;

      if (media.editor === 'binary') {
        const id = fieldId('body', 'file');

        return [
          field(
            'Request body',
            id,
            fileControl(id, BINARY_FIELD),
            fileNote(BINARY_FIELD, `${media.mediaType}, chosen as a file`),
          ),
        ];
      }

      if (media.editor === 'text') {
        const id = fieldId('body', 'text');

        return [
          field(
            'Request body',
            id,
            h('textarea', {
              class: 'oref-field-control oref-field-body',
              id,
              rows: BODY_ROWS,
              spellcheck: 'false',
              value: props.text,
              onInput: (event: ValueEvent) => {
                props.onText(eventValue(event));
              },
            }),
            media.mediaType,
          ),
        ];
      }

      // A FORM WHOSE SCHEMA DECLARES NO PROPERTY HAS NO FIELDS TO DRAW, and saying so is better
      // than drawing a text area that would be encoded as nothing. The document is what is
      // missing, and the drift rules of SPEC 7.1 are what report that.
      if (media.fields.length === 0) {
        return [
          h(notice.value, {
            key: 'no-fields',
            kind: 'no-body-fields',
            message: `${media.mediaType} is declared with no properties, so this console has no fields to offer for it.`,
          }),
        ];
      }

      return media.fields.map((bodyField) => {
        const id = fieldId('body', bodyField.name);
        const note = [bodyField.required ? 'required' : null, bodyField.contentType ?? null]
          .filter((part) => part !== null)
          .join(', ');

        if (bodyField.kind === 'file') {
          return field(
            bodyField.name,
            id,
            fileControl(id, bodyField.name, bodyField.contentType),
            fileNote(bodyField.name, note === '' ? 'file' : note),
          );
        }

        return field(
          bodyField.name,
          id,
          h('input', {
            class: 'oref-field-control',
            id,
            type: 'text',
            value: props.values[bodyField.name] ?? '',
            'aria-required': bodyField.required ? 'true' : 'false',
            onInput: (event: ValueEvent) => {
              props.onField(bodyField.name, eventValue(event));
            },
          }),
          note === '' ? null : note,
        );
      });
    };
  },
});

import { h, type VNode } from 'vue';
import { eventFile, eventValue, type FileEvent, type ValueEvent } from '../dom';
import type { RunnerBodyMediaTypeView, RunnerFile } from '@openref/vue';

/**
 * Filling a request body, in whichever of the three editors the media type calls for.
 *
 * THE SCHEMA DECIDES THE EDITOR AND THIS COMPONENT DOES NOT CLASSIFY ANYTHING. `editor` is `text`,
 * `fields` or `binary` and arrives already decided, per SPEC 14.3; a theme that looked at the
 * media type string and guessed would be a second classifier, disagreeing with the first on
 * whichever document nobody tested.
 *
 * A FILE FIELD HANDS BACK BYTES AND NOT A `File`. The runner is handed a `RunnerFile`, so what a
 * body is built from is the same shape on a page, in a test and in a static export.
 *
 * A media type with no fields is the `no-body-fields` state, and the notice for it belongs to the
 * position that owns notices. This one renders nothing there rather than writing its own sentence.
 */
export default function ShapeForm(props: {
  readonly media: RunnerBodyMediaTypeView;
  readonly values: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, RunnerFile>>;
  readonly text: string;
  readonly onField: (name: string, value: string) => void;
  readonly onFile: (name: string, file: RunnerFile | undefined) => void;
  readonly onText: (text: string) => void;
}): VNode {
  const media = props.media;

  if (media.editor === 'text' || media.editor === 'binary') {
    return h('div', { class: ['tt-body', `tt-body-${media.editor}`] }, [
      h('label', { class: 'tt-field' }, [
        h('span', { class: 'tt-field-label' }, media.mediaType),
        h('textarea', {
          class: 'tt-field-text',
          rows: 8,
          spellcheck: 'false',
          value: props.text,
          onInput: (event: ValueEvent): void => {
            props.onText(eventValue(event));
          },
        }),
      ]),
    ]);
  }

  return h(
    'div',
    { class: 'tt-body tt-body-fields' },
    media.fields.map((field) =>
      h('label', { class: 'tt-field', key: field.name }, [
        h('span', { class: 'tt-field-label' }, [
          field.name,
          field.required ? h('span', { class: 'tt-field-req' }, 'REQ') : null,
        ]),
        field.kind === 'file'
          ? h('input', {
              class: 'tt-field-file',
              type: 'file',
              name: field.name,
              onChange: (event: FileEvent): void => {
                const chosen = eventFile(event);
                if (chosen === null) {
                  props.onFile(field.name, undefined);
                  return;
                }
                void chosen.arrayBuffer().then((buffer) => {
                  props.onFile(field.name, {
                    fileName: chosen.name,
                    mediaType: chosen.type,
                    bytes: new Uint8Array(buffer),
                  });
                });
              },
            })
          : h('input', {
              class: 'tt-field-input',
              type: 'text',
              name: field.name,
              autocomplete: 'off',
              value: props.values[field.name] ?? '',
              onInput: (event: ValueEvent): void => {
                props.onField(field.name, eventValue(event));
              },
            }),
        field.kind === 'file' && props.files[field.name] !== undefined
          ? h('span', { class: 'tt-field-note' }, props.files[field.name]?.fileName ?? '')
          : null,
      ]),
    ),
  );
}

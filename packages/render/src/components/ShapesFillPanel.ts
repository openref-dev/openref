/**
 * The filling half of the shapes page: one body, rebuilt by its values.
 *
 * THE VALUES ARE THE ONLY STATE, per SPEC 11. Choosing a branch writes the leading value and
 * nothing else; the visible controls are re-derived from the schema and the map on every
 * change; and a hidden branch's values stay in the map, which is what the status line counts.
 *
 * THE STATUS LINE IS IN THE DOCUMENT FROM THE FIRST RENDER, empty, because a live region
 * announces changes to a region that exists: one injected together with its first sentence is
 * a region assistive technology never saw change. It says what rebuilt, not that something
 * rebuilt, in the wording SPEC 11 records.
 *
 * FOCUS SURVIVES THE REBUILD BY KEYS, not by handling: the chooser's buttons are keyed by
 * their values, so the pressed element persists through the patch and keeps focus. That this
 * holds in a real engine is the browser suite's claim, per the standing rule.
 */

import { defineComponent, h, ref, type PropType, type VNode } from 'vue';
import type { IRSchema } from '@openref/core';
import {
  announceSentence,
  deriveControls,
  keptCount,
  type ShapeChooserControl,
  type ShapeControl,
  type ShapeInputControl,
  type ShapePatternControl,
  type ShapeTupleControl,
} from '../page/domain/shape-form';
import { fieldId } from './field';
import { eventValue, type ValueEvent } from '../shared/dom';

/** Renders the filling half of one schema. */
export const ShapesFillPanel = defineComponent({
  name: 'OrefShapesFillPanel',

  props: {
    schemaId: { type: String, required: true },
    schemas: { type: Object as PropType<Readonly<Record<string, IRSchema>>>, required: true },
  },

  setup(props) {
    const values = ref<Record<string, string>>({});
    const announce = ref('');

    function put(path: string, value: string): void {
      values.value = { ...values.value, [path]: value };
    }

    /** A branch press: writes the leading value and announces what that rebuilt. */
    function choose(control: ShapeChooserControl, value: string): void {
      const previous = control.options.find((option) => option.pressed);
      const next = control.options.find((option) => option.value === value);
      if (next === undefined || previous?.value === value) return;

      put(control.path, value);

      announce.value = announceSentence(
        previous?.label ?? null,
        next.label,
        previous === undefined ? 0 : keptCount(previous.ownedPaths, values.value),
      );
    }

    function renderChooser(control: ShapeChooserControl): VNode {
      return h(
        'div',
        {
          class: ['oref-shape-branch', `oref-shape-d${String(control.depth)}`],
          key: `chooser:${control.path}`,
        },
        [
          h('div', { class: 'oref-shape-branch-row' }, [
            h('span', { class: 'oref-shape-name' }, control.label),
            h('span', { class: 'oref-shape-branch-note' }, `leading value: ${control.leading}`),
          ]),
          h(
            'div',
            { class: 'oref-shape-branch-opts' },
            control.options.map((option) =>
              h(
                'button',
                {
                  class: 'oref-seg-btn',
                  key: option.value,
                  type: 'button',
                  'aria-pressed': option.pressed ? 'true' : 'false',
                  onClick: () => {
                    choose(control, option.value);
                  },
                },
                option.label,
              ),
            ),
          ),
        ],
      );
    }

    function textInput(path: string, extra: string[], attrs: Record<string, unknown>): VNode {
      return h('input', {
        class: ['oref-field-control', ...extra],
        id: fieldId('shape', path),
        type: 'text',
        value: values.value[path] ?? '',
        onInput: (event: ValueEvent) => {
          put(path, eventValue(event));
        },
        ...attrs,
      });
    }

    function renderInput(control: ShapeInputControl): VNode {
      const conditional = control.requiredness === 'conditional';
      const requiredNow = control.requiredness === 'required' || control.conditionActive === true;

      return h(
        'div',
        {
          class: ['oref-shape-field', `oref-shape-d${String(control.depth)}`],
          key: `input:${control.path}`,
        },
        [
          h('label', { class: 'oref-field-label', for: fieldId('shape', control.path) }, [
            control.label,
            control.requiredness === 'optional'
              ? null
              : h(
                  'span',
                  { class: ['oref-shape-mark', ...(conditional ? ['oref-shape-mark-cond'] : [])] },
                  ' *',
                ),
          ]),
          h('span', { class: 'oref-shape-control' }, [
            textInput(
              control.path,
              [
                ...(control.error !== undefined ? ['oref-shape-input-error'] : []),
                ...(control.error === undefined && conditional && control.conditionActive === true
                  ? ['oref-shape-input-cond']
                  : []),
              ],
              {
                'aria-required': requiredNow ? 'true' : 'false',
                ...(control.error === undefined ? {} : { 'aria-invalid': 'true' }),
                ...(control.placeholder === undefined ? {} : { placeholder: control.placeholder }),
              },
            ),
            control.when === undefined
              ? null
              : h('span', { class: 'oref-shape-hint oref-shape-hint-cond' }, control.when),
            control.conditionReason === undefined
              ? null
              : h(
                  'span',
                  { class: 'oref-shape-hint oref-shape-hint-cond' },
                  control.conditionReason,
                ),
            control.error === undefined
              ? null
              : h('span', { class: 'oref-shape-hint oref-shape-hint-error' }, control.error),
          ]),
        ],
      );
    }

    /** The next free entry index, so removing never renumbers what the reader typed. */
    function nextEntryIndex(control: ShapePatternControl): number {
      const taken = control.entries.map((entry) => {
        const head = entry.keyPath.slice(0, -'/key'.length);
        return Number(head.slice(head.lastIndexOf('#') + 1));
      });
      return taken.length === 0 ? 0 : Math.max(...taken) + 1;
    }

    function renderPattern(control: ShapePatternControl): VNode {
      return h(
        'div',
        {
          class: ['oref-shape-pattern', `oref-shape-d${String(control.depth)}`],
          key: `pattern:${control.path}`,
        },
        [
          h('div', { class: 'oref-shape-branch-row' }, [
            h('span', { class: 'oref-shape-name' }, control.label),
            h('span', { class: 'oref-shape-branch-note' }, control.patterns.join(', ')),
          ]),
          ...control.entries.map((entry) =>
            h('div', { class: 'oref-shape-pair', key: entry.keyPath }, [
              textInput(
                entry.keyPath,
                entry.keyError === undefined ? [] : ['oref-shape-input-error'],
                {
                  'aria-label': `${control.label} key`,
                  ...(entry.keyError === undefined ? {} : { 'aria-invalid': 'true' }),
                  placeholder: control.patterns[0] ?? 'key',
                },
              ),
              textInput(entry.valuePath, [], {
                'aria-label': `${control.label} value`,
                ...(entry.valuePlaceholder === undefined
                  ? {}
                  : { placeholder: entry.valuePlaceholder }),
              }),
              entry.keyError === undefined
                ? null
                : h('span', { class: 'oref-shape-hint oref-shape-hint-error' }, entry.keyError),
            ]),
          ),
          h(
            'button',
            {
              class: 'oref-shape-add',
              type: 'button',
              onClick: () => {
                put(`${control.path}/#${String(nextEntryIndex(control))}/key`, '');
              },
            },
            'add key',
          ),
        ],
      );
    }

    function renderTuple(control: ShapeTupleControl): VNode {
      return h(
        'div',
        {
          class: ['oref-shape-tuple', `oref-shape-d${String(control.depth)}`],
          key: `tuple:${control.path}`,
        },
        [
          h('div', { class: 'oref-shape-branch-row' }, [
            h('span', { class: 'oref-shape-name' }, control.label),
            control.closed
              ? h('span', { class: 'oref-shape-branch-note' }, 'no items beyond the tuple')
              : null,
          ]),
          h('div', { class: 'oref-shape-pair' }, [
            ...control.positions.map((position) =>
              textInput(
                position.path,
                position.error === undefined ? [] : ['oref-shape-input-error'],
                {
                  'aria-label': `${control.label} ${position.label}`,
                  placeholder: position.label,
                  ...(position.error === undefined ? {} : { 'aria-invalid': 'true' }),
                },
              ),
            ),
          ]),
          ...control.positions
            .filter((position) => position.error !== undefined)
            .map((position) =>
              h(
                'span',
                { class: 'oref-shape-hint oref-shape-hint-error', key: `err:${position.path}` },
                position.error,
              ),
            ),
        ],
      );
    }

    function renderControl(control: ShapeControl): VNode {
      switch (control.kind) {
        case 'chooser':
          return renderChooser(control);
        case 'input':
          return renderInput(control);
        case 'pattern':
          return renderPattern(control);
        case 'tuple':
          return renderTuple(control);
      }
    }

    return (): VNode => {
      const controls = deriveControls(props.schemaId, props.schemas, values.value);

      return h('div', { class: 'oref-shapes-fill' }, [
        h('h2', { class: 'oref-section-title' }, 'Filling: one body, rebuilt by its values'),
        h('div', { class: 'oref-shape-announce', role: 'status' }, [
          announce.value === '' ? null : h('span', announce.value),
          announce.value === ''
            ? null
            : h(
                'button',
                {
                  class: 'oref-shape-add',
                  type: 'button',
                  onClick: () => {
                    announce.value = '';
                  },
                },
                'hide',
              ),
        ]),
        ...controls.map(renderControl),
      ]);
    };
  },
});

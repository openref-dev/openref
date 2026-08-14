/**
 * One labelled control of the try-it console.
 *
 * NOT A SLOT AND SHARED BY THREE THAT ARE. `ServerSelect`, `AuthPanel` and `ShapeForm` all draw
 * a label, a control and a note under it, and a fourth name in the registry for the shape they
 * have in common would be a name every theme had to implement to change nothing.
 */

import { h, type VNode } from 'vue';

/**
 * Id of one field, so its label can name it.
 *
 * IT NO LONGER CARRIES THE NODE ID, since `TX-SLOTWIRE` split the console into positions. A page
 * is one operation: the console is mounted by the node page for the node it is about, so two
 * consoles cannot share a document and the node id was buying uniqueness against nothing. The
 * positions that draw fields are slots now, and handing each of them a node id it uses for
 * nothing but a prefix would have been a prop in the contract for the same reason.
 */
export function fieldId(kind: string, name: string): string {
  return `oref-field-${kind}-${name}`.replace(/[^A-Za-z0-9_-]/g, '-');
}

/**
 * Renders one labelled control.
 *
 * @param label - What the field asks for
 * @param id - Id of the control, which the label points at
 * @param control - The control itself
 * @param note - What the field asks for beyond its name, or null
 * @returns The field
 */
export function field(label: string, id: string, control: VNode, note: string | null): VNode {
  return h('div', { class: 'oref-field', key: id }, [
    h('label', { class: 'oref-field-label', for: id }, label),
    control,
    note === null ? null : h('span', { class: 'oref-field-note' }, note),
  ]);
}

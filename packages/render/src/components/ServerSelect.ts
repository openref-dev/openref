/**
 * Which server the console sends to.
 *
 * THE SERVERS ARE URLS AND NOT `IRServer`, which is what the position can supply: the page model
 * carries them as urls because the reference has never drawn a server's description or its
 * variables. Putting those back is a page model decision and not a slot one, and saying so is
 * better than declaring a prop no page fills.
 *
 * ONE DECLARED SERVER IS NOT A CHOICE, so it is a read only field rather than a select with one
 * option, which asks a reader to make a decision that has already been made for them.
 */

import { h, type VNode } from 'vue';
import { field, fieldId } from './field';
import { eventValue, type ValueEvent } from '../shared/dom';

/** Id of the control, so its label can name it. A page carries one console. */
const SERVER_FIELD_ID = fieldId('server', 'url');

/**
 * Renders the server field.
 *
 * @param props - The declared servers, which one is active, and how to change it
 * @returns The field, or null when the document declares no server
 */
export function ServerSelect(props: {
  readonly servers: readonly string[];
  readonly activeServerUrl: string;
  readonly onSelect: (url: string) => void;
}): VNode | null {
  if (props.servers.length === 0) return null;

  const control =
    props.servers.length === 1
      ? h('input', {
          class: 'oref-field-control',
          id: SERVER_FIELD_ID,
          type: 'text',
          readonly: true,
          value: props.activeServerUrl,
        })
      : h(
          'select',
          {
            class: 'oref-field-control',
            id: SERVER_FIELD_ID,
            value: props.activeServerUrl,
            onChange: (event: ValueEvent) => {
              props.onSelect(eventValue(event));
            },
          },
          props.servers.map((url) => h('option', { key: url, value: url }, url)),
        );

  return field('Server', SERVER_FIELD_ID, control, null);
}

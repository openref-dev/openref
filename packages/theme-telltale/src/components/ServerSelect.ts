import { h, type VNode } from 'vue';
import { eventValue, type ValueEvent } from '../dom';

/**
 * Which server the console sends to.
 *
 * THE SERVERS ARE URLS AND NOT `IRServer`, because that is what the page model carries: the
 * reference has never drawn a server's description or its variables, so neither is on the wire.
 * A theme that wanted to draw a description would be asking for a page model change and not for a
 * slot change, and the difference is worth knowing before proposing one.
 *
 * A `select` AND NOT A LIST OF BUTTONS, because a document with forty servers is a document this
 * has to survive, and because a select is what a keyboard and a screen reader already know.
 */
export default function ServerSelect(props: {
  readonly servers: readonly string[];
  readonly activeServerUrl: string;
  readonly onSelect: (url: string) => void;
}): VNode {
  return h('label', { class: 'tt-field tt-server' }, [
    h('span', { class: 'tt-field-label' }, 'server'),
    h(
      'select',
      {
        class: 'tt-field-select',
        value: props.activeServerUrl,
        onChange: (event: ValueEvent): void => {
          props.onSelect(eventValue(event));
        },
      },
      props.servers.map((server) =>
        h(
          'option',
          { key: server, value: server, selected: server === props.activeServerUrl },
          server,
        ),
      ),
    ),
  ]);
}

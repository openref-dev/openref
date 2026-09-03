/**
 * The interactive socket console of SPEC 14.7, on the channel page.
 *
 * WHAT IT IS. A reader on a channel page picks a server, presses Connect, and the page opens a
 * real socket through the engine `T055` built: the session, the bounded window, the byte ceiling,
 * the deterministic reconnection budget and the per message verdict. What it draws is the log
 * that engine publishes and its six figures, nothing recomputed here. `T055` built the engine and
 * did not build this, because every shape of it needed class names and the stylesheet had forty
 * bytes of headroom; the debt was `TX-SOCKET-CONSOLE` and this is it paid.
 *
 * IT DRIVES THE PORT AND NOT `useSocket`, AND THAT IS MEASURED RATHER THAN PREFERRED. The
 * published composable answers `blocked` out of `state.document`, which is the whole IR document,
 * and the served reference has never provided one: `provideDocState` is called by the theme
 * harness and by tests, and by nothing on a page this module serves. A console written on the
 * composable would throw `ThemeContractError` on the first channel page a reader opened. So the
 * two halves land where their data is: the statement about what a browser cannot present at a
 * handshake is server markup `ChannelSections` already draws from the page model, at zero browser
 * bytes, and the session is driven here through `ISocketPort`, which is the same port
 * `useSocket` would have used and the same one a third party host implements.
 *
 * IT INVENTS NO CLASS NAME THAT NEEDS A RULE. Three names arrive, `oref-section-socket`,
 * `oref-socket-log` and `oref-socket-entry`, and each of them sits on an element that already
 * carries a styled class: the section, the result list and one of its bodies. That is the rule
 * `MODIFIERS_WITHOUT_RULES` states and the one the call samples block and the stream log were
 * built to, and it is why this console costs the default theme's stylesheet nothing at all. The
 * measurement is in SPEC 20 beside the caps rather than claimed here.
 *
 * THE REFUSAL IS THE ENGINE'S AND IS NOT REPEATED HERE. A credential given to a scheme a browser
 * cannot present at a handshake is refused by `buildHandshake` before a socket is opened, with the
 * scheme, the cause and the route in the sentence. This component shows that sentence and does not
 * decide it: a second copy of the rule here is how the page and the engine would come to disagree
 * about which schemes a browser can carry.
 */

import { useSocketPort } from '@openref/vue';
import { computed, defineComponent, h, onBeforeUnmount, ref, type PropType, type VNode } from 'vue';
import { field, fieldId } from './field';
import { eventValue, type ValueEvent } from '../shared/dom';
import type {
  ChannelModel,
  SocketLogEntryView,
  SocketLogStateView,
  SocketSessionView,
  SocketStatusView,
  SocketTransportKindView,
} from '@openref/vue';

/** The log a console has before a session has ever been opened. */
const EMPTY_LOG: SocketLogStateView = {
  entries: [],
  sent: 0,
  received: 0,
  invalid: 0,
  unreadable: 0,
  dropped: 0,
};

/**
 * What each status means to a reader, in words rather than as a machine name.
 *
 * A TOTAL RECORD OVER THE UNION, so a seventh status cannot arrive without a sentence. The
 * engine publishes six and the console draws whichever it is handed; a `default` here would draw
 * a state nobody had written words for and read as if it had.
 */
const STATUS_WORDS: Readonly<Record<SocketStatusView, string>> = {
  idle: 'Not connected.',
  connecting: 'Connecting.',
  open: 'Connected.',
  reconnecting: 'The connection dropped. Reconnecting.',
  closed: 'The connection is closed.',
  refused: 'The reconnection budget is spent. Press Connect to try again.',
};

/**
 * Which schemes a browser can carry into a handshake, so the console offers a box for those and
 * for nothing else.
 *
 * IT ASKS THE PAGE MODEL RATHER THAN RE-DERIVING THE RULE. `handshakeBlockedCause` in
 * `@openref/core` owns the question and `ChannelSections` already prints its answer beside the
 * server. What this needs is narrower and is a fact the model carries plainly: an `apiKey` or
 * `httpApiKey` in the query string is part of the address, so the reader can supply it here.
 * Everything else either travels in a header, which a browser cannot set on a handshake, or is
 * not a handshake credential at all.
 */
function askableSchemes(channel: ChannelModel | null): readonly { id: string; name: string }[] {
  if (channel === null) return [];

  const asked = new Map<string, string>();

  for (const server of channel.servers) {
    for (const scheme of server.security) {
      if (scheme.type !== 'apiKey' && scheme.type !== 'httpApiKey') continue;
      if (scheme.in !== 'query') continue;

      asked.set(scheme.schemeId, scheme.name === '' ? scheme.schemeId : scheme.name);
    }
  }

  return [...asked].map(([id, name]) => ({ id, name }));
}

/**
 * The transport a protocol names, which is the whole of what the document says about it.
 *
 * `socket.io` IS NAMED AND NOTHING ELSE IS GUESSED. AsyncAPI writes a protocol string, and the
 * two the engine has transports for are the native socket and Socket.IO. A protocol this does not
 * recognise gets the native transport, because that is what a `ws` or `wss` address is, and a
 * server that wanted something else declared a protocol saying so.
 */
function transportOf(protocol: string): SocketTransportKindView {
  return protocol.toLowerCase() === 'socket.io' ? 'socket.io' : 'native';
}

/**
 * The socket address, from the server the reader picked and the channel's own address.
 *
 * A CHANNEL ADDRESS IS RELATIVE TO ITS SERVER, per SPEC 8.2, so the two are joined rather than
 * one of them being taken alone. A channel with no address of its own is the server's address,
 * which is what a document that binds a channel to a whole server means.
 */
export function socketAddressOf(serverUrl: string, channelAddress: string): string {
  if (channelAddress === '') return serverUrl;
  if (serverUrl === '') return channelAddress;

  const left = serverUrl.endsWith('/') ? serverUrl.slice(0, -1) : serverUrl;
  const right = channelAddress.startsWith('/') ? channelAddress : `/${channelAddress}`;

  return `${left}${right}`;
}

/** One line of the window, with its direction, its text and whatever the engine said about it. */
function logEntry(entry: SocketLogEntryView): VNode {
  const marks: VNode[] = [
    h(
      'span',
      {
        class: [
          'oref-badge',
          entry.direction === 'sent' ? 'oref-direction-send' : 'oref-direction-receive',
        ],
      },
      entry.direction === 'sent' ? 'send' : 'receive',
    ),
  ];

  return h('li', { class: 'oref-run-body oref-socket-entry', key: entry.seq }, [
    ...marks,
    h('code', { class: 'oref-code' }, entry.data),
    // AN UNREADABLE FRAME SAYS SO RATHER THAN LOOKING LIKE A MESSAGE THAT PASSED, which is the
    // correction SPEC 14.7 records from the other side: before it, a binary frame went to the
    // validator as text and got a verdict about a schema its payload never reached. A row with
    // no verdict beside a row that matched would read as a frame nothing objected to.
    entry.unreadable === true
      ? h('span', { class: 'oref-run-summary' }, 'not text, so no schema was applied')
      : null,
    entry.matched === undefined
      ? null
      : h('span', { class: 'oref-run-summary' }, `matches ${entry.matched}`),
    entry.problem === undefined ? null : h('p', { class: 'oref-run-error' }, entry.problem),
  ]);
}

/** One counter of the window, drawn whether or not it is zero. */
function count(label: string, value: number): VNode {
  return h('li', { class: 'oref-fact', key: label }, [
    h('span', { class: 'oref-fact-label' }, label),
    h('span', { class: 'oref-fact-value' }, String(value)),
  ]);
}

/**
 * The console.
 *
 * ITS SERVER RENDER IS THE IDLE STATE AND THAT IS THE WHOLE OF WHY IT HYDRATES CLEANLY. Nothing
 * here reads a port at render time, so the markup a server writes and the markup the first client
 * render would write are the same: a picked server, an empty composer, six zeroes and an empty
 * window. The chunk arrives when the reader reaches into the region and hydrates it in place, per
 * the deferral rules in `browser/deferred.ts`.
 */
export const SocketConsole = defineComponent({
  name: 'OrefSocketConsole',

  props: {
    channel: { type: Object as PropType<ChannelModel | null>, default: null },
    /** The channel's own address, from the node header. Empty when the document wrote none. */
    address: { type: String, default: '' },
  },

  setup(props) {
    // `undefined` ON THE SERVER AND UNTIL THE CHUNK LANDS, which is what makes the controls
    // honest: with no port there is nothing to connect, and the notice says so rather than a
    // button promising something no code behind it can do.
    const port = useSocketPort();

    const servers = computed(() => props.channel?.servers ?? []);
    const picked = ref(servers.value[0]?.url ?? '');
    const draft = ref('');
    const credentials = ref<Record<string, string>>({});

    const status = ref<SocketStatusView>('idle');
    const log = ref<SocketLogStateView>(EMPTY_LOG);
    const attempts = ref(0);
    const notice = ref('');

    let session: SocketSessionView | undefined;

    const chosen = computed(() => servers.value.find((server) => server.url === picked.value));

    function adopt(): void {
      const state = session?.state();
      if (state === undefined) return;

      status.value = state.status;
      log.value = state.log;
      attempts.value = state.attempts;
      notice.value = state.message ?? '';
    }

    function connect(): void {
      if (port === undefined) {
        notice.value = 'This page has no socket client, so nothing can be connected.';
        return;
      }

      session?.close();
      notice.value = '';

      const server = chosen.value;
      const query = Object.entries(credentials.value)
        .filter(([, value]) => value !== '')
        .map(([name, value]): readonly [string, string] => [name, value]);

      try {
        session = port.open(
          {
            address: socketAddressOf(server?.url ?? '', props.address),
            transport: transportOf(server?.protocol ?? ''),
            ...(query.length === 0 ? {} : { query }),
          },
          { onState: adopt },
        );
        adopt();
      } catch (cause) {
        // THE ENGINE'S SENTENCE AND NOT A REPLACEMENT FOR IT. `buildHandshake` refuses before a
        // socket is opened and names the scheme, the cause and the route; a message written here
        // would be a second answer to a question `@openref/core` already answers.
        session = undefined;
        status.value = 'idle';
        notice.value = cause instanceof Error ? cause.message : String(cause);
      }
    }

    function close(): void {
      session?.close();
      session = undefined;
      status.value = 'closed';
    }

    function send(): void {
      if (session === undefined || draft.value === '') return;

      try {
        session.send(draft.value);
        draft.value = '';
        adopt();
      } catch (cause) {
        notice.value = cause instanceof Error ? cause.message : String(cause);
      }
    }

    // A SESSION OUTLIVING ITS PAGE IS A SOCKET NOBODY CAN CLOSE. Navigating away from a channel
    // unmounts this and the transport would otherwise keep the connection and keep filling a
    // window nothing draws.
    onBeforeUnmount(() => {
      session?.close();
      session = undefined;
    });

    return (): VNode => {
      const asked = askableSchemes(props.channel);
      const connected = status.value === 'open' || status.value === 'reconnecting';
      const window = log.value;

      return h('section', { class: 'oref-section oref-section-socket' }, [
        h('h2', { class: 'oref-section-title' }, 'Console'),
        h(
          'p',
          { class: 'oref-tryit-notice' },
          notice.value === '' ? STATUS_WORDS[status.value] : notice.value,
        ),
        h('div', { class: 'oref-tryit-form' }, [
          servers.value.length === 0
            ? null
            : field(
                'server',
                fieldId('socket', 'server'),
                h(
                  'select',
                  {
                    class: 'oref-field-control',
                    id: fieldId('socket', 'server'),
                    value: picked.value,
                    onChange: (event: ValueEvent): void => {
                      picked.value = eventValue(event);
                    },
                  },
                  servers.value.map((server) =>
                    h('option', { key: server.url, value: server.url }, server.url),
                  ),
                ),
                socketAddressOf(chosen.value?.url ?? '', props.address),
              ),
          ...asked.map((scheme) =>
            field(
              scheme.name,
              fieldId('socket', scheme.id),
              h('input', {
                class: 'oref-field-control',
                id: fieldId('socket', scheme.id),
                type: 'text',
                value: credentials.value[scheme.name] ?? '',
                onInput: (event: ValueEvent): void => {
                  credentials.value = { ...credentials.value, [scheme.name]: eventValue(event) };
                },
              }),
              'travels in the address, which is what a browser can present at a handshake',
            ),
          ),
          field(
            'message',
            fieldId('socket', 'message'),
            h('textarea', {
              class: 'oref-field-control',
              id: fieldId('socket', 'message'),
              rows: 3,
              value: draft.value,
              onInput: (event: ValueEvent): void => {
                draft.value = eventValue(event);
              },
            }),
            null,
          ),
        ]),
        h('div', { class: 'oref-tryit-actions' }, [
          h(
            'button',
            { class: 'oref-send', type: 'button', onClick: connect },
            connected ? 'Reconnect' : 'Connect',
          ),
          h(
            'button',
            { class: 'oref-send', type: 'button', disabled: !connected, onClick: close },
            'Disconnect',
          ),
          h(
            'button',
            { class: 'oref-send', type: 'button', disabled: !connected, onClick: send },
            'Send',
          ),
        ]),
        // SIX FIGURES AND NOT FIVE. `dropped` counts what left the window and what the byte
        // ceiling of SPEC 14.7 evicted, and `unreadable` counts the frames that were never text,
        // which `T065` gave the view precisely so a console could draw it rather than let a
        // binary frame read as a message that failed a schema.
        h('ul', { class: 'oref-facts' }, [
          count('sent', window.sent),
          count('received', window.received),
          count('invalid', window.invalid),
          count('unreadable', window.unreadable),
          count('dropped', window.dropped),
          count('attempts', attempts.value),
        ]),
        h(
          'ol',
          { class: 'oref-run-result oref-socket-log' },
          window.entries.map((entry) => logEntry(entry)),
        ),
      ]);
    };
  },
});

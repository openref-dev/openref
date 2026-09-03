// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createApp, createSSRApp, defineComponent, h, nextTick } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { SOCKET_KEY } from '@openref/vue';
import { SocketConsole, socketAddressOf } from '../../src/components/SocketConsole';
import type {
  ChannelModel,
  ISocketPort,
  SocketLogStateView,
  SocketOpenInput,
  SocketSessionHandlersView,
  SocketSessionStateView,
  SocketSessionView,
} from '@openref/vue';
import type { App } from 'vue';

/**
 * The interactive socket console of SPEC 14.7, per `TX-SOCKET-CONSOLE`.
 *
 * WHAT THIS FILE IS ABOUT is that a reader on a channel page can open a socket, send on it and
 * read the bounded window with its six figures, and that every one of those figures is the
 * engine's rather than this component's. The engine is `@openref/runner` and this package may not
 * see it, so the port is doubled here exactly as `IRunnerPort` is doubled for the console's own
 * tests: what is under test is the surface, and the engine has its suite in its own package.
 *
 * AND THAT THE ABSENCE OF A PORT IS A SENTENCE RATHER THAN A DEAD BUTTON. A reference published
 * read only wires no socket client, and a console that looked identical either way would be the
 * F14 reading exactly: a control that promises something no code behind it can do.
 *
 * THE PRESSES ARE REAL DOM EVENTS ON A REAL MOUNT, because that is the difference between a
 * component whose handler is callable and a page whose button is wired. What is deliberately not
 * here is anything about a gesture reaching an element on a served page: that is the browser
 * suite's, per the standing rule, and this is jsdom.
 */

/** A session double that publishes whatever a case tells it to. */
interface FakeSession extends SocketSessionView {
  readonly sent: string[];
  wasClosed: boolean;
}

function fakeSession(state: SocketSessionStateView): FakeSession {
  const sent: string[] = [];
  const session: FakeSession = {
    sent,
    wasClosed: false,
    state: () => state,
    send: (data: string) => {
      sent.push(data);
    },
    close: () => {
      session.wasClosed = true;
    },
    closed: Promise.resolve(state),
  };

  return session;
}

const EMPTY_LOG: SocketLogStateView = {
  entries: [],
  sent: 0,
  received: 0,
  invalid: 0,
  unreadable: 0,
  dropped: 0,
};

function channel(overrides: Partial<ChannelModel> = {}): ChannelModel {
  return {
    protocol: 'ws',
    parameters: [],
    servers: [
      {
        url: 'wss://ws.example.com',
        protocol: 'ws',
        protocolVersion: '',
        description: '',
        security: [],
      },
    ],
    bindings: [],
    operations: [],
    messages: [],
    ...overrides,
  };
}

/** The console rendered on the server, which is the markup a reader is served. */
async function served(model: ChannelModel | null, address = '/orders.created'): Promise<string> {
  const app = createSSRApp(
    defineComponent(() => () => h(SocketConsole, { channel: model, address })),
  );

  return renderToString(app);
}

interface Mounted {
  readonly root: HTMLElement;
  readonly app: App<Element>;
  /** The three controls of the actions row, in the order the console draws them. */
  buttons(): HTMLButtonElement[];
  /** The window figures, by the label the console prints beside each. */
  counters(): Record<string, string>;
  text(): string;
}

/** Mounts the console on a real element, so a press is a dispatched event. */
function mountConsole(model: ChannelModel | null, port?: ISocketPort): Mounted {
  const root = document.createElement('div');
  document.body.append(root);

  const app = createApp(
    defineComponent(() => () => h(SocketConsole, { channel: model, address: '/orders.created' })),
  );
  if (port !== undefined) app.provide(SOCKET_KEY, port);
  app.mount(root);

  return {
    root,
    app,
    buttons: () => Array.from(root.querySelectorAll('button')),
    counters: () =>
      Object.fromEntries(
        Array.from(root.querySelectorAll('.oref-fact')).map((row) => [
          row.querySelector('.oref-fact-label')?.textContent ?? '',
          row.querySelector('.oref-fact-value')?.textContent ?? '',
        ]),
      ),
    text: () => root.textContent.replace(/\s+/g, ' '),
  };
}

/** The words a reader sees, with the markup taken off. */
function words(markup: string): string {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

describe('the socket address', () => {
  it('should join the server a reader picked to the channel own address', () => {
    // Given a server and a channel address, which SPEC 8.2 says are relative to each other

    // When
    const address = socketAddressOf('wss://ws.example.com/', '/orders.created');

    // Then one separator, whichever side wrote it
    expect(address).toBe('wss://ws.example.com/orders.created');
    expect(socketAddressOf('wss://ws.example.com', 'orders.created')).toBe(
      'wss://ws.example.com/orders.created',
    );
  });

  it('should be the server alone for a channel that declares no address of its own', () => {
    // Given a channel bound to a whole server, which is what an empty address means

    // When, Then
    expect(socketAddressOf('wss://ws.example.com', '')).toBe('wss://ws.example.com');
  });
});

describe('the served socket console', () => {
  it('should draw the idle state, its controls and all six figures of the window', async () => {
    // Given a channel page served by a host that has not wired a socket client

    // When
    const markup = await served(channel());

    // Then the region is there for the deferral gate to match, with its three controls
    expect(markup).toContain('oref-section-socket');
    expect(markup.match(/oref-send/g)).toHaveLength(3);

    // And the window is drawn at zero rather than hidden, so a reader knows what it counts
    const seen = words(markup);
    for (const label of ['sent', 'received', 'invalid', 'unreadable', 'dropped', 'attempts']) {
      expect(seen).toContain(label);
    }
    expect(seen).toContain('Not connected.');
  });

  it('should offer a box only for a credential the address can carry, per SPEC 14.7', async () => {
    // Given one scheme a browser can present at a handshake and one it cannot
    const model = channel({
      servers: [
        {
          url: 'wss://ws.example.com',
          protocol: 'ws',
          protocolVersion: '',
          description: '',
          security: [
            { schemeId: 'queryKey', type: 'httpApiKey', in: 'query', name: 'token', scopes: [] },
            { schemeId: 'bearerAuth', type: 'http', in: '', name: '', scopes: [] },
          ],
        },
      ],
    });

    // When
    const markup = await served(model);

    // Then the query key is asked for and the header scheme is not, because a browser cannot set
    // a handshake header and a box for it would be a control that cannot work
    expect(markup).toContain('oref-field-socket-queryKey');
    expect(markup).toContain('>token</label>');
    expect(markup).not.toContain('oref-field-socket-bearerAuth');
  });
});

describe('the socket console with no client', () => {
  it('should say it has no client rather than offer a control that cannot connect', async () => {
    // Given the shipped read only reference, which wires no socket client
    const page = mountConsole(channel());

    // When a reader presses Connect
    page.buttons()[0]?.click();
    await nextTick();

    // Then the reason is in words, and the falsification is the suite below: with a client, the
    // same press on the same markup opens a session
    expect(page.text()).toContain('no socket client');
    page.app.unmount();
  });
});

describe('the socket console with a client', () => {
  it('should open a session through the port and draw what the engine publishes', async () => {
    // Given a port that publishes a window with one entry of each kind the engine can file
    const state: SocketSessionStateView = {
      status: 'open',
      attempts: 0,
      log: {
        entries: [
          { seq: 1, direction: 'sent', data: '{"ping":1}' },
          { seq: 2, direction: 'received', data: '{"pong":1}', matched: 'Pong' },
          { seq: 3, direction: 'received', data: 'nope', problem: 'this message does not match' },
          { seq: 4, direction: 'received', data: 'a binary frame', unreadable: true },
        ],
        sent: 1,
        received: 3,
        invalid: 1,
        unreadable: 1,
        dropped: 7,
      },
    };
    const session = fakeSession(state);
    const open = vi.fn(
      (_input: SocketOpenInput, _handlers: SocketSessionHandlersView): SocketSessionView => session,
    );
    const page = mountConsole(channel(), { open });

    // When a reader presses Connect
    page.buttons()[0]?.click();
    await nextTick();

    // Then the engine was asked for the joined address and the transport the protocol names
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0].address).toBe('wss://ws.example.com/orders.created');
    expect(open.mock.calls[0]?.[0].transport).toBe('native');

    // And every line of the window is drawn, with its direction and the engine's verdict
    expect(page.root.querySelectorAll('.oref-socket-entry')).toHaveLength(4);
    expect(page.root.querySelector('.oref-direction-send')).not.toBeNull();
    expect(page.root.querySelector('.oref-direction-receive')).not.toBeNull();
    expect(page.text()).toContain('matches Pong');
    expect(page.text()).toContain('this message does not match');

    // And the six figures are the engine's, `dropped` and `unreadable` among them, which is the
    // clause `TX-SOCKET-CONSOLE` names: a surface that drew five would be silent about a window
    // that is incomplete and about a frame that was never text at all
    expect(page.counters()).toEqual({
      sent: '1',
      received: '3',
      invalid: '1',
      unreadable: '1',
      dropped: '7',
      attempts: '0',
    });

    // And the frame that was never text says so, rather than sitting there with no verdict
    // beside one that matched, which would read as a frame nothing objected to
    expect(page.text()).toContain('not text, so no schema was applied');
    page.app.unmount();
  });

  it('should send what a reader typed on the open session and clear the composer', async () => {
    // Given an open session
    const session = fakeSession({ status: 'open', attempts: 0, log: EMPTY_LOG });
    const page = mountConsole(channel(), { open: () => session });
    page.buttons()[0]?.click();
    await nextTick();

    // When a reader types a frame and presses Send
    const composer = page.root.querySelector('textarea');
    if (composer === null) throw new Error('the console must draw a composer');
    composer.value = '{"hello":true}';
    composer.dispatchEvent(new Event('input'));
    await nextTick();
    page.buttons()[2]?.click();
    await nextTick();

    // Then the frame went to the engine and the composer is empty again
    expect(session.sent).toEqual(['{"hello":true}']);
    expect(page.root.querySelector('textarea')?.value).toBe('');
    page.app.unmount();
  });

  it('should show the engine refusal rather than open a socket it cannot open', async () => {
    // Given a port that refuses before opening anything, which is SPEC 14.7's own rule for a
    // credential given to a scheme a browser cannot present at a handshake
    const page = mountConsole(channel(), {
      open: () => {
        throw new Error('bearerAuth travels in a handshake header, which a browser cannot set');
      },
    });

    // When
    page.buttons()[0]?.click();
    await nextTick();

    // Then the engine's sentence reaches the reader unrewritten, because a second copy of the
    // rule here is how the page and the engine would come to disagree
    expect(page.text()).toContain('which a browser cannot set');
    page.app.unmount();
  });

  it('should close the session when the page it is on goes away', async () => {
    // Given an open session, because a socket outliving its page is one nobody can close
    const session = fakeSession({ status: 'open', attempts: 0, log: EMPTY_LOG });
    const page = mountConsole(channel(), { open: () => session });
    page.buttons()[0]?.click();
    await nextTick();
    expect(session.wasClosed).toBe(false);

    // When
    page.app.unmount();

    // Then
    expect(session.wasClosed).toBe(true);
  });
});

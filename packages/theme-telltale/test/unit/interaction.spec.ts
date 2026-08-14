import { describe, expect, it, vi } from 'vitest';
import { isVNode, type VNode, type VNodeArrayChildren } from 'vue';
import AuthPanel from '../../src/components/AuthPanel';
import CodeSample from '../../src/components/CodeSample';
import CommandPalette from '../../src/components/CommandPalette';
import SendButton from '../../src/components/SendButton';
import ServerSelect from '../../src/components/ServerSelect';
import ShapeForm from '../../src/components/ShapeForm';
import StreamLog from '../../src/components/StreamLog';
import { eventFile, eventValue } from '../../src/dom';

/**
 * The half of a theme a server render never reaches.
 *
 * A PAGE THAT RENDERS IS NOT A CONTROL THAT WORKS. `slot-coverage.spec.ts` drives every position
 * through `renderPage` and proves the reference hands each one the right thing; nothing in a server
 * render presses a button. The callbacks are the whole of what the console positions are for, and a
 * theme that drew a Send button and never called `onSend` would pass every other file here.
 *
 * IT CALLS THE COMPONENTS RATHER THAN MOUNTING THEM. These positions are function components, so
 * calling one with its props returns the tree it would draw and the handlers are on it. That needs
 * no DOM, which is the same reason the components themselves name no DOM type: this package's
 * `src/dom.ts` says structurally what an event carries, so an event here is an object literal.
 */

/** Every vnode of a tree, depth first, so a handler can be found wherever the layout put it. */
function walk(node: unknown): VNode[] {
  if (Array.isArray(node)) return (node as VNodeArrayChildren).flatMap(walk);
  if (!isVNode(node)) return [];

  const children = node.children;
  return [node, ...(typeof children === 'object' ? walk(children) : [])];
}

/**
 * Every vnode carrying a class.
 *
 * The class arrives normalized to a string here and as an array in the source, so both forms are
 * read. A helper that knew only one of them would find nothing and the case would read as a
 * component that drew nothing.
 */
function allByClass(tree: unknown, className: string): VNode[] {
  return walk(tree).filter((node) => {
    const value = (node.props as { class?: unknown } | null)?.class;
    const flat = Array.isArray(value) ? value.join(' ') : typeof value === 'string' ? value : '';
    return flat.split(/\s+/).includes(className);
  });
}

/** The first vnode carrying a class, so a case names what it pressed. */
function byClass(tree: unknown, className: string): VNode {
  const found = allByClass(tree, className)[0];
  if (found === undefined) throw new Error(`nothing drew .${className}`);
  return found;
}

/** The nth vnode carrying a class, for a position that draws the same control twice. */
function nthByClass(tree: unknown, className: string, at: number): VNode {
  const found = allByClass(tree, className)[at];
  if (found === undefined) throw new Error(`nothing drew a ${String(at + 1)}th .${className}`);
  return found;
}

/**
 * One handler off a vnode.
 *
 * The argument is `unknown` because what a listener is handed is the browser's, and this package
 * says structurally what it reads off it rather than naming a DOM type. A case passes the object
 * literal the component will actually narrow.
 */
function handler(node: VNode, name: string): (argument: unknown) => void {
  const props: unknown = node.props;
  const found = (props as Record<string, unknown> | null)?.[name];
  if (typeof found !== 'function') throw new Error(`no ${name} on that element`);

  const listener = found as (...args: readonly unknown[]) => unknown;
  return (argument: unknown): void => {
    listener(argument);
  };
}

describe('the shims that read a browser event', () => {
  it('should read a value off whatever carries one, and nothing off what does not', () => {
    // Given, an event is the browser's and this package compiles in a program with no DOM types,
    // so the value is narrowed rather than asserted. An event with no usable value yields an empty
    // field rather than throwing inside a listener, where nothing could catch it.
    // When, Then
    expect(eventValue({ target: { value: 'orders' } })).toBe('orders');
    expect(eventValue({ target: { value: 7 } })).toBe('');
    expect(eventValue({ target: null })).toBe('');
    expect(eventValue({})).toBe('');
  });

  it('should read the first file, and null when the reader cleared the field', () => {
    // Given
    const file = {
      name: 'order.csv',
      type: 'text/csv',
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(2)),
    };

    // When, Then
    expect(eventFile({ target: { files: [file] } })).toBe(file);
    expect(eventFile({ target: { files: [] } })).toBeNull();
    expect(eventFile({ target: { files: null } })).toBeNull();
    expect(eventFile({})).toBeNull();
  });
});

describe('the console positions, driven', () => {
  it('should send when the button is pressed and not when it cannot act', () => {
    // Given a button that can act
    const onSend = vi.fn();
    const ready = SendButton({
      available: true,
      pending: false,
      mounted: true,
      notice: '',
      onSend,
    });

    // When
    handler(byClass(ready, 'tt-send-button'), 'onClick')(undefined);

    // Then
    expect(onSend).toHaveBeenCalledTimes(1);

    // And a button before hydration is enabled with the notice associated rather than
    // adjacent, per the SPEC 11 rule rewritten 2026-08-14: this theme served Send natively
    // disabled and was the measured case of the engine dropping the click, a press that armed
    // the console's loader and sent nothing.
    const waiting = SendButton({
      available: true,
      pending: false,
      mounted: false,
      notice: 'The console loads when you press Send.',
      onSend,
    });

    expect((byClass(waiting, 'tt-send-button').props as { disabled?: boolean }).disabled).toBe(
      false,
    );
    expect(
      (byClass(waiting, 'tt-send-button').props as Record<string, unknown>)['aria-describedby'],
    ).toBe('tt-send-notice');

    // And a live console that cannot send is the only state the native attribute is for
    const readOnly = SendButton({
      available: false,
      pending: false,
      mounted: true,
      notice: 'This build carries no request runner, so the console is read only.',
      onSend,
    });
    expect((byClass(readOnly, 'tt-send-button').props as { disabled?: boolean }).disabled).toBe(
      true,
    );
  });

  it('should choose a server by its url', () => {
    // Given
    const onSelect = vi.fn();
    const tree = ServerSelect({
      servers: ['https://api.example.com', 'https://sandbox.example.com'],
      activeServerUrl: 'https://api.example.com',
      onSelect,
    });

    // When
    handler(
      byClass(tree, 'tt-field-select'),
      'onChange',
    )({
      target: { value: 'https://sandbox.example.com' },
    });

    // Then
    expect(onSelect).toHaveBeenCalledWith('https://sandbox.example.com');
  });

  it('should hand back what was typed into a text body and into a named field', () => {
    // Given a media type whose editor is one text area
    const onText = vi.fn();
    const text = ShapeForm({
      media: { mediaType: 'application/json', editor: 'text', fields: [] },
      values: {},
      files: {},
      text: '{}',
      onField: vi.fn(),
      onFile: vi.fn(),
      onText,
    });

    // When
    handler(byClass(text, 'tt-field-text'), 'onInput')({ target: { value: '{"id":1}' } });

    // Then
    expect(onText).toHaveBeenCalledWith('{"id":1}');

    // And a media type whose editor is named fields
    const onField = vi.fn();
    const fields = ShapeForm({
      media: {
        mediaType: 'multipart/form-data',
        editor: 'fields',
        fields: [{ name: 'sku', required: true, kind: 'text' }],
      },
      values: {},
      files: {},
      text: '',
      onField,
      onFile: vi.fn(),
      onText: vi.fn(),
    });

    handler(byClass(fields, 'tt-field-input'), 'onInput')({ target: { value: 'A-1' } });

    expect(onField).toHaveBeenCalledWith('sku', 'A-1');
  });

  it('should hand back a chosen file as bytes, and undefined when it is cleared', async () => {
    // Given, the runner is handed a `RunnerFile` rather than a browser `File`, so what a body is
    // built from is the same shape on a page, in a test and in a static export.
    const onFile = vi.fn();
    const tree = ShapeForm({
      media: {
        mediaType: 'multipart/form-data',
        editor: 'fields',
        fields: [{ name: 'receipt', required: false, kind: 'file' }],
      },
      values: {},
      files: {},
      text: '',
      onField: vi.fn(),
      onFile,
      onText: vi.fn(),
    });
    const onChange = handler(byClass(tree, 'tt-field-file'), 'onChange');

    // When
    onChange({
      target: {
        files: [
          {
            name: 'receipt.png',
            type: 'image/png',
            arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
          },
        ],
      },
    });
    await vi.waitFor(() => {
      expect(onFile).toHaveBeenCalled();
    });

    // Then
    expect(onFile).toHaveBeenCalledWith('receipt', {
      fileName: 'receipt.png',
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });

    // And clearing it says so rather than sending an empty file
    onChange({ target: { files: [] } });
    expect(onFile).toHaveBeenLastCalledWith('receipt', undefined);
  });

  it('should open, query, move and close the palette', () => {
    // Given a palette that is shut, which draws a button and not an absence
    const onOpen = vi.fn();
    const shut = CommandPalette({
      open: false,
      query: '',
      selected: 0,
      hits: [],
      partial: false,
      onOpen,
      onClose: vi.fn(),
      onQuery: vi.fn(),
      onSelect: vi.fn(),
    });

    // When
    handler(byClass(shut, 'tt-palette-open'), 'onClick')(undefined);

    // Then
    expect(onOpen).toHaveBeenCalledTimes(1);

    // And an open one queries, moves the selection and closes
    const onQuery = vi.fn();
    const onSelect = vi.fn();
    const onClose = vi.fn();
    const open = CommandPalette({
      open: true,
      query: 'ord',
      selected: 0,
      hits: [{ id: 'a', label: 'List orders', hint: 'GET /orders', href: '/get-orders' }],
      partial: true,
      onOpen: vi.fn(),
      onClose,
      onQuery,
      onSelect,
    });

    handler(byClass(open, 'tt-palette-input'), 'onInput')({ target: { value: 'order' } });
    handler(byClass(open, 'tt-palette-link'), 'onMouseenter')(undefined);
    handler(byClass(open, 'tt-palette-close'), 'onClick')(undefined);

    expect(onQuery).toHaveBeenCalledWith('order');
    expect(onSelect).toHaveBeenCalledWith(0);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should switch the call sample tab, and draw the first before anything is chosen', () => {
    // Given, `activeLang` is empty on the server and in the first client render, so both sides
    // draw the same tab and the hydration matches.
    const onSelect = vi.fn();
    const tree = CodeSample({
      samples: [
        { lang: 'bash', label: 'cURL', sourceHtml: '<pre>curl</pre>' },
        { lang: 'python', label: '', sourceHtml: '<pre>httpx</pre>' },
      ],
      activeLang: '',
      onSelect,
    });

    // When
    const tabs = allByClass(tree, 'tt-sample-tab');
    handler(nthByClass(tree, 'tt-sample-tab', 1), 'onClick')(undefined);

    // Then
    expect(onSelect).toHaveBeenCalledWith('python');
    expect((tabs[0]?.props as Record<string, unknown> | null)?.['aria-selected']).toBe('true');
  });

  it('should start and stop a stream, and say how it ended', () => {
    // Given
    const onStart = vi.fn();
    const onStop = vi.fn();
    const running = StreamLog({
      elements: [
        { seq: 1, data: '{"id":1}' },
        { seq: 2, data: 'nonsense', problem: 'not an object' },
      ],
      counts: { received: 2, invalid: 1, dropped: 3 },
      end: null,
      open: true,
      mounted: true,
      available: true,
      onStart,
      onStop,
    });

    // When
    handler(byClass(running, 'tt-stream-stop'), 'onClick')(undefined);

    // Then
    expect(onStop).toHaveBeenCalledTimes(1);

    // And a stream that is not running can be started, and one that ended says how
    const idle = StreamLog({
      elements: [],
      counts: { received: 0, invalid: 0, dropped: 0 },
      end: { reason: 'terminator', received: 4, invalid: 0 },
      open: false,
      mounted: true,
      available: true,
      onStart,
      onStop,
    });

    handler(byClass(idle, 'tt-stream-start'), 'onClick')(undefined);

    expect(onStart).toHaveBeenCalledTimes(1);
    expect(byClass(idle, 'tt-stream-end').children).toContain('ended on its terminator');
  });

  it('should choose a flow, type a client id and sign in and out of one scheme', () => {
    // Given a scheme with two flows and no session
    const onFlow = vi.fn();
    const onInput = vi.fn();
    const onSignIn = vi.fn();
    const onSignOut = vi.fn();
    const props = {
      schemes: [
        {
          id: 'oauth',
          type: 'oauth2' as const,
          flows: [
            { kind: 'authorizationCode' as const, scopes: ['orders:read'] },
            { kind: 'deviceAuthorization' as const, scopes: [] },
          ],
        },
      ],
      credentials: {},
      inputs: {},
      flows: {},
      chosenFlow: {},
      sessions: {},
      notices: {},
      devices: {},
      pending: null,
      mounted: true,
      onCredential: vi.fn(),
      onInput,
      onFlow,
      onSignIn,
      onSignOut,
    };
    const out = AuthPanel(props);

    // When
    handler(byClass(out, 'tt-auth-flow'), 'onClick')(undefined);
    // The second field, because a scheme a browser can send draws its credential field first and
    // the client id after it. Taking the first would have driven `onCredential` and passed.
    handler(nthByClass(out, 'tt-field-input', 1), 'onInput')({ target: { value: 'client-1' } });
    handler(byClass(out, 'tt-auth-signin'), 'onClick')(undefined);

    // Then
    expect(onFlow).toHaveBeenCalledWith('oauth', 'authorizationCode');
    expect(onInput).toHaveBeenCalledWith('oauth', 'clientId', 'client-1');
    expect(onSignIn).toHaveBeenCalledWith('oauth');

    // And the same control signs out once there is a session
    const signedIn = AuthPanel({
      ...props,
      sessions: { oauth: { signedIn: true, renewable: false } },
      devices: {
        oauth: {
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://example.com/device',
          expiresInSeconds: 600,
          intervalSeconds: 5,
        },
      },
      notices: { oauth: 'waiting on the reader' },
    });

    handler(byClass(signedIn, 'tt-auth-signin'), 'onClick')(undefined);

    expect(onSignOut).toHaveBeenCalledWith('oauth');
    expect(byClass(signedIn, 'tt-auth-code').children).toBe('WDJB-MJHT');
  });

  it('should draw the reason rather than nothing for a scheme a browser cannot send', () => {
    // Given, a scheme that draws nothing is indistinguishable from a scheme the document never
    // declared, which is what `unsendableCause` exists to prevent.
    const tree = AuthPanel({
      schemes: [
        { id: 'session', type: 'apiKey' as const, flows: [], unsendableCause: 'cookie-api-key' },
      ],
      credentials: {},
      inputs: {},
      flows: {},
      chosenFlow: {},
      sessions: {},
      notices: {},
      devices: {},
      pending: null,
      mounted: true,
      onCredential: vi.fn(),
      onInput: vi.fn(),
      onFlow: vi.fn(),
      onSignIn: vi.fn(),
      onSignOut: vi.fn(),
    });

    // When, Then
    expect(byClass(tree, 'tt-auth-unsendable').children).toBe(
      'this scheme travels in Cookie, which is a forbidden header name; the same origin proxy of ' +
        'SPEC 14.5 removes this one',
    );
  });

  it('should type a credential, and render nothing back before hydration has matched', () => {
    // Given, a credential that reached the markup would be a credential in the page cache, since
    // the render is cached by document hash per SPEC 12.
    const onCredential = vi.fn();
    const scheme = { id: 'apiKey', type: 'apiKey' as const, flows: [] };
    const base = {
      schemes: [scheme],
      credentials: { apiKey: 'secret' },
      inputs: {},
      flows: {},
      chosenFlow: {},
      sessions: {},
      notices: {},
      devices: {},
      pending: null,
      onCredential,
      onInput: vi.fn(),
      onFlow: vi.fn(),
      onSignIn: vi.fn(),
      onSignOut: vi.fn(),
    };

    // When
    const server = AuthPanel({ ...base, mounted: false });
    const client = AuthPanel({ ...base, mounted: true });

    // Then
    expect((byClass(server, 'tt-field-input').props as { value?: string }).value).toBe('');
    expect((byClass(server, 'tt-field-input').props as { disabled?: boolean }).disabled).toBe(true);
    expect((byClass(client, 'tt-field-input').props as { value?: string }).value).toBe('secret');

    handler(byClass(client, 'tt-field-input'), 'onInput')({ target: { value: 'other' } });
    expect(onCredential).toHaveBeenCalledWith('apiKey', 'other');
  });
});

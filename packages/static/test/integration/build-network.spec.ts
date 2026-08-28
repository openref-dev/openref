import { Socket } from 'node:net';
import { request as httpRequest } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSite } from '../../src/index';
import { fixtureAssets, MemoryOutputStore, miniDocument } from '../mocks/documents';

/**
 * SPEC 16.3's zero outbound requests, proved by interception rather than by reading the code.
 *
 * THE TRAP IS PROVED BEFORE THE BUILD IS JUDGED BY IT. A recorder that watched nothing would
 * report zero calls and look exactly like a build that made none, so the first case makes a
 * request itself and asserts the recorder saw it. Only then does the second case assert the
 * build made none.
 *
 * WHAT IT WATCHES, AND IT IS TWO THINGS BECAUSE ONE WAS NOT ENOUGH. `Socket.prototype.connect`
 * catches `node:http`, `node:https` and `node:tls`, which all construct a socket and call it. It
 * does NOT catch `fetch`: measured on this Node, a `node:http` request recorded one call and a
 * `fetch` to the same address recorded none, because the undici built into the runtime reaches
 * the network through internal bindings rather than through the public prototype. The first
 * version of this file watched the prototype alone and would have reported a clean zero for a
 * build that called `fetch` on every page. So `globalThis.fetch` is wrapped beside it, and both
 * are exercised below before either is trusted.
 *
 * WHAT IT DOES NOT WATCH, said rather than implied: a UDP socket and a unix domain socket.
 * Neither is an outbound request in the sense SPEC 16.3 is about.
 */

/** What the trap saw. */
interface Recorder {
  readonly calls: string[];
  restore(): void;
}

/** Wraps the two choke points and records what was asked for, refusing each. */
function trapNetwork(): Recorder {
  const calls: string[] = [];

  // The two hooks are held as `unknown` and put back as they were: the point is to restore the
  // exact values, and naming their types would be a second, weaker description of them.
  const prototype = Socket.prototype as unknown as Record<string, unknown>;
  const globals = globalThis as unknown as Record<string, unknown>;
  const originalConnect = prototype.connect;
  const originalFetch = globals.fetch;

  prototype.connect = (...args: unknown[]): never => {
    const target = args[0];
    const description =
      typeof target === 'object' && target !== null
        ? ((target as { host?: string }).host ?? JSON.stringify(target))
        : String(target);
    calls.push(`connect ${description}`);
    throw new Error('the static build opened a socket');
  };

  globals.fetch = (input: unknown): never => {
    calls.push(`fetch ${String(input)}`);
    throw new Error('the static build made an outbound request');
  };

  return {
    calls,
    restore(): void {
      prototype.connect = originalConnect;
      globals.fetch = originalFetch;
    },
  };
}

let recorder: Recorder | null = null;

beforeEach(() => {
  recorder = trapNetwork();
});

afterEach(() => {
  recorder?.restore();
  recorder = null;
});

describe('the network trap', () => {
  it('should record a socket, so a later zero means the build opened none', () => {
    // Given
    const trap = recorder;

    // When: the refusal is synchronous, because a trap that let the connection proceed would be
    // a test that opened a socket.
    const act = (): unknown => httpRequest('http://127.0.0.1:9/anything').end();

    // Then
    expect(act).toThrow('the static build opened a socket');
    expect(trap?.calls.filter((call) => call.startsWith('connect'))).toHaveLength(1);
  });

  it('should record a fetch, which the socket hook alone does not see', () => {
    // Given
    const trap = recorder;

    // When
    const act = (): unknown => fetch('http://127.0.0.1:9/anything');

    // Then: measured on this Node, `fetch` reaches the network without touching the public
    // socket prototype, so watching that alone would have reported a clean zero for a build
    // that called it. Both hooks exist because this case proved one was not enough.
    expect(act).toThrow();
    expect(trap?.calls).toEqual(['fetch http://127.0.0.1:9/anything']);
  });
});

describe('buildSite, outbound requests', () => {
  it('should make none, and still produce the whole site', async () => {
    // Given
    const store = new MemoryOutputStore();

    // When
    const report = await buildSite({
      document: miniDocument(),
      store,
      assets: fixtureAssets(),
      base: 'https://docs.example.com/api',
    });

    // Then: the build ran, wrote pages, and reached nobody. Both halves are asserted, because
    // a build that threw early would also have made no requests.
    expect(report.rendered).toHaveLength(9);
    expect(store.files.size).toBeGreaterThan(10);
    expect(recorder?.calls).toEqual([]);
  });
});

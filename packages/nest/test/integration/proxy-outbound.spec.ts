import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ProxyBlockedError } from '@openref/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeOutboundHttp } from '../../src/proxy/infrastructure/adapters/node-outbound.adapter';

/**
 * The outbound client, against a server that is really there.
 *
 * WHY THE SUBJECT IS ASSERTED FIRST. SPEC 0's fifth defect class is a proof of absence that passes
 * because the thing it is about was absent: "the proxy did not reach the internal server" is true
 * of a machine with no internal server on it, and it is true of a proxy with no checks. So the
 * first case here reaches the server directly and reads its answer. Everything after it is about a
 * client that will not.
 *
 * WHAT THIS FILE CANNOT TEST, SAID RATHER THAN LEFT OUT. The adapter refuses to open a connection
 * to any address that is not global unicast, and every address a test can bind a listener to is
 * one of those. So the forwarded path, an answer coming back through this client, is exercised
 * against a fake transport in `proxy-ssrf.spec.ts` and against nothing here, and a case in this
 * file that appeared to prove it would be proving something else.
 */

let server: Server;
let port = 0;
let reached = 0;

beforeAll(async () => {
  server = createServer((_request, response) => {
    reached += 1;
    response.statusCode = 302;
    response.setHeader('location', 'http://127.0.0.1:1/admin');
    response.end('moved');
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
});

describe('NodeOutboundHttp', () => {
  it('should be pointed at a server that is really listening', async () => {
    // Given the subject of every refusal below. Without this the cases that follow would pass
    // against a port nothing is bound to, which is the state they are supposed to rule out.
    const before = reached;

    // When
    const status = await new Promise<number>((resolve, reject) => {
      get({ hostname: '127.0.0.1', port, path: '/admin' }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }).on('error', reject);
    });

    // Then
    expect(status).toBe(302);
    expect(reached).toBe(before + 1);
  });

  it('should refuse to open a connection to the loopback it was handed', async () => {
    // Given a request that got past everything above it, with the loopback as its address. This
    // is the second of the two checks SPEC 14.5 asks for: the policy checked this address a
    // moment ago and the client checks it again at the instant of connecting, because the port
    // is public enough that the value will one day arrive from somewhere else.
    const before = reached;
    const outbound = new NodeOutboundHttp();

    // When, Then
    await expect(
      outbound.send({
        method: 'GET',
        url: `http://127.0.0.1:${String(port)}/admin`,
        headers: {},
        body: null,
        address: '127.0.0.1',
        timeoutMs: 5_000,
        maxResponseBytes: 1_000,
      }),
    ).rejects.toThrow(ProxyBlockedError);

    // And the server it would have reached was not reached
    expect(reached).toBe(before);
  });

  it('should refuse the link local address a forged request aims at', async () => {
    // Given
    const outbound = new NodeOutboundHttp();

    // When, Then
    await expect(
      outbound.send({
        method: 'GET',
        url: 'http://169.254.169.254/latest/meta-data/',
        headers: {},
        body: null,
        address: '169.254.169.254',
        timeoutMs: 5_000,
        maxResponseBytes: 1_000,
      }),
    ).rejects.toThrow(/link local/);
  });
});

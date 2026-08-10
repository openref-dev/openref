import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '@openref/core';
import { ExpressReferenceAdapter } from '../../src/http/infrastructure/adapters/express-reference.adapter';
import { FastifyReferenceAdapter } from '../../src/http/infrastructure/adapters/fastify-reference.adapter';
import { createReferenceAdapter } from '../../src/http/infrastructure/adapters/reference-adapter.factory';
import { readNestedString, readStringRecord } from '../../src/http/domain/request-shape';
import { fakeExpressResponse, fakeFastifyReply, fakeHttpAdapter } from '../mocks/fixtures';
import type {
  ReferenceReply,
  ReferenceRequest,
} from '../../src/http/application/ports/reference-http.port';

const OK: ReferenceReply = {
  status: 200,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body: 'hello',
};

/** Waits for the handler promise chain the adapters start. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('readStringRecord', () => {
  it('should keep string values and drop everything else', () => {
    // Given
    const request = { params: { id: 'a', repeated: ['b'], count: 2 } };

    // When
    const result = readStringRecord(request, 'params');

    // Then
    expect(result).toEqual({ id: 'a' });
  });

  it('should read an absent or wrongly shaped holder as empty', () => {
    // Given
    const sources = [undefined, null, {}, { params: 'not a record' }];

    // When
    const results = sources.map((source) => readStringRecord(source, 'params'));

    // Then
    expect(results).toEqual([{}, {}, {}, {}]);
  });
});

describe('readNestedString', () => {
  it('should follow a path to a string', () => {
    // Given
    const reply = { cspNonce: { script: 'n0nce' } };

    // When
    const result = readNestedString(reply, ['cspNonce', 'script']);

    // Then
    expect(result).toBe('n0nce');
  });

  it('should give up rather than throw on any missing step', () => {
    // Given
    const replies = [{}, { cspNonce: null }, { cspNonce: { script: 7 } }];

    // When
    const results = replies.map((reply) => readNestedString(reply, ['cspNonce', 'script']));

    // Then
    expect(results).toEqual([undefined, undefined, undefined]);
  });
});

describe('ExpressReferenceAdapter', () => {
  it('should write status, headers and body to the Node response', async () => {
    // Given
    const nest = fakeHttpAdapter('express');
    const adapter = new ExpressReferenceAdapter(nest);
    adapter.get('/docs', () => Promise.resolve(OK));
    const reply = fakeExpressResponse();

    // When
    nest.routes[0]?.handler({ params: {}, headers: {} }, reply);
    await settle();

    // Then
    expect([reply.statusCode, reply.headers['content-type'], reply.body]).toEqual([
      200,
      'text/plain; charset=utf-8',
      'hello',
    ]);
  });

  it('should take the nonce a helmet integration left on res.locals', async () => {
    // Given
    const nest = fakeHttpAdapter('express');
    const adapter = new ExpressReferenceAdapter(nest);
    const seen: ReferenceRequest[] = [];
    adapter.get('/docs', (request) => {
      seen.push(request);
      return Promise.resolve(OK);
    });

    // When
    nest.routes[0]?.handler({}, fakeExpressResponse({ cspNonce: 'from-helmet' }));
    await settle();

    // Then
    expect(seen[0]?.nonce).toBe('from-helmet');
  });

  it('should prefer the nonce the host supplied over the convention', async () => {
    // Given
    const nest = fakeHttpAdapter('express');
    const adapter = new ExpressReferenceAdapter(nest, { nonce: () => 'from-host' });
    const seen: ReferenceRequest[] = [];
    adapter.get('/docs', (request) => {
      seen.push(request);
      return Promise.resolve(OK);
    });

    // When
    nest.routes[0]?.handler({}, fakeExpressResponse({ cspNonce: 'from-helmet' }));
    await settle();

    // Then
    expect(seen[0]?.nonce).toBe('from-host');
  });

  it('should answer a handler that threw with a 500 that says nothing about it', async () => {
    // Given
    const nest = fakeHttpAdapter('express');
    const onError = vi.fn();
    const adapter = new ExpressReferenceAdapter(nest, { onError });
    adapter.get('/docs', () => Promise.reject(new Error('secret path /etc/passwd')));
    const reply = fakeExpressResponse();

    // When
    nest.routes[0]?.handler({}, reply);
    await settle();

    // Then
    expect(reply.statusCode).toBe(500);
    expect(String(reply.body)).not.toContain('/etc/passwd');
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('FastifyReferenceAdapter', () => {
  it('should write through the reply object rather than the raw socket', async () => {
    // Given
    const nest = fakeHttpAdapter('fastify');
    const adapter = new FastifyReferenceAdapter(nest);
    adapter.get('/docs', () => Promise.resolve(OK));
    const reply = fakeFastifyReply();

    // When
    nest.routes[0]?.handler({ params: {}, headers: {} }, reply);
    await settle();

    // Then
    expect([reply.statusCode, reply.headers['content-type'], reply.body]).toEqual([
      200,
      'text/plain; charset=utf-8',
      'hello',
    ]);
  });

  it('should send bytes as a Buffer, since Fastify would serialize an array to JSON', async () => {
    // Given
    const nest = fakeHttpAdapter('fastify');
    const adapter = new FastifyReferenceAdapter(nest);
    const font = new Uint8Array([119, 79, 70, 50]);
    adapter.get('/docs', () =>
      Promise.resolve({ status: 200, headers: {}, body: font } satisfies ReferenceReply),
    );
    const reply = fakeFastifyReply();

    // When
    nest.routes[0]?.handler({}, reply);
    await settle();

    // Then
    expect(Buffer.isBuffer(reply.body)).toBe(true);
    expect(Buffer.from(font).equals(reply.body as Buffer)).toBe(true);
  });

  it('should take the nonce @fastify/helmet left on the reply', async () => {
    // Given
    const nest = fakeHttpAdapter('fastify');
    const adapter = new FastifyReferenceAdapter(nest);
    const seen: ReferenceRequest[] = [];
    adapter.get('/docs', (request) => {
      seen.push(request);
      return Promise.resolve(OK);
    });

    // When
    nest.routes[0]?.handler({}, fakeFastifyReply('n0nce-from-helmet'));
    await settle();

    // Then
    expect(seen[0]?.nonce).toBe('n0nce-from-helmet');
  });
});

describe('createReferenceAdapter', () => {
  it('should pick the adapter the application actually runs on', () => {
    // Given
    const platforms = ['express', 'fastify'];

    // When
    const kinds = platforms.map(
      (platform) => createReferenceAdapter(fakeHttpAdapter(platform)).kind,
    );

    // Then
    expect(kinds).toEqual(['express', 'fastify']);
  });

  it('should refuse a third platform rather than registering routes that answer nothing', () => {
    // Given
    const nest = fakeHttpAdapter('hapi');

    // When
    const act = (): unknown => createReferenceAdapter(nest);

    // Then
    expect(act).toThrow(ConfigError);
    expect(act).toThrow(/hapi/);
  });
});

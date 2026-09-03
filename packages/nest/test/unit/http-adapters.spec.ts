import { describe, expect, it, vi } from 'vitest';
import { ConfigError } from '@openref/core';
import { ExpressReferenceAdapter } from '../../src/http/infrastructure/adapters/express-reference.adapter';
import { FastifyReferenceAdapter } from '../../src/http/infrastructure/adapters/fastify-reference.adapter';
import { createReferenceAdapter } from '../../src/http/infrastructure/adapters/reference-adapter.factory';
import { RouteAdmission } from '../../src/visibility/domain/admission';
import { readNestedString, readStringRecord } from '../../src/http/domain/request-shape';
import { fakeExpressResponse, fakeFastifyReply, fakeHttpAdapter } from '../mocks/fixtures';
import type {
  IReferenceHttpAdapter,
  ReferenceReply,
  ReferenceRequest,
} from '../../src/http/application/ports/reference-http.port';
import type { CanActivateLike } from '../../src/shared/types/nest-surface';

const OK: ReferenceReply = {
  status: 200,
  headers: { 'content-type': 'text/plain; charset=utf-8' },
  body: 'hello',
};

/** Waits for the handler promise chain the adapters start. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * A guard that records that it ran, and answers what it was built with.
 *
 * @param log - Where the two events of one request are written, in the order they happen
 * @param admits - What it decides
 * @returns The guard
 */
function recordingGuard(log: string[], admits: boolean): CanActivateLike {
  return {
    canActivate: (): boolean => {
      log.push('gate');

      return admits;
    },
  };
}

/**
 * A request whose body exists only in its socket, and which records being drained.
 *
 * NO `body` PROPERTY, DELIBERATELY. `readRequestBody` returns a framework parsed body without
 * touching the stream, and a request carrying one would answer the same whichever order the two
 * lines are in. This is the shape an Express host with no `express.json()` hands over, which is
 * also the shape the eight megabyte ceiling exists for.
 *
 * @param log - Where the two events of one request are written, in the order they happen
 * @returns The request
 */
function recordingRequest(log: string[]): unknown {
  const request = {
    params: {},
    query: {},
    headers: {},
    on(event: string, listener: (chunk: unknown) => void): unknown {
      if (event === 'data') {
        log.push('body');
        listener(Buffer.from('{"method":"GET"}'));
      }
      if (event === 'end') {
        queueMicrotask(() => {
          listener(undefined);
        });
      }

      return request;
    },
    destroy: (): unknown => undefined,
  };

  return request;
}

/**
 * Drives one POST route on one platform and reports what happened, in order.
 *
 * @param platform - Which of SPEC 23's two adapters answers
 * @param admits - What the guard decides
 * @returns The order the two events happened in, and the status written
 */
async function orderOfOneRequest(
  platform: 'express' | 'fastify',
  admits: boolean,
): Promise<{ readonly log: readonly string[]; readonly status: number }> {
  const log: string[] = [];
  const nest = fakeHttpAdapter(platform);
  const admission = RouteAdmission.behind([recordingGuard(log, admits)]);
  const adapter: IReferenceHttpAdapter =
    platform === 'express'
      ? new ExpressReferenceAdapter(nest, admission)
      : new FastifyReferenceAdapter(nest, admission);
  adapter.post('/docs/_proxy', () => Promise.resolve(OK));

  const reply = platform === 'express' ? fakeExpressResponse() : fakeFastifyReply();
  nest.routes[0]?.handler(recordingRequest(log), reply);
  await settle();
  await settle();

  return { log, status: reply.statusCode };
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
    const adapter = new ExpressReferenceAdapter(nest, RouteAdmission.open());
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
    const adapter = new ExpressReferenceAdapter(nest, RouteAdmission.open());
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
    const adapter = new ExpressReferenceAdapter(nest, RouteAdmission.open(), {
      nonce: () => 'from-host',
    });
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
    const adapter = new ExpressReferenceAdapter(nest, RouteAdmission.open(), { onError });
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
    const adapter = new FastifyReferenceAdapter(nest, RouteAdmission.open());
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
    const adapter = new FastifyReferenceAdapter(nest, RouteAdmission.open());
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
    const adapter = new FastifyReferenceAdapter(nest, RouteAdmission.open());
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

/**
 * SPEC 19.6's last sentence, which was a comment and a JSDoc and nothing that could fail.
 *
 * THE ORDER IS OBSERVABLE FROM OUTSIDE, so the check is behavioural rather than structural. The
 * body of the one route that takes one is read through the request object itself, so a request
 * that counts being drained tells "the body was not read" apart from "the body was read and
 * thrown away", which is the whole difference between refusing a call and paying eight megabytes
 * for it. Reversing the two lines of `resolve` on either adapter turns both cases below red.
 *
 * PRESENCE BEFORE ABSENCE, IN ONE CASE RATHER THAN TWO. The admitted run is asserted first, on the
 * same request shape, because a request nobody could have read and a request nobody chose to read
 * look identical to an absence check on its own.
 */
describe('the body of a request the admission refuses', () => {
  for (const platform of ['express', 'fastify'] as const) {
    it(`should be read after the gate on ${platform}, and not at all when it refuses`, async () => {
      // Given: the same route, the same request shape, driven behind a guard that admits and
      // behind one that refuses
      // When
      const admitted = await orderOfOneRequest(platform, true);
      const refused = await orderOfOneRequest(platform, false);

      // Then, presence: this request really is one whose body has to be drained to be read, and
      // the gate really does run in front of it
      expect(admitted.log).toEqual(['gate', 'body']);
      expect(admitted.status).toBe(200);

      // And absence: the refusal is answered without the body ever being touched
      expect(refused.log).toEqual(['gate']);
      expect(refused.status).toBe(403);
    });
  }
});

describe('createReferenceAdapter', () => {
  it('should pick the adapter the application actually runs on', () => {
    // Given
    const platforms = ['express', 'fastify'];

    // When
    const kinds = platforms.map(
      (platform) => createReferenceAdapter(fakeHttpAdapter(platform), RouteAdmission.open()).kind,
    );

    // Then
    expect(kinds).toEqual(['express', 'fastify']);
  });

  it('should refuse a third platform rather than registering routes that answer nothing', () => {
    // Given
    const nest = fakeHttpAdapter('hapi');

    // When
    const act = (): unknown => createReferenceAdapter(nest, RouteAdmission.open());

    // Then
    expect(act).toThrow(ConfigError);
    expect(act).toThrow(/hapi/);
  });
});
